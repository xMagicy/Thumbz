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
import { Loader2, Swords, AlertCircle, RefreshCw } from "lucide-react";
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
      }
    }
  });

  const handleVote = (winnerId: number, loserId: number) => {
    if (votingFor !== null) return;
    setVotingFor(winnerId);
    
    // Wait for animation to finish before invalidating and fetching the next pair
    setTimeout(() => {
      castVote.mutate({
        data: { winnerId, loserId }
      });
    }, 700); // ~700ms animation delay
  };

  return (
    <div className="min-h-screen bg-arena-gradient text-foreground flex flex-col items-center pb-24 selection:bg-primary/30 relative">
      <ParticleField />
      <div className="vignette-overlay" />

      {/* Header */}
      <header className="w-full max-w-6xl mx-auto px-6 py-6 flex flex-col md:flex-row items-center justify-between gap-6 z-20 relative">
        <div className="flex items-center gap-3">
          {/* Logo */}
          <div className="relative w-12 h-12 flex items-center justify-center drop-shadow-[0_0_15px_rgba(192,38,211,0.5)]">
            <div className="absolute inset-0 bg-electric-gradient rounded-sm rotate-45 scale-75 opacity-20 blur-sm" />
            <Swords className="w-8 h-8 text-white relative z-10 filter drop-shadow-md" />
          </div>
          <h1 className="font-display text-4xl md:text-5xl tracking-wider text-electric-gradient uppercase drop-shadow-md">
            ThumbBattle
          </h1>
        </div>
        
        {/* Battle Stats */}
        <div className="flex items-center gap-4 bg-black/40 backdrop-blur-md px-5 py-2.5 rounded-full border border-white/10 shadow-lg">
          <div className="flex items-center gap-2">
            <div className="w-2.5 h-2.5 rounded-full bg-red-500 live-dot" />
            <span className="font-bold text-sm tracking-widest text-white/90 uppercase">Live</span>
          </div>
          <div className="w-px h-4 bg-white/20" />
          <span className="font-display tracking-widest text-xl text-primary drop-shadow-sm">
            {stats?.totalVotes ? stats.totalVotes.toLocaleString() : 0} <span className="text-white/60 text-lg">MATCHES</span>
          </span>
        </div>
      </header>

      {/* Main Arena */}
      <main className="w-full max-w-6xl mx-auto px-6 mt-8 md:mt-16 mb-24 flex flex-col items-center z-20 relative">
        <h2 className="font-display text-5xl md:text-7xl text-white drop-shadow-lg mb-12 uppercase tracking-wide text-center">
          Which thumbnail makes you click?
        </h2>

        {isLoadingPair ? (
          <div className="w-full flex flex-col md:flex-row justify-center items-center gap-8 relative min-h-[400px]">
            <div className="flex-1 w-full max-w-[540px] aspect-video bg-white/5 rounded-2xl border border-white/10 animate-pulse" />
            <div className="flex-1 w-full max-w-[540px] aspect-video bg-white/5 rounded-2xl border border-white/10 animate-pulse" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-20 h-20 rounded-full bg-black/50 border border-white/10 animate-pulse flex items-center justify-center z-10 backdrop-blur-md" />
          </div>
        ) : isErrorPair || !battlePair ? (
          <div className="w-full flex flex-col items-center justify-center p-16 bg-black/40 backdrop-blur-md rounded-3xl border border-white/10 text-center gap-6 shadow-2xl">
            <AlertCircle className="w-16 h-16 text-destructive opacity-80" />
            <p className="font-display text-3xl tracking-widest uppercase">Failed to load the next battle</p>
            <Button onClick={() => refetchPair()} variant="secondary" size="lg" className="gap-3 font-bold tracking-widest uppercase rounded-full">
              <RefreshCw className="w-5 h-5" />
              Reload Arena
            </Button>
          </div>
        ) : (
          <div className="relative w-full flex flex-col md:flex-row justify-center items-stretch gap-8 md:gap-16">
            <FighterCard 
              thumbnail={battlePair.left} 
              side="left" 
              isVoting={votingFor !== null} 
              voteResult={votingFor === battlePair.left.id ? "winner" : votingFor !== null ? "loser" : null}
              onVote={() => handleVote(battlePair.left.id, battlePair.right.id)} 
            />

            <VSBadge />

            <FighterCard 
              thumbnail={battlePair.right} 
              side="right" 
              isVoting={votingFor !== null} 
              voteResult={votingFor === battlePair.right.id ? "winner" : votingFor !== null ? "loser" : null}
              onVote={() => handleVote(battlePair.right.id, battlePair.left.id)} 
            />
          </div>
        )}
      </main>

      <Leaderboard thumbnails={thumbnails} isLoading={isLoadingLeaderboard} />
    </div>
  );
}
