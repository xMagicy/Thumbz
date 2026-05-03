import React from "react";
import { Trophy, Medal, Star, Search, TrendingUp, Flame } from "lucide-react";
import type { Thumbnail } from "@workspace/api-client-react";
import { ListThumbnailsSort } from "@workspace/api-client-react";
import { motion, AnimatePresence } from "framer-motion";

import type { Niche } from "./NicheFilterBar";
import { EloSparkline } from "./EloTrendChart";
import { ChannelAvatar } from "./ChannelAvatar";

type Sort = (typeof ListThumbnailsSort)[keyof typeof ListThumbnailsSort];

interface LeaderboardProps {
  thumbnails: Thumbnail[] | undefined;
  isLoading: boolean;
  sort: Sort;
  onSortChange: (s: Sort) => void;
  onSelect: (t: Thumbnail) => void;
  niche?: Niche;
}

const inter = "'Inter', system-ui, sans-serif";

const SORT_OPTIONS: { value: Sort; label: string }[] = [
  { value: "elo", label: "Rating" },
  { value: "rising", label: "Rising" },
  { value: "winRate", label: "Win rate" },
  { value: "ctr", label: "CTR" },
  { value: "battles", label: "Most battled" },
];

// Compact FPH formatter: 12345 → "12.3k", 1500000 → "1.5M".
// Returns null for falsy/zero values so the badge can hide cleanly.
function formatFph(v: number | null | undefined): string | null {
  if (v === null || v === undefined || !Number.isFinite(v) || v <= 0) {
    return null;
  }
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}k`;
  return Math.round(v).toString();
}

const TIER_BREAKS: { index: number; label: string; subtitle: string }[] = [
  { index: 0, label: "Champions", subtitle: "The reigning thumbnails" },
  { index: 3, label: "Top contenders", subtitle: "Climbing fast" },
  { index: 10, label: "Rising", subtitle: "Up and coming" },
];

// Cubic-bezier easing tuple shared across leaderboard transitions
const EASE_STANDARD = [0.4, 0, 0.2, 1] as const;

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

function EmptyState({ niche }: { niche?: Niche }) {
  const isFiltered = niche && niche !== "All";
  return (
    <div className="p-16 flex flex-col items-center text-center gap-4">
      <div
        className="w-16 h-16 rounded-full flex items-center justify-center"
        style={{
          background:
            "radial-gradient(circle, rgba(217,70,239,0.18) 0%, rgba(139,92,246,0.08) 60%, transparent 100%)",
          border: "1px solid rgba(217,70,239,0.35)",
          boxShadow: "0 0 24px rgba(168,85,247,0.25)",
        }}
      >
        {isFiltered ? (
          <Search className="w-7 h-7" style={{ color: "#e9d5ff" }} />
        ) : (
          <Trophy className="w-7 h-7" style={{ color: "#e9d5ff" }} />
        )}
      </div>
      <h3
        className="text-white"
        style={{
          fontFamily: inter,
          fontWeight: 700,
          fontSize: "1.05rem",
          letterSpacing: "-0.01em",
        }}
      >
        {isFiltered
          ? `No battles in ${niche} yet`
          : "The arena is empty"}
      </h3>
      <p
        style={{
          fontFamily: inter,
          fontWeight: 400,
          fontSize: "0.875rem",
          color: "rgba(255,255,255,0.55)",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        {isFiltered
          ? "Be the first to upload a thumbnail in this niche and start the leaderboard."
          : "Start judging to populate the rankings."}
      </p>
    </div>
  );
}

export function Leaderboard({
  thumbnails,
  isLoading,
  sort,
  onSortChange,
  onSelect,
  niche,
}: LeaderboardProps) {
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

      {/* Sort tabs */}
      <div className="flex flex-wrap gap-2 mb-6 justify-center">
        {SORT_OPTIONS.map((opt) => {
          const active = sort === opt.value;
          return (
            <motion.button
              key={opt.value}
              type="button"
              onClick={() => onSortChange(opt.value)}
              whileTap={{ scale: 0.94 }}
              transition={{ type: "spring", stiffness: 500, damping: 28 }}
              className="px-4 py-1.5 rounded-full"
              style={{
                fontFamily: inter,
                fontWeight: active ? 600 : 500,
                fontSize: "0.8125rem",
                letterSpacing: "0.01em",
                background: active
                  ? "linear-gradient(135deg, #8b5cf6, #d946ef)"
                  : "rgba(255,255,255,0.05)",
                color: active ? "#fff" : "rgba(255,255,255,0.6)",
                border: active
                  ? "1px solid rgba(255,255,255,0.18)"
                  : "1px solid rgba(255,255,255,0.08)",
                boxShadow: active ? "0 6px 18px rgba(217,70,239,0.35)" : "none",
                transition: "background 0.2s var(--ease-standard), color 0.2s var(--ease-standard), border-color 0.2s var(--ease-standard), box-shadow 0.25s var(--ease-standard)",
              }}
            >
              {opt.label}
            </motion.button>
          );
        })}
      </div>

      <div className="bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2, ease: EASE_STANDARD }}
              className="p-6 space-y-4"
            >
              {[1, 2, 3, 4, 5].map((i) => (
                <div
                  key={i}
                  className="thumbz-skeleton w-full h-24 rounded-xl"
                />
              ))}
            </motion.div>
          ) : !thumbnails?.length ? (
            <motion.div
              key="empty"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE_STANDARD }}
            >
              <EmptyState niche={niche} />
            </motion.div>
          ) : (
            <motion.div
              key="list"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.3, ease: EASE_STANDARD }}
              className="flex flex-col"
            >
              {thumbnails.map((thumb, index) => (
                <React.Fragment key={thumb.id}>
                  {sort === "elo" && TIER_BREAKS.find((t) => t.index === index) && (
                    <TierHeader
                      label={TIER_BREAKS.find((t) => t.index === index)!.label}
                      subtitle={TIER_BREAKS.find((t) => t.index === index)!.subtitle}
                    />
                  )}
                  <motion.button
                    type="button"
                    onClick={() => onSelect(thumb)}
                    initial={{ opacity: 0, y: 18 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{
                      delay: Math.min(index * 0.04, 0.4),
                      duration: 0.45,
                      ease: EASE_STANDARD,
                    }}
                    whileHover={{
                      y: -2,
                      boxShadow:
                        "0 10px 30px -10px rgba(168,85,247,0.45), inset 0 0 0 1px rgba(217,70,239,0.22)",
                    }}
                    whileTap={{ scale: 0.995 }}
                    className="group flex flex-col md:flex-row md:items-center gap-4 p-4 md:p-6 relative overflow-hidden border-t border-white/[0.04] hover:bg-white/[0.04] text-left w-full cursor-pointer"
                    style={{
                      transition:
                        "background-color 0.2s var(--ease-standard), border-color 0.2s var(--ease-standard)",
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
                      <div className="flex items-center gap-2 flex-wrap">
                        <span
                          className="uppercase"
                          style={{
                            fontFamily: inter,
                            fontWeight: 600,
                            fontSize: "0.6rem",
                            letterSpacing: "0.1em",
                            color: "#c084fc",
                            background: "rgba(168, 85, 247, 0.15)",
                            border: "1px solid rgba(168, 85, 247, 0.4)",
                            padding: "2px 7px",
                            borderRadius: "9999px",
                            lineHeight: 1.2,
                          }}
                        >
                          {thumb.appCategory ?? thumb.niche}
                        </span>
                        {thumb.ctr !== null && thumb.ctr !== undefined && (
                          <span
                            style={{
                              fontFamily: inter,
                              fontWeight: 600,
                              fontSize: "0.62rem",
                              color: "#86efac",
                              background: "rgba(34,197,94,0.12)",
                              border: "1px solid rgba(34,197,94,0.35)",
                              padding: "2px 7px",
                              borderRadius: "9999px",
                              lineHeight: 1.2,
                              letterSpacing: "0.02em",
                            }}
                          >
                            {thumb.ctr.toFixed(1)}% CTR
                          </span>
                        )}
                        {(() => {
                          // 🔥 FPH badge — only shown when we actually have
                          // velocity data (real YouTube sync), never faked.
                          const fph = formatFph(thumb.viewVelocity);
                          if (!fph) return null;
                          return (
                            <span
                              className="inline-flex items-center gap-1"
                              style={{
                                fontFamily: inter,
                                fontWeight: 700,
                                fontSize: "0.62rem",
                                color: "#fdba74",
                                background:
                                  "linear-gradient(135deg, rgba(251,146,60,0.18), rgba(244,63,94,0.18))",
                                border: "1px solid rgba(251,146,60,0.45)",
                                padding: "2px 7px",
                                borderRadius: "9999px",
                                lineHeight: 1.2,
                                letterSpacing: "0.02em",
                                boxShadow:
                                  "0 0 12px rgba(251,146,60,0.25)",
                              }}
                              title="Views per hour (FPH) — measured from the last two YouTube snapshots"
                            >
                              <Flame
                                className="w-2.5 h-2.5"
                                style={{ color: "#fb923c" }}
                              />
                              {fph}/h
                            </span>
                          );
                        })()}
                      </div>
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
                      <div className="flex items-center gap-2 min-w-0">
                        <ChannelAvatar
                          channelName={thumb.channelName}
                          channelLogoUrl={thumb.channelLogoUrl}
                          size={22}
                        />
                        <p
                          className="truncate"
                          style={{
                            fontFamily: inter,
                            fontWeight: 400,
                            fontSize: "0.8125rem",
                            color: "#aaa",
                          }}
                        >
                          {thumb.channelName}
                        </p>
                      </div>
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

                    {/* Stats — fixed-width right rail so RATING and WIN RATE
                        share the same right edge across every row, instead
                        of the sparkline pushing the rating block leftward
                        unpredictably. */}
                    <div className="flex md:flex-col items-stretch md:items-end justify-between md:justify-center shrink-0 gap-3 md:gap-4 mt-4 md:mt-0 bg-white/5 md:bg-transparent p-3 md:p-0 rounded-lg w-full md:w-36">
                      <div className="flex flex-col items-end w-full">
                        <span
                          className="uppercase mb-1.5 flex items-center gap-1"
                          style={{
                            fontFamily: inter,
                            fontWeight: 500,
                            fontSize: "0.65rem",
                            letterSpacing: "0.12em",
                            color: "#666",
                          }}
                        >
                          <TrendingUp className="w-3 h-3 opacity-70" />
                          Rating
                        </span>
                        <div className="flex items-center justify-end gap-2 w-full">
                          <EloSparkline
                            recentRatings={thumb.recentRatings ?? []}
                            currentElo={Math.round(thumb.eloRating)}
                          />
                          <div
                            className="leading-none text-transparent bg-clip-text tabular-nums"
                            style={{
                              fontFamily: inter,
                              fontWeight: 800,
                              fontSize: "1.6rem",
                              letterSpacing: "-0.02em",
                              backgroundImage:
                                "linear-gradient(135deg, #8b5cf6, #d946ef)",
                              WebkitBackgroundClip: "text",
                            }}
                          >
                            {Math.round(thumb.eloRating)}
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-col items-end w-full">
                        <span
                          className="uppercase mb-1.5"
                          style={{
                            fontFamily: inter,
                            fontWeight: 500,
                            fontSize: "0.65rem",
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
                          className="mt-1.5 tabular-nums"
                          style={{
                            fontFamily: inter,
                            fontWeight: 600,
                            fontSize: "0.8125rem",
                            color: "#fff",
                          }}
                        >
                          {Math.round(thumb.winRate || 0)}%
                        </span>
                      </div>
                    </div>
                  </motion.button>
                </React.Fragment>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
