import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { NeonAuthUIProvider } from "@neondatabase/neon-js/auth/react";
import "@neondatabase/neon-js/ui/css";
import App from "./App";
import { authClient } from "./lib/auth";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <NeonAuthUIProvider emailOTP authClient={authClient}>
      <HashRouter>
        <App />
      </HashRouter>
    </NeonAuthUIProvider>
  </StrictMode>
);
