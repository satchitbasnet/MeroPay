import {
  RedirectToSignIn,
  SignedIn,
  UserButton,
} from "@neondatabase/neon-js/auth/react/ui";
import { useEffect } from "react";

function AuthBridge() {
  useEffect(() => {
    localStorage.setItem("meropay_auth", "signed_in");
    window.location.href = "/";
  }, []);
  return null;
}

export function Home() {
  return (
    <>
      <SignedIn>
        <AuthBridge />
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            alignItems: "center",
            minHeight: "100vh",
            gap: "2rem",
          }}
        >
          <div style={{ textAlign: "center" }}>
            <h1>Welcome!</h1>
            <p>You're successfully authenticated.</p>
            <UserButton />
          </div>
        </div>
      </SignedIn>
      <RedirectToSignIn />
    </>
  );
}
