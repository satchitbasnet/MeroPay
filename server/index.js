import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();
const MAX_TRANSFER_AMOUNT = 1_000_000;

app.use(cors({ origin: true }));
app.use(express.json());

const seedUsers = [
  ["u_rajesh", { id: "u_rajesh", username: "@rajesh_ktm", balance: 45280 }],
  ["u_sita", { id: "u_sita", username: "@sita_pkr", balance: 12850 }],
  ["u_bikram", { id: "u_bikram", username: "@bikram99", balance: 93210 }],
  ["u_anu", { id: "u_anu", username: "@anu_magar", balance: 18720 }],
  ["u_priya", { id: "u_priya", username: "@priya_ktm", balance: 22340 }],
  ["u_dipesh", { id: "u_dipesh", username: "@dipesh_bkt", balance: 10110 }],
  ["u_coffee", { id: "u_coffee", username: "@coffee_shop", balance: 50000 }],
];

async function ensureSeedData() {
  for (const [, user] of seedUsers) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {},
      create: user,
    });
  }
}

class ApiError extends Error {
  constructor(status, code, message, details = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendApiError(res, status, code, message, details = null) {
  return res.status(status).json({
    success: false,
    error: { code, message, details },
  });
}

function normalizeUsername(rawValue) {
  const raw = String(rawValue || "").trim().toLowerCase();
  if (!raw) return "";
  const withPrefix = raw.startsWith("@") ? raw : `@${raw}`;
  return withPrefix;
}

function validateTransferPayload(body) {
  if (!body || typeof body !== "object") {
    throw new ApiError(400, "INVALID_BODY", "Request body must be a JSON object");
  }

  const senderId = String(body.senderId || "").trim();
  const receiverUsername = normalizeUsername(body.receiverUsername);
  const amount = Number(body.amount);

  if (!senderId) {
    throw new ApiError(400, "INVALID_SENDER_ID", "senderId is required");
  }
  if (senderId.length > 64) {
    throw new ApiError(400, "INVALID_SENDER_ID", "senderId must be 64 characters or less");
  }
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

  return { senderId, receiverUsername, amount };
}

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

app.post("/api/transfer", async (req, res) => {
  try {
    const { senderId, receiverUsername, amount } = validateTransferPayload(req.body);
    const receipt = await prisma.$transaction(async (tx) => {
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

      return {
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

    return res.status(200).json({
      success: true,
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
  await ensureSeedData();
  app.listen(PORT, () => {
    console.log(`MeroPay backend running on http://localhost:${PORT}`);
  });
}

start().catch((err) => {
  console.error("Failed to start backend:", err);
  process.exit(1);
});
