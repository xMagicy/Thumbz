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

function formatRelative(iso?: string): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  const sec = Math.round(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 30) return `${day}d ago`;
  const mo = Math.round(day / 30);
  if (mo < 12) return `${mo}mo ago`;
  return d.toLocaleDateString();
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
  const { points: data, isFallback } = useRealEloTrend(thumbnailId, currentElo);
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
  const yMin = isFallback ? min - 20 : min - yPad;
  const yMax = isFallback ? max + 20 : max + yPad;
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

  // Min/max anchor coords (skip if flat or fallback).
  const minCoord = useMemo(() => {
    if (isFlat || isFallback) return null;
    return coords.reduce((acc, c) => (c.rating < acc.rating ? c : acc), coords[0]);
  }, [coords, isFlat, isFallback]);
  const maxCoord = useMemo(() => {
    if (isFlat || isFallback) return null;
    return coords.reduce((acc, c) => (c.rating > acc.rating ? c : acc), coords[0]);
  }, [coords, isFlat, isFallback]);

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

  // Hover tracking
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  const handleMove = (clientX: number) => {
    const svg = svgRef.current;
    if (!svg || coords.length < 2) return;
    const rect = svg.getBoundingClientRect();
    // Map clientX to SVG viewBox coords accounting for fluid scaling.
    const ratio = (clientX - rect.left) / rect.width;
    const xInView = ratio * W;
    let nearest = 0;
    let nearestDist = Infinity;
    for (let i = 0; i < coords.length; i++) {
      const d = Math.abs(coords[i].x - xInView);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = i;
      }
    }
    // Skip the rerender when the nearest battle hasn't changed — pointer
    // moves fire ~60Hz and we'd otherwise rebuild the tooltip every frame.
    setHoverIdx((prev) => (prev === nearest ? prev : nearest));
  };

  const hovered = hoverIdx !== null ? coords[hoverIdx] : null;
  const hoveredDelta =
    hovered !== null ? hovered.rating - data[0].rating : 0;
  const hoveredRel = hovered ? formatRelative(hovered.createdAt) : null;

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
  const subtitle = isFallback
    ? "No battles yet"
    : `Last ${totalPoints} ${totalPoints === 1 ? "battle" : "battles"}`;

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
          {hovered ? (
            <span
              className="tabular-nums"
              style={{
                fontWeight: 700,
                fontSize: "1.1rem",
                letterSpacing: "-0.02em",
                color: "#fff",
              }}
            >
              {hovered.rating}
            </span>
          ) : (
            <span
              className="tabular-nums"
              style={{
                fontWeight: 600,
                fontSize: "0.78rem",
                color: "rgba(255,255,255,0.55)",
              }}
            >
              now {data[data.length - 1].rating}
            </span>
          )}
        </div>
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

      <div
        className="relative w-full"
        onMouseLeave={() => setHoverIdx(null)}
        onPointerLeave={() => setHoverIdx(null)}
        style={{ touchAction: "pan-y" }}
      >
        <svg
          ref={svgRef}
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
          className="cursor-crosshair block"
          onMouseMove={(e) => handleMove(e.clientX)}
          onTouchMove={(e) => {
            const t = e.touches[0];
            if (t) handleMove(t.clientX);
          }}
          onTouchEnd={() => setHoverIdx(null)}
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

          {/* Endpoint anchor (only when not hovering) */}
          {!isFlat && hovered === null && coords.length > 0 && (
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

          {/* Hover crosshair + animated dot */}
          {hovered && (
            <>
              <line
                x1={hovered.x}
                x2={hovered.x}
                y1={padT}
                y2={padT + plotH}
                stroke={stroke}
                strokeOpacity={0.55}
                strokeWidth={1}
                strokeDasharray="3 3"
              />
              <circle
                cx={hovered.x}
                cy={hovered.y}
                r={9}
                fill={stroke}
                fillOpacity={0.18}
              />
              <circle
                cx={hovered.x}
                cy={hovered.y}
                r={4.5}
                fill={stroke}
                stroke="#0c0c16"
                strokeWidth={1.75}
              />
            </>
          )}

          {/* X-axis end labels — first / last battle # */}
          {!isFallback && data.length >= 2 && (
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

        {/* Floating hover tooltip — positioned in CSS pixels via percentage of
            the svg's viewBox so it tracks correctly under fluid widths.
            Anchor flips at the left/right edges so the tooltip never gets
            clipped outside the chart container. */}
        {hovered && (() => {
          const pctX = (hovered.x / W) * 100;
          // Edge thresholds — within ~12% of either side the tooltip flips
          // from centered to left- or right-anchored so it stays inside the
          // chart bounds at battle 1 / battle N.
          let translateX = "-50%";
          let leftStyle: string = `${pctX}%`;
          if (pctX < 12) {
            translateX = "0%";
            leftStyle = `calc(${pctX}% - 8px)`;
          } else if (pctX > 88) {
            translateX = "-100%";
            leftStyle = `calc(${pctX}% + 8px)`;
          }
          return (
          <div
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded-lg"
            style={{
              left: leftStyle,
              top: `${((hovered.y - 8) / H) * 100}%`,
              transform: `translate(${translateX}, -100%)`,
              padding: "7px 10px",
              fontFamily: inter,
              fontSize: "0.7rem",
              color: "#fff",
              background: "rgba(12,12,22,0.96)",
              border: "1px solid rgba(168,85,247,0.5)",
              boxShadow:
                "0 10px 28px -8px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04) inset",
              backdropFilter: "blur(8px)",
              minWidth: 110,
            }}
          >
            <div
              className="uppercase mb-0.5"
              style={{
                fontWeight: 600,
                fontSize: "0.55rem",
                letterSpacing: "0.12em",
                color: "rgba(255,255,255,0.45)",
              }}
            >
              {isFallback
                ? "Current"
                : `Battle ${hovered.index + 1} of ${totalPoints}`}
            </div>
            <div className="flex items-baseline gap-2">
              <span
                className="tabular-nums"
                style={{
                  fontWeight: 800,
                  fontSize: "1rem",
                  letterSpacing: "-0.02em",
                }}
              >
                {hovered.rating}
              </span>
              {!isFlat && hoveredDelta !== 0 && (
                <span
                  className="tabular-nums"
                  style={{
                    fontWeight: 700,
                    fontSize: "0.7rem",
                    color: hoveredDelta > 0 ? "#4ade80" : "#f87171",
                  }}
                >
                  {hoveredDelta > 0 ? "+" : ""}
                  {hoveredDelta}
                </span>
              )}
            </div>
            {hoveredRel && (
              <div
                style={{
                  marginTop: 2,
                  fontWeight: 500,
                  fontSize: "0.6rem",
                  color: "rgba(255,255,255,0.45)",
                }}
              >
                {hoveredRel}
              </div>
            )}
          </div>
          );
        })()}
      </div>

      <style>{`
        @keyframes elo-big-reveal {
          to { stroke-dashoffset: 0; }
        }
      `}</style>
    </div>
  );
}
