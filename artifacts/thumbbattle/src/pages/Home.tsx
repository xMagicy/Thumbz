import React, { useEffect, useState } from "react";
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
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion } from "framer-motion";

import { ParticleField } from "../components/ParticleField";
import { FighterCard } from "../components/FighterCard";
import { VSBadge } from "../components/VSBadge";
import { Leaderboard } from "../components/Leaderboard";

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
  const [votingFor, setVotingFor] = useState<number | null>(null);

  // Gamification state
  const [streak, setStreak] = useState(0);
  const [localVoteCount, setLocalVoteCount] = useState(0);
  const [dailyCount, setDailyCount] = useState(0);
  const [celebration, setCelebration] = useState<number | null>(null);

  // Init daily count from localStorage
  useEffect(() => {
    try {
      const today = new Date().toDateString();
      const stored = JSON.parse(localStorage.getItem("thumbz-daily") || "{}");
      setDailyCount(stored.date === today ? stored.count || 0 : 0);
    } catch {
      setDailyCount(0);
    }
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

  const castVote = useCastVote({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetBattlePairQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListThumbnailsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBattlesQueryKey() });
      },
      onSettled: () => {
        setVotingFor(null);
      },
    },
  });

  const handleVote = (winnerId: number, loserId: number) => {
    if (votingFor !== null) return;
    setVotingFor(winnerId);

    // Update gamification stats immediately
    setStreak((s) => s + 1);

    setLocalVoteCount((c) => {
      const next = c + 1;
      if (next > 0 && next % 10 === 0) {
        setCelebration(next);
        setTimeout(() => setCelebration(null), 2800);
      }
      return next;
    });

    setDailyCount((d) => {
      const next = d + 1;
      try {
        const today = new Date().toDateString();
        localStorage.setItem("thumbz-daily", JSON.stringify({ date: today, count: next }));
      } catch {
        /* ignore */
      }
      return next;
    });

    // Allow cinematic vote animation to play before mutating + reloading pair
    setTimeout(() => {
      castVote.mutate({
        data: { winnerId, loserId },
      });
    }, 850);
  };

  return (
    <div className="min-h-screen bg-arena-gradient text-foreground flex flex-col items-center pb-24 selection:bg-primary/30 relative">
      <ParticleField />
      <div className="vignette-overlay" />

      {/* Celebration overlay every 10 votes */}
      <AnimatePresence>
        {celebration !== null && <CelebrationOverlay key={celebration} count={celebration} />}
      </AnimatePresence>

      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-8 py-6 flex flex-row items-center justify-between gap-6 z-20 relative">
        {/* Logo: thumbz wordmark — DO NOT CHANGE */}
        <div className="flex items-baseline">
          <span className="thumbz-word">thumb</span>
          <span className="thumbz-z">z</span>
        </div>

        {/* Subtle live indicator */}
        <div
          className="flex items-center gap-2.5 bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10"
          style={{ fontFamily: inter }}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
          <span
            className="text-white/70 uppercase"
            style={{ fontWeight: 500, fontSize: "0.7rem", letterSpacing: "0.1em" }}
          >
            Live
          </span>
          <div className="w-px h-3 bg-white/15" />
          <span className="text-white/80" style={{ fontWeight: 600, fontSize: "0.75rem" }}>
            {stats?.totalVotes ? stats.totalVotes.toLocaleString() : 0}
            <span className="text-white/50 ml-1" style={{ fontWeight: 400 }}>
              matches
            </span>
          </span>
        </div>
      </header>

      {/* Main Arena */}
      <main className="w-full max-w-7xl mx-auto px-8 mt-10 md:mt-16 mb-28 flex flex-col items-center z-20 relative">
        <h2
          className="text-white text-center mb-4"
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

        {/* Streak indicator */}
        <div className="h-7 mb-12 flex items-center">
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
              key={`${battlePair.left.id}-${battlePair.right.id}`}
              initial={{ opacity: 0, y: 60 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ type: "spring", stiffness: 180, damping: 18, bounce: 0.4 }}
              className="relative w-full flex flex-col md:flex-row justify-center items-stretch gap-10 md:gap-28"
            >
              <FighterCard
                thumbnail={battlePair.left}
                side="left"
                isVoting={votingFor !== null}
                voteResult={
                  votingFor === battlePair.left.id ? "winner" : votingFor !== null ? "loser" : null
                }
                onVote={() => handleVote(battlePair.left.id, battlePair.right.id)}
              />

              <VSBadge />

              <FighterCard
                thumbnail={battlePair.right}
                side="right"
                isVoting={votingFor !== null}
                voteResult={
                  votingFor === battlePair.right.id ? "winner" : votingFor !== null ? "loser" : null
                }
                onVote={() => handleVote(battlePair.right.id, battlePair.left.id)}
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
