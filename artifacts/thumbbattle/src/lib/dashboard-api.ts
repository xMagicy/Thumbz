// Hand-rolled fetch wrappers for the dashboard-only endpoints. The rest of
// the app uses orval-generated TanStack hooks; the dashboard sits on plain
// fetch + useQuery for now since these routes aren't in the OpenAPI spec yet.

const API_BASE = `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api`;

export interface MyThumbnail {
  id: number;
  title: string;
  imageUrl: string;
  channelName: string;
  niche: string;
  ctr: number | null;
  youtubeUrl: string | null;
  status: string;
  wins: number;
  losses: number;
  eloRating: number;
  winRate: number | null;
  recentRatings: number[];
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function fetchMyThumbnails(): Promise<MyThumbnail[]> {
  const res = await fetch(`${API_BASE}/thumbnails/mine`, { credentials: "include" });
  return asJson<MyThumbnail[]>(res);
}

export async function updateThumbnailCtr(
  thumbnailId: number,
  ctr: number | null,
): Promise<MyThumbnail> {
  const res = await fetch(`${API_BASE}/thumbnails/${thumbnailId}/ctr`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ctr }),
  });
  return asJson<MyThumbnail>(res);
}
