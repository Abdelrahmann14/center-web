import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { AuthProvider } from "@/auth/AuthContext";
import { ToastProvider } from "@/components/Toast";
import { SyncProvider } from "@/sync/SyncProvider";
import { installEnterAdvance } from "@/components/ui";
import App from "./App";
import "./index.css";

// Enter walks to the next field in every form; the last field still submits.
installEnterAdvance();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          {/* Runs the offline sync engine for the signed-in staff account and
              serves the screens their reads from the local mirror when the
              network is down. */}
          <SyncProvider>
            <App />
          </SyncProvider>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>
);
