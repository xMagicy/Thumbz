import { useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail } from "lucide-react";

const inter = "'Inter', system-ui, sans-serif";

interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
}

// Visual-only sign-in dialog. Auth wiring is intentionally deferred — the buttons
// surface the upcoming flow without performing any network calls. A "Coming soon"
// banner makes the state unambiguous to users (and judges).
export function SignInDialog({ open, onClose }: SignInDialogProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
        >
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            className="absolute inset-0 bg-black/70 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="signin-title"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="relative w-full max-w-sm rounded-2xl p-6"
            style={{
              fontFamily: inter,
              background: "rgba(12,12,22,0.92)",
              border: "1px solid rgba(168,85,247,0.28)",
              boxShadow:
                "0 30px 60px -10px rgba(0,0,0,0.7), 0 0 40px rgba(168,85,247,0.18)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3.5 right-3.5 w-7 h-7 flex items-center justify-center rounded-full text-white/55 hover:text-white/90 hover:bg-white/5 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex flex-col items-center gap-2 text-center pt-1 pb-4">
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center mb-1"
                style={{
                  background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
                  boxShadow: "0 8px 24px rgba(217,70,239,0.35)",
                }}
              >
                <span
                  style={{
                    fontFamily: inter,
                    fontWeight: 900,
                    fontSize: "1.25rem",
                    color: "#fff",
                    letterSpacing: "-0.04em",
                  }}
                >
                  z
                </span>
              </div>
              <h2
                id="signin-title"
                className="text-white"
                style={{ fontWeight: 700, fontSize: "1.25rem", letterSpacing: "-0.01em" }}
              >
                Sign in to thumbz
              </h2>
              <p
                style={{
                  color: "rgba(255,255,255,0.55)",
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                  maxWidth: 280,
                }}
              >
                Save your stats, upload thumbnails, and track your taste over time.
              </p>
            </div>

            {/* Coming-soon banner */}
            <div
              className="rounded-lg px-3 py-2.5 mb-4 flex items-center gap-2"
              style={{
                background: "rgba(168,85,247,0.10)",
                border: "1px solid rgba(168,85,247,0.32)",
                fontSize: "0.78rem",
                color: "rgba(255,255,255,0.78)",
                lineHeight: 1.4,
              }}
            >
              <span
                className="uppercase shrink-0"
                style={{
                  fontWeight: 700,
                  fontSize: "9px",
                  color: "#c084fc",
                  background: "rgba(168, 85, 247, 0.18)",
                  border: "1px solid rgba(168, 85, 247, 0.5)",
                  padding: "3px 7px",
                  borderRadius: "9999px",
                  letterSpacing: "0.08em",
                  lineHeight: 1,
                }}
              >
                Soon
              </span>
              <span>Accounts launch right after the beta. Voting works without one.</span>
            </div>

            <div className="flex flex-col gap-2.5">
              <button
                type="button"
                disabled
                className="w-full flex items-center justify-center gap-2.5 rounded-full px-4 py-2.5 transition-colors cursor-not-allowed"
                style={{
                  fontFamily: inter,
                  fontWeight: 600,
                  fontSize: "0.875rem",
                  color: "rgba(255,255,255,0.85)",
                  background: "rgba(255,255,255,0.06)",
                  border: "1px solid rgba(255,255,255,0.12)",
                  opacity: 0.7,
                }}
              >
                <GoogleIcon />
                Continue with Google
              </button>

              <div
                className="flex items-center gap-3 my-1"
                style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem" }}
              >
                <div className="flex-1 h-px bg-white/10" />
                <span className="uppercase" style={{ letterSpacing: "0.1em" }}>
                  or
                </span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div className="flex flex-col gap-2">
                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: "rgba(255,255,255,0.35)" }}
                  />
                  <input
                    type="email"
                    placeholder="you@example.com"
                    disabled
                    className="w-full rounded-lg pl-9 pr-3 py-2 text-white placeholder:text-white/25"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      fontFamily: inter,
                      fontSize: "0.85rem",
                      cursor: "not-allowed",
                    }}
                  />
                </div>
                <input
                  type="password"
                  placeholder="Password"
                  disabled
                  className="w-full rounded-lg px-3 py-2 text-white placeholder:text-white/25"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    fontFamily: inter,
                    fontSize: "0.85rem",
                    cursor: "not-allowed",
                  }}
                />
                <button
                  type="button"
                  disabled
                  className="w-full rounded-full px-4 py-2.5 mt-1 transition-all cursor-not-allowed"
                  style={{
                    fontFamily: inter,
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    color: "#fff",
                    background:
                      "linear-gradient(135deg, hsl(280 90% 60%), hsl(320 90% 55%))",
                    opacity: 0.55,
                  }}
                >
                  Sign in
                </button>
              </div>
            </div>

            <p
              className="text-center mt-5"
              style={{
                fontSize: "0.72rem",
                color: "rgba(255,255,255,0.4)",
                lineHeight: 1.5,
              }}
            >
              By signing in you'll agree to our terms and privacy notice.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function GoogleIcon() {
  // Google G logo, official colors
  return (
    <svg width="16" height="16" viewBox="0 0 18 18" aria-hidden>
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.71H.957v2.332A8.997 8.997 0 0 0 9 18z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.708A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.708V4.96H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.04l3.007-2.332z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.96L3.964 7.29C4.672 5.165 6.656 3.58 9 3.58z"
      />
    </svg>
  );
}
