import { motion } from "framer-motion";

const inter = "'Inter', system-ui, sans-serif";

export const NICHES = [
  "All",
  "Gaming",
  "Tutorial",
  "Finance",
  "Music",
  "Lifestyle",
  "Tech",
  "Vlog",
  "Other",
] as const;

export type Niche = (typeof NICHES)[number];

interface NicheFilterBarProps {
  value: Niche;
  onChange: (n: Niche) => void;
}

export function NicheFilterBar({ value, onChange }: NicheFilterBarProps) {
  return (
    <div className="w-full overflow-x-auto no-scrollbar">
      <div className="flex gap-2 justify-center min-w-max px-2">
        {NICHES.map((n) => {
          const active = n === value;
          return (
            <motion.button
              key={n}
              type="button"
              whileTap={{ scale: 0.96 }}
              onClick={() => onChange(n)}
              className="px-3.5 py-1.5 rounded-full transition-all whitespace-nowrap"
              style={{
                fontFamily: inter,
                fontWeight: active ? 600 : 500,
                fontSize: "0.78rem",
                letterSpacing: "0.01em",
                color: active ? "#fff" : "rgba(255,255,255,0.65)",
                background: active
                  ? "linear-gradient(135deg, #8b5cf6, #d946ef)"
                  : "rgba(255,255,255,0.04)",
                border: active
                  ? "1px solid rgba(255,255,255,0.18)"
                  : "1px solid rgba(255,255,255,0.08)",
                boxShadow: active ? "0 6px 18px rgba(217,70,239,0.35)" : "none",
              }}
            >
              {n}
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}
