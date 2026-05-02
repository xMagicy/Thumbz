import React, { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate, PanInfo } from "framer-motion";
import { Youtube } from "lucide-react";
import type { Thumbnail } from "@workspace/api-client-react";

interface FighterCardProps {
  thumbnail: Thumbnail;
  side: "left" | "right";
  isVoting: boolean;
  voteResult: "winner" | "loser" | null;
  onVote: () => void;
  onSwipeStart?: () => void;
}

const SWIPE_THRESHOLD = 100;
// Material Design standard easing — natural deceleration / acceleration
const EASE_STANDARD = [0.4, 0, 0.2, 1] as const;

function deriveCategory(title: string, channel: string): string {
  const t = `${title} ${channel}`.toLowerCase();
  if (/(minecraft|fortnite|gaming|game|gta|fps|pvp|speedrun|roblox)/.test(t)) return "Gaming";
  if (/(tutorial|how to|guide|learn|tips)/.test(t)) return "Tutorial";
  if (/(music|song|remix|beat|album|cover|artist)/.test(t)) return "Music";
  if (/(invest|money|finance|stock|crypto|wealth|trading)/.test(t)) return "Finance";
  if (/(react|code|programming|javascript|python|dev)/.test(t)) return "Coding";
  if (/(food|recipe|cook|chef|baking)/.test(t)) return "Food";
  if (/(workout|fitness|gym|exercise)/.test(t)) return "Fitness";
  if (/(vlog|day in|life|story)/.test(t)) return "Lifestyle";
  return "Trending";
}

function extractYoutubeUrl(imageUrl: string): string | null {
  const match = imageUrl.match(/\/vi\/([^/]+)\//);
  return match ? `https://www.youtube.com/watch?v=${match[1]}` : null;
}

export function FighterCard({
  thumbnail,
  side,
  isVoting,
  voteResult,
  onVote,
  onSwipeStart,
}: FighterCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-15, 0, 15]);
  const voteOverlayOpacity = useTransform(x, [-200, -40, 0, 40, 200], [0.55, 0, 0, 0, 0.55]);

  // Reset drag offset when a new battle pair loads
  useEffect(() => {
    x.set(0);
  }, [thumbnail.id, x]);

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    if (isVoting) return;
    const offset = info.offset.x;
    const velocity = info.velocity.x;
    const swiped = Math.abs(offset) > SWIPE_THRESHOLD || Math.abs(velocity) > 600;

    if (swiped) {
      // Snap back to center inside the same 150ms feedback window so the
      // vote animation starts cleanly from rest — no jump, no fight with keyframes.
      animate(x, 0, { duration: 0.15, ease: EASE_STANDARD });
      onVote();
    } else {
      animate(x, 0, { type: "spring", stiffness: 400, damping: 30 });
    }
  };

  // Clean 4-stop timeline (matches the spec exactly):
  //   t = 0      (0%)        rest
  //   t = 150ms  (18.75%)    instant feedback   — winner pops, loser dims & shrinks
  //   t = 500ms  (62.5%)     winner moment      — loser drifts down to opacity 0.2 / +20
  //   t = 800ms  (100%)      exit               — both lift -30, fade to 0
  // Total: 800ms, single cubic-bezier(0.4, 0, 0.2, 1) easing across the whole curve.
  const winnerKeyframes = {
    scale: [1, 1.05, 1.05, 1.05],
    y: [0, 0, 0, -30],
    opacity: [1, 1, 1, 0],
  };
  const loserKeyframes = {
    scale: [1, 0.95, 0.95, 0.95],
    y: [0, 0, 20, -30],
    opacity: [1, 0.5, 0.2, 0],
  };
  const restState = { scale: 1, y: 0, opacity: 1 };

  const animateState =
    voteResult === "winner"
      ? winnerKeyframes
      : voteResult === "loser"
      ? loserKeyframes
      : restState;

  const voteTransition = voteResult
    ? { duration: 0.8, times: [0, 0.1875, 0.625, 1], ease: EASE_STANDARD }
    : { type: "spring" as const, stiffness: 280, damping: 22 };

  const winnerGlow =
    "0 0 80px rgba(217, 70, 239, 0.7), 0 0 32px rgba(139, 92, 246, 0.5), 0 24px 50px -16px rgba(0,0,0,0.7)";

  const category = deriveCategory(thumbnail.title, thumbnail.channelName);
  const youtubeUrl = extractYoutubeUrl(thumbnail.imageUrl);

  return (
    <motion.div
      className={`group relative flex-1 max-w-[560px] w-full flex flex-col gap-5 ${
        isVoting ? "pointer-events-none" : "cursor-grab active:cursor-grabbing"
      }`}
      style={{ x, rotate, touchAction: "pan-y", willChange: "transform, opacity" }}
      drag={voteResult || isVoting ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragStart={() => onSwipeStart?.()}
      onDragEnd={handleDragEnd}
      whileHover={voteResult || isVoting ? undefined : { scale: 1.04, y: -8 }}
      animate={animateState}
      transition={voteTransition}
      onClick={() => {
        if (isVoting) return;
        if (Math.abs(x.get()) < 5) onVote();
      }}
    >
      <div
        className="thumb-card-shadow relative aspect-video overflow-hidden border-2 group-hover:border-purple-400/70 transition-[border-color,box-shadow] duration-150"
        style={{
          borderRadius: 18,
          borderColor:
            voteResult === "winner" ? "rgba(217,70,239,0.7)" : "rgba(255,255,255,0.1)",
          boxShadow: voteResult === "winner" ? winnerGlow : undefined,
          transitionTimingFunction: "cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <img
          src={thumbnail.imageUrl}
          alt={thumbnail.title}
          className="w-full h-full object-cover pointer-events-none select-none"
          draggable={false}
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

        {/* Winner inner purple/magenta tint — fades in within the 150ms feedback window */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={false}
          animate={{ opacity: voteResult === "winner" ? 1 : 0 }}
          transition={{ duration: 0.15, ease: EASE_STANDARD }}
          style={{
            background:
              "linear-gradient(135deg, rgba(139,92,246,0.18), rgba(217,70,239,0.22))",
            mixBlendMode: "screen",
          }}
        />

        {/* Loser red tint — fades in smoothly within the 150ms feedback window */}
        <motion.div
          className="absolute inset-0 pointer-events-none"
          initial={false}
          animate={{ opacity: voteResult === "loser" ? 1 : 0 }}
          transition={{ duration: 0.15, ease: EASE_STANDARD }}
          style={{ background: "rgba(220, 38, 38, 0.3)" }}
        />

        {/* Top-left: Category pill */}
        <div className="absolute top-3 left-3 z-10 pointer-events-none">
          <div
            className="px-2.5 py-1 rounded-full backdrop-blur-md border"
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 500,
              fontSize: "0.7rem",
              letterSpacing: "0.02em",
              color: "rgba(255,255,255,0.9)",
              background: "rgba(0,0,0,0.45)",
              borderColor: "rgba(255,255,255,0.15)",
            }}
          >
            {category}
          </div>
        </div>

        {/* Top-right: YouTube link */}
        {youtubeUrl && (
          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="absolute top-3 right-3 z-10 w-8 h-8 flex items-center justify-center rounded-full backdrop-blur-md border border-white/15 bg-black/45 text-white/80 hover:text-white hover:bg-red-600/80 hover:border-red-400/50 transition-colors"
            title="Watch on YouTube"
          >
            <Youtube className="w-4 h-4" />
          </a>
        )}

        {/* Swipe vote overlay (green = "vote for this") */}
        <motion.div
          className="absolute inset-0 pointer-events-none flex items-center justify-center"
          style={{
            opacity: voteOverlayOpacity,
            background:
              "linear-gradient(135deg, rgba(34, 197, 94, 0.35), rgba(16, 185, 129, 0.55))",
          }}
        >
          <div
            className="px-5 py-2 rounded-full border-2 border-emerald-300 text-white"
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 800,
              fontSize: "1.1rem",
              letterSpacing: "0.04em",
              background: "rgba(0,0,0,0.35)",
              backdropFilter: "blur(4px)",
            }}
          >
            Vote
          </div>
        </motion.div>
      </div>

      <div className="flex flex-col gap-1.5 px-1 text-left">
        <h3
          className="leading-tight line-clamp-2 text-white/95"
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 600,
            fontSize: "1.25rem",
            letterSpacing: "-0.01em",
          }}
        >
          {thumbnail.title}
        </h3>
        <div className="flex items-center justify-between gap-2 mt-1">
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 400,
              fontSize: "0.875rem",
              color: "#888",
            }}
          >
            {thumbnail.channelName}
          </span>
          <div
            className="px-3 py-1 rounded-full bg-white/[0.06] border border-white/10 backdrop-blur-sm"
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 500,
              fontSize: "0.75rem",
              color: "rgba(255,255,255,0.85)",
              letterSpacing: "0.02em",
            }}
          >
            {thumbnail.winRate !== null && thumbnail.winRate !== undefined
              ? `${Math.round(thumbnail.winRate)}% win rate`
              : "New contender"}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
