import React from "react";
import { motion } from "framer-motion";

export function VSBadge() {
  return (
    <div className="absolute top-[40%] md:top-[45%] left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none flex items-center justify-center">
      <motion.div 
        className="w-20 h-20 md:w-28 md:h-28 rounded-full bg-background flex items-center justify-center p-2 shadow-2xl border-4 border-white/10 pulse-glow"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.2 }}
      >
        <div className="w-full h-full rounded-full bg-electric-gradient flex items-center justify-center border-2 border-black/50 shadow-inner">
          <span className="font-display text-4xl md:text-5xl italic tracking-tighter text-white drop-shadow-[0_2px_4px_rgba(0,0,0,0.5)]">
            VS
          </span>
        </div>
      </motion.div>
    </div>
  );
}
