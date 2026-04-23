import express from "express";
import cors from "cors";
import { PrismaClient } from "@prisma/client";

const app = express();
const PORT = process.env.PORT || 3000;
const prisma = new PrismaClient();

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

app.get("/api/health", async (_req, res) => {
  const [usersCount, txCount] = await Promise.all([
    prisma.user.count(),
    prisma.transaction.count(),
  ]);
  res.json({ ok: true, users: usersCount, transactions: txCount });
});

app.post("/api/transfer", async (req, res) => {
  const { senderId, receiverUsername, amount } = req.body || {};
  const parsedAmount = Number(amount);

  if (!senderId || !receiverUsername || !Number.isFinite(parsedAmount)) {
    return res.status(400).json({
      success: false,
      message: "senderId, receiverUsername, and amount are required",
    });
  }
  if (parsedAmount <= 0 || !Number.isInteger(parsedAmount)) {
    return res.status(400).json({
      success: false,
      message: "Amount must be a positive integer",
    });
  }

  try {
    const receipt = await prisma.$transaction(async (tx) => {
      const sender = await tx.user.findUnique({ where: { id: senderId } });
      if (!sender) throw new Error("Sender not found");

      const receiver = await tx.user.findFirst({
        where: {
          username: {
            equals: receiverUsername.startsWith("@")
              ? receiverUsername
              : `@${receiverUsername}`,
            mode: "insensitive",
          },
        },
      });
      if (!receiver) throw new Error("Receiver not found");
      if (sender.id === receiver.id) throw new Error("Cannot pay yourself");
      if (sender.balance < parsedAmount) throw new Error("Insufficient funds");

      const nextSender = await tx.user.update({
        where: { id: sender.id },
        data: { balance: { decrement: parsedAmount } },
      });
      const nextReceiver = await tx.user.update({
        where: { id: receiver.id },
        data: { balance: { increment: parsedAmount } },
      });

      const ledger = await tx.transaction.create({
        data: {
          id: `txn_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          amount: parsedAmount,
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
    return res.status(400).json({
      success: false,
      message: error?.message || "Transfer failed",
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
