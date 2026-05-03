import { useEffect, useState, type FormEvent } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Mail, Loader2 } from "lucide-react";
import { signIn, signUp } from "../lib/auth-client";

const inter = "'Inter', system-ui, sans-serif";

interface SignInDialogProps {
  open: boolean;
  onClose: () => void;
}

type Mode = "signin" | "signup";

export function SignInDialog({ open, onClose }: SignInDialogProps) {
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Reset transient state whenever the dialog re-opens so previous errors and
  // loading flags don't leak into a fresh attempt.
  useEffect(() => {
    if (open) {
      setError(null);
      setSubmitting(false);
    }
  }, [open]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setError(null);

    const trimmedEmail = email.trim();
    if (!trimmedEmail || !password) {
      setError("Email and password are required.");
      return;
    }
    if (mode === "signup" && password.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (mode === "signup" && !name.trim()) {
      setError("Name is required.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signin") {
        const { error: err } = await signIn.email({
          email: trimmedEmail,
          password,
        });
        if (err) {
          setError(err.message ?? "Sign in failed.");
          setSubmitting(false);
          return;
        }
      } else {
        const { error: err } = await signUp.email({
          email: trimmedEmail,
          password,
          name: name.trim(),
        });
        if (err) {
          setError(err.message ?? "Sign up failed.");
          setSubmitting(false);
          return;
        }
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
      setSubmitting(false);
    }
  }

  function toggleMode() {
    setMode((m) => (m === "signin" ? "signup" : "signin"));
    setError(null);
  }

  const isSignup = mode === "signup";
  const submitLabel = isSignup ? "Create account" : "Sign in";
  const headingLabel = isSignup ? "Create your account" : "Sign in to thumbz";
  const subLabel = isSignup
    ? "Save your stats, upload thumbnails, and track your taste over time."
    : "Welcome back. Pick up where you left off.";

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
                {headingLabel}
              </h2>
              <p
                style={{
                  color: "rgba(255,255,255,0.55)",
                  fontSize: "0.85rem",
                  lineHeight: 1.5,
                  maxWidth: 280,
                }}
              >
                {subLabel}
              </p>
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

              <form onSubmit={handleSubmit} className="flex flex-col gap-2">
                {isSignup && (
                  <input
                    type="text"
                    autoComplete="name"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    disabled={submitting}
                    className="w-full rounded-lg px-3 py-2 text-white placeholder:text-white/25 focus:outline-none focus:border-[rgba(168,85,247,0.55)]"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      fontFamily: inter,
                      fontSize: "0.85rem",
                    }}
                  />
                )}

                <div className="relative">
                  <Mail
                    className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                    style={{ color: "rgba(255,255,255,0.35)" }}
                  />
                  <input
                    type="email"
                    autoComplete="email"
                    placeholder="you@example.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    className="w-full rounded-lg pl-9 pr-3 py-2 text-white placeholder:text-white/25 focus:outline-none focus:border-[rgba(168,85,247,0.55)]"
                    style={{
                      background: "rgba(255,255,255,0.03)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      fontFamily: inter,
                      fontSize: "0.85rem",
                    }}
                  />
                </div>

                <input
                  type="password"
                  autoComplete={isSignup ? "new-password" : "current-password"}
                  placeholder={isSignup ? "At least 8 characters" : "Password"}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  disabled={submitting}
                  className="w-full rounded-lg px-3 py-2 text-white placeholder:text-white/25 focus:outline-none focus:border-[rgba(168,85,247,0.55)]"
                  style={{
                    background: "rgba(255,255,255,0.03)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    fontFamily: inter,
                    fontSize: "0.85rem",
                  }}
                />

                {error && (
                  <p
                    role="alert"
                    style={{
                      color: "#fca5a5",
                      fontSize: "0.78rem",
                      lineHeight: 1.4,
                      marginTop: 2,
                    }}
                  >
                    {error}
                  </p>
                )}

                <button
                  type="submit"
                  disabled={submitting}
                  className="w-full flex items-center justify-center gap-2 rounded-full px-4 py-2.5 mt-1 transition-all disabled:cursor-not-allowed"
                  style={{
                    fontFamily: inter,
                    fontWeight: 600,
                    fontSize: "0.875rem",
                    color: "#fff",
                    background:
                      "linear-gradient(135deg, hsl(280 90% 60%), hsl(320 90% 55%))",
                    opacity: submitting ? 0.6 : 1,
                  }}
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  {submitLabel}
                </button>
              </form>

              <button
                type="button"
                onClick={toggleMode}
                disabled={submitting}
                className="text-center mt-2 transition-colors hover:text-white/80 disabled:cursor-not-allowed"
                style={{
                  fontSize: "0.78rem",
                  color: "rgba(255,255,255,0.55)",
                  background: "transparent",
                  border: 0,
                  padding: 0,
                }}
              >
                {isSignup
                  ? "Already have an account? Sign in"
                  : "Need an account? Sign up"}
              </button>
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
