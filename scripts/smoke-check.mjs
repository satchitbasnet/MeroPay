import { spawn } from "node:child_process";

const HEALTH_URL = "http://localhost:3000/api/health";
const MAX_WAIT_MS = 12000;
const POLL_MS = 700;

async function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function checkHealth() {
  try {
    const res = await fetch(HEALTH_URL);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function waitForHealth() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < MAX_WAIT_MS) {
    const payload = await checkHealth();
    if (payload?.ok) return payload;
    await sleep(POLL_MS);
  }
  return null;
}

async function run() {
  const alreadyUp = await checkHealth();
  if (alreadyUp?.ok) {
    console.log("Smoke check: backend already healthy", JSON.stringify(alreadyUp));
    return;
  }

  const server = spawn(process.execPath, ["server/index.js"], {
    stdio: "ignore",
    windowsHide: true,
  });

  try {
    const payload = await waitForHealth();
    if (!payload?.ok) {
      throw new Error("Backend health check did not become ready in time");
    }
    console.log("Smoke check: backend started and healthy", JSON.stringify(payload));
  } finally {
    if (!server.killed) server.kill("SIGTERM");
  }
}

run().catch((err) => {
  console.error("Smoke check failed:", err?.message || err);
  process.exit(1);
});
