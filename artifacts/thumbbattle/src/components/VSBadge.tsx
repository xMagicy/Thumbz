import React from "react";
import { motion } from "framer-motion";

export function VSBadge() {
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none flex items-center justify-center">
      <div className="relative flex items-center justify-center" style={{ width: 140, height: 140 }}>
        {/* Soft outer purple/pink glow halo */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.55) 0%, rgba(139,92,246,0.3) 50%, rgba(0,0,0,0) 80%)",
            filter: "blur(14px)",
          }}
        />

        {/* Solid gradient circle, 80px, with subtle pulse */}
        <motion.div
          className="absolute rounded-full flex items-center justify-center"
          style={{
            width: 80,
            height: 80,
            background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
            boxShadow:
              "inset 0 2px 6px rgba(255,255,255,0.28), inset 0 -3px 8px rgba(0,0,0,0.25), 0 0 28px rgba(217,70,239,0.5), 0 8px 22px rgba(0,0,0,0.55)",
            border: "2px solid rgba(255,255,255,0.22)",
          }}
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          <span
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 900,
              fontSize: 28,
              color: "#ffffff",
              letterSpacing: "-0.04em",
              textShadow: "0 2px 6px rgba(0,0,0,0.45)",
              lineHeight: 1,
            }}
          >
            VS
          </span>
        </motion.div>
      </div>
    </div>
  );
}
