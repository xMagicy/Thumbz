// Hand-rolled fetch wrappers for the dashboard endpoints. The rest of the
// app uses the orval-generated TanStack hooks, but those routes still need
// codegen — we keep dashboard data on plain fetch + useQuery for now and
// can migrate later when the OpenAPI spec is updated.

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
}

export interface EloHistoryPoint {
  id: number;
  eloRating: number;
  recordedAt: string;
}

async function asJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status}: ${detail || res.statusText}`);
  }
  return (await res.json()) as T;
}

export async function fetchMyThumbnails(): Promise<MyThumbnail[]> {
  const res = await fetch("/api/thumbnails/mine", { credentials: "include" });
  return asJson<MyThumbnail[]>(res);
}

export async function fetchEloHistory(thumbnailId: number): Promise<EloHistoryPoint[]> {
  const res = await fetch(`/api/thumbnails/${thumbnailId}/elo-history`, {
    credentials: "include",
  });
  return asJson<EloHistoryPoint[]>(res);
}

export async function updateThumbnailCtr(
  thumbnailId: number,
  ctr: number | null,
): Promise<MyThumbnail> {
  const res = await fetch(`/api/thumbnails/${thumbnailId}/ctr`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ctr }),
  });
  return asJson<MyThumbnail>(res);
}
