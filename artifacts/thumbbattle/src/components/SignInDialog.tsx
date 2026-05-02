import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail } from "lucide-react";
import { useGoogleSignInButton } from "@/hooks/useAuth";

const inter = "'Inter', system-ui, sans-serif";

interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
}

// Real sign-in dialog. Renders an official Google Identity Services button
// that exchanges the resulting ID token with /api/auth/google for a session
// cookie. Email/password is shown as "coming after beta" so the option is
// visible without being misleading.
export function SignInDialog({ open, onClose }: SignInDialogProps) {
  const googleButtonRef = useRef<HTMLDivElement>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useGoogleSignInButton(googleButtonRef, {
    onSuccess: () => {
      setErrorMessage(null);
      onClose();
    },
    onError: () => {
      setErrorMessage("Sign-in failed. Please try again.");
    },
  });

  useEffect(() => {
    if (!open) return;
    setErrorMessage(null);
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

            <div className="flex flex-col gap-2.5">
              {/* Official Google Identity Services button mounts here */}
              <div ref={googleButtonRef} className="flex justify-center" />

              {errorMessage && (
                <p
                  role="alert"
                  className="text-center"
                  style={{
                    color: "#fca5a5",
                    fontSize: "0.78rem",
                    marginTop: "0.25rem",
                  }}
                >
                  {errorMessage}
                </p>
              )}

              <div
                className="flex items-center gap-3 my-1"
                style={{ color: "rgba(255,255,255,0.35)", fontSize: "0.7rem" }}
              >
                <div className="flex-1 h-px bg-white/10" />
                <span style={{ letterSpacing: "0.04em" }}>Email coming soon</span>
                <div className="flex-1 h-px bg-white/10" />
              </div>

              <div className="flex flex-col gap-2 opacity-60">
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
