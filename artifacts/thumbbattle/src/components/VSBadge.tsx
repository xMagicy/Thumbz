import React from "react";
import { motion } from "framer-motion";

export function VSBadge() {
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none flex items-center justify-center">
      <motion.div
        className="vs-badge-pulse relative flex items-center justify-center"
        style={{ width: 110, height: 110 }}
        initial={{ scale: 0.7, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.5, delay: 0.15, ease: "easeOut" }}
      >
        {/* Soft purple halo */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.45) 0%, rgba(139,92,246,0.25) 45%, rgba(0,0,0,0) 75%)",
            filter: "blur(8px)",
          }}
        />

        {/* Crossed swords SVG */}
        <svg
          viewBox="0 0 120 120"
          width="100"
          height="100"
          className="relative drop-shadow-[0_6px_14px_rgba(0,0,0,0.55)]"
          fill="none"
        >
          <defs>
            <linearGradient id="swordGrad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#8b5cf6" />
              <stop offset="100%" stopColor="#d946ef" />
            </linearGradient>
            <linearGradient id="swordHilt" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#1a1a2a" />
              <stop offset="100%" stopColor="#3a2a4a" />
            </linearGradient>
          </defs>

          {/* Sword 1 — top-left to bottom-right */}
          <g transform="rotate(45 60 60)">
            {/* Blade */}
            <polygon points="60,6 67,58 60,66 53,58" fill="url(#swordGrad)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
            {/* Blade highlight */}
            <polygon points="60,8 62,58 60,62" fill="rgba(255,255,255,0.35)" />
            {/* Crossguard */}
            <rect x="44" y="62" width="32" height="6" rx="1.5" fill="url(#swordHilt)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.6" />
            {/* Grip */}
            <rect x="56" y="68" width="8" height="16" fill="#2a1a3a" stroke="rgba(255,255,255,0.2)" strokeWidth="0.6" />
            {/* Pommel */}
            <circle cx="60" cy="86" r="4" fill="url(#swordGrad)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.6" />
          </g>

          {/* Sword 2 — top-right to bottom-left */}
          <g transform="rotate(-45 60 60)">
            <polygon points="60,6 67,58 60,66 53,58" fill="url(#swordGrad)" stroke="rgba(255,255,255,0.4)" strokeWidth="0.8" />
            <polygon points="60,8 62,58 60,62" fill="rgba(255,255,255,0.35)" />
            <rect x="44" y="62" width="32" height="6" rx="1.5" fill="url(#swordHilt)" stroke="rgba(255,255,255,0.25)" strokeWidth="0.6" />
            <rect x="56" y="68" width="8" height="16" fill="#2a1a3a" stroke="rgba(255,255,255,0.2)" strokeWidth="0.6" />
            <circle cx="60" cy="86" r="4" fill="url(#swordGrad)" stroke="rgba(255,255,255,0.3)" strokeWidth="0.6" />
          </g>

          {/* Center medallion */}
          <circle
            cx="60"
            cy="60"
            r="20"
            fill="#0a0a14"
            stroke="url(#swordGrad)"
            strokeWidth="3"
          />
          <text
            x="60"
            y="60"
            textAnchor="middle"
            dominantBaseline="central"
            fill="#ffffff"
            style={{
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 900,
              fontSize: 16,
              letterSpacing: "-0.03em",
            }}
          >
            VS
          </text>
        </svg>
      </motion.div>
    </div>
  );
}
