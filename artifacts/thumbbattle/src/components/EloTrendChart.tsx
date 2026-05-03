import { useEffect, useId, useMemo, useRef, useState } from "react";

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
 * IMPORTANT: this hook returns ONLY real recorded data points. We never
 * synthesize or interpolate values — Thumbz is a measurement platform and
 * showing made-up trend lines would destroy user trust. When there are
 * fewer than 2 recorded points the caller renders an empty state instead
 * of a chart.
 */
export function useRealEloTrend(thumbnailId: number) {
  const query = useGetThumbnailRatingHistory(thumbnailId, {
    query: {
      queryKey: getGetThumbnailRatingHistoryQueryKey(thumbnailId),
      // Cache briefly — history only changes after a vote on this thumbnail.
      staleTime: 30_000,
    },
  });

  const points = useMemo<EloTrendPoint[]>(() => {
    const raw = query.data?.points ?? [];
    return raw.map((p, i) => ({
      index: i + 1,
      rating: p.rating,
      createdAt: p.createdAt,
    }));
  }, [query.data]);

  return {
    points,
    isLoading: query.isLoading,
    hasData: points.length >= 2,
  };
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
   * render a muted dash placeholder so it's visually obvious there's no
   * trend yet (instead of faking a flat line that could be mistaken for
   * real "no movement" data). CRITICAL: this prop replaces the previous
   * per-row fetch that caused N+1 network saturation on the leaderboard.
   */
  recentRatings: number[];
  currentElo: number;
}) {
  void currentElo;
  // All hooks must run unconditionally — empty-state branch comes after.
  const points = useMemo<EloTrendPoint[]>(
    () => recentRatings.map((rating, i) => ({ index: i + 1, rating })),
    [recentRatings],
  );
  // Per-instance ids so the SVG <defs> for glow/gradient don't collide
  // across the dozens of sparklines rendered on the leaderboard.
  const reactId = useId();

  // Honest empty-state: fewer than 2 real points means no trend exists.
  // Render a small muted dash rather than a misleading flat line.
  if (recentRatings.length < 2) {
    return (
      <span
        className="inline-flex items-center justify-center"
        style={{
          width: 76,
          height: 28,
          color: "rgba(255,255,255,0.25)",
          fontSize: "0.85rem",
          fontWeight: 600,
          letterSpacing: "0.2em",
          fontFamily: inter,
        }}
        aria-label="No rating history yet"
        title="No battles yet"
      >
        — — —
      </span>
    );
  }
  const { trendUp, isFlat, stroke, fillSolid } = trendColors(points);

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

  // Pure visual — no hover. The user reads direction with their eyes,
  // and clicks the row to open the big chart for the full breakdown.
  return (
    <span className="relative inline-block" style={{ lineHeight: 0 }}>
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        className="shrink-0 pointer-events-none"
        role="img"
        aria-label={`ELO trend: ${
          isFlat ? "flat" : trendUp ? "up" : "down"
        }, ${delta >= 0 ? "+" : ""}${delta}`}
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
        {!isFlat && (
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
      </svg>
    </span>
  );
}

/**
 * Catmull-Rom → cubic-Bezier conversion so the line curves smoothly between
 * battle points instead of jagging. Tension 0.5 matches the small sparkline
 * `type="monotone"` look closely enough that the two charts feel like the
 * same family.
 */
function smoothPath(coords: { x: number; y: number }[]): string {
  if (coords.length === 0) return "";
  if (coords.length === 1) return `M${coords[0].x},${coords[0].y}`;
  let d = `M${coords[0].x.toFixed(2)},${coords[0].y.toFixed(2)}`;
  for (let i = 0; i < coords.length - 1; i++) {
    const p0 = coords[i - 1] ?? coords[i];
    const p1 = coords[i];
    const p2 = coords[i + 1];
    const p3 = coords[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${cp1x.toFixed(2)},${cp1y.toFixed(2)} ${cp2x.toFixed(
      2,
    )},${cp2y.toFixed(2)} ${p2.x.toFixed(2)},${p2.y.toFixed(2)}`;
  }
  return d;
}

/**
 * Larger interactive chart shown in the thumbnail detail modal. Custom SVG
 * (no recharts) so it shares the exact glow/gradient/curve aesthetic as the
 * tiny `EloSparkline` — they're meant to feel like the same chart, just at
 * different magnifications.
 *
 * Interactions:
 *   - Mouse/touch move tracks the nearest battle index and shows a vertical
 *     crosshair, animated dot, and floating tooltip with rating + delta +
 *     relative time.
 *   - Min and max battle dots are pinned with subtle markers so the user can
 *     spot peak/valley at a glance even without hovering.
 *   - Path stroke animates in on mount via dasharray reveal (matches the
 *     tasteful Linear/Vercel motion language).
 */
export function EloTrendChart({
  thumbnailId,
  currentElo,
  height = 220,
}: {
  thumbnailId: number;
  currentElo: number;
  height?: number;
}) {
  const { points: data, hasData, isLoading } = useRealEloTrend(thumbnailId);

  // Honest empty state: when we don't have at least 2 real recorded points
  // we render a calm placeholder card with the current rating instead of
  // drawing a chart. This is a measurement platform — fake trends would
  // destroy trust. The card matches the chart's chrome so the modal layout
  // stays stable.
  if (!hasData) {
    return (
      <div
        className="rounded-xl relative flex flex-col items-center justify-center text-center"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))",
          border: "1px solid rgba(255,255,255,0.08)",
          padding: "20px 14px",
          minHeight: Math.max(160, height),
          boxShadow:
            "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 28px -16px rgba(0,0,0,0.6)",
          fontFamily: inter,
        }}
      >
        <span
          className="uppercase mb-2"
          style={{
            fontWeight: 600,
            fontSize: "0.62rem",
            letterSpacing: "0.14em",
            color: "rgba(255,255,255,0.55)",
          }}
        >
          Rating trend
        </span>
        <span
          className="tabular-nums"
          style={{
            fontWeight: 800,
            fontSize: "2.1rem",
            letterSpacing: "-0.03em",
            color: "#fff",
            lineHeight: 1,
            marginBottom: 10,
          }}
        >
          {currentElo}
        </span>
        <span
          style={{
            fontWeight: 500,
            fontSize: "0.78rem",
            color: "rgba(255,255,255,0.5)",
            maxWidth: 320,
            lineHeight: 1.5,
          }}
        >
          {isLoading
            ? "Loading history…"
            : data.length === 0
            ? "No battles yet. Vote on this thumbnail to start its rating trend."
            : "Only one battle recorded. One more vote and the trend line appears."}
        </span>
      </div>
    );
  }

  const { stroke, fillSolid, isFlat, trendUp } = trendColors(data);

  const reactId = useId();
  const safeId = reactId.replace(/[:]/g, "");
  const gradientId = `elo-big-grad-${safeId}`;
  const glowId = `elo-big-glow-${safeId}`;
  const lineGlowId = `elo-big-line-glow-${safeId}`;

  // Layout — fluid width via viewBox, fixed inner padding so axis labels
  // never crowd the plot.
  const W = 720;
  const H = Math.max(160, height);
  const padL = 44;
  const padR = 14;
  const padT = 14;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const ratings = data.map((p) => p.rating);
  const min = Math.min(...ratings);
  const max = Math.max(...ratings);
  const swing = max - min;
  const yPad = Math.max(2, Math.round(swing * 0.12));
  const yMin = min - yPad;
  const yMax = max + yPad;
  const yRange = yMax - yMin || 1;

  const coords = useMemo(
    () =>
      data.map((p, i) => ({
        x:
          padL +
          (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW),
        y: padT + plotH - ((p.rating - yMin) / yRange) * plotH,
        rating: p.rating,
        index: i,
        createdAt: p.createdAt,
      })),
    [data, padL, padT, plotW, plotH, yMin, yRange],
  );

  const linePath = useMemo(() => smoothPath(coords), [coords]);
  const areaPath = useMemo(() => {
    if (coords.length === 0) return "";
    return `${linePath} L${coords[coords.length - 1].x.toFixed(
      2,
    )},${(padT + plotH).toFixed(2)} L${coords[0].x.toFixed(2)},${(
      padT + plotH
    ).toFixed(2)} Z`;
  }, [coords, linePath, padT, plotH]);

  // Min/max anchor coords (skip if flat).
  const minCoord = useMemo(() => {
    if (isFlat) return null;
    return coords.reduce((acc, c) => (c.rating < acc.rating ? c : acc), coords[0]);
  }, [coords, isFlat]);
  const maxCoord = useMemo(() => {
    if (isFlat) return null;
    return coords.reduce((acc, c) => (c.rating > acc.rating ? c : acc), coords[0]);
  }, [coords, isFlat]);

  // Y-axis ticks — 4 evenly spaced rounded values.
  const yTicks = useMemo(() => {
    const steps = 4;
    const out: number[] = [];
    for (let i = 0; i <= steps; i++) {
      const v = yMin + ((yMax - yMin) * i) / steps;
      out.push(Math.round(v));
    }
    // Dedupe in case of a very flat range.
    return Array.from(new Set(out));
  }, [yMin, yMax]);

  // No hover interactions — the big chart is intentionally a clean,
  // read-with-your-eyes visual. Numbers live in the header + min/max
  // anchors, not in a tooltip that follows the cursor.

  // Path-reveal animation on mount. Skip entirely when the user has asked
  // for reduced motion (matches OS-level accessibility preference).
  const pathRef = useRef<SVGPathElement | null>(null);
  const [pathLength, setPathLength] = useState(0);
  const prefersReducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  useEffect(() => {
    if (prefersReducedMotion) {
      setPathLength(0);
      return;
    }
    if (pathRef.current) {
      try {
        setPathLength(pathRef.current.getTotalLength());
      } catch {
        setPathLength(0);
      }
    }
  }, [linePath, prefersReducedMotion]);

  const totalPoints = data.length;
  const delta = data[data.length - 1].rating - data[0].rating;
  const subtitle = `Last ${totalPoints} ${totalPoints === 1 ? "battle" : "battles"}`;

  return (
    <div
      className="rounded-xl relative"
      style={{
        background:
          "linear-gradient(180deg, rgba(255,255,255,0.045), rgba(255,255,255,0.015))",
        border: "1px solid rgba(255,255,255,0.08)",
        padding: "14px 14px 10px",
        boxShadow:
          "inset 0 1px 0 rgba(255,255,255,0.04), 0 8px 28px -16px rgba(0,0,0,0.6)",
      }}
    >
      <div
        className="flex items-center justify-between mb-3 px-1"
        style={{ fontFamily: inter }}
      >
        <div className="flex items-baseline gap-2.5">
          <span
            className="uppercase"
            style={{
              fontWeight: 600,
              fontSize: "0.62rem",
              letterSpacing: "0.14em",
              color: "rgba(255,255,255,0.55)",
            }}
          >
            Rating trend
          </span>
          <span
            className="tabular-nums"
            style={{
              fontWeight: 800,
              fontSize: "1.25rem",
              letterSpacing: "-0.025em",
              color: "#fff",
            }}
          >
            {data[data.length - 1].rating}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {!isFlat && delta !== 0 && (
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

      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width="100%"
          height={H}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Rating trend: ${
            isFlat ? "flat" : trendUp ? "trending up" : "trending down"
          }, ${delta >= 0 ? "+" : ""}${delta} over ${totalPoints} ${
            totalPoints === 1 ? "battle" : "battles"
          }. Current rating ${data[data.length - 1].rating}, peak ${max}, low ${min}.`}
          className="block pointer-events-none"
        >
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={fillSolid} stopOpacity={0.42} />
              <stop offset="60%" stopColor={fillSolid} stopOpacity={0.12} />
              <stop offset="100%" stopColor={fillSolid} stopOpacity={0} />
            </linearGradient>
            <filter id={glowId} x="-10%" y="-10%" width="120%" height="120%">
              <feGaussianBlur stdDeviation="3" />
            </filter>
            <filter
              id={lineGlowId}
              x="-5%"
              y="-20%"
              width="110%"
              height="140%"
            >
              <feGaussianBlur stdDeviation="2" />
            </filter>
          </defs>

          {/* Y-axis grid lines + labels */}
          {yTicks.map((t, i) => {
            const y = padT + plotH - ((t - yMin) / yRange) * plotH;
            return (
              <g key={`yt-${i}`}>
                <line
                  x1={padL}
                  x2={W - padR}
                  y1={y}
                  y2={y}
                  stroke="rgba(255,255,255,0.05)"
                  strokeDasharray="3 4"
                />
                <text
                  x={padL - 8}
                  y={y + 3}
                  textAnchor="end"
                  fontFamily={inter}
                  fontSize={10}
                  fontWeight={500}
                  fill="rgba(255,255,255,0.4)"
                  style={{ fontVariantNumeric: "tabular-nums" }}
                >
                  {t}
                </text>
              </g>
            );
          })}

          {/* Area fill */}
          <path d={areaPath} fill={`url(#${gradientId})`} />

          {/* Glow underlay for the line */}
          {!isFlat && (
            <path
              d={linePath}
              fill="none"
              stroke={stroke}
              strokeOpacity={0.55}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
              filter={`url(#${lineGlowId})`}
            />
          )}

          {/* Crisp line, with dasharray reveal animation */}
          <path
            ref={pathRef}
            d={linePath}
            fill="none"
            stroke={stroke}
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            style={
              pathLength > 0
                ? {
                    strokeDasharray: pathLength,
                    strokeDashoffset: pathLength,
                    animation: "elo-big-reveal 800ms ease-out forwards",
                  }
                : undefined
            }
          />

          {/* Min / max anchor markers */}
          {minCoord && (
            <g>
              <circle
                cx={minCoord.x}
                cy={minCoord.y}
                r={3.5}
                fill="#0c0c16"
                stroke="rgba(248,113,113,0.85)"
                strokeWidth={1.5}
              />
            </g>
          )}
          {maxCoord && (
            <g>
              <circle
                cx={maxCoord.x}
                cy={maxCoord.y}
                r={3.5}
                fill="#0c0c16"
                stroke="rgba(74,222,128,0.85)"
                strokeWidth={1.5}
              />
            </g>
          )}

          {/* Endpoint anchor — always visible since hover is disabled. */}
          {!isFlat && coords.length > 0 && (
            <>
              <circle
                cx={coords[coords.length - 1].x}
                cy={coords[coords.length - 1].y}
                r={6}
                fill={stroke}
                fillOpacity={0.18}
              />
              <circle
                cx={coords[coords.length - 1].x}
                cy={coords[coords.length - 1].y}
                r={3.2}
                fill={stroke}
                stroke="#0c0c16"
                strokeWidth={1.5}
              />
            </>
          )}

          {/* X-axis end labels — first / last battle # */}
          {data.length >= 2 && (
            <>
              <text
                x={padL}
                y={H - 8}
                textAnchor="start"
                fontFamily={inter}
                fontSize={10}
                fontWeight={500}
                fill="rgba(255,255,255,0.35)"
              >
                Battle 1
              </text>
              <text
                x={W - padR}
                y={H - 8}
                textAnchor="end"
                fontFamily={inter}
                fontSize={10}
                fontWeight={500}
                fill="rgba(255,255,255,0.35)"
              >
                Battle {totalPoints}
              </text>
            </>
          )}
        </svg>
      </div>

      <style>{`
        @keyframes elo-big-reveal {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
