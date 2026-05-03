import React, { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient, keepPreviousData } from "@tanstack/react-query";
import {
  getBattlePair,
  useListThumbnails,
  getListThumbnailsQueryKey,
  useListBattles,
  getListBattlesQueryKey,
  useCastVote,
  ListThumbnailsSort,
} from "@workspace/api-client-react";
import type { Thumbnail } from "@workspace/api-client-react";
import { AlertCircle, RefreshCw, LogIn } from "lucide-react";
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
import { NicheFilterBar, NICHES, type Niche } from "../components/NicheFilterBar";
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
  // Start-the-challenge gate. The intro overlay should run on every page
  // load, including refreshes, so the user always actively opts in to a
  // session — keeps the experience deliberate instead of a passive feed.
  // Plain component state means the gate resets every mount automatically.
  const [challengeStarted, setChallengeStarted] = useState(false);
  const startChallenge = useCallback(() => {
    setChallengeStarted(true);
  }, []);

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

  // ────────────────────────────────────────────────────────────────────────────
  // Tinder-style prefetched battle queue.
  //
  // Strategy: maintain a per-niche FIFO queue of pre-fetched pairs in local
  // state. On vote we pop the head — the next pair is already in memory AND
  // its images are already in the browser cache (warmed via `new Image().src`
  // the moment they entered the queue). This puts ZERO network on the critical
  // path between votes, which is what makes Tinder feel instant.
  //
  //   QUEUE_TARGET     — how many pairs to hold for the active niche
  //   QUEUE_REFILL_AT  — refill (in background) when remaining drops below this
  //   IDLE_PREFETCH_MS — after this idle period, warm a single pair for every
  //                      OTHER niche so the first niche-switch is also instant
  // ────────────────────────────────────────────────────────────────────────────
  type Pair = { left: Thumbnail; right: Thumbnail };
  const QUEUE_TARGET = 5;
  const QUEUE_REFILL_AT = 2;
  const IDLE_PREFETCH_MS = 2000;

  const [queues, setQueues] = useState<Record<string, Pair[]>>({});
  // Per-niche error state — scoped so a failed background prefetch for niche A
  // can never clear or mask an active-niche-A error, and a successful idle
  // prefetch for niche B can never overwrite niche A's state.
  const [errors, setErrors] = useState<Record<string, boolean>>({});
  // Track which niches have an in-flight fetch so we never stampede the API
  // with overlapping requests for the same niche.
  const inflightRef = useRef<Set<string>>(new Set());
  // Mirror of `queues` for read-time decisions inside async handlers (vote
  // refill check) — useState reads inside callbacks may be stale otherwise.
  const queuesRef = useRef<Record<string, Pair[]>>({});

  const fetchPairs = useCallback(
    async (
      nicheKey: string,
      count: number,
      mode: "replace" | "append",
    ): Promise<void> => {
      if (inflightRef.current.has(nicheKey)) return;
      inflightRef.current.add(nicheKey);
      try {
        const apiNicheArg = nicheKey === "All" ? undefined : nicheKey;
        const params = apiNicheArg
          ? { niche: apiNicheArg, count }
          : { count };
        const resp = await getBattlePair(params);
        const pairs = resp?.pairs ?? [];
        if (pairs.length > 0) {
          // Image preload — the single biggest perceived-speed win. By the
          // time these pairs are rendered the JPGs are decoded in the browser
          // cache, so the swipe-to-paint gap collapses to ~one frame.
          for (const p of pairs) {
            new Image().src = p.left.imageUrl;
            new Image().src = p.right.imageUrl;
          }
          setQueues((prev) => {
            const existing = prev[nicheKey] ?? [];
            const next =
              mode === "append" ? [...existing, ...pairs] : pairs;
            const updated = { ...prev, [nicheKey]: next };
            queuesRef.current = updated;
            return updated;
          });
        }
        // Successful response for THIS niche → clear THIS niche's error only.
        setErrors((prev) => (prev[nicheKey] ? { ...prev, [nicheKey]: false } : prev));
      } catch (err) {
        console.error("[thumbz] fetchPairs failed", { nicheKey, mode, err });
        // Surface the error only when this niche has nothing left to render —
        // i.e. a replace-fetch failed, OR an append-fetch failed and the
        // queue is empty. Otherwise the failure is invisible to the user.
        const nicheQueueEmpty =
          !queuesRef.current[nicheKey] || queuesRef.current[nicheKey].length === 0;
        if (mode === "replace" || nicheQueueEmpty) {
          setErrors((prev) => ({ ...prev, [nicheKey]: true }));
        }
      } finally {
        inflightRef.current.delete(nicheKey);
      }
    },
    [],
  );

  // On niche change (and on initial mount): ensure the active niche has a
  // queue. We intentionally read `queues` inside the effect body (not via
  // deps) so that vote-driven queue mutations don't re-trigger this effect —
  // refills are owned by the vote handler.
  useEffect(() => {
    const key = niche;
    // Clear THIS niche's error before re-attempting (other niches keep state).
    setErrors((prev) => (prev[key] ? { ...prev, [key]: false } : prev));
    if (!queuesRef.current[key] || queuesRef.current[key].length === 0) {
      void fetchPairs(key, QUEUE_TARGET, "replace");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [niche, fetchPairs]);

  // Recovery guard: if the active niche somehow ends up with an empty queue
  // and no in-flight fetch and no error, kick off a replace-fetch. This
  // covers the failure mode where a background refill quietly failed before
  // the queue drained — without this the arena would deadlock at "Loading…"
  // forever waiting on a refill that never comes.
  const activeQueueLength = (queues[niche] ?? []).length;
  useEffect(() => {
    if (activeQueueLength === 0 && !inflightRef.current.has(niche) && !errors[niche]) {
      void fetchPairs(niche, QUEUE_TARGET, "replace");
    }
  }, [activeQueueLength, niche, errors, fetchPairs]);

  // Idle prefetch — once on mount, after IDLE_PREFETCH_MS, warm a single pair
  // for every other niche. First niche-switch then renders instantly from
  // cache while the new niche's full queue back-fills in the background.
  useEffect(() => {
    const id = window.setTimeout(() => {
      for (const n of NICHES) {
        const cur = queuesRef.current[n];
        if (!cur || cur.length === 0) {
          void fetchPairs(n, 1, "replace");
        }
      }
    }, IDLE_PREFETCH_MS);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentQueue = queues[niche] ?? [];
  const headPair: Pair | undefined = currentQueue[0];

  // Frozen pair pins the rendered cards during the swipe animation so the
  // queue mutation underneath cannot interrupt FighterCard's exit transition.
  const [frozenPair, setFrozenPair] = useState<Pair | null>(null);
  const battlePair: Pair | undefined = frozenPair ?? headPair;

  // Loading + error states derived from the per-niche queue + error map.
  const nicheError = !!errors[niche];
  const isLoadingPair = !battlePair && !nicheError;
  const isFetchingPair = inflightRef.current.has(niche) && !!battlePair;
  const isErrorPair = nicheError && !battlePair;
  const refetchPair = useCallback(() => {
    setErrors((prev) => (prev[niche] ? { ...prev, [niche]: false } : prev));
    void fetchPairs(niche, QUEUE_TARGET, "replace");
  }, [fetchPairs, niche]);

  // Layer 4 safety net handler. FighterCard fires this when an image
  // loads with a vertical/near-square aspect — almost certainly a Short
  // that slipped past the backend filters. We:
  //   1. tell the server (which logs + auto-archives the row),
  //   2. drop any queued pair that contains this thumbnail so the user
  //      never sees it again,
  //   3. trigger a refill so the queue stays warm.
  // Idempotent: a Set guards against double-reporting the same id from
  // two cards / two re-mounts within the same session.
  const reportedBadIdsRef = useRef<Set<number>>(new Set());
  const handleBadThumbnail = useCallback(
    (info: {
      thumbnailId: number;
      reason: "vertical_aspect";
      width: number;
      height: number;
    }) => {
      if (reportedBadIdsRef.current.has(info.thumbnailId)) return;
      reportedBadIdsRef.current.add(info.thumbnailId);
      // Fire-and-forget. We don't await — the UI swap below is the
      // user-visible action and shouldn't be gated on a network round-trip.
      void fetch("/api/thumbnails/report-bad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(info),
      }).catch((err) => {
        console.warn("[thumbz] report-bad failed", err);
      });
      // Purge any queued pair across all niches that references this id.
      setQueues((prev) => {
        let mutated = false;
        const next: Record<string, Pair[]> = {};
        for (const [k, list] of Object.entries(prev)) {
          const filtered = list.filter(
            (p) =>
              p.left.id !== info.thumbnailId &&
              p.right.id !== info.thumbnailId,
          );
          if (filtered.length !== list.length) mutated = true;
          next[k] = filtered;
        }
        if (!mutated) return prev;
        queuesRef.current = next;
        return next;
      });
      // Refill the active niche so the swap is invisible to the user.
      void fetchPairs(niche, QUEUE_TARGET, "replace");
    },
    [fetchPairs, niche],
  );

  // keepPreviousData unused now — kept import-stable below via the leaderboard
  // query which still benefits from it.
  void keepPreviousData;

  const {
    data: thumbnails,
    isLoading: isLoadingLeaderboard,
    isFetching: isFetchingLeaderboard,
  } = useListThumbnails(listThumbnailsParams, {
    query: {
      queryKey: getListThumbnailsQueryKey(listThumbnailsParams),
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
  // Reduced from 800ms → 250ms for a Tinder-snap swipe. Keep in sync with the
  // `duration` field in FighterCard's voteTransition. The next-pair refetch
  // fires the moment the user clicks (parallel to the animation), so by the
  // time this timer expires the new pair is usually already in cache.
  const VOTE_ANIM_DURATION_MS = 250;

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
    if (activeVote !== null || !currentPairKey || !battlePair) return;
    voteStartedAtRef.current = Date.now();
    setVoteState({ winnerId, round });

    // Pin the displayed pair so the queue pop below can't mutate the rendered
    // pair mid-animation. Released when the round bumps.
    setFrozenPair(battlePair);

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

    // Fire the vote mutation in the background — DB write + ELO calc happen
    // server-side while the user is already looking at the next pair.
    castVote.mutate({ data: { winnerId, loserId } });

    // Pop the consumed pair from the queue NOW so the next pair (already
    // image-preloaded) is the new head when the round bumps in 250ms.
    const key = niche;
    const remainingAfterPop =
      Math.max(0, (queuesRef.current[key]?.length ?? 0) - 1);
    setQueues((prev) => {
      const q = prev[key] ?? [];
      const next = { ...prev, [key]: q.slice(1) };
      queuesRef.current = next;
      return next;
    });

    // Background refill if the queue is getting low — never blocks the UI.
    if (remainingAfterPop < QUEUE_REFILL_AT) {
      void fetchPairs(key, QUEUE_TARGET, "append");
    }

    // VOTE_ANIM_DURATION_MS after click, commit the round swap. The new pair
    // is already in state (queue head) AND already in the image cache, so
    // AnimatePresence remounts with a fully painted card — zero perceived
    // wait. No safety timer needed: there's no async dependency to race.
    if (pairRefreshTimeoutRef.current !== null) {
      window.clearTimeout(pairRefreshTimeoutRef.current);
    }
    pairRefreshTimeoutRef.current = window.setTimeout(() => {
      pairRefreshTimeoutRef.current = null;
      setVoteState(null);
      setRound((r) => r + 1);
      setFrozenPair(null);
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
      <UploadDialog
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onRequireSignIn={() => setSignInOpen(true)}
      />

      {/* Sign in dialog (visual placeholder until accounts ship) */}
      <SignInDialog open={signInOpen} onClose={() => setSignInOpen(false)} />

      {/* Detail modal — opened from leaderboard rows */}
      <ThumbnailDetailModal
        thumbnail={selectedThumb}
        onClose={() => setSelectedThumb(null)}
      />

      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-8 py-6 flex flex-row items-center justify-between gap-6 z-50 relative">
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

        {/* Right-side header cluster: auth + live indicator.
            "Send feedback" is intentionally NOT here — it lives in the
            footer to keep the header clean and signal-focused. */}
        <div className="flex items-center gap-3" style={{ fontFamily: inter }}>
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
          <div className="w-px h-3 bg-white/15" />
          <span
            style={{ fontWeight: 500, fontSize: "0.72rem", color: "rgba(255,255,255,0.55)" }}
            title="Thumbnails uploaded by real creators on Thumbz (excludes the YouTube trending pool)"
          >
            <span style={{ color: "rgba(255,255,255,0.85)", fontWeight: 600 }}>
              {stats?.totalUploads ? stats.totalUploads.toLocaleString() : 0}
            </span>{" "}
            creator uploads
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
              fontSize: "clamp(2rem, 4.5vw, 3.25rem)",
              letterSpacing: "-0.028em",
              lineHeight: 1.08,
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
          {/* Loading bar — only mounted while a niche-switch refetch is in
              flight, so it disappears the instant the fetch settles. Lives
              outside any AnimatePresence container so it can't interfere with
              the battle pair / vote transitions. */}
          {(isFetchingPair || isFetchingLeaderboard) && (
            <div
              aria-hidden
              className="relative mt-2 h-[2px] w-full overflow-hidden rounded-full"
              style={{ background: "rgba(255,255,255,0.04)" }}
            >
              <div
                className="absolute inset-y-0 left-0"
                style={{
                  width: "100%",
                  background:
                    "linear-gradient(90deg, transparent, #d946ef, #8b5cf6, transparent)",
                  animation: "thumbz-loading-sweep 1.1s ease-in-out infinite",
                }}
              />
            </div>
          )}
        </div>

        {/* Battle gate — wraps the streak + battle area. When the user
            hasn't started the challenge yet, the contents are blurred and
            non-interactive, with a "Start the challenge" CTA overlaid on
            top so the call to action is unmistakable. */}
        <div className="relative w-full flex flex-col items-center">
        <motion.div
          className="w-full flex flex-col items-center"
          initial={false}
          animate={{
            filter: challengeStarted ? "blur(0px)" : "blur(8px)",
            opacity: challengeStarted ? 1 : 0.55,
          }}
          transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
          style={{
            pointerEvents: challengeStarted ? "auto" : "none",
            // Hint the browser to optimize the blur transition.
            willChange: challengeStarted ? "auto" : "filter, opacity",
          }}
          aria-hidden={!challengeStarted}
        >
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
                onBadThumbnail={handleBadThumbnail}
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
                onBadThumbnail={handleBadThumbnail}
              />
              </motion.div>
            </AnimatePresence>
          </div>
        )}
        </motion.div>

        {/* Start-the-challenge overlay — clean, centered, low-key but
            confident. Lives inside the same relative container as the
            blurred battle so it sits perfectly on top. */}
        <AnimatePresence>
          {!challengeStarted && (
            <motion.div
              key="start-challenge-overlay"
              className="absolute inset-0 z-30 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, transition: { duration: 0.35, ease: [0.4, 0, 0.2, 1] } }}
              transition={{ duration: 0.4, ease: [0.4, 0, 0.2, 1] }}
            >
              {/* Heavy backdrop scrim — kills the visual competition with the
                  blurred thumbnails (and their ambient-light bleed) behind so
                  the card is the only thing the eye latches onto.
                  Two layers:
                   1. A massively oversized radial that extends well past the
                      battle container's bounds so the gradient fades to fully
                      transparent before reaching any edge. This kills the
                      hard rectangular silhouette the scrim used to draw at
                      the exact width of the battle area.
                   2. A tight inner radial that pumps extra darkness directly
                      under the modal to mask the card glow that previously
                      bled out at the bottom-right corner. */}
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: "-60vw",
                  right: "-60vw",
                  top: "-40vh",
                  bottom: "-40vh",
                  background:
                    "radial-gradient(ellipse 55% 45% at 50% 50%, rgba(8,5,20,0.92), rgba(8,5,20,0.6) 55%, rgba(8,5,20,0) 78%)",
                }}
              />
              <div
                aria-hidden
                className="pointer-events-none absolute"
                style={{
                  left: "-12%",
                  right: "-12%",
                  top: "-12%",
                  bottom: "-12%",
                  background:
                    "radial-gradient(ellipse 45% 55% at 50% 50%, rgba(8,5,20,0.65), rgba(8,5,20,0) 75%)",
                }}
              />

              <motion.div
                initial={{ opacity: 0, y: 18, scale: 0.94 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -10, scale: 0.96 }}
                transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
                className="relative flex flex-col items-center text-center pointer-events-auto"
                style={{
                  maxWidth: 540,
                  width: "calc(100% - 32px)",
                  padding: "36px 32px 30px",
                  borderRadius: 28,
                  background:
                    "linear-gradient(180deg, rgba(22,17,38,0.96), rgba(12,8,22,0.96))",
                  border: "1px solid rgba(168,85,247,0.38)",
                  boxShadow:
                    "0 40px 100px -20px rgba(0,0,0,0.85), 0 0 0 1px rgba(255,255,255,0.04) inset, 0 0 80px -10px rgba(217,70,239,0.4)",
                  backdropFilter: "blur(18px)",
                  WebkitBackdropFilter: "blur(18px)",
                }}
              >
                {/* Outer breathing glow halo */}
                <motion.div
                  aria-hidden
                  className="absolute -inset-[1px] rounded-[29px] pointer-events-none"
                  style={{
                    background:
                      "linear-gradient(135deg, rgba(139,92,246,0.6), rgba(217,70,239,0.6))",
                    opacity: 0.3,
                    filter: "blur(18px)",
                    zIndex: -1,
                  }}
                  animate={{ opacity: [0.22, 0.38, 0.22] }}
                  transition={{
                    duration: 4,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />

                {/* Top corner accent */}
                <div
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-28 rounded-t-[28px] pointer-events-none"
                  style={{
                    background:
                      "radial-gradient(ellipse at 50% 0%, rgba(217,70,239,0.25), rgba(0,0,0,0) 70%)",
                  }}
                />

                <div
                  className="px-3 py-1 rounded-full mb-5 inline-flex items-center gap-1.5 relative"
                  style={{
                    fontFamily: inter,
                    fontWeight: 600,
                    fontSize: "0.65rem",
                    letterSpacing: "0.16em",
                    color: "#e9d5ff",
                    background: "rgba(168,85,247,0.14)",
                    border: "1px solid rgba(168,85,247,0.35)",
                    textTransform: "uppercase",
                  }}
                >
                  <motion.span
                    aria-hidden
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 999,
                      background: "#d946ef",
                      boxShadow: "0 0 8px rgba(217,70,239,0.9)",
                    }}
                    animate={{ opacity: [1, 0.4, 1] }}
                    transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
                  />
                  Live battle · ready
                </div>

                <h3
                  className="text-white relative"
                  style={{
                    fontFamily: inter,
                    fontWeight: 800,
                    fontSize: "clamp(1.6rem, 3vw, 2.25rem)",
                    letterSpacing: "-0.028em",
                    lineHeight: 1.12,
                    marginBottom: 22,
                  }}
                >
                  Two thumbnails enter.
                  <br />
                  Only one wins.
                </h3>

                {/* MINI BATTLE PREVIEW — instantly telegraphs "this is the
                    game". Two thumbnail-shaped tiles with a tiny VS badge
                    between them. Tilts gently like Tinder cards. */}
                <div
                  aria-hidden
                  className="relative w-full flex items-center justify-center mb-6"
                  style={{ height: 96 }}
                >
                  <motion.div
                    className="relative rounded-lg overflow-hidden"
                    style={{
                      width: 148,
                      height: 84,
                      background:
                        "linear-gradient(135deg, #1f2937, #374151)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      boxShadow:
                        "0 10px 24px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
                      transformOrigin: "center right",
                    }}
                    initial={{ rotate: -7, x: 16 }}
                    animate={{ rotate: [-7, -5, -7] }}
                    transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(139,92,246,0.4), rgba(217,70,239,0.2))",
                      }}
                    />
                    {/* Skeleton-like horizontal lines */}
                    <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1">
                      <div
                        style={{
                          height: 4,
                          width: "75%",
                          background: "rgba(255,255,255,0.35)",
                          borderRadius: 2,
                        }}
                      />
                      <div
                        style={{
                          height: 3,
                          width: "45%",
                          background: "rgba(255,255,255,0.18)",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </motion.div>

                  {/* Mini VS badge between the two cards */}
                  <motion.div
                    className="relative mx-2 rounded-full flex items-center justify-center z-10"
                    style={{
                      width: 38,
                      height: 38,
                      background:
                        "radial-gradient(circle at 30% 30%, #a855f7, #7e22ce 60%, #4c1d95)",
                      border: "1px solid rgba(255,255,255,0.25)",
                      boxShadow:
                        "0 6px 18px rgba(217,70,239,0.55), inset 0 1px 0 rgba(255,255,255,0.3)",
                      fontFamily: inter,
                      fontWeight: 800,
                      fontSize: "0.7rem",
                      color: "#fff",
                      letterSpacing: "0.04em",
                    }}
                    animate={{ scale: [1, 1.08, 1] }}
                    transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
                  >
                    VS
                  </motion.div>

                  <motion.div
                    className="relative rounded-lg overflow-hidden"
                    style={{
                      width: 148,
                      height: 84,
                      background:
                        "linear-gradient(135deg, #1f2937, #374151)",
                      border: "1px solid rgba(255,255,255,0.08)",
                      boxShadow:
                        "0 10px 24px -8px rgba(0,0,0,0.6), inset 0 1px 0 rgba(255,255,255,0.06)",
                      transformOrigin: "center left",
                    }}
                    initial={{ rotate: 7, x: -16 }}
                    animate={{ rotate: [7, 5, 7] }}
                    transition={{
                      duration: 3.2,
                      repeat: Infinity,
                      ease: "easeInOut",
                      delay: 0.4,
                    }}
                  >
                    <div
                      className="absolute inset-0"
                      style={{
                        background:
                          "linear-gradient(135deg, rgba(217,70,239,0.4), rgba(251,146,60,0.25))",
                      }}
                    />
                    <div className="absolute inset-x-2 bottom-2 flex flex-col gap-1">
                      <div
                        style={{
                          height: 4,
                          width: "70%",
                          background: "rgba(255,255,255,0.35)",
                          borderRadius: 2,
                        }}
                      />
                      <div
                        style={{
                          height: 3,
                          width: "50%",
                          background: "rgba(255,255,255,0.18)",
                          borderRadius: 2,
                        }}
                      />
                    </div>
                  </motion.div>
                </div>

                <p
                  className="relative"
                  style={{
                    fontFamily: inter,
                    fontWeight: 400,
                    fontSize: "0.92rem",
                    color: "rgba(255,255,255,0.62)",
                    lineHeight: 1.55,
                    marginBottom: 22,
                  }}
                >
                  Click the one you'd actually click on YouTube. Watch the
                  rankings shift in real-time.
                </p>

                <motion.button
                  type="button"
                  onClick={startChallenge}
                  className="relative inline-flex items-center justify-center gap-2.5 rounded-full overflow-hidden pointer-events-auto"
                  style={{
                    fontFamily: inter,
                    fontWeight: 700,
                    fontSize: "1rem",
                    color: "#fff",
                    padding: "14px 28px",
                    background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
                    border: "1px solid rgba(255,255,255,0.18)",
                    boxShadow:
                      "0 18px 40px -10px rgba(217,70,239,0.55), inset 0 1px 0 rgba(255,255,255,0.22)",
                    letterSpacing: "0.005em",
                  }}
                  whileHover={{ scale: 1.035 }}
                  whileTap={{ scale: 0.97 }}
                  transition={{ type: "spring", stiffness: 400, damping: 22 }}
                  // Subtle entrance: the soft glow underneath breathes,
                  // calling attention without being noisy.
                  animate={{
                    boxShadow: [
                      "0 18px 40px -10px rgba(217,70,239,0.45), inset 0 1px 0 rgba(255,255,255,0.22)",
                      "0 22px 50px -10px rgba(217,70,239,0.65), inset 0 1px 0 rgba(255,255,255,0.22)",
                      "0 18px 40px -10px rgba(217,70,239,0.45), inset 0 1px 0 rgba(255,255,255,0.22)",
                    ],
                  }}
                >
                  {/* Sheen sweep — runs once every few seconds, very subtle */}
                  <motion.span
                    aria-hidden
                    className="absolute inset-y-0"
                    style={{
                      width: "40%",
                      background:
                        "linear-gradient(90deg, transparent, rgba(255,255,255,0.35), transparent)",
                      filter: "blur(2px)",
                    }}
                    initial={{ x: "-120%" }}
                    animate={{ x: ["-120%", "260%"] }}
                    transition={{
                      duration: 2.4,
                      repeat: Infinity,
                      repeatDelay: 2.6,
                      ease: "easeInOut",
                    }}
                  />
                  <span className="relative">Start the challenge</span>
                  <span
                    className="relative"
                    style={{ fontSize: "1.1rem", lineHeight: 1 }}
                    aria-hidden
                  >
                    →
                  </span>
                </motion.button>

                <div
                  className="mt-4"
                  style={{
                    fontFamily: inter,
                    fontWeight: 400,
                    fontSize: "0.75rem",
                    color: "rgba(255,255,255,0.4)",
                    letterSpacing: "0.01em",
                  }}
                >
                  No sign-up required
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>
        </div>

        {/* Upload promo — moved directly under the battle so creators see
            the call-to-action immediately, instead of after the leaderboard
            divider gap. */}
        <div className="w-full mt-8 md:mt-10">
          <UploadPromo
            onUploadClick={() => {
              // Uploads now require an account. Send anonymous visitors
              // straight to the sign-in flow instead of opening a dialog
              // they'd just bounce out of with a 401.
              if (!sessionPending && !sessionUser) {
                setSignInOpen(true);
                return;
              }
              setUploadOpen(true);
            }}
          />
        </div>

        {/* Daily progress */}
        {dailyCount > 0 && (
          <div
            className="mt-6"
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

      {/* Faint divider between upload promo and championship rankings */}
      <div className="w-full max-w-5xl mx-auto px-6 mt-10 z-20 relative">
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

      <footer className="w-full max-w-7xl mx-auto px-8 mt-16 mb-8 z-20 relative flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-5">
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
        <span className="hidden sm:inline" style={{ color: "rgba(255,255,255,0.2)" }}>·</span>
        <button
          type="button"
          onClick={() => setFeedbackOpen(true)}
          className="feedback-link transition-colors"
          style={{
            fontFamily: inter,
            fontWeight: 400,
            fontSize: "14px",
            color: "#888",
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
            textDecoration: "underline",
            textUnderlineOffset: "3px",
            textDecorationColor: "rgba(255,255,255,0.2)",
          }}
        >
          Send feedback
        </button>
      </footer>
    </div>
  );
}
