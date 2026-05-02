import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Check, AlertCircle, Mail, Upload } from "lucide-react";
import { useJoinWaitlist } from "@workspace/api-client-react";

const inter = "'Inter', system-ui, sans-serif";

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function UploadDialog({ open, onClose }: UploadDialogProps) {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const { mutate, isPending, isError, reset } = useJoinWaitlist({
    mutation: {
      onSuccess: () => setSubmitted(true),
    },
  });

  useEffect(() => {
    if (open) {
      setSubmitted(false);
      setEmail("");
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const trimmed = email.trim();
  const valid = EMAIL_RE.test(trimmed) && trimmed.length <= 254;
  const canSubmit = valid && !isPending;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    mutate({ data: { email: trimmed } });
  };

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
            aria-labelledby="upload-title"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="relative w-full max-w-md rounded-2xl p-6"
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

            {submitted ? (
              <div className="flex flex-col items-center text-center py-3 gap-3">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center"
                  style={{
                    background: "rgba(16,185,129,0.15)",
                    border: "1px solid rgba(16,185,129,0.4)",
                  }}
                >
                  <Check className="w-5 h-5" style={{ color: "#10b981" }} />
                </div>
                <h2
                  id="upload-title"
                  className="text-white"
                  style={{ fontWeight: 700, fontSize: "1.125rem", letterSpacing: "-0.01em" }}
                >
                  You're on the list
                </h2>
                <p
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: "0.875rem",
                    lineHeight: 1.5,
                    maxWidth: 320,
                  }}
                >
                  We'll email you the moment thumbnail uploads go live. No spam, just the launch.
                </p>
                <button
                  type="button"
                  onClick={onClose}
                  className="mt-2 px-4 py-2 rounded-full text-sm transition-colors"
                  style={{
                    fontWeight: 500,
                    color: "rgba(255,255,255,0.85)",
                    background: "rgba(255,255,255,0.06)",
                    border: "1px solid rgba(255,255,255,0.12)",
                  }}
                >
                  Close
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="flex flex-col gap-4">
                <div className="flex flex-col gap-1.5 pr-7">
                  <div className="flex items-center gap-2">
                    <span
                      className="uppercase"
                      style={{
                        fontWeight: 600,
                        fontSize: "10px",
                        color: "#c084fc",
                        background: "rgba(168, 85, 247, 0.15)",
                        border: "1px solid rgba(168, 85, 247, 0.4)",
                        padding: "3px 8px",
                        borderRadius: "9999px",
                        lineHeight: 1,
                        letterSpacing: "0.06em",
                      }}
                    >
                      Coming soon
                    </span>
                    <h2
                      id="upload-title"
                      className="text-white"
                      style={{
                        fontWeight: 700,
                        fontSize: "1.125rem",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      Upload your thumbnail
                    </h2>
                  </div>
                  <p
                    style={{
                      color: "rgba(255,255,255,0.55)",
                      fontSize: "0.8125rem",
                      lineHeight: 1.5,
                    }}
                  >
                    Uploads aren't live yet. Drop your email and we'll let you know the moment
                    you can put your own thumbnails into the arena.
                  </p>
                </div>

                <label className="flex flex-col gap-1.5">
                  <span
                    className="uppercase"
                    style={{
                      fontWeight: 600,
                      fontSize: "0.65rem",
                      letterSpacing: "0.12em",
                      color: "rgba(255,255,255,0.5)",
                    }}
                  >
                    Email
                  </span>
                  <div className="relative">
                    <Mail
                      className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4"
                      style={{ color: "rgba(255,255,255,0.4)" }}
                    />
                    <input
                      autoFocus
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="w-full rounded-lg pl-9 pr-3 py-2.5 text-white placeholder:text-white/30 focus:outline-none transition-colors"
                      style={{
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.10)",
                        fontFamily: inter,
                        fontSize: "0.9rem",
                      }}
                      onFocus={(e) => {
                        e.currentTarget.style.borderColor = "rgba(168,85,247,0.5)";
                      }}
                      onBlur={(e) => {
                        e.currentTarget.style.borderColor = "rgba(255,255,255,0.10)";
                      }}
                    />
                  </div>
                </label>

                {isError && (
                  <div
                    className="flex items-center gap-2 rounded-lg px-3 py-2"
                    style={{
                      background: "rgba(239,68,68,0.08)",
                      border: "1px solid rgba(239,68,68,0.3)",
                      color: "#fecaca",
                      fontSize: "0.8125rem",
                    }}
                  >
                    <AlertCircle className="w-4 h-4 shrink-0" />
                    <span>Couldn't sign you up. Please try again.</span>
                  </div>
                )}

                <div className="flex items-center justify-end gap-2 pt-1">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 rounded-full text-sm transition-colors"
                    style={{
                      fontWeight: 500,
                      color: "rgba(255,255,255,0.7)",
                      background: "transparent",
                    }}
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={!canSubmit}
                    className="flex items-center gap-2 px-4 py-2 rounded-full text-sm transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                    style={{
                      fontWeight: 600,
                      color: "#fff",
                      background:
                        "linear-gradient(135deg, hsl(280 90% 60%), hsl(320 90% 55%))",
                      boxShadow: canSubmit
                        ? "0 6px 18px rgba(217,70,239,0.35)"
                        : "none",
                    }}
                  >
                    {isPending ? (
                      <>
                        <span
                          className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin"
                          aria-hidden
                        />
                        Sending…
                      </>
                    ) : (
                      <>
                        <Upload className="w-3.5 h-3.5" />
                        Notify me
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
