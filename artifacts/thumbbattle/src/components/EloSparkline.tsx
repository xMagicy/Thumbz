import { useQuery } from "@tanstack/react-query";
import { LineChart, Line, ResponsiveContainer, YAxis } from "recharts";
import { fetchEloHistory } from "../lib/dashboard-api";

interface EloSparklineProps {
  thumbnailId: number;
  height?: number;
}

// Compact ELO history sparkline. No axes, no grid — just the line, sized to
// fit inside a card. Stays empty (small placeholder) until at least 2 points
// exist; recharts can't draw a line from a single point.
export function EloSparkline({ thumbnailId, height = 48 }: EloSparklineProps) {
  const { data, isLoading } = useQuery({
    queryKey: ["elo-history", thumbnailId],
    queryFn: () => fetchEloHistory(thumbnailId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div
        style={{ height }}
        className="w-full rounded animate-pulse"
        aria-hidden
      />
    );
  }

  if (!data || data.length < 2) {
    return (
      <div
        style={{ height, fontSize: "0.7rem", color: "rgba(255,255,255,0.35)" }}
        className="w-full flex items-center"
      >
        Not enough battles yet for a chart
      </div>
    );
  }

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
          <YAxis hide domain={["dataMin - 10", "dataMax + 10"]} />
          <Line
            type="monotone"
            dataKey="eloRating"
            stroke="#d946ef"
            strokeWidth={1.75}
            dot={false}
            isAnimationActive={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
