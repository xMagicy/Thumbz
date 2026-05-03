import { useId, useMemo, useRef, useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import {
  useGetThumbnailRatingHistory,
  getGetThumbnailRatingHistoryQueryKey,
} from "@workspace/api-client-react";

const inter = "'Inter', system-ui, sans-serif";

export interface EloTrendPoint {
  index: number;
  rating: number;
  createdAt?: string;
}

/**
 * Hook that loads a thumbnail's recorded ELO history from the server and
 * normalizes it into chart-ready points (1-indexed `index` + `rating`).
 *
 * Fallback: if there are fewer than 2 recorded points (a brand-new thumbnail
 * or one that hasn't fought yet) we synthesize a flat 2-point line at the
 * thumbnail's current rating so the chart still has something to render
 * instead of collapsing to a single dot.
 */
export function useRealEloTrend(thumbnailId: number, currentElo: number) {
  const query = useGetThumbnailRatingHistory(thumbnailId, {
    query: {
      queryKey: getGetThumbnailRatingHistoryQueryKey(thumbnailId),
      // Cache briefly — history only changes after a vote on this thumbnail.
      staleTime: 30_000,
    },
  });

  const points = useMemo<EloTrendPoint[]>(() => {
    const raw = query.data?.points ?? [];
    if (raw.length >= 2) {
      return raw.map((p, i) => ({
        index: i + 1,
        rating: p.rating,
        createdAt: p.createdAt,
      }));
    }
    // Fallback flat line at the current rating.
    return [
      { index: 1, rating: currentElo },
      { index: 2, rating: currentElo },
    ];
  }, [query.data, currentElo]);

  return { points, isLoading: query.isLoading, isFallback: (query.data?.points.length ?? 0) < 2 };
}

function trendColors(points: EloTrendPoint[]) {
  const first = points[0].rating;
  const last = points[points.length - 1].rating;
  const isFlat = points.every((p) => p.rating === first);
  const trendUp = last >= first;
  // Brighter, higher-saturation hues so the up/down direction is obvious at
  // a glance even on a tiny sparkline. Flat lines fall back to a muted
  // neutral so we don't imply a fake direction.
  if (isFlat) {
    return {
      trendUp: true,
      isFlat: true,
      stroke: "#a78bfa",
      fillSolid: "#8b5cf6",
    };
  }
  return {
    trendUp,
    isFlat: false,
    stroke: trendUp ? "#4ade80" : "#f87171",
    fillSolid: trendUp ? "#22c55e" : "#ef4444",
  };
}

/**
 * Compact inline SVG sparkline shown in leaderboard rows. Reads real history
 * from the API; falls back to a flat line at `currentElo` when the thumbnail
 * has fewer than 2 recorded points.
 */
export function EloSparkline({
  recentRatings,
  currentElo,
}: {
  /**
   * Chronological rating snapshots (oldest first) embedded in the thumbnail
   * list response. Pass the empty array for never-battled thumbnails — we
   * fall back to a flat 2-point line at `currentElo`. CRITICAL: this prop
   * replaces the previous per-row fetch that caused N+1 network saturation
   * on the leaderboard.
   */
  recentRatings: number[];
  currentElo: number;
}) {
  const points = useMemo<EloTrendPoint[]>(() => {
    if (recentRatings.length >= 2) {
      return recentRatings.map((rating, i) => ({ index: i + 1, rating }));
    }
    return [
      { index: 1, rating: currentElo },
      { index: 2, rating: currentElo },
    ];
  }, [recentRatings, currentElo]);
  const { trendUp, isFlat, stroke, fillSolid } = trendColors(points);

  // Per-instance ids so the SVG <defs> for glow/gradient don't collide
  // across the dozens of sparklines rendered on the leaderboard.
  const reactId = useId();
  const safeId = reactId.replace(/[:]/g, "");
  const filterId = `spark-glow-${safeId}`;
  const gradId = `spark-grad-${safeId}`;

  const ratings = points.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const range = max - min || 1;
  const W = 76;
  const H = 28;
  // Tight vertical padding so the line uses ~93% of the height — the trend
  // stretches almost to the edges instead of being squashed in the middle.
  const padY = 2;

  const coords = points.map((p, i) => ({
    x: (i / (points.length - 1)) * W,
    y: H - padY - ((p.rating - min) / range) * (H - padY * 2),
    rating: p.rating,
    index: i,
  }));

  const path = coords
    .map((c, i) => `${i === 0 ? "M" : "L"}${c.x.toFixed(1)},${c.y.toFixed(1)}`)
    .join(" ");
  const areaPath = `${path} L${W},${H} L0,${H} Z`;
  const lastCoord = coords[coords.length - 1];
  const delta = points[points.length - 1].rating - points[0].rating;

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
  const hoveredDelta =
    hovered !== null ? hovered.rating - points[0].rating : 0;

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
        aria-label={`ELO trend: ${
          isFlat ? "flat" : trendUp ? "up" : "down"
        }, ${delta >= 0 ? "+" : ""}${delta}`}
        onMouseMove={handleMove}
      >
        <defs>
          {/* Soft glow that bleeds the line color into the area below — the
              trick that makes Vercel/Linear charts feel alive instead of
              looking like flat geometry. */}
          <filter
            id={filterId}
            x="-30%"
            y="-30%"
            width="160%"
            height="160%"
          >
            <feGaussianBlur stdDeviation="1.4" />
          </filter>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fillSolid} stopOpacity={0.38} />
            <stop offset="100%" stopColor={fillSolid} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={areaPath} fill={`url(#${gradId})`} />
        {/* Glow underlay — wide soft stroke beneath the crisp line. */}
        {!isFlat && (
          <path
            d={path}
            fill="none"
            stroke={stroke}
            strokeOpacity={0.45}
            strokeWidth={3.25}
            strokeLinecap="round"
            strokeLinejoin="round"
            filter={`url(#${filterId})`}
          />
        )}
        <path
          d={path}
          fill="none"
          stroke={stroke}
          strokeWidth={2.25}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Endpoint anchor — the eye lands here and immediately reads the
            direction relative to the start of the line. */}
        {!isFlat && hoverIdx === null && (
          <>
            <circle
              cx={lastCoord.x}
              cy={lastCoord.y}
              r={3.2}
              fill={stroke}
              fillOpacity={0.25}
            />
            <circle
              cx={lastCoord.x}
              cy={lastCoord.y}
              r={1.8}
              fill={stroke}
              stroke="#0c0c16"
              strokeWidth={0.75}
            />
          </>
        )}
        {hovered && (
          <>
            <line
              x1={hovered.x}
              x2={hovered.x}
              y1={0}
              y2={H}
              stroke={stroke}
              strokeOpacity={0.55}
              strokeWidth={1}
              strokeDasharray="2 2"
            />
            <circle
              cx={hovered.x}
              cy={hovered.y}
              r={4}
              fill={stroke}
              fillOpacity={0.25}
            />
            <circle
              cx={hovered.x}
              cy={hovered.y}
              r={2.4}
              fill={stroke}
              stroke="#0c0c16"
              strokeWidth={1}
            />
          </>
        )}
      </svg>
      {hovered && (
        <span
          className="pointer-events-none absolute z-20 -translate-x-1/2 whitespace-nowrap rounded-md px-2 py-1"
          style={{
            left: `${(hovered.x / W) * 100}%`,
            bottom: "calc(100% + 6px)",
            fontFamily: inter,
            fontSize: "0.65rem",
            color: "#fff",
            background: "rgba(12,12,22,0.96)",
            border: "1px solid rgba(168,85,247,0.45)",
            boxShadow: "0 4px 14px rgba(0,0,0,0.55)",
            display: "inline-flex",
            alignItems: "baseline",
            gap: 6,
          }}
        >
          <span style={{ fontWeight: 700, letterSpacing: "-0.01em" }}>
            {hovered.rating}
          </span>
          {!isFlat && hoveredDelta !== 0 && (
            <span
              style={{
                fontWeight: 600,
                fontSize: "0.58rem",
                color: hoveredDelta > 0 ? "#4ade80" : "#f87171",
              }}
            >
              {hoveredDelta > 0 ? "+" : ""}
              {hoveredDelta}
            </span>
          )}
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
 * Larger interactive Recharts version used in the detail modal. Reads the
 * thumbnail's real recorded rating history; flat-lines at `currentElo` if
 * fewer than 2 points have been recorded yet.
 */
export function EloTrendChart({
  thumbnailId,
  currentElo,
  height = 160,
}: {
  thumbnailId: number;
  currentElo: number;
  height?: number;
}) {
  const { points: data, isFallback } = useRealEloTrend(thumbnailId, currentElo);
  const { stroke, fillSolid, isFlat, trendUp } = trendColors(data);
  const gradientId = `elo-grad-${thumbnailId}`;
  const glowId = `elo-glow-${thumbnailId}`;

  const ratings = data.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  // Tight padding so the trend dominates the chart instead of getting
  // squashed into a flat band in the middle. Old behaviour padded by 18%
  // of the swing which made even 100-point climbs look almost horizontal.
  const swing = max - min;
  const pad = Math.max(2, Math.round(swing * 0.06));

  const totalPoints = data.length;
  const delta = data[data.length - 1].rating - data[0].rating;
  const subtitle = isFallback
    ? "No battles yet"
    : `Last ${totalPoints} ${totalPoints === 1 ? "battle" : "battles"}`;

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
        <div className="flex items-center gap-2">
          {!isFlat && !isFallback && delta !== 0 && (
            <span
              className="px-1.5 py-0.5 rounded-md tabular-nums"
              style={{
                fontWeight: 700,
                fontSize: "0.65rem",
                letterSpacing: "-0.01em",
                color: trendUp ? "#4ade80" : "#f87171",
                background: trendUp
                  ? "rgba(34,197,94,0.12)"
                  : "rgba(239,68,68,0.12)",
                border: `1px solid ${
                  trendUp ? "rgba(74,222,128,0.35)" : "rgba(248,113,113,0.35)"
                }`,
              }}
            >
              {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
            </span>
          )}
          <span
            style={{
              fontWeight: 500,
              fontSize: "0.65rem",
              color: "rgba(255,255,255,0.4)",
            }}
          >
            {subtitle}
          </span>
        </div>
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
              <stop offset="0%" stopColor={fillSolid} stopOpacity={0.55} />
              <stop offset="100%" stopColor={fillSolid} stopOpacity={0} />
            </linearGradient>
            {/* Subtle blur so the line glows slightly into the area below
                — the same trick used in the leaderboard sparkline. */}
            <filter id={glowId} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="2" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
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
                  isFallback
                    ? "Current rating"
                    : `Battle ${label} of ${totalPoints}`
                }
              />
            }
          />
          <Area
            type="monotone"
            dataKey="rating"
            stroke={stroke}
            strokeWidth={2.75}
            fill={`url(#${gradientId})`}
            filter={isFlat ? undefined : `url(#${glowId})`}
            isAnimationActive
            animationDuration={650}
            animationEasing="ease-out"
            dot={false}
            activeDot={{
              r: 5,
              fill: stroke,
              stroke: "#0c0c16",
              strokeWidth: 2,
              style: {
                filter: `drop-shadow(0 0 6px ${stroke})`,
              },
            }}
          />
        </AreaChart>
      </ChartContainer>
    </div>
  );
}
