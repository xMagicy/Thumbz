import React, { useEffect } from "react";
import { motion, useMotionValue, useTransform, animate, PanInfo } from "framer-motion";
import type { Thumbnail } from "@workspace/api-client-react";

interface FighterCardProps {
  thumbnail: Thumbnail;
  isVoting: boolean;
  voteResult: "winner" | "loser" | null;
  onVote: () => void;
}

const SWIPE_THRESHOLD = 100;

export function FighterCard({ thumbnail, isVoting, voteResult, onVote }: FighterCardProps) {
  const x = useMotionValue(0);
  const rotate = useTransform(x, [-300, 0, 300], [-15, 0, 15]);
  const voteOverlayOpacity = useTransform(x, [-200, -40, 0, 40, 200], [0.55, 0, 0, 0, 0.55]);

  // Reset card position when a new battle pair loads (thumbnail.id changes)
  useEffect(() => {
    x.set(0);
  }, [thumbnail.id, x]);

  // When this card becomes the LOSER from the other side's vote, ensure it's reset
  useEffect(() => {
    if (voteResult === null) {
      x.set(0);
    }
  }, [voteResult, x]);

  const handleDragEnd = (_e: unknown, info: PanInfo) => {
    if (isVoting) return;

    const offset = info.offset.x;
    const velocity = info.velocity.x;
    const swiped = Math.abs(offset) > SWIPE_THRESHOLD || Math.abs(velocity) > 600;

    if (swiped) {
      // Fly off-screen in the swipe direction, then register the vote
      const flyTo = offset > 0 ? 800 : -800;
      animate(x, flyTo, {
        duration: 0.35,
        ease: "easeOut",
      });
      onVote();
    } else {
      // Snap back
      animate(x, 0, { type: "spring", stiffness: 400, damping: 30 });
    }
  };

  // Animation states driven by voteResult
  const animateState =
    voteResult === "winner"
      ? { scale: 1.06, opacity: 1, filter: "grayscale(0%) blur(0px)" }
      : voteResult === "loser"
      ? { scale: 0.92, opacity: 0.3, filter: "grayscale(100%) blur(4px)", x: 0 }
      : { scale: 1, opacity: 1, filter: "grayscale(0%) blur(0px)" };

  const winnerGlow = "0 0 60px rgba(217, 70, 239, 0.55), 0 24px 50px -16px rgba(0,0,0,0.7)";

  return (
    <motion.div
      className={`group relative flex-1 max-w-[560px] w-full flex flex-col gap-5 ${
        isVoting && !voteResult ? "pointer-events-none" : "cursor-grab active:cursor-grabbing"
      }`}
      style={{ x, rotate, touchAction: "pan-y" }}
      drag={voteResult || isVoting ? false : "x"}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.7}
      onDragEnd={handleDragEnd}
      whileHover={voteResult || isVoting ? undefined : { scale: 1.03, y: -6 }}
      animate={animateState}
      transition={{ type: "spring", stiffness: 280, damping: 22 }}
      onClick={() => {
        if (isVoting) return;
        // Only treat as click if the card hasn't been dragged
        if (Math.abs(x.get()) < 5) onVote();
      }}
    >
      <div
        className="thumb-card-shadow relative aspect-video overflow-hidden border-2 border-white/10 group-hover:border-purple-400/70 transition-[border-color,box-shadow] duration-300"
        style={{
          borderRadius: 16,
          boxShadow: voteResult === "winner" ? winnerGlow : undefined,
        }}
      >
        <img
          src={thumbnail.imageUrl}
          alt={thumbnail.title}
          className="w-full h-full object-cover pointer-events-none select-none"
          draggable={false}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-60 group-hover:opacity-40 transition-opacity pointer-events-none" />

        {/* Hover glow */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{ boxShadow: "inset 0 0 50px rgba(192, 38, 211, 0.45)" }}
        />

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
