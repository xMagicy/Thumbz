import React from "react";
import { motion } from "framer-motion";
import type { Thumbnail } from "@workspace/api-client-react";

interface FighterCardProps {
  thumbnail: Thumbnail;
  side: "left" | "right";
  isVoting: boolean;
  voteResult: "winner" | "loser" | null;
  onVote: () => void;
}

export function FighterCard({ thumbnail, side, isVoting, voteResult, onVote }: FighterCardProps) {
  const variants = {
    idle: {
      scale: 1,
      opacity: 1,
      y: 0,
      filter: "grayscale(0%) blur(0px)",
    },
    hover: {
      scale: 1.03,
      y: -6,
      transition: { duration: 0.25, ease: "easeOut" },
    },
    winner: {
      scale: 1.08,
      opacity: 1,
      y: 0,
      zIndex: 50,
      transition: { type: "spring", stiffness: 280, damping: 22 },
    },
    loser: {
      scale: 0.92,
      opacity: 0.3,
      filter: "grayscale(100%) blur(4px)",
      transition: { duration: 0.4 },
    },
  };

  const getVariant = () => {
    if (voteResult === "winner") return "winner";
    if (voteResult === "loser") return "loser";
    return "idle";
  };

  const winnerGlow = "0 0 60px rgba(217, 70, 239, 0.55), 0 24px 50px -16px rgba(0,0,0,0.7)";

  return (
    <motion.div
      className={`group relative flex-1 max-w-[560px] w-full flex flex-col gap-5 cursor-pointer ${
        isVoting && !voteResult ? "pointer-events-none" : ""
      }`}
      variants={variants}
      initial="idle"
      animate={getVariant()}
      whileHover={voteResult ? undefined : "hover"}
      onClick={() => !isVoting && onVote()}
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
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />

        {/* Hover glow */}
        <div
          className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none"
          style={{ boxShadow: "inset 0 0 50px rgba(192, 38, 211, 0.45)" }}
        />
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
