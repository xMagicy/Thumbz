import React, { useState } from "react";
import { Trophy, Medal, Star } from "lucide-react";
import type { Thumbnail } from "@workspace/api-client-react";
import { motion } from "framer-motion";

interface LeaderboardProps {
  thumbnails: Thumbnail[] | undefined;
  isLoading: boolean;
}

const inter = "'Inter', system-ui, sans-serif";

type Filter = "all" | "week" | "today";

const TIER_BREAKS: { index: number; label: string; subtitle: string }[] = [
  { index: 0, label: "Champions", subtitle: "The reigning thumbnails" },
  { index: 3, label: "Top contenders", subtitle: "Climbing fast" },
  { index: 10, label: "Rising", subtitle: "Up and coming" },
];

function TierHeader({ label, subtitle }: { label: string; subtitle: string }) {
  return (
    <div className="px-4 md:px-6 pt-6 pb-3 flex items-baseline gap-3 bg-gradient-to-r from-purple-500/10 via-fuchsia-500/5 to-transparent border-l-2 border-fuchsia-500/40">
      <span
        style={{
          fontFamily: inter,
          fontWeight: 700,
          fontSize: "0.875rem",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "transparent",
          backgroundImage: "linear-gradient(135deg, #c084fc, #f0abfc)",
          WebkitBackgroundClip: "text",
          backgroundClip: "text",
        }}
      >
        {label}
      </span>
      <span
        style={{
          fontFamily: inter,
          fontWeight: 400,
          fontSize: "0.75rem",
          color: "#888",
        }}
      >
        {subtitle}
      </span>
    </div>
  );
}

function RankBadge({ index }: { index: number }) {
  if (index === 0) {
    return (
      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-yellow-300 to-yellow-600 flex items-center justify-center shadow-[0_0_18px_rgba(253,224,71,0.45)] text-black">
        <Trophy className="w-5 h-5" />
      </div>
    );
  }
  if (index === 1) {
    return (
      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-gray-200 to-gray-500 flex items-center justify-center shadow-[0_0_14px_rgba(209,213,219,0.35)] text-black">
        <Medal className="w-5 h-5" />
      </div>
    );
  }
  if (index === 2) {
    return (
      <div className="w-11 h-11 rounded-full bg-gradient-to-br from-orange-300 to-orange-600 flex items-center justify-center shadow-[0_0_14px_rgba(251,146,60,0.35)] text-black">
        <Star className="w-5 h-5" />
      </div>
    );
  }
  return (
    <div
      className="w-11 h-11 rounded-full flex items-center justify-center text-white"
      style={{
        background: "linear-gradient(135deg, rgba(139,92,246,0.35), rgba(217,70,239,0.35))",
        border: "1px solid rgba(255,255,255,0.12)",
        fontFamily: inter,
        fontWeight: 700,
        fontSize: "0.95rem",
      }}
    >
      {index + 1}
    </div>
  );
}

export function Leaderboard({ thumbnails, isLoading }: LeaderboardProps) {
  const [filter, setFilter] = useState<Filter>("all");

  const filterOptions: { value: Filter; label: string }[] = [
    { value: "all", label: "All time" },
    { value: "week", label: "This week" },
    { value: "today", label: "Today" },
  ];

  return (
    <section className="w-full max-w-5xl mx-auto px-6 mt-12 z-20 relative">
      <div className="flex flex-col items-center gap-2 mb-6">
        <h2
          className="text-white"
          style={{
            fontFamily: inter,
            fontWeight: 900,
            fontSize: "clamp(1.5rem, 2.5vw, 2rem)",
            letterSpacing: "-0.02em",
          }}
        >
          Championship rankings
        </h2>
        <p
          style={{
            fontFamily: inter,
            fontWeight: 400,
            fontSize: "0.95rem",
            color: "#888",
          }}
        >
          The thumbnails the world loves most
        </p>
        <div
          className="h-1 w-16 rounded-full mt-1"
          style={{ background: "linear-gradient(135deg, #8b5cf6, #d946ef)" }}
        />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6 justify-center">
        {filterOptions.map((opt) => (
          <button
            key={opt.value}
            onClick={() => setFilter(opt.value)}
            className="px-4 py-1.5 rounded-full transition-all"
            style={{
              fontFamily: inter,
              fontWeight: 500,
              fontSize: "0.8125rem",
              letterSpacing: "0.01em",
              background:
                filter === opt.value
                  ? "linear-gradient(135deg, #8b5cf6, #d946ef)"
                  : "rgba(255,255,255,0.05)",
              color: filter === opt.value ? "#fff" : "rgba(255,255,255,0.6)",
              border:
                filter === opt.value
                  ? "1px solid rgba(255,255,255,0.18)"
                  : "1px solid rgba(255,255,255,0.08)",
              boxShadow:
                filter === opt.value ? "0 6px 18px rgba(217,70,239,0.35)" : "none",
            }}
          >
            {opt.label}
          </button>
        ))}
      </div>

      <div className="bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="w-full h-24 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !thumbnails?.length ? (
          <div
            className="p-16 text-center text-muted-foreground"
            style={{ fontFamily: inter, fontWeight: 500, fontSize: "1rem" }}
          >
            The arena is empty. Start judging.
          </div>
        ) : (
          <div className="flex flex-col">
            {thumbnails.map((thumb, index) => (
              <React.Fragment key={thumb.id}>
                {TIER_BREAKS.find((t) => t.index === index) && (
                  <TierHeader
                    label={TIER_BREAKS.find((t) => t.index === index)!.label}
                    subtitle={TIER_BREAKS.find((t) => t.index === index)!.subtitle}
                  />
                )}
                <motion.div
                  initial={{ opacity: 0, y: 18 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.04, 0.4) }}
                  whileHover={{ y: -2 }}
                  className="group flex flex-col md:flex-row md:items-center gap-4 p-4 md:p-6 transition-colors relative overflow-hidden border-t border-white/[0.04] hover:bg-white/[0.04]"
                  style={{
                    boxShadow: "none",
                  }}
                >
                  {/* Hover purple glow strip on left */}
                  <div className="absolute left-0 top-0 bottom-0 w-1 opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-b from-purple-500 to-fuchsia-500" />

                  {/* Rank Badge */}
                  <div className="w-12 shrink-0 flex justify-center">
                    <RankBadge index={index} />
                  </div>

                  {/* Thumbnail Image */}
                  <div className="w-full md:w-44 aspect-video rounded-xl overflow-hidden shrink-0 border-2 border-white/5 group-hover:border-purple-400/40 transition-colors shadow-lg">
                    <img
                      src={thumb.imageUrl}
                      alt={thumb.title}
                      className="w-full h-full object-cover"
                    />
                  </div>

                  {/* Details */}
                  <div className="flex-1 min-w-0 pr-4 flex flex-col gap-1">
                    <h4
                      className="truncate text-white"
                      style={{
                        fontFamily: inter,
                        fontWeight: 600,
                        fontSize: "1.05rem",
                        letterSpacing: "-0.01em",
                      }}
                    >
                      {thumb.title}
                    </h4>
                    <p
                      className="truncate"
                      style={{
                        fontFamily: inter,
                        fontWeight: 400,
                        fontSize: "0.8125rem",
                        color: "#888",
                      }}
                    >
                      {thumb.channelName}
                    </p>
                    <p
                      style={{
                        fontFamily: inter,
                        fontWeight: 500,
                        fontSize: "0.7rem",
                        color: "#666",
                        marginTop: 2,
                      }}
                    >
                      {thumb.wins + thumb.losses} battles
                    </p>
                  </div>

                  {/* Stats */}
                  <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center shrink-0 gap-2 mt-4 md:mt-0 bg-white/5 md:bg-transparent p-3 md:p-0 rounded-lg">
                    <div className="flex flex-col items-start md:items-end">
                      <span
                        className="uppercase mb-1"
                        style={{
                          fontFamily: inter,
                          fontWeight: 500,
                          fontSize: "0.65rem",
                          letterSpacing: "0.12em",
                          color: "#666",
                        }}
                      >
                        Rating
                      </span>
                      <div
                        className="leading-none text-transparent bg-clip-text"
                        style={{
                          fontFamily: inter,
                          fontWeight: 800,
                          fontSize: "1.6rem",
                          letterSpacing: "-0.02em",
                          backgroundImage: "linear-gradient(135deg, #8b5cf6, #d946ef)",
                          WebkitBackgroundClip: "text",
                        }}
                      >
                        {Math.round(thumb.eloRating)}
                      </div>
                    </div>

                    <div className="flex flex-col items-end md:items-end w-28">
                      <span
                        className="uppercase mb-1"
                        style={{
                          fontFamily: inter,
                          fontWeight: 500,
                          fontSize: "0.6rem",
                          letterSpacing: "0.12em",
                          color: "#666",
                        }}
                      >
                        Win rate
                      </span>
                      <div className="w-full bg-black/50 rounded-full h-2 overflow-hidden border border-white/10">
                        <div
                          className="h-full"
                          style={{
                            width: `${thumb.winRate || 0}%`,
                            background: "linear-gradient(90deg, #8b5cf6, #d946ef)",
                          }}
                        />
                      </div>
                      <span
                        className="mt-1"
                        style={{
                          fontFamily: inter,
                          fontWeight: 600,
                          fontSize: "0.78rem",
                          color: "#fff",
                        }}
                      >
                        {Math.round(thumb.winRate || 0)}%
                      </span>
                    </div>
                  </div>
                </motion.div>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
