import { useState, type FormEvent } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Loader2, Upload, ArrowLeft } from "lucide-react";
import { useSession, authClient } from "../lib/auth-client";
import { fetchMyThumbnails } from "../lib/dashboard-api";
import { MyThumbnailCard } from "../components/MyThumbnailCard";

const inter = "'Inter', system-ui, sans-serif";

export default function Dashboard() {
  const { data: session, isPending: sessionPending } = useSession();
  const sessionUser = session?.user ?? null;

  const { data: thumbnails, isLoading: thumbnailsLoading } = useQuery({
    queryKey: ["my-thumbnails"],
    queryFn: fetchMyThumbnails,
    enabled: !!sessionUser,
    staleTime: 15_000,
  });

  if (sessionPending) {
    return <FullPageStatus label="Loading…" />;
  }

  if (!sessionUser) {
    return <SignInGate />;
  }

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
          Dashboard
        </span>
      </header>

      <main className="max-w-5xl mx-auto px-6 pt-10 flex flex-col gap-10">
        <ProfileSection
          name={sessionUser.name ?? ""}
          email={sessionUser.email}
        />

        <section className="flex flex-col gap-4">
          <div className="flex items-center justify-between">
            <h2
              style={{
                fontWeight: 700,
                fontSize: "1.15rem",
                letterSpacing: "-0.01em",
              }}
            >
              My thumbnails
            </h2>
            <span
              style={{
                fontSize: "0.78rem",
                color: "rgba(255,255,255,0.45)",
              }}
            >
              {thumbnailsLoading
                ? "Loading…"
                : `${thumbnails?.length ?? 0} total`}
            </span>
          </div>

          {thumbnailsLoading ? (
            <SkeletonGrid />
          ) : !thumbnails || thumbnails.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {thumbnails.map((t) => (
                <MyThumbnailCard key={t.id} thumbnail={t} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function ProfileSection({ name, email }: { name: string; email: string }) {
  const [editing, setEditing] = useState(false);
  const [draftName, setDraftName] = useState(name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    const trimmed = draftName.trim();
    if (!trimmed) {
      setError("Name can't be empty.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const result = await authClient.updateUser({ name: trimmed });
      if ("error" in result && result.error) {
        setError(result.error.message ?? "Failed to update.");
      } else {
        setEditing(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{
        background: "rgba(12, 12, 22, 0.7)",
        border: "1px solid rgba(168, 85, 247, 0.18)",
      }}
    >
      <div className="flex items-center justify-between">
        <h2
          style={{
            fontWeight: 700,
            fontSize: "1rem",
            letterSpacing: "-0.01em",
          }}
        >
          Profile
        </h2>
        {!editing && (
          <button
            type="button"
            onClick={() => {
              setDraftName(name);
              setEditing(true);
              setError(null);
            }}
            className="rounded-full px-3 py-1 transition-colors hover:bg-white/10"
            style={{
              fontSize: "0.75rem",
              color: "rgba(255,255,255,0.65)",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.08)",
            }}
          >
            Edit name
          </button>
        )}
      </div>

      {editing ? (
        <form onSubmit={handleSave} className="flex flex-col gap-2">
          <label
            className="uppercase"
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              color: "rgba(255,255,255,0.45)",
            }}
          >
            Name
          </label>
          <input
            type="text"
            value={draftName}
            onChange={(e) => setDraftName(e.target.value)}
            disabled={saving}
            autoFocus
            className="rounded-lg px-3 py-2 text-white"
            style={{
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(168,85,247,0.35)",
              fontSize: "0.9rem",
            }}
          />
          {error && (
            <p style={{ fontSize: "0.78rem", color: "#fca5a5" }}>{error}</p>
          )}
          <div className="flex gap-2 mt-1">
            <button
              type="submit"
              disabled={saving}
              className="flex items-center gap-2 rounded-full px-4 py-2"
              style={{
                fontSize: "0.82rem",
                fontWeight: 600,
                color: "white",
                background:
                  "linear-gradient(135deg, hsl(280 90% 60%), hsl(320 90% 55%))",
                opacity: saving ? 0.6 : 1,
              }}
            >
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save
            </button>
            <button
              type="button"
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={saving}
              className="rounded-full px-4 py-2"
              style={{
                fontSize: "0.82rem",
                color: "rgba(255,255,255,0.55)",
                background: "rgba(255,255,255,0.04)",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-1">
          <span style={{ fontSize: "1.05rem", fontWeight: 600 }}>
            {name || <em style={{ color: "rgba(255,255,255,0.4)" }}>No name set</em>}
          </span>
          <span style={{ fontSize: "0.8rem", color: "rgba(255,255,255,0.5)" }}>
            {email}
          </span>
        </div>
      )}
    </section>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {Array.from({ length: 3 }).map((_, i) => (
        <div
          key={i}
          className="rounded-2xl animate-pulse"
          style={{
            height: 320,
            background: "rgba(255,255,255,0.03)",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        />
      ))}
    </div>
  );
}

function EmptyState() {
  return (
    <div
      className="rounded-2xl p-10 flex flex-col items-center gap-3 text-center"
      style={{
        background: "rgba(12, 12, 22, 0.5)",
        border: "1px dashed rgba(255,255,255,0.12)",
      }}
    >
      <div
        className="w-12 h-12 rounded-2xl flex items-center justify-center"
        style={{
          background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
          opacity: 0.7,
        }}
      >
        <Upload className="w-5 h-5" style={{ color: "white" }} />
      </div>
      <h3 style={{ fontWeight: 600, fontSize: "1rem" }}>No thumbnails yet</h3>
      <p
        style={{
          fontSize: "0.85rem",
          color: "rgba(255,255,255,0.55)",
          maxWidth: 360,
          lineHeight: 1.5,
        }}
      >
        Upload your first thumbnail from the homepage. After admin review it'll
        appear here with battle stats and an ELO chart.
      </p>
      <Link
        href="/"
        className="rounded-full px-4 py-2 mt-1"
        style={{
          fontSize: "0.82rem",
          fontWeight: 600,
          color: "white",
          background:
            "linear-gradient(135deg, hsl(280 90% 60%), hsl(320 90% 55%))",
        }}
      >
        Go to homepage
      </Link>
    </div>
  );
}

function SignInGate() {
  return (
    <FullPageStatus
      label="Sign in to view your dashboard"
      action={
        <Link
          href="/"
          className="rounded-full px-5 py-2.5 mt-2"
          style={{
            fontSize: "0.85rem",
            fontWeight: 600,
            color: "white",
            background:
              "linear-gradient(135deg, hsl(280 90% 60%), hsl(320 90% 55%))",
            boxShadow: "0 6px 18px -4px rgba(217,70,239,0.4)",
          }}
        >
          Back to homepage
        </Link>
      }
    />
  );
}

function FullPageStatus({
  label,
  action,
}: {
  label: string;
  action?: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center gap-3 bg-arena-gradient text-white px-6"
      style={{ fontFamily: inter }}
    >
      <p
        style={{
          fontSize: "0.95rem",
          color: "rgba(255,255,255,0.7)",
          textAlign: "center",
        }}
      >
        {label}
      </p>
      {action}
    </div>
  );
}
