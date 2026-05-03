import { useEffect, useRef, useState } from "react";
import { useLocation } from "wouter";
import { LayoutDashboard, LogOut, Loader2, ChevronDown } from "lucide-react";
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
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [, navigate] = useLocation();
  const initials = getInitials(name, email);
  const displayName = name || email;

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (!wrapRef.current) return;
      if (!wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  async function handleSignOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await signOut();
      setOpen(false);
    } finally {
      setSigningOut(false);
    }
  }

  function goDashboard() {
    setOpen(false);
    navigate("/dashboard");
  }

  return (
    <div
      ref={wrapRef}
      className="hidden sm:block relative"
      style={{ fontFamily: inter }}
    >
      {/* Trigger: avatar + name + chevron, single rounded surface so it
          reads as one clickable target instead of three loose chips. */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open user menu"
        className="flex items-center gap-2 rounded-full transition-colors hover:bg-white/5"
        style={{
          padding: "4px 10px 4px 4px",
          background: open ? "rgba(255,255,255,0.06)" : "rgba(255,255,255,0.025)",
          border: "1px solid rgba(255,255,255,0.08)",
        }}
      >
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
            color: "rgba(255,255,255,0.85)",
            maxWidth: 120,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {displayName}
        </span>
        <ChevronDown
          className="hidden md:block transition-transform"
          style={{
            width: 14,
            height: 14,
            color: "rgba(255,255,255,0.55)",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        />
      </button>

      {/* Dropdown panel. Glass-dark to sit on top of the gradient header
          without losing legibility. Width is fixed so a long email can't
          stretch it past the avatar trigger. */}
      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 rounded-xl overflow-hidden"
          style={{
            width: 240,
            background: "rgba(15, 15, 20, 0.92)",
            backdropFilter: "blur(20px)",
            WebkitBackdropFilter: "blur(20px)",
            border: "1px solid rgba(255,255,255,0.10)",
            boxShadow:
              "0 20px 50px -10px rgba(0,0,0,0.6), 0 0 0 1px rgba(168,85,247,0.08)",
            zIndex: 60,
          }}
        >
          {/* Header inside menu: name + email so the avatar trigger can
              stay compact while still surfacing the full identity. */}
          <div
            style={{
              padding: "14px 14px 12px",
              borderBottom: "1px solid rgba(255,255,255,0.06)",
            }}
          >
            <div
              style={{
                fontWeight: 600,
                fontSize: "0.82rem",
                color: "rgba(255,255,255,0.95)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
              title={displayName}
            >
              {displayName}
            </div>
            {name && email && name !== email && (
              <div
                style={{
                  marginTop: 2,
                  fontWeight: 400,
                  fontSize: "0.72rem",
                  color: "rgba(255,255,255,0.5)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
                title={email}
              >
                {email}
              </div>
            )}
          </div>

          <div style={{ padding: 6 }}>
            <button
              type="button"
              role="menuitem"
              onClick={goDashboard}
              className="w-full flex items-center gap-2.5 rounded-lg transition-colors hover:bg-white/8"
              style={{
                padding: "9px 10px",
                fontWeight: 500,
                fontSize: "0.82rem",
                color: "rgba(255,255,255,0.9)",
                textAlign: "left",
                background: "transparent",
              }}
            >
              <LayoutDashboard className="w-4 h-4" style={{ color: "#c084fc" }} />
              Dashboard
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={handleSignOut}
              disabled={signingOut}
              className="w-full flex items-center gap-2.5 rounded-lg transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-60"
              style={{
                padding: "9px 10px",
                fontWeight: 500,
                fontSize: "0.82rem",
                color: "rgba(255,255,255,0.85)",
                textAlign: "left",
                background: "transparent",
              }}
            >
              {signingOut ? (
                <Loader2 className="w-4 h-4 animate-spin" style={{ color: "rgba(255,255,255,0.7)" }} />
              ) : (
                <LogOut className="w-4 h-4" style={{ color: "rgba(255,255,255,0.7)" }} />
              )}
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
