import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  X,
  Check,
  AlertCircle,
  Image as ImageIcon,
  Upload as UploadIcon,
} from "lucide-react";
import {
  useRequestUploadUrl,
  useUploadThumbnail,
  getListThumbnailsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { LogIn } from "lucide-react";
import { useSession } from "../lib/auth-client";

const inter = "'Inter', system-ui, sans-serif";

const NICHE_OPTIONS = [
  "Gaming",
  "Tutorial",
  "Finance",
  "Music",
  "Lifestyle",
  "Tech",
  "Vlog",
  "Other",
] as const;

type NicheOption = (typeof NICHE_OPTIONS)[number];

const MAX_BYTES = 10 * 1024 * 1024;

interface UploadDialogProps {
  open: boolean;
  onClose: () => void;
  /**
   * Called when an unauthenticated visitor tries to open the upload
   * dialog. Home wires this to `setSignInOpen(true)` so the user lands
   * straight in the auth flow instead of seeing the form locked behind
   * an inline gate.
   */
  onRequireSignIn?: () => void;
}

// Same lightweight check the API does. Kept in sync intentionally —
// a stricter client-side check just means clearer feedback before the
// network round-trip; the server is still the source of truth.
const YT_PATTERN =
  /^https?:\/\/(www\.|m\.)?(youtube\.com\/(watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)[\w-]{6,}|youtu\.be\/[\w-]{6,})/i;

export function UploadDialog({ open, onClose, onRequireSignIn }: UploadDialogProps) {
  const queryClient = useQueryClient();
  const { data: sessionData, isPending: sessionPending } = useSession();
  const isSignedIn = !!sessionData?.user;

  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [channelName, setChannelName] = useState("");
  const [niche, setNiche] = useState<NicheOption>("Gaming");
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { mutateAsync: requestUploadUrl } = useRequestUploadUrl();
  const { mutateAsync: uploadThumbnail } = useUploadThumbnail();

  // Reset state when the dialog opens
  useEffect(() => {
    if (!open) return;
    setFile(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setTitle("");
    setChannelName("");
    setNiche("Gaming");
    setYoutubeUrl("");
    setIsDragging(false);
    setSubmitted(false);
    setSubmitError(null);
    setIsUploading(false);
  }, [open]);

  // Revoke any preview URL on unmount
  useEffect(() => {
    return () => {
      setPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return null;
      });
    };
  }, []);

  // ESC closes
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Auth gate: uploads now require an account. If a logged-out visitor
  // somehow gets here (e.g. they had the dialog open and signed out in
  // another tab), close the dialog and surface the sign-in flow instead
  // of letting them fill out a form that the server will reject.
  useEffect(() => {
    if (!open || sessionPending || isSignedIn) return;
    onClose();
    onRequireSignIn?.();
  }, [open, sessionPending, isSignedIn, onClose, onRequireSignIn]);

  const handleFile = (f: File) => {
    if (!f.type.startsWith("image/")) {
      setSubmitError("Please select an image file (JPG, PNG, WebP).");
      return;
    }
    if (f.size > MAX_BYTES) {
      setSubmitError("Image must be smaller than 10 MB.");
      return;
    }
    setSubmitError(null);
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return URL.createObjectURL(f);
    });
    setFile(f);
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) handleFile(f);
    e.target.value = "";
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) handleFile(f);
  };

  const trimmedTitle = title.trim();
  const trimmedChannel = channelName.trim();
  const trimmedYoutube = youtubeUrl.trim();
  const youtubeInvalid =
    trimmedYoutube.length > 0 && !YT_PATTERN.test(trimmedYoutube);

  const canSubmit =
    !!file &&
    trimmedTitle.length > 0 &&
    trimmedTitle.length <= 200 &&
    trimmedChannel.length > 0 &&
    trimmedChannel.length <= 120 &&
    trimmedYoutube.length > 0 &&
    trimmedYoutube.length <= 500 &&
    !youtubeInvalid &&
    !isUploading;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit || !file) return;
    setIsUploading(true);
    setSubmitError(null);

    try {
      const presigned = await requestUploadUrl({
        data: {
          name: file.name.slice(0, 500),
          size: file.size,
          contentType: file.type,
        },
      });

      const putRes = await fetch(presigned.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!putRes.ok) {
        throw new Error(`Upload failed (${putRes.status})`);
      }

      await uploadThumbnail({
        data: {
          title: trimmedTitle,
          channelName: trimmedChannel,
          niche,
          imageUrl: presigned.objectPath,
          youtubeUrl: trimmedYoutube,
        },
      });

      // Refresh leaderboard once admin approves it shows up; refetch anyway.
      queryClient.invalidateQueries({ queryKey: getListThumbnailsQueryKey() });

      setSubmitted(true);
    } catch (err) {
      console.error("[upload] failed:", err);
      setSubmitError(
        err instanceof Error ? err.message : "Upload failed — please try again.",
      );
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[60] flex items-center justify-center px-4 py-6"
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
            className="relative w-full max-w-lg rounded-2xl p-6 max-h-[92vh] overflow-y-auto"
            style={{
              fontFamily: inter,
              background: "rgba(12,12,22,0.95)",
              border: "1px solid rgba(168,85,247,0.32)",
              boxShadow:
                "0 30px 60px -10px rgba(0,0,0,0.7), 0 0 50px rgba(168,85,247,0.22)",
            }}
          >
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="absolute top-3.5 right-3.5 w-7 h-7 flex items-center justify-center rounded-full text-white/55 hover:text-white/90 hover:bg-white/5 transition-colors z-10"
            >
              <X className="w-4 h-4" />
            </button>

            {submitted ? (
              <div className="flex flex-col items-center text-center py-4 gap-3">
                <div
                  className="w-12 h-12 rounded-full flex items-center justify-center"
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
                  style={{
                    fontWeight: 800,
                    fontSize: "1.2rem",
                    letterSpacing: "-0.01em",
                  }}
                >
                  Your thumbnail is live
                </h2>
                <p
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: "0.9rem",
                    lineHeight: 1.55,
                    maxWidth: 360,
                  }}
                >
                  It's already in the battle pool. Keep voting and watch its
                  rating climb (or fall) on your dashboard.
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
                  <h2
                    id="upload-title"
                    className="text-white"
                    style={{
                      fontWeight: 800,
                      fontSize: "1.2rem",
                      letterSpacing: "-0.01em",
                    }}
                  >
                    Upload a thumbnail
                  </h2>
                  <p
                    style={{
                      color: "rgba(255,255,255,0.55)",
                      fontSize: "0.825rem",
                      lineHeight: 1.5,
                    }}
                  >
                    Drop in the thumbnail image and a few details. It joins
                    the battle pool immediately.
                  </p>
                </div>

                {/* Dropzone / preview */}
                <div
                  onDragOver={(e) => {
                    e.preventDefault();
                    setIsDragging(true);
                  }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={onDrop}
                  onClick={() => fileInputRef.current?.click()}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      fileInputRef.current?.click();
                    }
                  }}
                  className="relative aspect-video rounded-xl overflow-hidden flex items-center justify-center cursor-pointer transition-all"
                  style={{
                    background: previewUrl
                      ? "rgba(0,0,0,0.4)"
                      : isDragging
                      ? "rgba(168,85,247,0.12)"
                      : "rgba(255,255,255,0.03)",
                    border: previewUrl
                      ? "1px solid rgba(255,255,255,0.12)"
                      : isDragging
                      ? "1.5px dashed rgba(217,70,239,0.6)"
                      : "1.5px dashed rgba(255,255,255,0.16)",
                  }}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={onFileInputChange}
                  />
                  {previewUrl ? (
                    <>
                      <img
                        src={previewUrl}
                        alt="Preview"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute bottom-2 right-2 px-2.5 py-1 rounded-full flex items-center gap-1.5 backdrop-blur-md"
                        style={{
                          fontWeight: 500,
                          fontSize: "0.72rem",
                          color: "rgba(255,255,255,0.9)",
                          background: "rgba(0,0,0,0.55)",
                          border: "1px solid rgba(255,255,255,0.12)",
                        }}
                      >
                        Click or drop to replace
                      </div>
                    </>
                  ) : (
                    <div className="flex flex-col items-center gap-2 px-6 text-center">
                      <ImageIcon className="w-7 h-7 text-white/40" />
                      <div
                        style={{
                          fontWeight: 600,
                          fontSize: "0.9rem",
                          color: "rgba(255,255,255,0.85)",
                        }}
                      >
                        Drop a thumbnail here
                      </div>
                      <div
                        style={{
                          fontSize: "0.78rem",
                          color: "rgba(255,255,255,0.45)",
                        }}
                      >
                        or click to browse · PNG, JPG, WebP up to 10 MB
                      </div>
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <Field label="Title" required>
                    <input
                      type="text"
                      maxLength={200}
                      required
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      placeholder="Video title"
                      className="upload-input"
                    />
                  </Field>
                  <Field label="Channel" required>
                    <input
                      type="text"
                      maxLength={120}
                      required
                      value={channelName}
                      onChange={(e) => setChannelName(e.target.value)}
                      placeholder="Channel name"
                      className="upload-input"
                    />
                  </Field>
                  <Field label="Niche" required>
                    <select
                      required
                      value={niche}
                      onChange={(e) => setNiche(e.target.value as NicheOption)}
                      className="upload-input"
                    >
                      {NICHE_OPTIONS.map((n) => (
                        <option key={n} value={n} style={{ background: "#0c0c16" }}>
                          {n}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <Field label="YouTube URL" required>
                  <input
                    type="url"
                    required
                    maxLength={500}
                    value={youtubeUrl}
                    onChange={(e) => setYoutubeUrl(e.target.value)}
                    placeholder="https://youtube.com/watch?v=…"
                    className="upload-input"
                    aria-invalid={youtubeInvalid || undefined}
                  />
                  <span
                    style={{
                      fontSize: "0.72rem",
                      color: "rgba(255,255,255,0.45)",
                      marginTop: 2,
                    }}
                  >
                    The link to the video this thumbnail belongs to.
                  </span>
                </Field>

                {youtubeInvalid && (
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
                    <span>
                      That doesn't look like a YouTube URL. Paste the full link, e.g.
                      https://youtube.com/watch?v=…
                    </span>
                  </div>
                )}

                {submitError && (
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
                    <span>{submitError}</span>
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
                    {isUploading ? (
                      <>
                        <span
                          className="w-3.5 h-3.5 rounded-full border-2 border-white/40 border-t-white animate-spin"
                          aria-hidden
                        />
                        Submitting…
                      </>
                    ) : (
                      <>
                        <UploadIcon className="w-3.5 h-3.5" />
                        Submit thumbnail
                      </>
                    )}
                  </button>
                </div>
              </form>
            )}
          </motion.div>

          <style>{`
            .upload-input {
              width: 100%;
              border-radius: 0.5rem;
              padding: 0.55rem 0.7rem;
              background: rgba(255,255,255,0.04);
              border: 1px solid rgba(255,255,255,0.10);
              color: #fff;
              font-family: ${inter};
              font-size: 0.875rem;
              outline: none;
              transition: border-color 0.15s ease, background 0.15s ease;
            }
            .upload-input::placeholder { color: rgba(255,255,255,0.32); }
            .upload-input:focus { border-color: rgba(168,85,247,0.55); background: rgba(255,255,255,0.05); }
          `}</style>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span
        className="uppercase"
        style={{
          fontWeight: 600,
          fontSize: "0.62rem",
          letterSpacing: "0.12em",
          color: "rgba(255,255,255,0.55)",
        }}
      >
        {label}
        {required && (
          <span style={{ color: "#d946ef", marginLeft: 4 }}>*</span>
        )}
      </span>
      {children}
    </label>
  );
}
