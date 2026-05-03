import { db, thumbnailsTable } from "@workspace/db";
import { and, eq, isNotNull, isNull } from "drizzle-orm";

const YT_BASE = "https://www.googleapis.com/youtube/v3";

interface YtVideosResponse {
  items?: Array<{ id: string; snippet?: { channelId?: string } }>;
  error?: { code: number; message: string };
}

interface YtChannelsResponse {
  items?: Array<{
    id: string;
    snippet?: {
      thumbnails?: {
        default?: { url?: string };
        medium?: { url?: string };
        high?: { url?: string };
      };
    };
  }>;
  error?: { code: number; message: string };
}

async function fetchChannelIdsForVideos(
  apiKey: string,
  videoIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < videoIds.length; i += 50) {
    const batch = videoIds.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/videos`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url);
    const data = (await res.json()) as YtVideosResponse;
    if (data.error) {
      console.error(`[backfill-logos] videos.list error: ${data.error.message}`);
      continue;
    }
    for (const v of data.items ?? []) {
      const cid = v.snippet?.channelId;
      if (cid) out.set(v.id, cid);
    }
  }
  return out;
}

async function fetchLogos(
  apiKey: string,
  ids: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/channels`);
    url.searchParams.set("part", "snippet");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const res = await fetch(url);
    const data = (await res.json()) as YtChannelsResponse;
    if (data.error) {
      console.error(`[backfill-logos] channels.list error: ${data.error.message}`);
      continue;
    }
    for (const ch of data.items ?? []) {
      const logo =
        ch.snippet?.thumbnails?.medium?.url ??
        ch.snippet?.thumbnails?.high?.url ??
        ch.snippet?.thumbnails?.default?.url;
      if (logo) out.set(ch.id, logo);
    }
  }
  return out;
}

async function main() {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    console.error("[backfill-logos] YOUTUBE_API_KEY not set");
    process.exit(1);
  }

  const rows = await db
    .select({
      id: thumbnailsTable.id,
      channelId: thumbnailsTable.channelId,
      youtubeVideoId: thumbnailsTable.youtubeVideoId,
    })
    .from(thumbnailsTable)
    .where(
      and(
        eq(thumbnailsTable.source, "youtube"),
        isNull(thumbnailsTable.channelLogoUrl),
        isNotNull(thumbnailsTable.youtubeVideoId),
      ),
    );

  console.log(`[backfill-logos] rows missing logo: ${rows.length}`);
  if (rows.length === 0) {
    process.exit(0);
  }

  // Phase 1: resolve missing channelIds via videos.list.
  const needsChannelId = rows.filter((r) => !r.channelId && r.youtubeVideoId);
  console.log(
    `[backfill-logos] rows needing channelId resolve: ${needsChannelId.length}`,
  );
  let videoToChannel = new Map<string, string>();
  if (needsChannelId.length > 0) {
    const videoIds = Array.from(
      new Set(
        needsChannelId
          .map((r) => r.youtubeVideoId)
          .filter((v): v is string => Boolean(v)),
      ),
    );
    videoToChannel = await fetchChannelIdsForVideos(apiKey, videoIds);
    console.log(`[backfill-logos] resolved ${videoToChannel.size} channelIds`);

    // Persist newly resolved channelIds.
    for (const r of needsChannelId) {
      if (!r.youtubeVideoId) continue;
      const cid = videoToChannel.get(r.youtubeVideoId);
      if (!cid) continue;
      await db
        .update(thumbnailsTable)
        .set({ channelId: cid })
        .where(eq(thumbnailsTable.id, r.id));
      r.channelId = cid;
    }
  }

  // Phase 2: fetch logos for every distinct channelId.
  const channelIds = Array.from(
    new Set(
      rows.map((r) => r.channelId).filter((id): id is string => Boolean(id)),
    ),
  );
  console.log(`[backfill-logos] unique channels to fetch: ${channelIds.length}`);
  const logos = await fetchLogos(apiKey, channelIds);
  console.log(`[backfill-logos] fetched ${logos.size} logos`);

  let updated = 0;
  for (const row of rows) {
    if (!row.channelId) continue;
    const logo = logos.get(row.channelId);
    if (!logo) continue;
    await db
      .update(thumbnailsTable)
      .set({ channelLogoUrl: logo })
      .where(eq(thumbnailsTable.id, row.id));
    updated += 1;
  }
  console.log(`[backfill-logos] updated ${updated} rows`);
  process.exit(0);
}

main().catch((err) => {
  console.error("[backfill-logos] error", err);
  process.exit(1);
});
