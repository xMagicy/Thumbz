import { useState, useRef, useEffect } from "react";
import { LogIn, LogOut, User as UserIcon } from "lucide-react";
import { useUser, useLogout } from "@/hooks/useAuth";

const inter = "'Inter', system-ui, sans-serif";

interface HeaderUserSlotProps {
  onSignInClick: () => void;
}

// Right-side header slot: shows the Sign in button when signed-out, and an
// avatar + popover with sign-out when signed-in. Hidden on small screens to
// match the existing header layout.
export function HeaderUserSlot({ onSignInClick }: HeaderUserSlotProps) {
  const { user, isLoading } = useUser();
  const logout = useLogout();
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close the menu on outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapperRef.current?.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  // While the first /api/auth/me call is in flight we render nothing rather
  // than flashing the Sign in button — keeps the header stable on reload.
  if (isLoading) {
    return <div className="hidden sm:block w-[88px] h-[30px]" aria-hidden />;
  }

  if (!user) {
    return (
      <button
        type="button"
        onClick={onSignInClick}
        className="hidden sm:flex items-center gap-1.5 rounded-full transition-all hover:scale-[1.03] active:scale-[0.98]"
        style={{
          fontFamily: inter,
          fontWeight: 600,
          fontSize: "0.78rem",
          color: "#fff",
          padding: "6px 14px",
          background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
          border: "1px solid rgba(255,255,255,0.14)",
          boxShadow: "0 6px 18px -4px rgba(217,70,239,0.4)",
          letterSpacing: "0.01em",
        }}
      >
        <LogIn className="w-3.5 h-3.5" />
        Sign in
      </button>
    );
  }

  const displayName = user.name?.trim() || user.email.split("@")[0];
  const initial = (displayName[0] ?? "?").toUpperCase();

  return (
    <div ref={wrapperRef} className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => setMenuOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        className="flex items-center gap-2 rounded-full transition-all hover:scale-[1.03] active:scale-[0.98]"
        style={{
          fontFamily: inter,
          fontWeight: 600,
          fontSize: "0.78rem",
          color: "#fff",
          padding: "4px 12px 4px 4px",
          background: "rgba(255,255,255,0.06)",
          border: "1px solid rgba(255,255,255,0.12)",
        }}
      >
        {user.avatarUrl ? (
          <img
            src={user.avatarUrl}
            alt=""
            className="w-6 h-6 rounded-full object-cover"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span
            className="w-6 h-6 rounded-full flex items-center justify-center"
            style={{
              background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
              fontSize: "0.72rem",
              fontWeight: 700,
            }}
          >
            {initial}
          </span>
        )}
        <span className="max-w-[120px] truncate">{displayName}</span>
      </button>

      {menuOpen && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[180px] rounded-xl overflow-hidden z-50"
          style={{
            fontFamily: inter,
            background: "rgba(12,12,22,0.96)",
            border: "1px solid rgba(168,85,247,0.28)",
            boxShadow: "0 20px 40px -10px rgba(0,0,0,0.6)",
          }}
        >
          <div
            className="px-3 py-2.5 flex items-center gap-2"
            style={{ borderBottom: "1px solid rgba(255,255,255,0.06)" }}
          >
            <UserIcon className="w-3.5 h-3.5" style={{ color: "rgba(255,255,255,0.4)" }} />
            <span
              className="truncate"
              style={{
                fontSize: "0.75rem",
                color: "rgba(255,255,255,0.6)",
              }}
              title={user.email}
            >
              {user.email}
            </span>
          </div>

          <button
            type="button"
            role="menuitem"
            disabled={logout.isPending}
            onClick={() => {
              setMenuOpen(false);
              logout.mutate();
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/5 disabled:opacity-60"
            style={{
              fontSize: "0.8rem",
              fontWeight: 500,
              color: "rgba(255,255,255,0.85)",
            }}
          >
            <LogOut className="w-3.5 h-3.5" />
            {logout.isPending ? "Signing out..." : "Sign out"}
          </button>
        </div>
      )}
    </div>
  );
}
