import { Upload } from "lucide-react";

const inter = "'Inter', system-ui, sans-serif";

interface UploadPromoProps {
  onUploadClick: () => void;
}

export function UploadPromo({ onUploadClick }: UploadPromoProps) {
  return (
    <section className="w-full max-w-3xl mx-auto px-6 mt-16 z-20 relative">
      <div
        className="rounded-3xl px-8 py-10 md:px-12 md:py-12 relative overflow-hidden"
        style={{
          background:
            "linear-gradient(135deg, rgba(139,92,246,0.12), rgba(217,70,239,0.08) 60%, rgba(0,0,0,0.0))",
          border: "1px solid rgba(168,85,247,0.25)",
          boxShadow:
            "0 20px 50px -20px rgba(217,70,239,0.35), inset 0 1px 0 rgba(255,255,255,0.05)",
        }}
      >
        {/* Subtle radial accent */}
        <div
          className="absolute -top-20 -right-20 w-72 h-72 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.18), rgba(0,0,0,0) 70%)",
            filter: "blur(20px)",
          }}
        />

        <div className="flex flex-col items-center text-center gap-3 relative">
          <span
            className="uppercase"
            style={{
              fontFamily: inter,
              fontWeight: 600,
              fontSize: "0.7rem",
              letterSpacing: "0.14em",
              color: "#c084fc",
              background: "rgba(168, 85, 247, 0.15)",
              border: "1px solid rgba(168, 85, 247, 0.35)",
              padding: "4px 10px",
              borderRadius: "9999px",
              lineHeight: 1,
            }}
          >
            For creators
          </span>

          <h2
            className="text-white"
            style={{
              fontFamily: inter,
              fontWeight: 800,
              fontSize: "clamp(1.4rem, 2.4vw, 1.85rem)",
              letterSpacing: "-0.02em",
              lineHeight: 1.2,
              maxWidth: 560,
            }}
          >
            Add your thumbnails to the battle
          </h2>

          <p
            style={{
              fontFamily: inter,
              fontWeight: 400,
              fontSize: "0.95rem",
              color: "rgba(255,255,255,0.65)",
              lineHeight: 1.55,
              maxWidth: 520,
              marginTop: 2,
            }}
          >
            Want to test your own thumbnails against the world? Upload them and watch them
            rise (or fall) in the rankings.
          </p>

          <button
            type="button"
            onClick={onUploadClick}
            className="mt-5 inline-flex items-center gap-2 rounded-full transition-all hover:scale-[1.025] active:scale-[0.98]"
            style={{
              fontFamily: inter,
              fontWeight: 600,
              fontSize: "0.95rem",
              color: "#fff",
              padding: "12px 22px",
              background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
              border: "1px solid rgba(255,255,255,0.15)",
              boxShadow:
                "0 14px 32px -8px rgba(217,70,239,0.45), inset 0 1px 0 rgba(255,255,255,0.18)",
              letterSpacing: "0.005em",
            }}
          >
            <Upload className="w-4 h-4" />
            Upload your thumbnail
          </button>

          <div
            className="mt-3"
            style={{
              fontFamily: inter,
              fontWeight: 500,
              fontSize: "0.78rem",
              color: "rgba(255,255,255,0.45)",
              letterSpacing: "0.01em",
            }}
          >
            Free during beta · No account required to vote
          </div>
        </div>
      </div>
    </section>
  );
}
