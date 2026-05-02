import React, { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";

interface VSBadgeProps {
  /** Bumped by parent to trigger the sword animation from a swipe-start. */
  externalTrigger?: number;
  /** True while a vote is in flight — VS badge fades out so it doesn't sit on top of the cinematic vote anim. */
  isVoting?: boolean;
}

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

export function VSBadge({ externalTrigger = 0, isVoting = false }: VSBadgeProps) {
  const [animating, setAnimating] = useState(false);
  const animatingRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const lastExternalRef = useRef(externalTrigger);

  const triggerAnim = useCallback(() => {
    if (animatingRef.current) return;
    animatingRef.current = true;
    setAnimating(true);
    if (timeoutRef.current !== null) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      animatingRef.current = false;
      setAnimating(false);
      timeoutRef.current = null;
    }, 1000);
  }, []);

  // External (swipe-start) trigger
  useEffect(() => {
    if (externalTrigger !== lastExternalRef.current) {
      lastExternalRef.current = externalTrigger;
      if (externalTrigger > 0) triggerAnim();
    }
  }, [externalTrigger, triggerAnim]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <motion.div
      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-40 pointer-events-none flex items-center justify-center"
      initial={false}
      // Spec: VS stays still in the 0–150ms instant-feedback window, then fades out
      // smoothly during the 150–500ms winner-moment window.
      animate={{ opacity: isVoting ? 0 : 1 }}
      transition={{
        duration: 0.35,
        delay: isVoting ? 0.15 : 0,
        ease: [0.4, 0, 0.2, 1],
      }}
    >
      <div
        className="relative flex items-center justify-center"
        style={{ width: 160, height: 160 }}
      >
        {/* Soft outer purple/pink glow halo */}
        <div
          className="absolute inset-0 rounded-full"
          style={{
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.55) 0%, rgba(139,92,246,0.3) 50%, rgba(0,0,0,0) 80%)",
            filter: "blur(14px)",
          }}
        />

        {/* Sword 1 — swings in from top-left */}
        <motion.div
          className="absolute pointer-events-none"
          style={{ originX: 0.5, originY: 0.5 }}
          initial={false}
          animate={
            animating
              ? {
                  x: [-95, 0, 0, 0],
                  y: [-95, 0, 0, 0],
                  rotate: [-110, 45, 45, 45],
                  opacity: [0, 1, 1, 0],
                }
              : { opacity: 0 }
          }
          transition={
            animating
              ? { duration: 1, times: [0, 0.3, 0.85, 1], ease: "easeOut" }
              : { duration: 0.2 }
          }
        >
          <SwordSVG />
        </motion.div>

        {/* Sword 2 — swings in from top-right */}
        <motion.div
          className="absolute pointer-events-none"
          style={{ originX: 0.5, originY: 0.5 }}
          initial={false}
          animate={
            animating
              ? {
                  x: [95, 0, 0, 0],
                  y: [-95, 0, 0, 0],
                  rotate: [110, -45, -45, -45],
                  opacity: [0, 1, 1, 0],
                }
              : { opacity: 0 }
          }
          transition={
            animating
              ? { duration: 1, times: [0, 0.3, 0.85, 1], ease: "easeOut" }
              : { duration: 0.2 }
          }
        >
          <SwordSVG />
        </motion.div>

        {/* Clash flash burst — bright at the moment swords meet */}
        <motion.div
          className="absolute rounded-full pointer-events-none"
          style={{
            width: 110,
            height: 110,
            background:
              "radial-gradient(circle, rgba(255,255,255,0.95) 0%, rgba(217,70,239,0.55) 35%, rgba(139,92,246,0.3) 60%, transparent 75%)",
          }}
          initial={false}
          animate={
            animating
              ? { opacity: [0, 0, 0.9, 0, 0], scale: [0.8, 0.9, 1.5, 1.7, 1.7] }
              : { opacity: 0, scale: 1 }
          }
          transition={
            animating
              ? { duration: 1, times: [0, 0.25, 0.32, 0.55, 1], ease: "easeOut" }
              : { duration: 0.2 }
          }
        />

        {/* Solid gradient circle, 80px, with subtle pulse — visual only (no pointer events) */}
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
          {/* VS text — fades out while swords clash, fades back in when they're gone */}
          <motion.span
            initial={false}
            animate={{ opacity: animating ? 0 : 1 }}
            transition={{ duration: 0.2 }}
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
          </motion.span>
        </motion.div>

        {/* Dedicated hover/click target — transparent button sits on top, slightly larger
            than the visible circle for a forgiving hover area. Also lets touch users tap
            to see the animation. */}
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
          onMouseEnter={triggerAnim}
          onPointerEnter={triggerAnim}
          onFocus={triggerAnim}
          onClick={triggerAnim}
        />
      </div>
    </motion.div>
  );
}
