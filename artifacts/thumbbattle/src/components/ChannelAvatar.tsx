import { useEffect, useState } from "react";

interface ChannelAvatarProps {
  channelName: string;
  channelLogoUrl?: string | null;
  size?: number;
}

const INTER = "'Inter', system-ui, sans-serif";

/**
 * Round channel avatar. Renders the YouTube channel logo when we have one
 * (YouTube-sourced rows post task #18); falls back to a purple gradient
 * bubble with the channel's initial for user uploads or rows whose logo
 * hasn't been backfilled yet. The fallback also kicks in when the image
 * fails to load (deleted channel, signed-URL expiry, etc) so the row
 * never renders a broken-image icon next to the channel name.
 */
export function ChannelAvatar({
  channelName,
  channelLogoUrl,
  size = 22,
}: ChannelAvatarProps) {
  const [errored, setErrored] = useState(false);
  // Reset the failed-image flag whenever the URL itself changes — otherwise
  // a single failed load (e.g. a transient 5xx from googleusercontent) would
  // permanently lock this component instance into fallback mode even after
  // a valid new logo is passed in via prop changes / list re-render.
  useEffect(() => {
    setErrored(false);
  }, [channelLogoUrl]);
  const showImage = Boolean(channelLogoUrl) && !errored;
  const initial = (channelName?.[0] ?? "?").toUpperCase();
  const fontSize = Math.max(9, Math.round(size * 0.5));

  return (
    <span
      aria-hidden
      className="shrink-0 rounded-full overflow-hidden inline-flex items-center justify-center"
      style={{
        width: size,
        height: size,
        background: showImage
          ? "rgba(255,255,255,0.04)"
          : "linear-gradient(135deg, rgba(168,85,247,0.55), rgba(217,70,239,0.55))",
        border: "1px solid rgba(255,255,255,0.18)",
        fontFamily: INTER,
        fontWeight: 700,
        fontSize,
        color: "#fff",
        lineHeight: 1,
      }}
    >
      {showImage ? (
        <img
          src={channelLogoUrl ?? undefined}
          alt=""
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setErrored(true)}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            display: "block",
          }}
        />
      ) : (
        initial
      )}
    </span>
  );
}
