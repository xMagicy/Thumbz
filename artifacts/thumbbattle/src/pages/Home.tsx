import React, { useState } from "react";
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

import { ParticleField } from "../components/ParticleField";
import { FighterCard } from "../components/FighterCard";
import { VSBadge } from "../components/VSBadge";
import { Leaderboard } from "../components/Leaderboard";

export default function Home() {
  const queryClient = useQueryClient();
  const [votingFor, setVotingFor] = useState<number | null>(null);

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

    setTimeout(() => {
      castVote.mutate({
        data: { winnerId, loserId },
      });
    }, 700);
  };

  return (
    <div className="min-h-screen bg-arena-gradient text-foreground flex flex-col items-center pb-24 selection:bg-primary/30 relative">
      <ParticleField />
      <div className="vignette-overlay" />

      {/* Header */}
      <header className="w-full max-w-7xl mx-auto px-8 py-6 flex flex-row items-center justify-between gap-6 z-20 relative">
        {/* Logo: thumbz wordmark */}
        <div className="flex items-baseline">
          <span className="thumbz-word">thumb</span>
          <span className="thumbz-z">z</span>
        </div>

        {/* Subtle live indicator */}
        <div
          className="flex items-center gap-2.5 bg-black/30 backdrop-blur-md px-3 py-1.5 rounded-full border border-white/10"
          style={{ fontFamily: "'Inter', system-ui, sans-serif" }}
        >
          <div className="w-1.5 h-1.5 rounded-full bg-red-500 live-dot" />
          <span
            className="text-white/70 uppercase"
            style={{ fontWeight: 500, fontSize: "0.7rem", letterSpacing: "0.1em" }}
          >
            Live
          </span>
          <div className="w-px h-3 bg-white/15" />
          <span
            className="text-white/80"
            style={{ fontWeight: 600, fontSize: "0.75rem" }}
          >
            {stats?.totalVotes ? stats.totalVotes.toLocaleString() : 0}
            <span className="text-white/50 ml-1" style={{ fontWeight: 400 }}>
              matches
            </span>
          </span>
        </div>
      </header>

      {/* Main Arena */}
      <main className="w-full max-w-7xl mx-auto px-8 mt-12 md:mt-20 mb-28 flex flex-col items-center z-20 relative">
        <h2
          className="text-white text-center mb-16"
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 900,
            fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
            letterSpacing: "-0.02em",
            lineHeight: 1.15,
          }}
        >
          Which thumbnail makes you click?
        </h2>

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
                fontFamily: "'Inter', system-ui, sans-serif",
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
              style={{
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: 500,
              }}
            >
              <RefreshCw className="w-4 h-4" />
              Reload arena
            </Button>
          </div>
        ) : (
          <div className="relative w-full flex flex-col md:flex-row justify-center items-stretch gap-10 md:gap-24">
            <FighterCard
              thumbnail={battlePair.left}
              isVoting={votingFor !== null}
              voteResult={
                votingFor === battlePair.left.id ? "winner" : votingFor !== null ? "loser" : null
              }
              onVote={() => handleVote(battlePair.left.id, battlePair.right.id)}
            />

            <VSBadge />

            <FighterCard
              thumbnail={battlePair.right}
              isVoting={votingFor !== null}
              voteResult={
                votingFor === battlePair.right.id ? "winner" : votingFor !== null ? "loser" : null
              }
              onVote={() => handleVote(battlePair.right.id, battlePair.left.id)}
            />
          </div>
        )}
      </main>

      <Leaderboard thumbnails={thumbnails} isLoading={isLoadingLeaderboard} />

      <footer className="w-full max-w-7xl mx-auto px-8 mt-16 mb-8 z-20 relative flex justify-center">
        <p
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 400,
            fontSize: "14px",
            color: "#888",
            margin: 0,
          }}
        >
          Built by{" "}
          <span
            style={{
              fontWeight: 500,
              color: "#ffffff",
              letterSpacing: "0.02em",
            }}
          >
            xMagicy
          </span>
        </p>
      </footer>
    </div>
  );
}
