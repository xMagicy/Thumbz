import { Upload } from "lucide-react";

const inter = "'Inter', system-ui, sans-serif";

interface UploadPromoProps {
  onUploadClick: () => void;
}

export function UploadPromo({ onUploadClick }: UploadPromoProps) {
  return (
    <section className="w-full max-w-3xl mx-auto px-6 mt-8 md:mt-10 z-20 relative">
      <div
        className="rounded-2xl relative overflow-hidden flex flex-col md:flex-row md:items-center gap-5 md:gap-7"
        style={{
          padding: "20px 22px",
          background:
            "linear-gradient(135deg, rgba(139,92,246,0.10), rgba(217,70,239,0.06) 65%, rgba(0,0,0,0))",
          border: "1px solid rgba(168,85,247,0.22)",
          boxShadow:
            "0 14px 36px -18px rgba(217,70,239,0.30), inset 0 1px 0 rgba(255,255,255,0.04)",
        }}
      >
        {/* Subtle radial accent */}
        <div
          className="absolute -top-16 -right-16 w-56 h-56 rounded-full pointer-events-none"
          style={{
            background:
              "radial-gradient(closest-side, rgba(217,70,239,0.16), rgba(0,0,0,0) 70%)",
            filter: "blur(18px)",
          }}
        />

        {/* Icon disc */}
        <div
          className="shrink-0 rounded-xl flex items-center justify-center mx-auto md:mx-0"
          style={{
            width: 48,
            height: 48,
            background:
              "linear-gradient(135deg, rgba(168,85,247,0.35), rgba(217,70,239,0.30))",
            border: "1px solid rgba(255,255,255,0.12)",
            boxShadow: "inset 0 1px 0 rgba(255,255,255,0.15)",
          }}
        >
          <Upload className="w-5 h-5 text-white" strokeWidth={2.25} />
        </div>

        {/* Copy block */}
        <div className="flex-1 min-w-0 text-center md:text-left">
          <div className="flex items-center justify-center md:justify-start gap-2 mb-1">
            <span
              className="uppercase"
              style={{
                fontFamily: inter,
                fontWeight: 600,
                fontSize: "0.6rem",
                letterSpacing: "0.16em",
                color: "#c084fc",
              }}
            >
              For creators
            </span>
            <span
              style={{
                width: 3,
                height: 3,
                borderRadius: 999,
                background: "rgba(168,85,247,0.55)",
              }}
            />
            <span
              style={{
                fontFamily: inter,
                fontWeight: 500,
                fontSize: "0.65rem",
                color: "rgba(255,255,255,0.45)",
                letterSpacing: "0.02em",
              }}
            >
              Free during beta
            </span>
          </div>
          <h2
            className="text-white"
            style={{
              fontFamily: inter,
              fontWeight: 700,
              fontSize: "clamp(1.05rem, 1.8vw, 1.25rem)",
              letterSpacing: "-0.018em",
              lineHeight: 1.25,
            }}
          >
            Add your thumbnails to the battle
          </h2>
          <p
            style={{
              fontFamily: inter,
              fontWeight: 400,
              fontSize: "0.85rem",
              color: "rgba(255,255,255,0.6)",
              lineHeight: 1.5,
              marginTop: 4,
            }}
          >
            Test your own thumbnails against the world and watch them rise (or
            fall) in the rankings.
          </p>
        </div>

        {/* CTA */}
        <button
          type="button"
          onClick={onUploadClick}
          className="shrink-0 inline-flex items-center justify-center gap-2 rounded-full transition-all hover:scale-[1.03] active:scale-[0.97] mx-auto md:mx-0"
          style={{
            fontFamily: inter,
            fontWeight: 600,
            fontSize: "0.875rem",
            color: "#fff",
            padding: "10px 18px",
            background: "linear-gradient(135deg, #8b5cf6, #d946ef)",
            border: "1px solid rgba(255,255,255,0.15)",
            boxShadow:
              "0 10px 24px -6px rgba(217,70,239,0.45), inset 0 1px 0 rgba(255,255,255,0.18)",
            letterSpacing: "0.005em",
            whiteSpace: "nowrap",
          }}
        >
          Upload thumbnail
        </button>
      </div>
    </section>
  );
}
