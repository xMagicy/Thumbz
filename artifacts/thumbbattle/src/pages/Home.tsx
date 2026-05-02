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
import { Loader2, Swords, Trophy, TrendingUp, AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

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
        setVotingFor(null);
      },
      onError: () => {
        setVotingFor(null);
      }
    }
  });

  const handleVote = (winnerId: number, loserId: number) => {
    if (votingFor !== null) return;
    setVotingFor(winnerId);
    castVote.mutate({
      data: { winnerId, loserId }
    });
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col items-center pb-24 selection:bg-primary/30">
      {/* Header */}
      <header className="w-full max-w-5xl mx-auto px-6 py-8 flex flex-col md:flex-row items-center justify-between gap-4 border-b border-white/5">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-electric-gradient flex items-center justify-center shadow-[0_0_20px_rgba(192,38,211,0.3)]">
            <Swords className="w-5 h-5 text-white" />
          </div>
          <h1 className="text-3xl font-black tracking-tight text-electric-gradient uppercase">
            ThumbBattle
          </h1>
        </div>
        <div className="flex items-center gap-2 bg-white/5 px-4 py-2 rounded-full border border-white/10">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="font-medium text-sm">
            {stats?.totalVotes ? stats.totalVotes.toLocaleString() : 0} Battles Judged
          </span>
        </div>
      </header>

      {/* Main Arena */}
      <main className="w-full max-w-5xl mx-auto px-6 mt-12 mb-20 flex flex-col items-center">
        <h2 className="text-xl font-medium text-muted-foreground mb-8 uppercase tracking-widest text-center">
          Which thumbnail makes you click?
        </h2>

        {isLoadingPair ? (
          <div className="w-full flex flex-col md:flex-row justify-center items-center gap-8 relative h-[400px]">
            <div className="w-full max-w-[480px] aspect-video bg-white/5 rounded-2xl animate-pulse" />
            <div className="w-full max-w-[480px] aspect-video bg-white/5 rounded-2xl animate-pulse" />
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full bg-background border border-white/10 animate-pulse flex items-center justify-center z-10" />
          </div>
        ) : isErrorPair || !battlePair ? (
          <div className="w-full flex flex-col items-center justify-center p-12 bg-white/5 rounded-3xl border border-white/10 text-center gap-4">
            <AlertCircle className="w-12 h-12 text-destructive opacity-80" />
            <p className="text-lg font-medium">Failed to load the next battle</p>
            <Button onClick={() => refetchPair()} variant="secondary" className="gap-2">
              <RefreshCw className="w-4 h-4" />
              Reload Arena
            </Button>
          </div>
        ) : (
          <div className="relative w-full flex flex-col md:flex-row justify-center items-stretch gap-6 md:gap-12">
            {/* Left Card */}
            <div 
              className={`group flex-1 max-w-[480px] w-full flex flex-col gap-4 cursor-pointer transition-all duration-500 ease-out hover:-translate-y-2
                ${votingFor === battlePair.left.id ? 'scale-105 opacity-100 z-20' : votingFor !== null ? 'scale-95 opacity-40 grayscale blur-[2px]' : 'opacity-100'}`}
              onClick={() => handleVote(battlePair.left.id, battlePair.right.id)}
            >
              <div className="relative aspect-video rounded-3xl overflow-hidden border-2 border-white/10 shadow-2xl transition-all duration-300 group-hover:border-primary/50 group-hover:shadow-[0_0_30px_rgba(192,38,211,0.2)]">
                <img 
                  src={battlePair.left.imageUrl} 
                  alt={battlePair.left.title} 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
              </div>
              <div className="flex flex-col gap-1 px-2">
                <h3 className="font-bold text-lg leading-tight line-clamp-2 group-hover:text-primary transition-colors">
                  {battlePair.left.title}
                </h3>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground font-medium">{battlePair.left.channelName}</span>
                  <div className="px-3 py-1 rounded-full bg-primary/10 text-primary border border-primary/20 text-xs font-bold">
                    {battlePair.left.winRate !== null && battlePair.left.winRate !== undefined 
                      ? `${Math.round(battlePair.left.winRate)}% WR` 
                      : 'New'}
                  </div>
                </div>
              </div>
            </div>

            {/* VS Badge */}
            <div className="absolute top-[40%] md:top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none md:flex hidden">
              <div className="w-16 h-16 rounded-full bg-background flex items-center justify-center p-1.5 shadow-2xl border border-white/10">
                <div className="w-full h-full rounded-full bg-electric-gradient flex items-center justify-center font-black text-xl italic tracking-tighter">
                  VS
                </div>
              </div>
            </div>
            
            <div className="md:hidden flex items-center justify-center py-2 z-30 pointer-events-none">
              <div className="w-12 h-12 rounded-full bg-background flex items-center justify-center p-1 shadow-2xl border border-white/10">
                <div className="w-full h-full rounded-full bg-electric-gradient flex items-center justify-center font-black text-sm italic tracking-tighter">
                  VS
                </div>
              </div>
            </div>

            {/* Right Card */}
            <div 
              className={`group flex-1 max-w-[480px] w-full flex flex-col gap-4 cursor-pointer transition-all duration-500 ease-out hover:-translate-y-2
                ${votingFor === battlePair.right.id ? 'scale-105 opacity-100 z-20' : votingFor !== null ? 'scale-95 opacity-40 grayscale blur-[2px]' : 'opacity-100'}`}
              onClick={() => handleVote(battlePair.right.id, battlePair.left.id)}
            >
              <div className="relative aspect-video rounded-3xl overflow-hidden border-2 border-white/10 shadow-2xl transition-all duration-300 group-hover:border-accent/50 group-hover:shadow-[0_0_30px_rgba(217,70,239,0.2)]">
                <img 
                  src={battlePair.right.imageUrl} 
                  alt={battlePair.right.title} 
                  className="w-full h-full object-cover"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent opacity-60 group-hover:opacity-40 transition-opacity" />
              </div>
              <div className="flex flex-col gap-1 px-2">
                <h3 className="font-bold text-lg leading-tight line-clamp-2 group-hover:text-accent transition-colors">
                  {battlePair.right.title}
                </h3>
                <div className="flex items-center justify-between mt-2">
                  <span className="text-sm text-muted-foreground font-medium">{battlePair.right.channelName}</span>
                  <div className="px-3 py-1 rounded-full bg-accent/10 text-accent border border-accent/20 text-xs font-bold">
                    {battlePair.right.winRate !== null && battlePair.right.winRate !== undefined 
                      ? `${Math.round(battlePair.right.winRate)}% WR` 
                      : 'New'}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Leaderboard */}
      <section className="w-full max-w-5xl mx-auto px-6">
        <div className="flex items-center gap-3 mb-8">
          <Trophy className="w-6 h-6 text-primary" />
          <h2 className="text-2xl font-bold tracking-tight">Global Rankings</h2>
        </div>

        <div className="bg-card rounded-3xl border border-white/5 overflow-hidden">
          {isLoadingLeaderboard ? (
            <div className="p-6 space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className="w-full h-20 bg-white/5 rounded-xl animate-pulse" />
              ))}
            </div>
          ) : !thumbnails?.length ? (
            <div className="p-12 text-center text-muted-foreground">
              No thumbnails ranked yet. Be the first to vote!
            </div>
          ) : (
            <div className="flex flex-col divide-y divide-white/5">
              {thumbnails.map((thumb, index) => (
                <div 
                  key={thumb.id}
                  className="flex items-center gap-4 p-4 hover:bg-white/[0.02] transition-colors"
                >
                  <div className="w-8 text-center font-bold text-lg text-muted-foreground">
                    {index + 1}
                  </div>
                  <div className="w-24 md:w-32 aspect-video rounded-lg overflow-hidden shrink-0 border border-white/10">
                    <img 
                      src={thumb.imageUrl} 
                      alt={thumb.title}
                      className="w-full h-full object-cover"
                    />
                  </div>
                  <div className="flex-1 min-w-0 pr-4">
                    <h4 className="font-semibold text-sm md:text-base truncate">{thumb.title}</h4>
                    <p className="text-xs text-muted-foreground truncate">{thumb.channelName}</p>
                  </div>
                  <div className="flex flex-col items-end shrink-0 gap-1">
                    <div className="text-sm font-bold text-primary">
                      {Math.round(thumb.eloRating)} ELO
                    </div>
                    <div className="text-xs font-medium text-muted-foreground">
                      {thumb.winRate !== null && thumb.winRate !== undefined ? `${Math.round(thumb.winRate)}% Win Rate` : '-'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
