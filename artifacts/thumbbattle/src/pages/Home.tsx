import React, { useEffect, useRef, useState } from "react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  useGetBattlePair,
  getGetBattlePairQueryKey,
  useListThumbnails,
  getListThumbnailsQueryKey,
  useListBattles,
  getListBattlesQueryKey,
  useCastVote,
  ListThumbnailsSort,
} from "@workspace/api-client-react";
import type { Thumbnail } from "@workspace/api-client-react";
import { AlertCircle, RefreshCw, MessageSquarePlus, LogIn } from "lucide-react";
import { Button } from "@/components/ui/button";
import { AnimatePresence, motion, useScroll, useTransform, useReducedMotion } from "framer-motion";

import { ParticleField } from "../components/ParticleField";
import { FighterCard } from "../components/FighterCard";
import { VSBadge } from "../components/VSBadge";
import { Leaderboard } from "../components/Leaderboard";
import { FeedbackDialog } from "../components/FeedbackDialog";
import { UploadDialog } from "../components/UploadDialog";
import { SignInDialog } from "../components/SignInDialog";
import { UserMenu } from "../components/UserMenu";
import { UploadPromo } from "../components/UploadPromo";
import { NicheFilterBar, type Niche } from "../components/NicheFilterBar";
import { ThumbnailDetailModal } from "../components/ThumbnailDetailModal";
import { useSession } from "../lib/auth-client";

type Sort = (typeof ListThumbnailsSort)[keyof typeof ListThumbnailsSort];

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

  // Monotonic round counter. Bumped on every pair swap (vote success, error, or timeout).
  // Drives the AnimatePresence key so even an identical-pair refetch is treated as a fresh
  // round — no risk of UI deadlock if the random pair selector returns the same pair twice.
  const [round, setRound] = useState(0);

  // Round-locked vote state. The active vote is valid only when its round matches the
  // current round — bumping round atomically unlocks the UI, guaranteeing no deadlock
  // even if the mutation fails or the new pair query stalls.
  const [voteState, setVoteState] = useState<{ winnerId: number; round: number } | null>(null);

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

  // Beta feedback dialog
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [signInOpen, setSignInOpen] = useState(false);

  const { data: sessionData, isPending: sessionPending } = useSession();
  const sessionUser = sessionData?.user ?? null;

  // Filter / sort / detail state
  const [niche, setNiche] = useState<Niche>("All");
  const [sort, setSort] = useState<Sort>("elo");
  const [selectedThumb, setSelectedThumb] = useState<Thumbnail | null>(null);

  const apiNiche = niche === "All" ? undefined : niche;
  const battlePairParams = apiNiche ? { niche: apiNiche } : undefined;
  const listThumbnailsParams = {
    ...(apiNiche ? { niche: apiNiche } : {}),
    sort,
  };

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
    isFetching: isFetchingPair,
    isError: isErrorPair,
    refetch: refetchPair,
  } = useGetBattlePair(battlePairParams, {
    query: {
      queryKey: getGetBattlePairQueryKey(battlePairParams),
      refetchOnWindowFocus: false,
      // One automatic retry on transient failure so the arena never gets stuck on a flake.
      retry: 1,
      // Keep the previous pair visible during a niche switch refetch so the UI
      // doesn't blank out — the new pair fades in once the request settles.
      placeholderData: keepPreviousData,
    },
  });

  const {
    data: thumbnails,
    isLoading: isLoadingLeaderboard,
    isFetching: isFetchingLeaderboard,
  } = useListThumbnails(listThumbnailsParams, {
    query: {
      placeholderData: keepPreviousData,
    },
  });

  const { data: stats } = useListBattles();

  // Stable id for the currently rendered pair — used in the AnimatePresence key together
  // with `round` so identical-pair refetches still trigger a fresh transition.
  const currentPairKey = battlePair
    ? `${battlePair.left.id}-${battlePair.right.id}`
    : null;

  // Single source of truth for "is a vote currently displayed?". A vote is "active" only
  // while its captured round matches the current round; bumping round (the UI unlock signal)
  // atomically deactivates the vote AND forces AnimatePresence to swap to the new pair.
  const activeVote =
    voteState && voteState.round === round ? voteState : null;
  const isVoting = activeVote !== null;
  const winningId = activeVote?.winnerId ?? null;

  // Vote anim end-to-end:  click → 800ms cinematic → swap to next pair.
  // We fire the mutation IMMEDIATELY (so the server round-trip overlaps with the animation),
  // and the round bump + pair invalidation fires on a DETERMINISTIC 800ms timer — not coupled
  // to mutation success. This guarantees the UI unlocks at exactly 800ms regardless of whether
  // the vote API succeeded, failed, or stalled, and regardless of whether the random pair
  // selector returns the same pair twice in a row.
  const VOTE_ANIM_DURATION_MS = 800;

  const castVote = useCastVote({
    mutation: {
      // One automatic retry on transient failure (matches the user-requested behavior).
      retry: 1,
      onSuccess: () => {
        // Leaderboard + counters can refresh immediately; they're not in the cards container.
        queryClient.invalidateQueries({ queryKey: getListThumbnailsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListBattlesQueryKey() });
      },
      onError: (error) => {
        // Log and let the deterministic timer handle UI unlock — no manual cleanup needed.
        console.error("[thumbz] vote submission failed:", error);
      },
    },
  });

  const handleVote = (winnerId: number, loserId: number) => {
    // Gate on activeVote (round-aware), NOT raw voteState — stale voteState from previous
    // rounds is harmless and intentionally lingers until the next setVoteState overwrites it.
    if (activeVote !== null || !currentPairKey) return;
    voteStartedAtRef.current = Date.now();
    setVoteState({ winnerId, round });

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

    // 800ms after the click, the cinematic exit (cards lifted -30 / opacity 0) is complete.
    // We then start the next-pair refetch and ONLY commit the round-swap (which forces
    // AnimatePresence to remount with the new pair) once the refetch has actually settled.
    // This closes the architect-flagged race where remounting on stale cached data showed
    // the old pair flashing back as interactive.
    //
    // A 2s safety fallback guarantees the UI never deadlocks even if the refetch hangs.
    if (pairRefreshTimeoutRef.current !== null) {
      window.clearTimeout(pairRefreshTimeoutRef.current);
    }
    pairRefreshTimeoutRef.current = window.setTimeout(() => {
      pairRefreshTimeoutRef.current = null;
      let committed = false;
      const commit = () => {
        if (committed) return;
        committed = true;
        if (safetyId !== null) window.clearTimeout(safetyId);
        setVoteState(null);
        setRound((r) => r + 1);
      };
      // Trigger refetch and commit when the invalidation's promise settles (success or fail).
      queryClient
        .invalidateQueries({ queryKey: getGetBattlePairQueryKey() })
        .then(commit, commit);
      // Safety net: never wait longer than 2s before unlocking the UI.
      const safetyId = window.setTimeout(commit, 2000);
    }, VOTE_ANIM_DURATION_MS);
  };

  // Subtle parallax for the layered background — translates a soft purple/magenta
  // halo plane slower than the page scrolls. Pure visual; never blocks pointer events.
  // Disabled entirely under prefers-reduced-motion to avoid continuous transforms.
  const prefersReducedMotion = useReducedMotion();
  const { scrollY } = useScroll();
  const parallaxYRaw = useTransform(scrollY, [0, 1200], [0, -180]);
  const parallaxYSlowRaw = useTransform(scrollY, [0, 1200], [0, -90]);
  const parallaxY = prefersReducedMotion ? 0 : parallaxYRaw;
  const parallaxYSlow = prefersReducedMotion ? 0 : parallaxYSlowRaw;

  return (
    <div className="min-h-screen bg-arena-gradient text-foreground flex flex-col items-center pb-24 selection:bg-primary/30 relative">
      {/* Parallax background halos — subtle depth on scroll. Behind everything. */}
      <motion.div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          y: parallaxY,
          zIndex: 0,
          background:
            "radial-gradient(circle at 22% 18%, rgba(139,92,246,0.18), transparent 45%), radial-gradient(circle at 78% 82%, rgba(217,70,239,0.16), transparent 50%)",
          willChange: "transform",
        }}
      />
      <motion.div
        aria-hidden
        className="fixed inset-0 pointer-events-none"
        style={{
          y: parallaxYSlow,
          zIndex: 0,
          background:
            "radial-gradient(circle at 50% 60%, rgba(168,85,247,0.10), transparent 55%)",
          willChange: "transform",
        }}
      />
      <ParticleField />
      <div className="vignette-overlay" />

      {/* Celebration overlay every 10 votes */}
      <AnimatePresence>
        {celebration !== null && <CelebrationOverlay key={celebration} count={celebration} />}
      </AnimatePresence>

      {/* Beta feedback dialog */}
      <FeedbackDialog open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />

      {/* Upload waitlist dialog */}
      <UploadDialog open={uploadOpen} onClose={() => setUploadOpen(false)} />

      {/* Sign in dialog (visual placeholder until accounts ship) */}
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />

      {/* Detail modal — opened from leaderboard rows */}
      <ThumbnailDetailModal
        thumbnail={selectedThumb}
        onClose={() => setSelectedThumb(null)}
      />

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

          {/* Auth header slot — UserMenu when signed in, Sign in button otherwise.
              While the session is still resolving we render nothing to avoid a
              flash of the wrong state on first paint. */}
          {sessionPending ? null : sessionUser ? (
            <UserMenu name={sessionUser.name ?? ""} email={sessionUser.email} />
          ) : (
            <button
              type="button"
              onClick={() => setSignInOpen(true)}
              className="hidden sm:flex items-center gap-1.5 rounded-full transition-all hover:scale-[1.03] active:scale-[0.98]"
              style={{
                fontFamily: inter,
                fontWeight: 600,
                fontSize: "0.78rem",
                color: "#fff",
                padding: "6px 14px",
                background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
                border: "1px solid rgba(255,255,255,0.14)",
                boxShadow: "0 6px 18px -4px rgba(217,70,239,0.4)",
                letterSpacing: "0.01em",
              }}
            >
              <LogIn className="w-3.5 h-3.5" />
              Sign in
            </button>
          )}

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
            real-time. Or upload your own to see how they perform.
          </p>
        </div>

        {/* Niche filter bar */}
        <div className="w-full mb-6">
          <NicheFilterBar value={niche} onChange={setNiche} />
          {/* Loading bar — visible while a niche-switch refetch is in flight.
              Lives outside any AnimatePresence container so it never interferes
              with the battle pair / vote transitions. */}
          <div
            aria-hidden
            className="relative mt-2 h-[2px] w-full overflow-hidden rounded-full"
            style={{ background: "rgba(255,255,255,0.04)" }}
          >
            <div
              className="absolute inset-y-0 left-0 transition-opacity duration-200"
              style={{
                width: "100%",
                background:
                  "linear-gradient(90deg, transparent, #d946ef, #8b5cf6, transparent)",
                opacity: isFetchingPair || isFetchingLeaderboard ? 1 : 0,
                animation:
                  isFetchingPair || isFetchingLeaderboard
                    ? "thumbz-loading-sweep 1.1s ease-in-out infinite"
                    : undefined,
              }}
            />
          </div>
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
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            className="w-full flex flex-col md:flex-row justify-center items-center gap-10 md:gap-28 relative min-h-[400px]"
          >
            <div className="flex-1 w-full max-w-[560px] flex flex-col gap-5">
              <div className="thumbz-skeleton aspect-video rounded-2xl" />
              <div className="flex flex-col gap-2 px-3">
                <div className="thumbz-skeleton h-4 w-3/4 rounded-md" />
                <div className="thumbz-skeleton h-3 w-1/2 rounded-md" />
              </div>
            </div>
            <div className="flex-1 w-full max-w-[560px] flex flex-col gap-5">
              <div className="thumbz-skeleton aspect-video rounded-2xl" />
              <div className="flex flex-col gap-2 px-3">
                <div className="thumbz-skeleton h-4 w-3/4 rounded-md" />
                <div className="thumbz-skeleton h-3 w-1/2 rounded-md" />
              </div>
            </div>
            <div className="hidden md:block absolute top-[28%] left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full thumbz-skeleton z-10" />
          </motion.div>
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
          <div className="relative w-full">
            {/* Subtle loading hint — only visible during the brief gap while the next pair is
                being fetched. Sits behind the cards container so it never blocks pointer events. */}
            <motion.div
              className="absolute inset-0 flex items-center justify-center pointer-events-none"
              initial={false}
              animate={{ opacity: isFetchingPair && !isLoadingPair ? 1 : 0 }}
              transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
              aria-hidden
            >
              <div className="relative" style={{ width: 48, height: 48 }}>
                <div
                  className="absolute inset-0 rounded-full"
                  style={{
                    background:
                      "radial-gradient(closest-side, rgba(217,70,239,0.5), rgba(139,92,246,0.2) 60%, transparent 80%)",
                    filter: "blur(8px)",
                    animation: "thumbz-loader-pulse 1.1s ease-in-out infinite",
                  }}
                />
                <div
                  className="absolute inset-2 rounded-full"
                  style={{
                    background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
                    boxShadow:
                      "inset 0 1px 3px rgba(255,255,255,0.3), 0 0 14px rgba(217,70,239,0.6)",
                    animation: "thumbz-loader-pulse 1.1s ease-in-out infinite",
                  }}
                />
              </div>
            </motion.div>

            <AnimatePresence mode="wait">
              <motion.div
                key={`r${round}-${currentPairKey ?? "empty"}`}
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
                onReject={() => handleVote(battlePair.right.id, battlePair.left.id)}
              />

              <VSBadge isVoting={isVoting} />

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
                onReject={() => handleVote(battlePair.left.id, battlePair.right.id)}
              />
              </motion.div>
            </AnimatePresence>
          </div>
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

      {/* Upload promo — invites creators to join the waitlist */}
      <UploadPromo onUploadClick={() => setUploadOpen(true)} />

      {/* Faint divider between upload promo and championship rankings */}
      <div className="w-full max-w-5xl mx-auto px-6 mt-12 z-20 relative">
        <div className="h-px w-full" style={{ background: "rgba(255,255,255,0.05)" }} />
      </div>

      <Leaderboard
        thumbnails={thumbnails}
        isLoading={isLoadingLeaderboard}
        sort={sort}
        onSortChange={setSort}
        onSelect={setSelectedThumb}
        niche={niche}
      />

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
