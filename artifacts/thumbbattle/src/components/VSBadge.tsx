import React from "react";
import { motion } from "framer-motion";

export function VSBadge() {
  return (
    <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none flex items-center justify-center">
      <div className="relative" style={{ width: 180, height: 180 }}>
        {/* Soft outer purple/pink halo */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.55) 0%, rgba(139,92,246,0.32) 50%, rgba(0,0,0,0) 80%)",
            filter: "blur(16px)",
          }}
        />

        {/* Pulsing wrapper — affects medallion + swords + VS together */}
        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ scale: [1, 1.05, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
        >
          {/* Solid gradient medallion (90px circle) */}
          <div
            className="absolute rounded-full"
            style={{
              width: 90,
              height: 90,
              background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
              boxShadow:
                "inset 0 2px 6px rgba(255,255,255,0.28), inset 0 -3px 8px rgba(0,0,0,0.25), 0 0 32px rgba(217,70,239,0.55), 0 8px 24px rgba(0,0,0,0.55)",
              border: "2px solid rgba(255,255,255,0.22)",
            }}
          />

          {/* Slow-rotating crossed swords (one full rotation every 30s) — sit on top of medallion, tips poke out */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            animate={{ rotate: 360 }}
            transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
          >
            <svg
              viewBox="0 0 200 200"
              width="180"
              height="180"
              fill="none"
              className="drop-shadow-[0_4px_8px_rgba(0,0,0,0.4)]"
            >
              <defs>
                <linearGradient id="swordDarkGrad" x1="0%" y1="0%" x2="100%" y2="100%">
                  <stop offset="0%" stopColor="#5b21b6" />
                  <stop offset="100%" stopColor="#4c1d95" />
                </linearGradient>
              </defs>

              {/* Sword 1 — vertical, then rotated 45° */}
              <g transform="rotate(45 100 100)">
                {/* Blade */}
                <polygon
                  points="100,18 109,108 100,116 91,108"
                  fill="url(#swordDarkGrad)"
                  stroke="#3b0764"
                  strokeWidth="1"
                />
                {/* Crossguard */}
                <rect
                  x="78"
                  y="116"
                  width="44"
                  height="8"
                  rx="2"
                  fill="#3b0764"
                  stroke="#1e1b4b"
                  strokeWidth="0.6"
                />
                {/* Grip */}
                <rect x="95" y="124" width="10" height="22" fill="#1e1b4b" />
                {/* Pommel */}
                <circle
                  cx="100"
                  cy="150"
                  r="5.5"
                  fill="url(#swordDarkGrad)"
                  stroke="#3b0764"
                  strokeWidth="0.8"
                />
              </g>

              {/* Sword 2 — vertical, then rotated -45° */}
              <g transform="rotate(-45 100 100)">
                <polygon
                  points="100,18 109,108 100,116 91,108"
                  fill="url(#swordDarkGrad)"
                  stroke="#3b0764"
                  strokeWidth="1"
                />
                <rect
                  x="78"
                  y="116"
                  width="44"
                  height="8"
                  rx="2"
                  fill="#3b0764"
                  stroke="#1e1b4b"
                  strokeWidth="0.6"
                />
                <rect x="95" y="124" width="10" height="22" fill="#1e1b4b" />
                <circle
                  cx="100"
                  cy="150"
                  r="5.5"
                  fill="url(#swordDarkGrad)"
                  stroke="#3b0764"
                  strokeWidth="0.8"
                />
              </g>
            </svg>
          </motion.div>

          {/* VS text — front layer, centered on top of swords + medallion */}
          <div
            className="absolute flex items-center justify-center"
            style={{
              width: 90,
              height: 90,
            }}
          >
            <span
              style={{
                fontFamily: "'Inter', system-ui, sans-serif",
                fontWeight: 900,
                fontSize: 32,
                color: "#ffffff",
                letterSpacing: "-0.04em",
                textShadow: "0 2px 6px rgba(0,0,0,0.45)",
                lineHeight: 1,
              }}
            >
              VS
            </span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
