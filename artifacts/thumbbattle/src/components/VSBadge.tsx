import React, { useState } from "react";
import { motion } from "framer-motion";

interface VSBadgeProps {
  /** True while a vote is in flight — VS badge fades out so it doesn't sit on top of the
   * cinematic vote anim, then fades back in once the new pair has settled. */
  isVoting?: boolean;
}

const EASE_STANDARD = [0.4, 0, 0.2, 1] as const;

function SwordSVG({ size = 56 }: { size?: number }) {
  // White swords drawn so the blade tip + pommel are EQUIDISTANT from the SVG
  // center (y=50). Old version had tip at y=4 and pommel at y=80, which made
  // the visual center sit at y≈42 — that's why crossed copies looked offset.
  const fill = "#ffffff";
  const stroke = "rgba(91,33,182,0.85)";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none" className="block">
      {/* Blade — tip at y=12, base at y=58 (so the visual midpoint of the
          whole sword sits at y=50 once the grip + pommel are added below). */}
      <polygon
        points="50,12 53,58 50,64 47,58"
        fill={fill}
        stroke={stroke}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Crossguard */}
      <rect
        x="40"
        y="62"
        width="20"
        height="4"
        rx="1"
        fill={fill}
        stroke={stroke}
        strokeWidth="1"
      />
      {/* Grip */}
      <rect x="47.5" y="66" width="5" height="16" fill={fill} stroke={stroke} strokeWidth="1" />
      {/* Pommel — center at y=85 so blade-tip→pommel-edge spans y=12..88,
          midpoint y=50 ✓ */}
      <circle cx="50" cy="85" r="3" fill={fill} stroke={stroke} strokeWidth="1" />
    </svg>
  );
}

export function VSBadge({ isVoting = false }: VSBadgeProps) {
  const [hovered, setHovered] = useState(false);
  // Swords appear ONLY while hovered AND not in the middle of a vote transition.
  const showSwords = hovered && !isVoting;

  return (
    <motion.div
      // z-20 so cards (z-10 at rest) sit BELOW the badge by default, but cards bump
      // their z-index to 30 while dragging or voting so they slide over the badge.
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center"
      // Mount with opacity 0 so the badge fades IN explicitly (400ms) when a fresh pair
      // arrives — landing slightly after the cards settle (which fade in over 300ms via
      // the parent AnimatePresence container), exactly matching the spec.
      initial={{ opacity: 0 }}
      // 200ms fade-out when a vote starts, 400ms fade-in when the badge re-enters.
      animate={{ opacity: isVoting ? 0 : 1 }}
      transition={{ duration: isVoting ? 0.2 : 0.4, ease: EASE_STANDARD }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: 160, height: 160 }}
      >
        {/* Layer 1 — soft outer purple/pink halo (always on, soft pulse via blur) */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            zIndex: 1,
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.55) 0%, rgba(139,92,246,0.3) 50%, rgba(0,0,0,0) 80%)",
            filter: "blur(14px)",
          }}
        />

        {/* Layer 2 — gradient ball (80px). Now uses overflow:hidden so the
            hover sword animation is CLIPPED inside the ball and never spills
            out past the rim. */}
        <motion.div
          className="absolute rounded-full flex items-center justify-center pointer-events-none overflow-hidden"
          style={{
            zIndex: 3,
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
          {/* Crossed swords — clipped inside the ball. They live BEHIND the
              VS text and slowly rotate while hovered for a subtle "alive"
              feel. Sized small enough that nothing pokes past the rim. */}
          <motion.div
            className="absolute inset-0 flex items-center justify-center"
            style={{ zIndex: 1 }}
            initial={false}
            animate={{
              opacity: showSwords ? 0.42 : 0,
              rotate: showSwords ? 8 : 0,
            }}
            transition={{ duration: 0.45, ease: EASE_STANDARD }}
          >
            <div className="absolute" style={{ transform: "rotate(45deg)" }}>
              <SwordSVG />
            </div>
            <div className="absolute" style={{ transform: "rotate(-45deg)" }}>
              <SwordSVG />
            </div>
          </motion.div>

          {/* Subtle radial sheen that drifts across the ball on hover —
              the "background animation" the user asked for, kept inside
              the clipped ball so it never bleeds out. */}
          <motion.div
            className="absolute inset-0 pointer-events-none"
            style={{
              zIndex: 2,
              background:
                "radial-gradient(circle at 30% 30%, rgba(255,255,255,0.22), rgba(255,255,255,0) 55%)",
              mixBlendMode: "screen",
            }}
            initial={false}
            animate={{
              opacity: showSwords ? 1 : 0,
              backgroundPosition: showSwords
                ? ["0% 0%", "100% 100%", "0% 0%"]
                : "0% 0%",
            }}
            transition={{
              opacity: { duration: 0.4, ease: EASE_STANDARD },
              backgroundPosition: showSwords
                ? { duration: 4, repeat: Infinity, ease: "easeInOut" }
                : { duration: 0 },
            }}
          />

          {/* VS text — ALWAYS readable, on top of swords + sheen. */}
          <span
            style={{
              position: "relative",
              zIndex: 3,
              fontFamily: "'Inter', system-ui, sans-serif",
              fontWeight: 900,
              fontSize: 28,
              color: "#ffffff",
              letterSpacing: "-0.04em",
              textShadow: "0 2px 6px rgba(0,0,0,0.55), 0 0 8px rgba(0,0,0,0.35)",
              lineHeight: 1,
            }}
          >
            VS
          </span>
        </motion.div>

        {/* Hover/click target — transparent button slightly larger than the visible
            circle for a forgiving hover area. Drives the sword fade. Sits above
            everything so it always receives the hover events. */}
        <button
          type="button"
          aria-label="VS"
          className="absolute rounded-full pointer-events-auto"
          style={{
            zIndex: 5,
            width: 96,
            height: 96,
            background: "transparent",
            border: "none",
            padding: 0,
            cursor: "pointer",
          }}
          onMouseEnter={() => setHovered(true)}
          onMouseLeave={() => setHovered(false)}
          onPointerEnter={() => setHovered(true)}
          onPointerLeave={() => setHovered(false)}
          onFocus={() => setHovered(true)}
          onBlur={() => setHovered(false)}
        />
      </div>
    </motion.div>
  );
}
