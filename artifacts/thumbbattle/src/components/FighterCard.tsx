import React, { useEffect, useState } from "react";
import { motion, useMotionValue, useTransform, animate, PanInfo } from "framer-motion";
import { Youtube } from "lucide-react";
import type { Thumbnail } from "@workspace/api-client-react";
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "@/components/ui/tooltip";
import { ChannelAvatar } from "./ChannelAvatar";

interface FighterCardProps {
  thumbnail: Thumbnail;
  side: "left" | "right";
  isVoting: boolean;
  voteResult: "winner" | "loser" | null;
  /** Called when the user picks THIS card (click or swipe-right). */
  onVote: () => void;
  /** Called when the user rejects THIS card (swipe-left → other card wins). */
  onReject: () => void;
  /** Layer 4 safety net: fired when the loaded image is vertical/near-square
   *  (almost certainly a Short that slipped past the backend filters). */
  onBadThumbnail?: (info: {
    thumbnailId: number;
    reason: "vertical_aspect";
    width: number;
    height: number;
  }) => void;
}

const SWIPE_THRESHOLD = 100;
// Material Design standard easing — natural deceleration / acceleration
const EASE_STANDARD = [0.4, 0, 0.2, 1] as const;

function extractYoutubeUrl(thumbnail: Thumbnail): string | null {
  if (thumbnail.youtubeUrl) return thumbnail.youtubeUrl;
  const match = thumbnail.imageUrl.match(/\/vi\/([^/]+)\//);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : null;
}

const INTER_STACK = "'Inter', system-ui, sans-serif";

export function FighterCard({
  thumbnail,
  side,
  isVoting,
  voteResult,
  onVote,
  onReject,
  onBadThumbnail,
}: FighterCardProps) {
  void side;
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-15, 0, 15]);

  // Tinder-style per-card swipe feedback (independent on each card).
  //   • Swipe RIGHT (positive x) → green tint + green inset glow (this card chosen)
  //   • Swipe LEFT (negative x)  → red tint + red inset glow (this card rejected)
  // Opacities scale with swipe magnitude so they intensify the further you go.
  const greenSwipeOpacity = useTransform(x, [0, 100, 200], [0, 0.7, 1]);
  const redSwipeOpacity = useTransform(x, [-200, -100, 0], [1, 0.7, 0]);

  // Tracks active drag — used to lift the card above the VS badge while it slides.
  const [isDragging, setIsDragging] = useState(false);

  // Reset drag offset when a new battle pair loads
  useEffect(() => {
    x.set(0);
  }, [thumbnail.id, x]);

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    setIsDragging(false);
    if (isVoting) return;
    const offset = info.offset.x;
    const velocity = info.velocity.x;
    const swiped = Math.abs(offset) > SWIPE_THRESHOLD || Math.abs(velocity) > 600;

    if (swiped) {
      // Snap back to center inside the same 150ms feedback window so the
      // vote animation starts cleanly from rest — no jump, no fight with keyframes.
      animate(x, 0, { duration: 0.15, ease: EASE_STANDARD });
      // Tinder semantics: swiping right = "I want this", swiping left = "I don't want this".
      if (offset > 0 || velocity > 0) {
        onVote();
      } else {
        onReject();
      }
    } else {
      animate(x, 0, { type: "spring", stiffness: 400, damping: 30 });
    }
  };

  // Clean 4-stop timeline (matches the Tinder-style spec):
  //   t = 0      (0%)        rest
  //   t = 150ms  (18.75%)    instant feedback   — winner pops, loser dims neutrally to 0.8
  //   t = 500ms  (62.5%)     winner moment      — loser drifts to opacity 0.4 / +20
  //   t = 800ms  (100%)      exit               — both lift -30, fade to 0
  // Total: 800ms, single cubic-bezier(0.4, 0, 0.2, 1) easing across the whole curve.
  const winnerKeyframes = {
    scale: [1, 1.05, 1.05, 1.05],
    y: [0, 0, 0, -30],
    opacity: [1, 1, 1, 0],
  };
  // Tinder model: the not-chosen card fades NEUTRALLY (no red, no negative tint).
  // Only opacity drops; the card itself stays visually clean.
  const loserKeyframes = {
    scale: [1, 0.95, 0.95, 0.95],
    y: [0, 0, 20, -30],
    opacity: [1, 0.8, 0.4, 0],
  };
  const restState = { scale: 1, y: 0, opacity: 1 };

  const animateState =
    voteResult === "winner"
      ? winnerKeyframes
      : voteResult === "loser"
      ? loserKeyframes
      : restState;

  const voteTransition = voteResult
    ? { duration: 0.25, times: [0, 0.1875, 0.625, 1], ease: EASE_STANDARD }
    : { type: "spring" as const, stiffness: 280, damping: 22 };

  // Click-time green winner glow (clicking a card == "swiped right" == green chosen state).
  const winnerGlow =
    "0 0 80px rgba(34, 197, 94, 0.6), 0 0 32px rgba(16, 185, 129, 0.45), 0 24px 50px -16px rgba(0,0,0,0.7)";

  const niche = thumbnail.niche ?? "Trending";
  const youtubeUrl = extractYoutubeUrl(thumbnail);
  const winRateLabel =
    thumbnail.winRate !== null && thumbnail.winRate !== undefined
      ? `${Math.round(thumbnail.winRate)}% win rate`
      : "New contender";

  // Z-index management: cards sit BELOW the VS badge at rest (so VS visually overlaps
  // the card edges), and ABOVE the VS badge while being dragged or animated through a
  // vote — so the card slides cleanly over the badge like a Tinder swipe.
  const cardZ = isDragging || isVoting || voteResult !== null ? 30 : 10;

  return (
    <motion.div
      className={`group relative flex-1 max-w-[560px] w-full flex flex-col gap-5 ${
        isVoting ? "pointer-events-none" : "cursor-grab active:cursor-grabbing"
      }`}
      style={{ x, rotate, touchAction: "pan-y", willChange: "transform, opacity", zIndex: cardZ }}
      drag={voteResult || isVoting ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragStart={() => setIsDragging(true)}
      onDragEnd={handleDragEnd}
      whileHover={voteResult || isVoting ? undefined : { y: -4 }}
      animate={animateState}
      transition={voteTransition}
      onClick={() => {
        if (isVoting) return;
        if (Math.abs(x.get()) < 5) onVote();
      }}
    >
      <div
        className="thumb-card-shadow relative aspect-video overflow-hidden border-2 group-hover:border-purple-400/80 group-hover:shadow-[0_0_40px_rgba(139,92,246,0.35)] transition-[border-color,box-shadow] duration-200"
        style={{
          borderRadius: 16,
          borderColor:
            voteResult === "winner" ? "rgba(34,197,94,0.85)" : "rgba(255,255,255,0.1)",
          boxShadow: voteResult === "winner" ? winnerGlow : undefined,
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <img
          src={thumbnail.imageUrl}
          alt={thumbnail.title}
          className="w-full h-full object-cover pointer-events-none select-none"
          draggable={false}
          onLoad={(e) => {
            // Layer 4 safety net: any image with aspect ratio < 1.2 is
            // either a Short (9:16 ≈ 0.56) or a near-square repost. Real
            // YouTube thumbnails are 16:9 ≈ 1.78. We report it so the
            // backend can archive + log the leakage, then trust the
            // parent to swap in a fresh battle.
            const img = e.currentTarget;
            const w = img.naturalWidth;
            const h = img.naturalHeight;
            if (!w || !h) return;
            if (w / h < 1.2 && onBadThumbnail) {
              onBadThumbnail({
                thumbnailId: thumbnail.id,
                reason: "vertical_aspect",
                width: w,
                height: h,
              });
            }
          }}
        />

        {/* Bottom dark gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent opacity-70 group-hover:opacity-50 transition-opacity pointer-events-none" />

        {/* Hover purple glow inset (idle hover only — disabled during voting via pointer-events) */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{
            boxShadow: "inset 0 0 60px rgba(192, 38, 211, 0.4), inset 0 0 0 1px rgba(217,70,239,0.4)",
          }}
        />

        {/* Click-time GREEN winner tint — fades in within the 150ms feedback window
            (the parent element's borderColor + winnerGlow paint the surrounding green
            border + outer glow simultaneously). */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={false}
          animate={{ opacity: voteResult === "winner" ? 1 : 0 }}
          transition={{ duration: 0.15, ease: EASE_STANDARD }}
          style={{
            background: "rgba(34, 197, 94, 0.18)",
          }}
        />

        {/* Tinder GREEN: swipe RIGHT → "I want this one". Tint + inset green border ring.
            Opacity scales with swipe magnitude (0 → 1 across 200px). */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: greenSwipeOpacity,
            background: "rgba(34, 197, 94, 0.15)",
            boxShadow:
              "inset 0 0 0 3px rgba(34,197,94,0.85), inset 0 0 60px rgba(34,197,94,0.4)",
          }}
        />

        {/* Tinder RED: swipe LEFT → "I don't want this one". Tint + inset red border ring. */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          style={{
            opacity: redSwipeOpacity,
            background: "rgba(239, 68, 68, 0.20)",
            boxShadow:
              "inset 0 0 0 3px rgba(239,68,68,0.85), inset 0 0 60px rgba(239,68,68,0.35)",
          }}
        />

        {/* Top-left: niche pill + (for fresh user uploads) calibrating badge.
            "Calibrating" tells the viewer the system is still measuring this
            thumbnail — so they understand a low ELO / weird matchup isn't
            random, it's just early-sample noise. Disappears at 20 battles
            in line with the boost decay schedule. */}
        <div className="absolute top-3 left-3 z-10 pointer-events-none flex items-center gap-1.5">
          <div
            className="rounded-full backdrop-blur-md"
            style={{
              padding: "4px 10px",
              fontFamily: INTER_STACK,
              fontWeight: 500,
              fontSize: 11,
              lineHeight: 1.2,
              color: "#ffffff",
              background: "rgba(0,0,0,0.6)",
            }}
          >
            {niche}
          </div>
          {thumbnail.source === "user" && thumbnail.battleCount < 20 && (
            <div
              className="rounded-full backdrop-blur-md flex items-center gap-1"
              style={{
                padding: "4px 9px",
                fontFamily: INTER_STACK,
                fontWeight: 600,
                fontSize: 10,
                lineHeight: 1.2,
                letterSpacing: "0.04em",
                color: "#fde68a",
                background: "rgba(251, 191, 36, 0.18)",
                border: "1px solid rgba(251, 191, 36, 0.45)",
                textTransform: "uppercase",
              }}
              title={`Calibrating — ${thumbnail.battleCount}/20 battles`}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: 999,
                  background: "#fbbf24",
                  boxShadow: "0 0 6px rgba(251,191,36,0.9)",
                }}
              />
              Calibrating
            </div>
          )}
        </div>

        {/* Top-right: YouTube link icon (with polished tooltip) */}
        {youtubeUrl && (
          <Tooltip>
            <TooltipTrigger asChild>
              <a
                href={youtubeUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
                className="absolute top-3 right-3 z-10 flex items-center justify-center rounded-full text-white/85 opacity-90 hover:opacity-100 hover:scale-110 active:scale-95 transition-transform"
                style={{
                  width: 28,
                  height: 28,
                  background: "rgba(0,0,0,0.6)",
                  transitionDuration: "150ms",
                  transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
                }}
                aria-label="Watch on YouTube"
              >
                <Youtube style={{ width: 14, height: 14 }} />
              </a>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Watch on YouTube
            </TooltipContent>
          </Tooltip>
        )}
      </div>

      {/* Info section — cleaner hierarchy: title (prominent) → channel
          (clearly readable, with a small avatar dot for visual anchoring)
          → solid yellow win-rate chip aligned right. */}
      <div
        className="flex flex-col text-left"
        style={{ padding: "0 4px", paddingTop: 2 }}
      >
        <h3
          className="line-clamp-2 text-white"
          style={{
            fontFamily: INTER_STACK,
            fontWeight: 600,
            fontSize: "1.0625rem",
            lineHeight: 1.3,
            letterSpacing: "-0.012em",
          }}
        >
          {thumbnail.title}
        </h3>
        <div
          className="flex items-center justify-between gap-3"
          style={{ marginTop: 10 }}
        >
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <ChannelAvatar
              channelName={thumbnail.channelName}
              channelLogoUrl={thumbnail.channelLogoUrl}
              size={22}
            />
            <span
              className="truncate"
              style={{
                fontFamily: INTER_STACK,
                fontWeight: 500,
                fontSize: "0.875rem",
                color: "rgba(255,255,255,0.78)",
                letterSpacing: "0.005em",
              }}
            >
              {thumbnail.channelName}
            </span>
          </div>
          <span
            className="shrink-0 rounded-full tabular-nums"
            style={{
              padding: "4px 10px",
              fontFamily: INTER_STACK,
              fontWeight: 700,
              fontSize: 12,
              color: "#1a1500",
              background: "#facc15",
              border: "1px solid rgba(250,204,21,0.55)",
              boxShadow:
                "0 4px 14px -4px rgba(250,204,21,0.45), inset 0 1px 0 rgba(255,255,255,0.35)",
              whiteSpace: "nowrap",
              letterSpacing: "-0.005em",
            }}
          >
            {winRateLabel}
          </span>
        </div>
      </div>
    </motion.div>
  );
}
