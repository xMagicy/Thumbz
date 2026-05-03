import { useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";

const inter = "'Inter', system-ui, sans-serif";

const POINT_COUNT = 10;

export interface EloTrendPoint {
  index: number;
  rating: number;
}

/**
 * Deterministic placeholder Elo trend used by both the inline sparkline and
 * the larger modal chart. Pure visual filler — never reads from the DB. The
 * trend always lands on the thumbnail's current Elo so the last point matches
 * the row's displayed rating.
 */
export function useEloTrendData(seed: number, currentElo: number): EloTrendPoint[] {
  return useMemo(() => {
    const pts: EloTrendPoint[] = [];
    let v = currentElo - 28;
    let s = (seed * 9301 + 49297) % 233280;
    for (let i = 0; i < POINT_COUNT - 1; i++) {
      s = (s * 9301 + 49297) % 233280;
      const r = s / 233280 - 0.5;
      v += r * 18;
      pts.push({ index: i + 1, rating: Math.round(v) });
    }
    pts.push({ index: POINT_COUNT, rating: currentElo });
    return pts;
  }, [seed, currentElo]);
}

function trendColors(points: EloTrendPoint[]) {
  const trendUp = points[points.length - 1].rating >= points[0].rating;
  return {
    trendUp,
    stroke: trendUp ? "#86efac" : "#fca5a5",
    fill: trendUp ? "rgba(34,197,94,0.18)" : "rgba(239,68,68,0.18)",
    fillSolid: trendUp ? "#22c55e" : "#ef4444",
  };
}

/**
 * Compact inline SVG sparkline shown in leaderboard rows. Adds a hover
 * tooltip showing the rating value at the hovered point. Mouse events bubble
 * up normally so the surrounding row's click-to-open behavior still fires
 * when the user clicks the sparkline area.
 */
export function EloSparkline({
  seed,
  currentElo,
}: {
  seed: number;
  currentElo: number;
}) {
  const points = useEloTrendData(seed, currentElo);
  const { trendUp, stroke, fill } = trendColors(points);

  const ratings = points.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = max - min || 1;
  const W = 64;
  const H = 22;

  const coords = points.map((p, i) => ({
    x: (i / (points.length - 1)) * W,
    y: H - ((p.rating - min) / range) * (H - 2) - 1,
    rating: p.rating,
    index: i,
  }));

  const path = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${path} L${W},${H} L0,${H} Z`;

  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const handleMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const idx = Math.round(ratio * (coords.length - 1));
    const clamped = Math.max(0, Math.min(coords.length - 1, idx));
    setHoverIdx(clamped);
  };

  const hovered = hoverIdx !== null ? coords[hoverIdx] : null;

  return (
    <span
      className="relative inline-block"
      style={{ lineHeight: 0 }}
      onMouseLeave={() => setHoverIdx(null)}
    >
      <svg
        ref={svgRef}
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="shrink-0 cursor-crosshair"
        role="img"
        aria-label={`ELO trend: ${trendUp ? "up" : "down"}`}
        onMouseMove={handleMove}
      >
        <path d={areaPath} fill={fill} />
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {hovered && (
          <>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={0}
              y2={H}
              stroke={stroke}
              strokeOpacity={0.5}
              strokeWidth={1}
            />
            <circle
              cx={hovered.x}
              cy={hovered.y}
              r={2.2}
              fill={stroke}
              stroke="#0c0c16"
              strokeWidth={1}
            />
          </>
        )}
      </svg>
      {hovered && (
        <span
          className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5"
          style={{
            left: `${(hovered.x / W) * 100}%`,
            bottom: "calc(100% + 4px)",
            fontFamily: inter,
            fontWeight: 600,
            fontSize: "0.62rem",
            color: "#fff",
            background: "rgba(12,12,22,0.95)",
            border: "1px solid rgba(168,85,247,0.45)",
            boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
          }}
        >
          {hovered.rating}
        </span>
      )}
    </span>
  );
}

const chartConfig = {
  rating: {
    label: "Rating",
  },
} satisfies ChartConfig;

/**
 * Larger interactive Recharts version used in the detail modal. Uses the same
 * deterministic seeded data as the inline sparkline so the trend visually
 * matches between the row and the modal.
 */
export function EloTrendChart({
  seed,
  currentElo,
  height = 160,
}: {
  seed: number;
  currentElo: number;
  height?: number;
}) {
  const data = useEloTrendData(seed, currentElo);
  const { stroke, fillSolid } = trendColors(data);
  const gradientId = `elo-grad-${seed}`;

  const ratings = data.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const pad = Math.max(6, Math.round((max - min) * 0.18));

  return (
    <div
      className="rounded-xl"
      style={{
        background: "rgba(255,255,255,0.04)",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 12px 8px",
      }}
    >
      <div
        className="flex items-center justify-between mb-2 px-1"
        style={{ fontFamily: inter }}
      >
        <span
          className="uppercase"
          style={{
            fontWeight: 500,
            fontSize: "0.62rem",
            letterSpacing: "0.12em",
            color: "rgba(255,255,255,0.5)",
          }}
        >
          Rating trend
        </span>
        <span
          style={{
            fontWeight: 500,
            fontSize: "0.65rem",
            color: "rgba(255,255,255,0.4)",
          }}
        >
          Last {POINT_COUNT} battles
        </span>
      </div>
      <ChartContainer
        config={chartConfig}
        className="aspect-auto w-full"
        style={{ height }}
      >
        <AreaChart
          data={data}
          margin={{ top: 6, right: 8, left: 0, bottom: 0 }}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillSolid} stopOpacity={0.45} />
              <stop offset="100%" stopColor={fillSolid} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid
            stroke="rgba(255,255,255,0.06)"
            strokeDasharray="3 3"
            vertical={false}
          />
          <XAxis
            dataKey="index"
            tick={{
              fill: "rgba(255,255,255,0.35)",
              fontSize: 10,
              fontFamily: inter,
            }}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            tickLine={false}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{
              fill: "rgba(255,255,255,0.35)",
              fontSize: 10,
              fontFamily: inter,
            }}
            axisLine={{ stroke: "rgba(255,255,255,0.08)" }}
            tickLine={false}
            width={36}
          />
          <ChartTooltip
            cursor={{
              stroke: "rgba(217,70,239,0.45)",
              strokeWidth: 1,
              strokeDasharray: "3 3",
            }}
            content={
              <ChartTooltipContent
                indicator="dot"
                labelFormatter={(label) =>
                  `Battle ${label} of ${POINT_COUNT}`
                }
              />
            }
          />
          <Area
            type="monotone"
            dataKey="rating"
            stroke={stroke}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            activeDot={{
              r: 4,
              fill: stroke,
              stroke: "#0c0c16",
              strokeWidth: 2,
            }}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
