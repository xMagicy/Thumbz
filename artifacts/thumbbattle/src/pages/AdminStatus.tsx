import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, RefreshCw, ArrowLeft, LogOut } from "lucide-react";

const inter = "'Inter', system-ui, sans-serif";
const TOKEN_STORAGE_KEY = "thumbz_admin_token";

type SyncStatus = {
  ok: true;
  lastSyncedAt: string | null;
  hoursSinceLastSync: number | null;
  counts: {
    total: number;
    byStatus: Record<string, number>;
    bySource: Record<string, number>;
  };
  activity: {
    addedLast24h: number;
    syncedLast24h: number;
  };
};

class AdminAuthError extends Error {
  constructor() {
    super("unauthorized");
  }
}

async function fetchSyncStatus(token: string): Promise<SyncStatus> {
  const res = await fetch("/api/admin/sync-status", {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) throw new AdminAuthError();
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return (await res.json()) as SyncStatus;
}

export default function AdminStatus() {
  const [token, setToken] = useState<string>(
    () => localStorage.getItem(TOKEN_STORAGE_KEY) ?? "",
  );

  const handleSubmitToken = (next: string) => {
    localStorage.setItem(TOKEN_STORAGE_KEY, next);
    setToken(next);
  };

  const handleForget = () => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken("");
  };

  return (
    <div
      className="min-h-screen bg-arena-gradient text-white pb-24"
      style={{ fontFamily: inter }}
    >
      <header
        className="w-full px-6 py-5 flex items-center justify-between"
        style={{
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          background: "rgba(10, 10, 20, 0.6)",
          backdropFilter: "blur(8px)",
        }}
      >
        <Link
          href="/"
          className="flex items-center gap-2 text-white/60 hover:text-white/90 transition-colors"
          style={{ fontSize: "0.85rem" }}
        >
          <ArrowLeft className="w-4 h-4" />
          Back to battles
        </Link>
        <span
          className="uppercase"
          style={{
            fontWeight: 700,
            fontSize: "0.7rem",
            letterSpacing: "0.12em",
            color: "rgba(255,255,255,0.45)",
          }}
        >
          Admin · Sync status
        </span>
      </header>

      <main className="max-w-4xl mx-auto px-6 pt-10 flex flex-col gap-8">
        {token ? (
          <StatusPanel token={token} onForget={handleForget} onAuthFail={handleForget} />
        ) : (
          <TokenGate onSubmit={handleSubmitToken} />
        )}
      </main>
    </div>
  );
}

function TokenGate({ onSubmit }: { onSubmit: (token: string) => void }) {
  const [draft, setDraft] = useState("");

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const trimmed = draft.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <section
      className="rounded-2xl p-6 flex flex-col gap-4"
      style={{
        background: "rgba(12, 12, 22, 0.7)",
        border: "1px solid rgba(168, 85, 247, 0.18)",
      }}
    >
      <div className="flex flex-col gap-1">
        <h1 style={{ fontWeight: 700, fontSize: "1.15rem", letterSpacing: "-0.01em" }}>
          Enter admin token
        </h1>
        <p style={{ fontSize: "0.85rem", color: "rgba(255,255,255,0.55)" }}>
          The token is stored in this browser only (localStorage). Use "Forget token" to clear it.
        </p>
      </div>
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <input
          type="password"
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="ADMIN_TOKEN"
          className="w-full px-4 py-2.5 rounded-lg outline-none"
          style={{
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.12)",
            color: "white",
            fontSize: "0.9rem",
          }}
        />
        <button
          type="submit"
          className="self-start px-4 py-2 rounded-lg transition-opacity hover:opacity-90"
          style={{
            background: "linear-gradient(135deg, #8b5cf6 0%, #d946ef 100%)",
            fontWeight: 600,
            fontSize: "0.85rem",
          }}
        >
          Sign in
        </button>
      </form>
    </section>
  );
}

function StatusPanel({
  token,
  onForget,
  onAuthFail,
}: {
  token: string;
  onForget: () => void;
  onAuthFail: () => void;
}) {
  const query = useQuery({
    queryKey: ["admin-sync-status", token],
    queryFn: () => fetchSyncStatus(token),
    refetchInterval: 30_000,
    retry: (failureCount, error) =>
      !(error instanceof AdminAuthError) && failureCount < 2,
  });

  if (query.error instanceof AdminAuthError) {
    queueMicrotask(onAuthFail);
    return null;
  }

  return (
    <>
      <div className="flex items-center justify-between">
        <h1 style={{ fontWeight: 700, fontSize: "1.6rem", letterSpacing: "-0.02em" }}>
          Sync status
        </h1>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => query.refetch()}
            disabled={query.isFetching}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5 disabled:opacity-50"
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: "0.8rem",
              color: "rgba(255,255,255,0.8)",
            }}
          >
            {query.isFetching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <RefreshCw className="w-3.5 h-3.5" />
            )}
            Refresh
          </button>
          <button
            type="button"
            onClick={onForget}
            className="flex items-center gap-2 px-3 py-1.5 rounded-lg transition-colors hover:bg-white/5"
            style={{
              border: "1px solid rgba(255,255,255,0.12)",
              fontSize: "0.8rem",
              color: "rgba(255,255,255,0.55)",
            }}
          >
            <LogOut className="w-3.5 h-3.5" />
            Forget token
          </button>
        </div>
      </div>

      {query.isLoading ? (
        <CardShell>
          <div className="flex items-center gap-3" style={{ color: "rgba(255,255,255,0.55)" }}>
            <Loader2 className="w-4 h-4 animate-spin" />
            <span style={{ fontSize: "0.9rem" }}>Loading…</span>
          </div>
        </CardShell>
      ) : query.error ? (
        <CardShell tone="error">
          <p style={{ fontSize: "0.9rem", color: "#fca5a5" }}>
            Failed to load: {query.error instanceof Error ? query.error.message : "unknown error"}
          </p>
        </CardShell>
      ) : query.data ? (
        <StatusGrid data={query.data} />
      ) : null}
    </>
  );
}

function StatusGrid({ data }: { data: SyncStatus }) {
  const lastSyncLabel = data.lastSyncedAt
    ? new Date(data.lastSyncedAt).toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "Never";

  const hoursLabel =
    data.hoursSinceLastSync === null
      ? "—"
      : data.hoursSinceLastSync < 1
        ? `${Math.round(data.hoursSinceLastSync * 60)} min ago`
        : `${data.hoursSinceLastSync.toFixed(1)}h ago`;

  const cronHealthy =
    data.hoursSinceLastSync !== null && data.hoursSinceLastSync < 7;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <Stat
        label="Last YouTube sync"
        primary={hoursLabel}
        secondary={lastSyncLabel}
        accent={cronHealthy ? "ok" : "warn"}
      />
      <Stat
        label="Activity (last 24h)"
        primary={`+${data.activity.addedLast24h} added`}
        secondary={`${data.activity.syncedLast24h} (re)synced`}
      />
      <Stat
        label="Total thumbnails"
        primary={data.counts.total.toLocaleString()}
        secondary={breakdownLine(data.counts.byStatus)}
      />
      <Stat
        label="By source"
        primary={breakdownLine(data.counts.bySource)}
      />
    </div>
  );
}

function breakdownLine(record: Record<string, number>): string {
  const entries = Object.entries(record).sort(([, a], [, b]) => b - a);
  if (entries.length === 0) return "—";
  return entries.map(([k, v]) => `${k}: ${v.toLocaleString()}`).join(" · ");
}

function Stat({
  label,
  primary,
  secondary,
  accent,
}: {
  label: string;
  primary: string;
  secondary?: string;
  accent?: "ok" | "warn";
}) {
  const accentColor =
    accent === "ok"
      ? "rgba(74, 222, 128, 0.7)"
      : accent === "warn"
        ? "rgba(251, 191, 36, 0.85)"
        : undefined;

  return (
    <CardShell>
      <div className="flex flex-col gap-2">
        <span
          className="uppercase"
          style={{
            fontSize: "0.7rem",
            letterSpacing: "0.1em",
            color: "rgba(255,255,255,0.45)",
            fontWeight: 600,
          }}
        >
          {label}
        </span>
        <span
          style={{
            fontSize: "1.4rem",
            fontWeight: 700,
            letterSpacing: "-0.02em",
            color: accentColor ?? "white",
          }}
        >
          {primary}
        </span>
        {secondary && (
          <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.55)" }}>
            {secondary}
          </span>
        )}
      </div>
    </CardShell>
  );
}

function CardShell({
  children,
  tone,
}: {
  children: React.ReactNode;
  tone?: "error";
}) {
  return (
    <section
      className="rounded-2xl p-5"
      style={{
        background: "rgba(12, 12, 22, 0.7)",
        border:
          tone === "error"
            ? "1px solid rgba(252, 165, 165, 0.3)"
            : "1px solid rgba(168, 85, 247, 0.18)",
      }}
    >
      {children}
    </section>
  );
}
