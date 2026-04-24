const API_BASE_URL = "http://localhost:3000";

async function getDevToken(userId) {
  const response = await fetch(`${API_BASE_URL}/api/auth/dev-token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId }),
  });
  const data = await response.json();
  if (!response.ok || !data.success || !data.token) {
    throw new Error("Unable to mint development auth token");
  }
  return data.token;
}

async function assertJson(response, expectedCode) {
  const data = await response.json();
  if (data?.error?.code !== expectedCode) {
    throw new Error(`Expected error code ${expectedCode}, received ${data?.error?.code || "unknown"}`);
  }
}

async function run() {
  const token = await getDevToken("u_rajesh");

  const transferNoIdempotency = await fetch(`${API_BASE_URL}/api/transfer`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      receiverUsername: "@sita_pkr",
      amount: 100,
    }),
  });
  if (transferNoIdempotency.status !== 400) {
    throw new Error("Expected missing idempotency key to fail with 400");
  }
  await assertJson(transferNoIdempotency, "IDEMPOTENCY_KEY_REQUIRED");

  const badQr = await fetch(`${API_BASE_URL}/api/qr/verify`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ token: "not.a.real.token" }),
  });
  if (badQr.status !== 400) {
    throw new Error("Expected bad QR token to fail with 400");
  }
  await assertJson(badQr, "QR_INVALID_FORMAT");

  console.log("Security smoke checks passed.");
}

run().catch((error) => {
  console.error("Security smoke check failed:", error?.message || error);
  process.exit(1);
});
