import React from "react";
import { motion } from "framer-motion";

export function VSBadge() {
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 pointer-events-none flex items-center justify-center">
      <motion.div
        className="vs-badge-pulse vs-badge-halo flex items-center justify-center rounded-full"
        style={{
          width: 80,
          height: 80,
          background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
        }}
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, delay: 0.15 }}
      >
        <span
          style={{
            fontFamily: "'Inter', system-ui, sans-serif",
            fontWeight: 900,
            fontSize: 28,
            color: "#ffffff",
            letterSpacing: "-0.02em",
            lineHeight: 1,
          }}
        >
          VS
        </span>
      </motion.div>
    </div>
  );
}
