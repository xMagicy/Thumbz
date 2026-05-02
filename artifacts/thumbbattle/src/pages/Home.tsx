import React, { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetBattlePair,
  getGetBattlePairQueryKey,
  useListThumbnails,
  getListThumbnailsQueryKey,
  useListBattles,
  getListBattlesQueryKey,
  useCastVote,
} from "@workspace/api-client-react";
import { AlertCircle, RefreshCw, MessageSquarePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";

import { ParticleField } from "../components/ParticleField";
import { FighterCard } from "../components/FighterCard";
import { VSBadge } from "../components/VSBadge";
import { Leaderboard } from "../components/Leaderboard";
import { FeedbackDialog } from "../components/FeedbackDialog";

const inter = "'Inter', system-ui, sans-serif";

function Confetti() {
  const colors = ["#8b5cf6", "#d946ef", "#fbbf24", "#10b981", "#f43f5e", "#22d3ee"];
  const pieces = Array.from({ length: 60 }, (_, i) => i);
  return (
    <div className="absolute inset-0 overflow-hidden pointer-events-none">
      {pieces.map((i) => {
        const left = Math.random() * 100;
        const delay = Math.random() * 0.6;
        const dur = 1.6 + Math.random() * 1.6;
        const color = colors[i % colors.length];
        const size = 6 + Math.random() * 8;
        const rotate = (Math.random() - 0.5) * 720;
        const drift = (Math.random() - 0.5) * 200;
        return (
          <motion.div
            key={i}
            initial={{ y: -40, x: 0, rotate: 0, opacity: 1 }}
            animate={{ y: 900, x: drift, rotate, opacity: 0 }}
            transition={{ duration: dur, delay, ease: "easeIn" }}
            style={{
              position: "absolute",
              top: 0,
              left: `${left}%`,
              width: size,
              height: size * 1.4,
              background: color,
              borderRadius: 2,
              boxShadow: `0 0 6px ${color}80`,
            }}
          />
        );
      })}
    </div>
  );
}

function CelebrationOverlay({ count }: { count: number }) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Confetti />
      <motion.div
        initial={{ scale: 0.7, y: 20, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.85, opacity: 0 }}
        transition={{ type: "spring", stiffness: 220, damping: 16 }}
        className="px-10 py-8 rounded-3xl flex flex-col items-center gap-2 backdrop-blur-xl"
        style={{
          background: "rgba(10,10,20,0.85)",
          border: "1px solid rgba(217,70,239,0.4)",
          boxShadow: "0 30px 60px -10px rgba(0,0,0,0.6), 0 0 60px rgba(217,70,239,0.4)",
        }}
      >
        <div
          style={{
            fontFamily: inter,
            fontWeight: 900,
            fontSize: "2.5rem",
            letterSpacing: "-0.02em",
            backgroundImage: "linear-gradient(135deg, #c084fc, #f0abfc)",
            WebkitBackgroundClip: "text",
            color: "transparent",
            lineHeight: 1,
          }}
        >
          {count} battles judged!
        </div>
        <div
          style={{
            fontFamily: inter,
            fontWeight: 500,
            fontSize: "1rem",
            color: "rgba(255,255,255,0.7)",
            marginTop: 4,
          }}
        >
          Keep going
        </div>
      </motion.div>
    </motion.div>
  );
}

export default function Home() {
  const queryClient = useQueryClient();

  // Pair-locked vote state. Pinning the active vote to the pair it was cast on means it
  // auto-clears the moment a new pair is loaded — no manual onSettled reset needed, and no
  // risk of cards flashing back to rest state mid-exit while the OLD pair is still visible.
  const [voteState, setVoteState] = useState<{ winnerId: number; pairKey: string } | null>(null);

  // Gamification state — refs mirror the count for race-free synchronous reads
  const [streak, setStreak] = useState(0);
  const [localVoteCount, setLocalVoteCount] = useState(0);
  const [dailyCount, setDailyCount] = useState(0);
  const [celebration, setCelebration] = useState<number | null>(null);
  const localVoteCountRef = useRef(0);
  const dailyCountRef = useRef(0);
  const celebrationTimeoutRef = useRef<number | null>(null);
  const pairRefreshTimeoutRef = useRef<number | null>(null);
  const voteStartedAtRef = useRef(0);

  // Counter bumped whenever a card swipe starts — VSBadge watches this to trigger sword anim
  const [vsAnimTrigger, setVsAnimTrigger] = useState(0);
  const triggerVsAnim = () => setVsAnimTrigger((v) => v + 1);

  // Beta feedback dialog
  const [feedbackOpen, setFeedbackOpen] = useState(false);

  // Init daily count from localStorage on mount
  useEffect(() => {
    try {
      const today = new Date().toDateString();
      const stored = JSON.parse(localStorage.getItem("thumbz-daily") || "{}");
      const initial = stored.date === today ? Number(stored.count) || 0 : 0;
      dailyCountRef.current = initial;
      setDailyCount(initial);
    } catch {
      dailyCountRef.current = 0;
      setDailyCount(0);
    }
  }, []);

  // Cancel pending timeouts on unmount so we never call setState / mutate after unmount
  useEffect(() => {
    return () => {
      if (celebrationTimeoutRef.current !== null) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
      if (pairRefreshTimeoutRef.current !== null) {
        window.clearTimeout(pairRefreshTimeoutRef.current);
      }
    };
  }, []);

  const {
    data: battlePair,
    isLoading: isLoadingPair,
    isError: isErrorPair,
    refetch: refetchPair,
  } = useGetBattlePair({
    query: {
      queryKey: getGetBattlePairQueryKey(),
      refetchOnWindowFocus: false,
    },
  });

  const { data: thumbnails, isLoading: isLoadingLeaderboard } = useListThumbnails({
    query: {
      queryKey: getListThumbnailsQueryKey(),
    },
  });

  const { data: stats } = useListBattles({
    query: {
      queryKey: getListBattlesQueryKey(),
    },
  });

  // Single source of truth for "what pair are we currently rendering?". The active vote is
  // valid only when its pairKey matches — if a refetch swaps the pair, the vote auto-deactivates.
  const currentPairKey = battlePair
    ? `${battlePair.left.id}-${battlePair.right.id}`
    : null;
  const activeVote =
    voteState && voteState.pairKey === currentPairKey ? voteState : null;
  const isVoting = activeVote !== null;
  const winningId = activeVote?.winnerId ?? null;

  // Vote anim end-to-end:  click → 800ms cinematic → swap to next pair.
  // We fire the mutation IMMEDIATELY (so the server round-trip overlaps with the animation),
  // and schedule the battle-pair query invalidation to fire AT THE END of the 800ms window —
  // never sooner — so AnimatePresence doesn't swap children mid-animation.
  const VOTE_ANIM_DURATION_MS = 800;

  const castVote = useCastVote({
    mutation: {
      onSuccess: () => {
        // Leaderboard + counters can refresh immediately; they're not in the cards container.
        queryClient.invalidateQueries({ queryKey: getListThumbnailsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBattlesQueryKey() });

        // Battle pair refresh is gated by the animation timeline.
        const elapsed = Date.now() - voteStartedAtRef.current;
        const wait = Math.max(0, VOTE_ANIM_DURATION_MS - elapsed);
        if (pairRefreshTimeoutRef.current !== null) {
          window.clearTimeout(pairRefreshTimeoutRef.current);
        }
        pairRefreshTimeoutRef.current = window.setTimeout(() => {
          queryClient.invalidateQueries({ queryKey: getGetBattlePairQueryKey() });
          pairRefreshTimeoutRef.current = null;
        }, wait);
      },
    },
  });

  const handleVote = (winnerId: number, loserId: number) => {
    if (voteState !== null || !currentPairKey) return;
    voteStartedAtRef.current = Date.now();
    setVoteState({ winnerId, pairKey: currentPairKey });

    // Increment via refs (race-free sync writes), then mirror to state for rendering.
    setStreak((s) => s + 1);

    const nextLocalCount = localVoteCountRef.current + 1;
    localVoteCountRef.current = nextLocalCount;
    setLocalVoteCount(nextLocalCount);
    if (nextLocalCount > 0 && nextLocalCount % 10 === 0) {
      if (celebrationTimeoutRef.current !== null) {
        window.clearTimeout(celebrationTimeoutRef.current);
      }
      setCelebration(nextLocalCount);
      celebrationTimeoutRef.current = window.setTimeout(() => {
        setCelebration(null);
        celebrationTimeoutRef.current = null;
      }, 2800);
    }

    const nextDailyCount = dailyCountRef.current + 1;
    dailyCountRef.current = nextDailyCount;
    setDailyCount(nextDailyCount);
    try {
      const today = new Date().toDateString();
      localStorage.setItem(
        "thumbz-daily",
        JSON.stringify({ date: today, count: nextDailyCount }),
      );
    } catch {
      /* ignore quota / disabled storage */
    }

    // Fire the mutation right away so server work overlaps with the cinematic animation.
    castVote.mutate({ data: { winnerId, loserId } });
  };

  return (
    <div className="min-h-screen bg-arena-gradient text-foreground flex flex-col items-center pb-24 selection:bg-primary/30 relative">
      <ParticleField />
      <div className="vignette-overlay" />

      {/* Celebration overlay every 10 votes */}
      <AnimatePresence>
        {celebration !== null && <CelebrationOverlay key={celebration} count={celebration} />}
      </AnimatePresence>

      {/* Beta feedback dialog */}
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-8 py-6 flex flex-row items-center justify-between gap-6 z-20 relative">
        {/* Logo: thumbz wordmark — DO NOT CHANGE */}
        <div className="flex items-baseline gap-2">
          <div className="flex items-baseline">
            <span className="thumbz-word">thumb</span>
            <span className="thumbz-z">z</span>
          </div>
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            aria-label="Send feedback — site is in beta"
            className="beta-badge-trigger uppercase"
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 600,
              fontSize: "11px",
              color: "#c084fc",
              background: "rgba(168, 85, 247, 0.15)",
              border: "1px solid rgba(168, 85, 247, 0.4)",
              padding: "4px 10px",
              borderRadius: "9999px",
              lineHeight: 1,
              transform: "translateY(-18px)",
              display: "inline-block",
              cursor: "pointer",
              transition: "background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease",
            }}
          >
            BETA
          </button>
        </div>

        {/* Right-side header cluster: feedback link + live indicator */}
        <div className="flex items-center gap-3" style={{ fontFamily: inter }}>
          <button
            type="button"
            onClick={() => setFeedbackOpen(true)}
            className="feedback-link hidden sm:flex items-center gap-1.5 rounded-full transition-colors"
            style={{
              fontWeight: 500,
              fontSize: "0.78rem",
              color: "rgba(255,255,255,0.55)",
              padding: "6px 10px",
              letterSpacing: "0.01em",
            }}
          >
            <MessageSquarePlus className="w-3.5 h-3.5" />
            Send feedback
          </button>

        {/* Refined live indicator: green pulsing dot, LIVE small caps, N matches today secondary */}
        <div
          className="flex items-center gap-2.5 bg-black/30 backdrop-blur-md px-3.5 py-1.5 rounded-full border border-white/10"
        >
          <div
            className="w-1.5 h-1.5 rounded-full live-dot"
            style={{ background: "#10b981" }}
          />
          <span
            className="text-white/85 uppercase"
            style={{ fontWeight: 600, fontSize: "0.68rem", letterSpacing: "0.14em" }}
          >
            Live
          </span>
          <div className="w-px h-3 bg-white/15" />
          <span style={{ fontWeight: 500, fontSize: "0.72rem", color: "rgba(255,255,255,0.55)" }}>
            <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>
              {stats?.totalVotes ? stats.totalVotes.toLocaleString() : 0}
            </span>{" "}
            matches today
          </span>
        </div>
        </div>
      </header>

      {/* Main Arena */}
      <main className="w-full max-w-7xl mx-auto px-8 mt-8 md:mt-12 mb-28 flex flex-col items-center z-20 relative">
        {/* Intro section — tagline pill + headline + subtitle */}
        <div className="flex flex-col items-center text-center max-w-2xl mb-10">
          <div
            className="px-3 py-1 rounded-full backdrop-blur-md mb-5"
            style={{
              fontFamily: inter,
              fontWeight: 500,
              fontSize: "0.72rem",
              letterSpacing: "0.05em",
              color: "rgba(255,255,255,0.75)",
              background: "rgba(139,92,246,0.12)",
              border: "1px solid rgba(217,70,239,0.25)",
              textTransform: "uppercase",
            }}
          >
            The thumbnail rating game
          </div>

          <h2
            className="text-white"
            style={{
              fontFamily: inter,
              fontWeight: 900,
              fontSize: "clamp(1.125rem, 2.25vw, 1.7rem)",
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
            }}
          >
            Which thumbnail makes you click?
          </h2>

          <p
            className="mt-3"
            style={{
              fontFamily: inter,
              fontWeight: 400,
              fontSize: "16px",
              color: "#888",
              lineHeight: 1.55,
              maxWidth: 520,
            }}
          >
            Vote on real YouTube thumbnails. Watch the rankings change in
            real-time. The best thumbnails rise to the top.
          </p>
        </div>

        {/* Streak indicator */}
        <div className="h-7 mb-10 flex items-center">
          <AnimatePresence>
            {streak >= 3 && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, y: -6 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{ type: "spring", stiffness: 320, damping: 20 }}
                className="px-3 py-1 rounded-full backdrop-blur-md"
                style={{
                  fontFamily: inter,
                  fontWeight: 600,
                  fontSize: "0.8125rem",
                  letterSpacing: "0.01em",
                  color: "#fff",
                  background: "rgba(251,146,60,0.18)",
                  border: "1px solid rgba(251,146,60,0.4)",
                  boxShadow: "0 0 18px rgba(251,146,60,0.25)",
                }}
              >
                🔥 {streak} in a row
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {isLoadingPair ? (
          <div className="w-full flex flex-col md:flex-row justify-center items-center gap-10 md:gap-20 relative min-h-[400px]">
            <div className="flex-1 w-full max-w-[560px] aspect-video bg-white/5 rounded-2xl border border-white/10 animate-pulse" />
            <div className="flex-1 w-full max-w-[560px] aspect-video bg-white/5 rounded-2xl border border-white/10 animate-pulse" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-black/50 border border-white/10 animate-pulse z-10 backdrop-blur-md" />
          </div>
        ) : isErrorPair || !battlePair ? (
          <div className="w-full max-w-2xl flex flex-col items-center justify-center p-16 bg-black/40 backdrop-blur-md rounded-3xl border border-white/10 text-center gap-6 shadow-2xl">
            <AlertCircle className="w-14 h-14 text-destructive opacity-80" />
            <p
              style={{
                fontFamily: inter,
                fontWeight: 700,
                fontSize: "1.25rem",
                color: "#fff",
              }}
            >
              Failed to load the next battle
            </p>
            <Button
              onClick={() => refetchPair()}
              variant="secondary"
              size="lg"
              className="gap-2 rounded-full"
              style={{ fontFamily: inter, fontWeight: 500 }}
            >
              <RefreshCw className="w-4 h-4" />
              Reload arena
            </Button>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            <motion.div
              key={currentPairKey ?? "empty"}
              // New pair entry (spec stage 4, 800–1100ms): rises up from y +30 with a soft fade.
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              // Cards already animated themselves to opacity 0 + y -30 by the time the key
              // changes, so the parent's exit can be instant — no extra dead time.
              exit={{ opacity: 0, transition: { duration: 0 } }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
              className="relative w-full flex flex-col md:flex-row justify-center items-stretch gap-10 md:gap-28"
            >
              <FighterCard
                thumbnail={battlePair.left}
                side="left"
                isVoting={isVoting}
                voteResult={
                  winningId === battlePair.left.id
                    ? "winner"
                    : winningId !== null
                    ? "loser"
                    : null
                }
                onVote={() => handleVote(battlePair.left.id, battlePair.right.id)}
                onSwipeStart={triggerVsAnim}
              />

              <VSBadge externalTrigger={vsAnimTrigger} isVoting={isVoting} />

              <FighterCard
                thumbnail={battlePair.right}
                side="right"
                isVoting={isVoting}
                voteResult={
                  winningId === battlePair.right.id
                    ? "winner"
                    : winningId !== null
                    ? "loser"
                    : null
                }
                onVote={() => handleVote(battlePair.right.id, battlePair.left.id)}
                onSwipeStart={triggerVsAnim}
              />
            </motion.div>
          </AnimatePresence>
        )}

        {/* Daily progress */}
        {dailyCount > 0 && (
          <div
            className="mt-10"
            style={{
              fontFamily: inter,
              fontWeight: 400,
              fontSize: "0.8125rem",
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.01em",
            }}
          >
            You've judged{" "}
            <span style={{ color: "#fff", fontWeight: 600 }}>{dailyCount}</span>{" "}
            {dailyCount === 1 ? "battle" : "battles"} today
          </div>
        )}
      </main>

      {/* Faint divider between battle area and championship rankings */}
      <div className="w-full max-w-5xl mx-auto px-6 z-20 relative">
        <div className="h-px w-full" style={{ background: "rgba(255,255,255,0.05)" }} />
      </div>

      <Leaderboard thumbnails={thumbnails} isLoading={isLoadingLeaderboard} />

      <footer className="w-full max-w-7xl mx-auto px-8 mt-16 mb-8 z-20 relative flex justify-center">
        <p
          style={{
            fontFamily: inter,
            fontWeight: 400,
            fontSize: "14px",
            color: "#888",
            margin: 0,
          }}
        >
          Built by{" "}
          <a
            href="#"
            onClick={(e) => e.preventDefault()}
            className="xmagicy-link"
            style={{
              fontWeight: 500,
              color: "#ffffff",
              letterSpacing: "0.02em",
              textDecoration: "none",
            }}
          >
            xMagicy
          </a>
        </p>
      </footer>
    </div>
  );
}
