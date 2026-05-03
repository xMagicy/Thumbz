import { useState } from "react";
import { Link } from "wouter";
import { LayoutDashboard, LogOut, Loader2 } from "lucide-react";
import { signOut } from "../lib/auth-client";

const inter = "'Inter', system-ui, sans-serif";

interface UserMenuProps {
  name: string;
  email: string;
}

function getInitials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function UserMenu({ name, email }: UserMenuProps) {
  const [signingOut, setSigningOut] = useState(false);
  const initials = getInitials(name, email);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  }

  return (
    <div className="hidden sm:flex items-center gap-2" style={{ fontFamily: inter }}>
      <div
        className="flex items-center justify-center rounded-full text-white"
        style={{
          width: 28,
          height: 28,
          fontWeight: 700,
          fontSize: "0.7rem",
          background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
          boxShadow: "0 4px 12px -2px rgba(217,70,239,0.35)",
          letterSpacing: "0.02em",
        }}
        aria-hidden
      >
        {initials}
      </div>

      <span
        className="hidden md:inline"
        style={{
          fontWeight: 500,
          fontSize: "0.78rem",
          color: "rgba(255,255,255,0.78)",
          maxWidth: 120,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
        title={name || email}
      >
        {name || email}
      </span>

      <Link
        href="/dashboard"
        aria-label="Dashboard"
        className="flex items-center gap-1.5 rounded-full transition-colors hover:bg-white/10"
        style={{
          fontFamily: inter,
          fontWeight: 500,
          fontSize: "0.78rem",
          color: "rgba(255,255,255,0.78)",
          padding: "6px 10px",
          background: "rgba(168,85,247,0.10)",
          border: "1px solid rgba(168,85,247,0.28)",
          letterSpacing: "0.01em",
        }}
      >
        <LayoutDashboard className="w-3.5 h-3.5" />
        Dashboard
      </Link>

      <button
        type="button"
        onClick={handleSignOut}
        disabled={signingOut}
        aria-label="Sign out"
        className="flex items-center gap-1.5 rounded-full transition-colors hover:bg-white/10 disabled:cursor-not-allowed"
        style={{
          fontFamily: inter,
          fontWeight: 500,
          fontSize: "0.78rem",
          color: "rgba(255,255,255,0.65)",
          padding: "6px 10px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          letterSpacing: "0.01em",
        }}
      >
        {signingOut ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
        ) : (
          <LogOut className="w-3.5 h-3.5" />
        )}
        Sign out
      </button>
    </div>
  );
}
