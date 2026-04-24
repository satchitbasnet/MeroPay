import crypto from "crypto";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { PrismaClient } from "@prisma/client";

dotenv.config({ override: true });

const app = express();
const PORT = Number(process.env.PORT || 3000);
const prisma = new PrismaClient();
const MAX_TRANSFER_AMOUNT = 1_000_000;
const AUTH_TOKEN_TTL_SECONDS = Number(process.env.AUTH_TOKEN_TTL_SECONDS || 3600);
const QR_TOKEN_TTL_SECONDS = Number(process.env.QR_TOKEN_TTL_SECONDS || 300);
const QR_CLOCK_SKEW_SECONDS = Number(process.env.QR_CLOCK_SKEW_SECONDS || 30);
const IDEMPOTENCY_TTL_SECONDS = Number(process.env.IDEMPOTENCY_TTL_SECONDS || 86400);
const NONCE_TTL_SECONDS = Number(process.env.NONCE_TTL_SECONDS || 900);
const APP_ORIGIN = process.env.APP_ORIGIN || "http://localhost:5174";
const AUTH_TOKEN_SECRET = process.env.AUTH_TOKEN_SECRET || "dev-only-change-auth-secret";
const QR_ACTIVE_KID = process.env.QR_ACTIVE_KID || "v1";
const QR_SIGNING_KEYS = readQrSigningKeys();
const allowedOrigins = new Set([APP_ORIGIN, "http://localhost:5173", "http://localhost:5174"]);

const seedUsers = [
  ["u_rajesh", { id: "u_rajesh", username: "@rajesh_ktm", balance: 45280 }],
  ["u_sita", { id: "u_sita", username: "@sita_pkr", balance: 12850 }],
  ["u_bikram", { id: "u_bikram", username: "@bikram99", balance: 93210 }],
  ["u_anu", { id: "u_anu", username: "@anu_magar", balance: 18720 }],
  ["u_priya", { id: "u_priya", username: "@priya_ktm", balance: 22340 }],
  ["u_dipesh", { id: "u_dipesh", username: "@dipesh_bkt", balance: 10110 }],
  ["u_coffee", { id: "u_coffee", username: "@coffee_shop", balance: 50000 }],
];

class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function readQrSigningKeys() {
  const defaultKeys = { v1: process.env.QR_SIGNING_SECRET || "dev-only-change-qr-secret" };
  if (!process.env.QR_SIGNING_KEYS) return defaultKeys;
  try {
    const parsed = JSON.parse(process.env.QR_SIGNING_KEYS);
    if (!parsed || typeof parsed !== "object") return defaultKeys;
    return parsed;
  } catch (_error) {
    return defaultKeys;
  }
}

function assertSecurityConfig() {
  if (!QR_SIGNING_KEYS[QR_ACTIVE_KID]) {
    throw new Error(`QR signing key id "${QR_ACTIVE_KID}" is missing in QR_SIGNING_KEYS`);
  }
}

function base64urlEncode(value) {
  return Buffer.from(value).toString("base64url");
}

function base64urlDecode(value) {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signHmac(input, secret) {
  return crypto.createHmac("sha256", secret).update(input).digest("base64url");
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value);
  } catch (_err) {
    return null;
  }
}

function sendApiError(res, status, code, message, details = null) {
  return res.status(status).json({
    success: false,
    error: { code, message, details },
  });
}

function logSecurity(event, details = {}) {
  console.log(`[security:${event}]`, JSON.stringify(details));
}

function normalizeUsername(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw) return "";
  return raw.startsWith("@") ? raw : `@${raw}`;
}

function createAuthToken(userId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    sub: userId,
    iat: now,
    exp: now + AUTH_TOKEN_TTL_SECONDS,
  };
  const payloadEncoded = base64urlEncode(JSON.stringify(payload));
  const sig = signHmac(payloadEncoded, AUTH_TOKEN_SECRET);
  return `${payloadEncoded}.${sig}`;
}

function parseAuthToken(token) {
  const [payloadEncoded, signature] = String(token || "").split(".");
  if (!payloadEncoded || !signature) {
    throw new ApiError(401, "AUTH_INVALID_TOKEN", "Missing or invalid auth token");
  }
  const expectedSig = signHmac(payloadEncoded, AUTH_TOKEN_SECRET);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    throw new ApiError(401, "AUTH_INVALID_TOKEN", "Invalid auth token signature");
  }
  const payload = safeJsonParse(base64urlDecode(payloadEncoded));
  if (!payload || !payload.sub || !payload.exp) {
    throw new ApiError(401, "AUTH_INVALID_TOKEN", "Malformed auth token payload");
  }
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new ApiError(401, "AUTH_TOKEN_EXPIRED", "Auth token expired");
  }
  return payload;
}

async function requireAuth(req, _res, next) {
  try {
    const authHeader = String(req.headers.authorization || "");
    if (!authHeader.startsWith("Bearer ")) {
      throw new ApiError(401, "AUTH_REQUIRED", "Authorization bearer token is required");
    }
    const token = authHeader.slice(7).trim();
    const payload = parseAuthToken(token);
    const user = await prisma.user.findUnique({ where: { id: payload.sub } });
    if (!user) {
      throw new ApiError(401, "AUTH_USER_NOT_FOUND", "Authenticated user no longer exists");
    }
    req.auth = { userId: user.id, username: user.username };
    next();
  } catch (error) {
    if (error instanceof ApiError) {
      logSecurity("auth_failed", { code: error.code, path: req.path });
      return sendApiError(req.res, error.status, error.code, error.message);
    }
    return sendApiError(req.res, 401, "AUTH_FAILED", "Authentication failed");
  }
}

function createSignedQrToken(payload) {
  const header = { alg: "HS256", typ: "MPQR", kid: QR_ACTIVE_KID };
  const headerEncoded = base64urlEncode(JSON.stringify(header));
  const payloadEncoded = base64urlEncode(JSON.stringify(payload));
  const signingInput = `${headerEncoded}.${payloadEncoded}`;
  const signature = signHmac(signingInput, QR_SIGNING_KEYS[QR_ACTIVE_KID]);
  return `${signingInput}.${signature}`;
}

function verifySignedQrToken(token) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3) {
    throw new ApiError(400, "QR_INVALID_FORMAT", "QR token format is invalid");
  }
  const [headerEncoded, payloadEncoded, signature] = parts;
  const header = safeJsonParse(base64urlDecode(headerEncoded));
  const payload = safeJsonParse(base64urlDecode(payloadEncoded));
  if (!header || !payload || header.typ !== "MPQR" || !header.kid) {
    throw new ApiError(400, "QR_INVALID_FORMAT", "QR token structure is invalid");
  }
  const secret = QR_SIGNING_KEYS[header.kid];
  if (!secret) {
    throw new ApiError(400, "QR_UNKNOWN_KEY", "QR signing key is unknown");
  }
  const expectedSig = signHmac(`${headerEncoded}.${payloadEncoded}`, secret);
  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
    throw new ApiError(400, "QR_INVALID_SIGNATURE", "QR signature verification failed");
  }
  const now = Math.floor(Date.now() / 1000);
  if (!payload.exp || payload.exp + QR_CLOCK_SKEW_SECONDS < now) {
    throw new ApiError(400, "QR_EXPIRED", "QR code has expired");
  }
  if (!payload.iat || payload.iat - QR_CLOCK_SKEW_SECONDS > now) {
    throw new ApiError(400, "QR_NOT_YET_VALID", "QR token time is invalid");
  }
  return payload;
}

function validateTransferPayload(body) {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "INVALID_BODY", "Request body must be a JSON object");
  }

  const receiverUsername = normalizeUsername(body.receiverUsername);
  const amount = Number(body.amount);

  if (!receiverUsername) {
    throw new ApiError(400, "INVALID_RECEIVER_USERNAME", "receiverUsername is required");
  }
  if (!/^@[a-z0-9_]{3,32}$/i.test(receiverUsername)) {
    throw new ApiError(
      400,
      "INVALID_RECEIVER_USERNAME",
      "receiverUsername must be 3-32 characters and use letters, numbers, or underscores"
    );
  }
  if (!Number.isFinite(amount) || !Number.isInteger(amount)) {
    throw new ApiError(400, "INVALID_AMOUNT", "amount must be an integer");
  }
  if (amount <= 0) {
    throw new ApiError(400, "INVALID_AMOUNT", "amount must be greater than 0");
  }
  if (amount > MAX_TRANSFER_AMOUNT) {
    throw new ApiError(
      400,
      "INVALID_AMOUNT",
      `amount must be less than or equal to ${MAX_TRANSFER_AMOUNT}`
    );
  }

  return { receiverUsername, amount };
}

function getIdempotencyKey(req) {
  const key = String(req.headers["idempotency-key"] || "").trim();
  if (!key) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_REQUIRED", "Idempotency-Key header is required");
  }
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(400, "IDEMPOTENCY_KEY_INVALID", "Idempotency key format is invalid");
  }
  return key;
}

function buildRequestHash(userId, receiverUsername, amount) {
  return crypto
    .createHash("sha256")
    .update(`${userId}|${receiverUsername}|${amount}`)
    .digest("hex");
}

async function ensureSeedData() {
  for (const [, user] of seedUsers) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: user,
    });
  }
}

const transferRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many transfer attempts, slow down." },
  },
});

const qrVerifyRateLimit = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: { code: "RATE_LIMITED", message: "Too many QR scans, try again shortly." },
  },
});

app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("CORS blocked"));
    },
  })
);
app.use(helmet());
app.use(express.json({ limit: "16kb" }));

app.get("/api/health", async (_req, res) => {
  try {
    const [usersCount, txCount] = await Promise.all([
      prisma.user.count(),
      prisma.transaction.count(),
    ]);
    res.json({ ok: true, users: usersCount, transactions: txCount });
  } catch (error) {
    sendApiError(res, 500, "HEALTH_CHECK_FAILED", "Failed to query health state", {
      reason: error?.message || "Unknown error",
    });
  }
});

app.post("/api/auth/dev-token", async (req, res) => {
  try {
    const userId = String(req.body?.userId || "").trim();
    if (!userId) throw new ApiError(400, "INVALID_USER_ID", "userId is required");
    const user = await prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new ApiError(404, "USER_NOT_FOUND", "User not found");
    const token = createAuthToken(user.id);
    res.json({ success: true, token, user: { id: user.id, username: user.username } });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendApiError(res, error.status, error.code, error.message, error.details);
    }
    return sendApiError(res, 500, "TOKEN_ISSUE_FAILED", "Failed to create auth token");
  }
});

app.post("/api/qr/create", requireAuth, async (req, res) => {
  try {
    const requestedAmount = req.body?.amount;
    const amount = requestedAmount == null || requestedAmount === "" ? null : Number(requestedAmount);
    if (amount != null) {
      if (!Number.isFinite(amount) || !Number.isInteger(amount) || amount <= 0) {
        throw new ApiError(400, "INVALID_AMOUNT", "amount must be a positive integer");
      }
      if (amount > MAX_TRANSFER_AMOUNT) {
        throw new ApiError(400, "INVALID_AMOUNT", "amount exceeds maximum allowed");
      }
    }
    const now = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    const payload = {
      v: 1,
      type: "payment_intent",
      merchantUsername: req.auth.username,
      amount,
      currency: "NPR",
      nonce,
      iat: now,
      exp: now + QR_TOKEN_TTL_SECONDS,
    };
    const token = createSignedQrToken(payload);
    res.json({
      success: true,
      token,
      qrUrl: `https://app.meropay.com/pay?t=${encodeURIComponent(token)}`,
      expiresAt: payload.exp,
      merchantUsername: payload.merchantUsername,
      amount: payload.amount,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendApiError(res, error.status, error.code, error.message, error.details);
    }
    return sendApiError(res, 500, "QR_CREATE_FAILED", "Failed to generate secure QR");
  }
});

app.post("/api/qr/verify", requireAuth, qrVerifyRateLimit, async (req, res) => {
  try {
    const token = String(req.body?.token || "").trim();
    if (!token) {
      throw new ApiError(400, "QR_TOKEN_REQUIRED", "token is required");
    }
    const payload = verifySignedQrToken(token);
    if (payload.type !== "payment_intent") {
      throw new ApiError(400, "QR_INVALID_TYPE", "Unsupported QR payload type");
    }
    if (payload.currency !== "NPR") {
      throw new ApiError(400, "QR_INVALID_CURRENCY", "Unsupported QR currency");
    }
    const merchantUsername = normalizeUsername(payload.merchantUsername);
    if (!merchantUsername) {
      throw new ApiError(400, "QR_INVALID_MERCHANT", "Merchant username missing");
    }
    const nonce = String(payload.nonce || "");
    if (!nonce) {
      throw new ApiError(400, "QR_INVALID_NONCE", "QR nonce missing");
    }
    const existingNonce = await prisma.qrNonce.findUnique({ where: { nonce } });
    if (existingNonce) {
      logSecurity("qr_replay_blocked", { nonce, userId: req.auth.userId });
      throw new ApiError(409, "QR_REPLAY_DETECTED", "QR code already used");
    }
    const merchant = await prisma.user.findFirst({
      where: { username: { equals: merchantUsername, mode: "insensitive" } },
      select: { id: true, username: true },
    });
    if (!merchant) {
      throw new ApiError(404, "QR_MERCHANT_NOT_FOUND", "Merchant account not found");
    }
    if (merchant.id === req.auth.userId) {
      throw new ApiError(400, "SELF_TRANSFER_BLOCKED", "Cannot pay yourself");
    }
    await prisma.qrNonce.create({
      data: {
        nonce,
        expiresAt: new Date((payload.exp + NONCE_TTL_SECONDS) * 1000),
      },
    });
    res.json({
      success: true,
      intent: {
        merchantId: merchant.id,
        merchantUsername: merchant.username,
        amount: payload.amount == null ? null : Number(payload.amount),
        currency: payload.currency,
        exp: payload.exp,
      },
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendApiError(res, error.status, error.code, error.message, error.details);
    }
    return sendApiError(res, 500, "QR_VERIFY_FAILED", "Failed to verify QR code");
  }
});

app.post("/api/transfer", requireAuth, transferRateLimit, async (req, res) => {
  try {
    const senderId = req.auth.userId;
    const { receiverUsername, amount } = validateTransferPayload(req.body);
    const idempotencyKey = getIdempotencyKey(req);
    const requestHash = buildRequestHash(senderId, receiverUsername, amount);
    const receipt = await prisma.$transaction(async (tx) => {
      const existing = await tx.idempotencyKey.findUnique({ where: { key: idempotencyKey } });
      if (existing) {
        if (existing.userId !== senderId || existing.requestHash !== requestHash) {
          throw new ApiError(409, "IDEMPOTENCY_KEY_CONFLICT", "Idempotency key already used");
        }
        if (existing.transactionId) {
          const existingTx = await tx.transaction.findUnique({
            where: { id: existing.transactionId },
            include: { sender: true, receiver: true },
          });
          if (existingTx) {
            return {
              replayed: true,
              id: existingTx.id,
              amount: existingTx.amount,
              senderId: existingTx.senderId,
              senderUsername: existingTx.sender.username,
              receiverId: existingTx.receiverId,
              receiverUsername: existingTx.receiver.username,
              status: existingTx.status,
              createdAt: existingTx.createdAt,
              balances: {
                sender: existingTx.sender.balance,
                receiver: existingTx.receiver.balance,
              },
            };
          }
        }
      } else {
        await tx.idempotencyKey.create({
          data: {
            key: idempotencyKey,
            userId: senderId,
            requestHash,
            expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_SECONDS * 1000),
          },
        });
      }

      const sender = await tx.user.findUnique({ where: { id: senderId } });
      if (!sender) throw new ApiError(404, "SENDER_NOT_FOUND", "Sender not found");

      const receiver = await tx.user.findFirst({
        where: {
          username: {
            equals: receiverUsername,
            mode: "insensitive",
          },
        },
      });
      if (!receiver) throw new ApiError(404, "RECEIVER_NOT_FOUND", "Receiver not found");
      if (sender.id === receiver.id) {
        throw new ApiError(400, "SELF_TRANSFER_BLOCKED", "Cannot transfer to your own account");
      }
      if (sender.balance < amount) {
        throw new ApiError(409, "INSUFFICIENT_FUNDS", "Insufficient funds");
      }

      const nextSender = await tx.user.update({
        where: { id: sender.id },
        data: { balance: { decrement: amount } },
      });
      const nextReceiver = await tx.user.update({
        where: { id: receiver.id },
        data: { balance: { increment: amount } },
      });

      const ledger = await tx.transaction.create({
        data: {
          id: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          amount,
          senderId: sender.id,
          receiverId: receiver.id,
          status: "COMPLETED",
        },
      });

      await tx.idempotencyKey.update({
        where: { key: idempotencyKey },
        data: { transactionId: ledger.id },
      });

      return {
        replayed: false,
        id: ledger.id,
        amount: ledger.amount,
        senderId: sender.id,
        senderUsername: sender.username,
        receiverId: receiver.id,
        receiverUsername: receiver.username,
        status: ledger.status,
        createdAt: ledger.createdAt,
        balances: {
          sender: nextSender.balance,
          receiver: nextReceiver.balance,
        },
      };
    });

    logSecurity("transfer_processed", {
      senderId,
      receiverUsername,
      amount,
      replayed: receipt.replayed,
    });
    return res.status(200).json({
      success: true,
      idempotentReplay: Boolean(receipt.replayed),
      receipt: {
        id: receipt.id,
        amount: receipt.amount,
        senderId: receipt.senderId,
        senderUsername: receipt.senderUsername,
        receiverId: receipt.receiverId,
        receiverUsername: receipt.receiverUsername,
        status: receipt.status,
        createdAt: receipt.createdAt,
      },
      balances: receipt.balances,
    });
  } catch (error) {
    if (error instanceof ApiError) {
      return sendApiError(res, error.status, error.code, error.message, error.details);
    }
    return sendApiError(res, 500, "TRANSFER_FAILED", "Transfer failed", {
      reason: error?.message || "Unknown error",
    });
  }
});

async function start() {
  assertSecurityConfig();
  await ensureSeedData();
  app.listen(PORT, () => {
    console.log(`MeroPay backend running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
