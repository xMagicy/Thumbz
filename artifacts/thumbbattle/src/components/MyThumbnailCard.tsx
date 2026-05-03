import { useState, type FormEvent } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { EloSparkline } from "./EloTrendChart";
import { updateThumbnailCtr, type MyThumbnail } from "../lib/dashboard-api";

const inter = "'Inter', system-ui, sans-serif";

interface MyThumbnailCardProps {
  thumbnail: MyThumbnail;
}

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string }> = {
  active: {
    bg: "rgba(16, 185, 129, 0.12)",
    border: "rgba(16, 185, 129, 0.45)",
    text: "#34d399",
  },
  pending: {
    bg: "rgba(251, 191, 36, 0.12)",
    border: "rgba(251, 191, 36, 0.45)",
    text: "#fbbf24",
  },
  rejected: {
    bg: "rgba(244, 63, 94, 0.12)",
    border: "rgba(244, 63, 94, 0.45)",
    text: "#f87171",
  },
};

export function MyThumbnailCard({ thumbnail }: MyThumbnailCardProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draftCtr, setDraftCtr] = useState<string>(
    thumbnail.ctr === null ? "" : String(thumbnail.ctr),
  );
  const [error, setError] = useState<string | null>(null);

  const ctrMutation = useMutation({
    mutationFn: (ctr: number | null) => updateThumbnailCtr(thumbnail.id, ctr),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["my-thumbnails"] });
      setEditing(false);
      setError(null);
    },
    onError: (err: unknown) => {
      setError(err instanceof Error ? err.message : "Failed to save");
    },
  });

  function handleCtrSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = draftCtr.trim();
    if (trimmed === "") {
      ctrMutation.mutate(null);
      return;
    }
    const parsed = Number(trimmed);
    if (Number.isNaN(parsed) || parsed < 0 || parsed > 100) {
      setError("CTR must be a number between 0 and 100");
      return;
    }
    ctrMutation.mutate(parsed);
  }

  const status = STATUS_COLORS[thumbnail.status] ?? STATUS_COLORS.pending;
  const totalBattles = thumbnail.wins + thumbnail.losses;

  return (
    <div
      className="rounded-2xl overflow-hidden flex flex-col gap-3"
      style={{
        fontFamily: inter,
        background: "rgba(12, 12, 22, 0.7)",
        border: "1px solid rgba(168, 85, 247, 0.18)",
      }}
    >
      <div className="relative w-full aspect-video bg-black/40">
        <img
          src={thumbnail.imageUrl}
          alt={thumbnail.title}
          className="w-full h-full object-cover"
          loading="lazy"
        />
        <span
          className="absolute top-2 left-2 uppercase"
          style={{
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            color: status.text,
            background: status.bg,
            border: `1px solid ${status.border}`,
            padding: "3px 8px",
            borderRadius: 9999,
            lineHeight: 1,
          }}
        >
          {thumbnail.status}
        </span>
      </div>

      <div className="px-4 pb-4 flex flex-col gap-3">
        <div className="flex flex-col gap-0.5">
          <h3
            className="text-white"
            style={{
              fontWeight: 600,
              fontSize: "0.92rem",
              lineHeight: 1.3,
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {thumbnail.title}
          </h3>
          <p style={{ color: "rgba(255,255,255,0.5)", fontSize: "0.78rem" }}>
            {thumbnail.channelName} · {thumbnail.niche}
          </p>
        </div>

        <div
          className="grid grid-cols-3 gap-2"
          style={{
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: "10px 12px",
          }}
        >
          <Stat label="ELO" value={thumbnail.eloRating} />
          <Stat
            label="win rate"
            value={
              thumbnail.winRate === null ? "—" : `${Math.round(thumbnail.winRate)}%`
            }
          />
          <Stat label="battles" value={totalBattles} />
        </div>

        <div className="flex items-center gap-2">
          <span
            className="uppercase shrink-0"
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            CTR
          </span>
          {editing ? (
            <form onSubmit={handleCtrSubmit} className="flex items-center gap-1.5 flex-1">
              <input
                type="number"
                min="0"
                max="100"
                step="0.1"
                value={draftCtr}
                onChange={(e) => setDraftCtr(e.target.value)}
                disabled={ctrMutation.isPending}
                placeholder="e.g. 8.4"
                className="flex-1 rounded px-2 py-1 text-white"
                style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(168,85,247,0.35)",
                  fontSize: "0.82rem",
                }}
                autoFocus
              />
              <button
                type="submit"
                disabled={ctrMutation.isPending}
                aria-label="Save CTR"
                className="p-1 rounded hover:bg-white/10 disabled:cursor-not-allowed"
                style={{ color: "#34d399" }}
              >
                {ctrMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Check className="w-4 h-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => {
                  setEditing(false);
                  setError(null);
                  setDraftCtr(thumbnail.ctr === null ? "" : String(thumbnail.ctr));
                }}
                disabled={ctrMutation.isPending}
                aria-label="Cancel"
                className="p-1 rounded hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.5)" }}
              >
                <X className="w-4 h-4" />
              </button>
            </form>
          ) : (
            <>
              <span style={{ fontSize: "0.85rem", color: "white", fontWeight: 500 }}>
                {thumbnail.ctr === null ? "—" : `${thumbnail.ctr}%`}
              </span>
              <button
                type="button"
                onClick={() => setEditing(true)}
                aria-label="Edit CTR"
                className="ml-auto p-1 rounded hover:bg-white/10"
                style={{ color: "rgba(255,255,255,0.55)" }}
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
            </>
          )}
        </div>

        {error && (
          <p style={{ fontSize: "0.72rem", color: "#fca5a5", lineHeight: 1.3 }}>
            {error}
          </p>
        )}

        <div className="flex items-center justify-between">
          <span
            className="uppercase"
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            ELO trend
          </span>
          <EloSparkline
            recentRatings={thumbnail.recentRatings}
            currentElo={thumbnail.eloRating}
          />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="flex flex-col items-center gap-0.5 text-center">
      <span style={{ color: "white", fontWeight: 700, fontSize: "0.95rem" }}>
        {value}
      </span>
      <span
        className="uppercase"
        style={{
          fontSize: "0.6rem",
          letterSpacing: "0.08em",
          color: "rgba(255,255,255,0.45)",
        }}
      >
        {label}
      </span>
    </div>
  );
}
