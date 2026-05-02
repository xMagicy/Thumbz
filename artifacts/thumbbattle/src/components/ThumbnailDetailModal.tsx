import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Trophy, Target, Zap, ExternalLink, Link2, Check } from "lucide-react";
import type { Thumbnail } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";

const inter = "'Inter', system-ui, sans-serif";

interface ThumbnailDetailModalProps {
  thumbnail: Thumbnail | null;
  onClose: () => void;
}

export function ThumbnailDetailModal({
  thumbnail,
  onClose,
}: ThumbnailDetailModalProps) {
  const { toast } = useToast();
  const [justCopied, setJustCopied] = useState(false);
  const copyResetTimer = useRef<number | null>(null);

  useEffect(() => {
    if (!thumbnail) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [thumbnail, onClose]);

  // Reset copy-confirmed state when the modal switches thumbnails (or closes).
  useEffect(() => {
    setJustCopied(false);
    if (copyResetTimer.current !== null) {
      window.clearTimeout(copyResetTimer.current);
      copyResetTimer.current = null;
    }
  }, [thumbnail?.id]);

  // Clear the pending "Copied" reset timer on unmount to avoid setting state
  // after the modal has been removed.
  useEffect(() => {
    return () => {
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
        copyResetTimer.current = null;
      }
    };
  }, []);

  const copyShareLink = async () => {
    if (!thumbnail) return;
    const link = thumbnail.youtubeUrl ?? thumbnail.imageUrl;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(link);
      } else {
        // Legacy fallback for non-secure contexts. execCommand returns a
        // boolean indicating whether the copy actually succeeded — propagate
        // the failure so the catch block surfaces a destructive toast instead
        // of a misleading "Copied" confirmation.
        const ta = document.createElement("textarea");
        ta.value = link;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (!ok) {
          throw new Error("execCommand copy returned false");
        }
      }
      setJustCopied(true);
      toast({
        title: "Link copied",
        description: "The thumbnail link is on your clipboard.",
      });
      if (copyResetTimer.current !== null) {
        window.clearTimeout(copyResetTimer.current);
      }
      copyResetTimer.current = window.setTimeout(() => {
        setJustCopied(false);
        copyResetTimer.current = null;
      }, 1800);
    } catch {
      toast({
        title: "Couldn't copy link",
        description: "Try copying it manually from the address bar.",
        variant: "destructive",
      });
    }
  };

  return (
    <AnimatePresence>
      {thumbnail && (
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
            className="absolute inset-0 bg-black/75 backdrop-blur-sm"
          />

          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="thumb-detail-title"
            initial={{ opacity: 0, y: 18, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.97 }}
            transition={{ type: "spring", stiffness: 260, damping: 24 }}
            className="relative w-full max-w-2xl rounded-2xl overflow-hidden"
            style={{
              fontFamily: inter,
              background: "rgba(12,12,22,0.95)",
              border: "1px solid rgba(168,85,247,0.32)",
              boxShadow:
                "0 30px 60px -10px rgba(0,0,0,0.7), 0 0 50px rgba(168,85,247,0.22)",
            }}
          >
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="absolute top-3.5 right-3.5 z-10 w-8 h-8 flex items-center justify-center rounded-full text-white/65 hover:text-white hover:bg-white/10 active:scale-95 transition-all backdrop-blur-md bg-black/40"
                  style={{
                    transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                  }}
                >
                  <X className="w-4 h-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="left" sideOffset={6}>
                Close
              </TooltipContent>
            </Tooltip>

            <div className="aspect-video w-full overflow-hidden bg-black">
              <img
                src={thumbnail.imageUrl}
                alt={thumbnail.title}
                className="w-full h-full object-cover"
              />
            </div>

            <div className="p-6 flex flex-col gap-5">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span
                    className="px-2.5 py-1 rounded-full uppercase"
                    style={{
                      fontWeight: 600,
                      fontSize: "0.65rem",
                      letterSpacing: "0.08em",
                      color: "#c084fc",
                      background: "rgba(168, 85, 247, 0.15)",
                      border: "1px solid rgba(168, 85, 247, 0.4)",
                    }}
                  >
                    {thumbnail.niche}
                  </span>
                  {thumbnail.ctr !== null && thumbnail.ctr !== undefined && (
                    <span
                      className="px-2.5 py-1 rounded-full"
                      style={{
                        fontWeight: 600,
                        fontSize: "0.7rem",
                        color: "#86efac",
                        background: "rgba(34,197,94,0.12)",
                        border: "1px solid rgba(34,197,94,0.35)",
                      }}
                    >
                      {thumbnail.ctr.toFixed(1)}% CTR
                    </span>
                  )}
                </div>
                <h2
                  id="thumb-detail-title"
                  className="text-white"
                  style={{
                    fontWeight: 800,
                    fontSize: "1.45rem",
                    letterSpacing: "-0.02em",
                    lineHeight: 1.25,
                  }}
                >
                  {thumbnail.title}
                </h2>
                <p
                  style={{
                    color: "rgba(255,255,255,0.6)",
                    fontSize: "0.9rem",
                  }}
                >
                  {thumbnail.channelName}
                </p>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <StatCard
                  icon={<Trophy className="w-4 h-4" />}
                  label="Rating"
                  value={Math.round(thumbnail.eloRating).toString()}
                  accent
                />
                <StatCard
                  icon={<Target className="w-4 h-4" />}
                  label="Win rate"
                  value={
                    thumbnail.winRate !== null && thumbnail.winRate !== undefined
                      ? `${Math.round(thumbnail.winRate)}%`
                      : "—"
                  }
                />
                <StatCard
                  icon={<Zap className="w-4 h-4" />}
                  label="Battles"
                  value={(thumbnail.wins + thumbnail.losses).toString()}
                />
              </div>

              <div className="flex items-center justify-between gap-3 text-sm">
                <div
                  style={{
                    color: "rgba(255,255,255,0.55)",
                    fontSize: "0.8rem",
                  }}
                >
                  <span style={{ color: "#86efac" }}>{thumbnail.wins} wins</span>
                  <span className="mx-2 opacity-40">·</span>
                  <span style={{ color: "#fca5a5" }}>{thumbnail.losses} losses</span>
                </div>
                <div className="flex items-center gap-2">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        type="button"
                        onClick={copyShareLink}
                        aria-label="Copy share link"
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all hover:bg-white/10 active:scale-95"
                        style={{
                          fontFamily: inter,
                          fontWeight: 500,
                          fontSize: "0.8rem",
                          color: "rgba(255,255,255,0.85)",
                          background: "rgba(255,255,255,0.05)",
                          border: "1px solid rgba(255,255,255,0.12)",
                          transitionTimingFunction:
                            "cubic-bezier(0.4, 0, 0.2, 1)",
                        }}
                      >
                        {justCopied ? (
                          <>
                            <Check className="w-3.5 h-3.5" style={{ color: "#86efac" }} />
                            Copied
                          </>
                        ) : (
                          <>
                            <Link2 className="w-3.5 h-3.5" />
                            Copy link
                          </>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="top" sideOffset={6}>
                      Copy share link
                    </TooltipContent>
                  </Tooltip>
                  {thumbnail.youtubeUrl && (
                    <a
                      href={thumbnail.youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 px-3 py-1.5 rounded-full transition-all hover:bg-white/10 active:scale-95"
                      style={{
                        fontWeight: 500,
                        fontSize: "0.8rem",
                        color: "rgba(255,255,255,0.85)",
                        background: "rgba(255,255,255,0.05)",
                        border: "1px solid rgba(255,255,255,0.12)",
                        transitionTimingFunction:
                          "cubic-bezier(0.4, 0, 0.2, 1)",
                      }}
                    >
                      Watch on YouTube
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div
      className="flex flex-col gap-1 p-3 rounded-xl"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
      }}
    >
      <div
        className="flex items-center gap-1.5 uppercase"
        style={{
          fontWeight: 500,
          fontSize: "0.62rem",
          letterSpacing: "0.12em",
          color: "rgba(255,255,255,0.5)",
        }}
      >
        {icon}
        {label}
      </div>
      <div
        className={accent ? "text-transparent bg-clip-text" : "text-white"}
        style={{
          fontWeight: 800,
          fontSize: "1.35rem",
          letterSpacing: "-0.02em",
          ...(accent
            ? {
                backgroundImage: "linear-gradient(135deg, #8b5cf6, #d946ef)",
                WebkitBackgroundClip: "text",
              }
            : {}),
        }}
      >
        {value}
      </div>
    </div>
  );
}
