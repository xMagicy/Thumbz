import React from "react";
import { Trophy, Medal, Star } from "lucide-react";
import type { Thumbnail } from "@workspace/api-client-react";
import { motion } from "framer-motion";

interface LeaderboardProps {
  thumbnails: Thumbnail[] | undefined;
  isLoading: boolean;
}

export function Leaderboard({ thumbnails, isLoading }: LeaderboardProps) {
  return (
    <section className="w-full max-w-5xl mx-auto px-6 mt-12 z-20 relative">
      <div className="flex flex-col items-center gap-3 mb-10">
        <h2 className="font-display text-4xl md:text-5xl tracking-wide uppercase text-transparent bg-clip-text bg-gradient-to-r from-white to-white/50">
          Championship Rankings
        </h2>
        <div className="h-1 w-24 bg-electric-gradient rounded-full" />
      </div>

      <div className="bg-black/40 backdrop-blur-md rounded-2xl border border-white/10 overflow-hidden shadow-2xl">
        {isLoading ? (
          <div className="p-6 space-y-4">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="w-full h-24 bg-white/5 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !thumbnails?.length ? (
          <div className="p-16 text-center text-muted-foreground font-display text-2xl tracking-widest uppercase">
            The arena is empty. Start judging.
          </div>
        ) : (
          <div className="flex flex-col divide-y divide-white/5">
            {thumbnails.map((thumb, index) => (
              <motion.div 
                key={thumb.id}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: index * 0.05 }}
                className="group flex flex-col md:flex-row md:items-center gap-4 p-4 md:p-6 hover:bg-white/[0.04] transition-colors relative overflow-hidden"
              >
                {/* Rank Medal */}
                <div className="w-12 shrink-0 flex justify-center">
                  {index === 0 ? (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-yellow-300 to-yellow-600 flex items-center justify-center shadow-[0_0_15px_rgba(253,224,71,0.4)] text-black">
                      <Trophy className="w-5 h-5" />
                    </div>
                  ) : index === 1 ? (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-gray-300 to-gray-500 flex items-center justify-center shadow-[0_0_10px_rgba(209,213,219,0.3)] text-black">
                      <Medal className="w-5 h-5" />
                    </div>
                  ) : index === 2 ? (
                    <div className="w-10 h-10 rounded-full bg-gradient-to-br from-orange-300 to-orange-600 flex items-center justify-center shadow-[0_0_10px_rgba(251,146,60,0.3)] text-black">
                      <Star className="w-5 h-5" />
                    </div>
                  ) : (
                    <div className="font-display text-3xl text-white/30 font-bold">
                      {index + 1}
                    </div>
                  )}
                </div>

                {/* Thumbnail Image */}
                <div className="w-full md:w-40 aspect-video rounded-lg overflow-hidden shrink-0 border-2 border-white/5 group-hover:border-white/20 transition-colors shadow-lg">
                  <img 
                    src={thumb.imageUrl} 
                    alt={thumb.title}
                    className="w-full h-full object-cover"
                  />
                </div>

                {/* Details */}
                <div className="flex-1 min-w-0 pr-4 flex flex-col gap-1">
                  <h4 className="font-display text-xl md:text-2xl tracking-wide uppercase truncate drop-shadow-sm">{thumb.title}</h4>
                  <p className="text-sm text-muted-foreground font-semibold uppercase tracking-wider truncate">{thumb.channelName}</p>
                </div>

                {/* Stats */}
                <div className="flex md:flex-col items-center md:items-end justify-between md:justify-center shrink-0 gap-2 mt-4 md:mt-0 bg-white/5 md:bg-transparent p-3 md:p-0 rounded-lg">
                  <div className="flex flex-col items-start md:items-end">
                    <span className="text-xs text-muted-foreground uppercase font-bold tracking-widest mb-1">Rating</span>
                    <div className="font-display text-2xl md:text-3xl text-transparent bg-clip-text bg-electric-gradient leading-none">
                      {Math.round(thumb.eloRating)} ELO
                    </div>
                  </div>
                  
                  <div className="flex flex-col items-end md:items-end w-24">
                    <span className="text-[10px] text-muted-foreground uppercase font-bold tracking-widest mb-1">Win Rate</span>
                    <div className="w-full bg-black/50 rounded-full h-2 overflow-hidden border border-white/10">
                      <div 
                        className="h-full bg-primary" 
                        style={{ width: `${thumb.winRate || 0}%` }}
                      />
                    </div>
                    <span className="text-xs font-bold mt-1">{Math.round(thumb.winRate || 0)}%</span>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
