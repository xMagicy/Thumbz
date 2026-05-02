import React, { useState } from "react";
import { motion } from "framer-motion";

interface VSBadgeProps {
  /** True while a vote is in flight — VS badge fades out so it doesn't sit on top of the
   * cinematic vote anim, then fades back in once the new pair has settled. */
  isVoting?: boolean;
}

const EASE_STANDARD = [0.4, 0, 0.2, 1] as const;

function SwordSVG({ size = 78 }: { size?: number }) {
  // White swords with a subtle dark-purple outline (#6b21a8) for definition against
  // the gradient circle. All elements share the same stroke for visual cohesion.
  const fill = "#ffffff";
  const stroke = "#6b21a8";
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} fill="none" className="block">
      {/* Blade — slim & metallic */}
      <polygon
        points="50,4 53,56 50,62 47,56"
        fill={fill}
        stroke={stroke}
        strokeWidth="1"
        strokeLinejoin="round"
      />
      {/* Crossguard */}
      <rect
        x="38"
        y="60"
        width="24"
        height="4.5"
        rx="1"
        fill={fill}
        stroke={stroke}
        strokeWidth="1"
      />
      {/* Grip */}
      <rect x="47" y="64.5" width="6" height="14" fill={fill} stroke={stroke} strokeWidth="1" />
      {/* Pommel */}
      <circle cx="50" cy="80" r="3" fill={fill} stroke={stroke} strokeWidth="1" />
    </svg>
  );
}

export function VSBadge({ isVoting = false }: VSBadgeProps) {
  const [hovered, setHovered] = useState(false);
  // Show swords ONLY while hovered and not in the middle of a vote transition.
  const showSwords = hovered && !isVoting;

  return (
    <motion.div
      // z-20 so cards (z-10 at rest) sit BELOW the badge by default, but cards bump
      // their z-index to 30 while dragging or voting so they slide over the badge.
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-20 flex items-center justify-center"
      initial={false}
      // 200ms fade-out when a vote starts; on the new pair the parent AnimatePresence
      // container handles the fade-in (no inner re-animation needed).
      animate={{ opacity: isVoting ? 0 : 1 }}
      transition={{ duration: 0.2, ease: EASE_STANDARD }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: 160, height: 160 }}
      >
        {/* Soft outer purple/pink halo — always visible, soft pulse */}
        <div
          className="absolute inset-0 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.55) 0%, rgba(139,92,246,0.3) 50%, rgba(0,0,0,0) 80%)",
            filter: "blur(14px)",
          }}
        />

        {/* Crossed swords — only visible while hovered. Static rotations form an X
            behind the gradient circle. Smooth 300ms fade in/out via opacity only. */}
        <motion.div
          className="absolute pointer-events-none"
          style={{ rotate: 45 }}
          initial={false}
          animate={{ opacity: showSwords ? 1 : 0 }}
          transition={{ duration: 0.3, ease: EASE_STANDARD }}
        >
          <SwordSVG />
        </motion.div>
        <motion.div
          className="absolute pointer-events-none"
          style={{ rotate: -45 }}
          initial={false}
          animate={{ opacity: showSwords ? 1 : 0 }}
          transition={{ duration: 0.3, ease: EASE_STANDARD }}
        >
          <SwordSVG />
        </motion.div>

        {/* Solid gradient circle, 80px, with subtle pulse — visual only (no pointer
            events). VS text is layered ON TOP of the swords because the circle paints
            after the sword motion.divs in DOM order. */}
        <motion.div
          className="absolute rounded-full flex items-center justify-center pointer-events-none"
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
          {/* VS text — always visible. Stays on top of the swords. */}
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

        {/* Dedicated hover/click target — transparent button sits on top, slightly larger
            than the visible circle for a forgiving hover area. Drives the sword fade. */}
        <button
          type="button"
          aria-label="VS"
          className="absolute rounded-full pointer-events-auto"
          style={{
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
