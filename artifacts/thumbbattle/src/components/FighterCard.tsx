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
  // Animation variants
  const variants = {
    idle: {
      scale: 1,
      opacity: 1,
      y: 0,
      rotateY: 0,
      filter: "grayscale(0%) blur(0px)",
    },
    hover: {
      scale: 1.05,
      y: -10,
      rotateY: side === "left" ? 5 : -5,
      transition: { duration: 0.3, ease: "easeOut" }
    },
    winner: {
      scale: 1.15,
      opacity: 1,
      y: 0,
      zIndex: 50,
      transition: { type: "spring", stiffness: 300, damping: 20 }
    },
    loser: {
      scale: 0.9,
      opacity: 0.3,
      filter: "grayscale(100%) blur(4px)",
      transition: { duration: 0.4 }
    }
  };

  const getVariant = () => {
    if (voteResult === "winner") return "winner";
    if (voteResult === "loser") return "loser";
    return "idle";
  };

  const glowColor = side === "left" ? "rgba(192, 38, 211, 0.4)" : "rgba(217, 70, 239, 0.4)";
  const borderColorClass = side === "left" ? "group-hover:border-primary" : "group-hover:border-accent";

  return (
    <motion.div
      className={`group relative flex-1 max-w-[540px] w-full flex flex-col gap-4 cursor-pointer perspective-1000 ${isVoting && !voteResult ? 'pointer-events-none' : ''}`}
      variants={variants}
      initial="idle"
      animate={getVariant()}
      whileHover={voteResult ? undefined : "hover"}
      onClick={() => !isVoting && onVote()}
      style={{ transformStyle: "preserve-3d" }}
    >
      <div 
        className={`relative aspect-video rounded-xl overflow-hidden border-2 border-white/10 shadow-2xl transition-all duration-300 ${borderColorClass}`}
        style={{
          boxShadow: voteResult === 'winner' ? `0 0 60px ${glowColor}` : undefined
        }}
      >
        <img 
          src={thumbnail.imageUrl} 
          alt={thumbnail.title} 
          className="w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-70 group-hover:opacity-50 transition-opacity" />
        
        {/* Glow overlay on hover */}
        <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300`} 
             style={{ boxShadow: `inset 0 0 40px ${glowColor}` }} />
      </div>

      <div className="flex flex-col gap-1 px-4 text-center md:text-left">
        <h3 className="font-display text-3xl leading-tight line-clamp-2 uppercase tracking-wide group-hover:text-white text-white/90 transition-colors drop-shadow-md">
          {thumbnail.title}
        </h3>
        <div className="flex flex-col md:flex-row items-center md:justify-between gap-2 mt-2">
          <span className="text-sm md:text-base text-muted-foreground font-semibold uppercase tracking-wider">
            {thumbnail.channelName}
          </span>
          <div className="px-4 py-1 rounded bg-white/10 text-white border border-white/20 text-sm font-bold tracking-widest backdrop-blur-sm">
            {thumbnail.winRate !== null && thumbnail.winRate !== undefined 
              ? `${Math.round(thumbnail.winRate)}% WR` 
              : 'NEW CONTENDER'}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
