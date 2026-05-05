import {
  db,
  thumbnailsTable,
  viewSnapshotsTable,
  type Thumbnail,
} from "@workspace/db";
import { and, eq, sql, lt, gte, isNotNull } from "drizzle-orm";
import { logger } from "./logger";

/**
 * YouTube sourcing v2 — Blok A + E + F (per herziening brief).
 *
 *   1. mostPopular.list across 12 regions          → globally trending
 *   2. search.list per under-served category       → cold-start fillers
 *   3. videos.list to enrich search hits           → snippet+stats+contentDetails
 *   4. channels.list to fetch subscriberCount      → drives overperformer ratio
 *   5. Quality gate (recency, duration, views,
 *      engagement, overperformer, channel-name
 *      patterns, lyric exclusion, maxres-only)
 *   6. Hybrid classifier (categoryId + title
 *      keywords + channel patterns) → app_category
 *   7. Channel cap (≤2 per channelId)
 *   8. Topic diversity (Jaccard < 0.4 cluster cap 5)
 *   9. Region balance (≤25% per primary region)
 *  10. Upsert + view-snapshot
 *  11. Category balance archive (≤20% per category)
 *
 * Quota math (per sync run):
 *   12 mostPopular        ×   1 unit   =  12
 *    4 search.list        × 100 units  = 400
 *    4 videos.list (enrich)× 1 unit    =   4
 *   ~600 channels in batches of 50 → 12 calls × 1 = 12
 *   Total ≈ 428 units / sync × 4 syncs/day = 1712 / 10000 daily quota.
 */

const YT_BASE = "https://www.googleapis.com/youtube/v3";

const REGIONS = [
  "US", "GB", "IN", "BR", "JP", "DE",
  "KR", "MX", "FR", "CA", "AU", "ID",
] as const;

// Targeted search queries to fill structurally under-represented buckets.
// Each entry is one search.list call (100 quota units). Keep the list
// short — the most expensive part of the sync.
const TARGETED_SEARCHES: Array<{
  category: string;
  q: string;
  videoCategoryId?: string;
}> = [
  { category: "Finance", q: "investing OR stocks OR money OR crypto" },
  { category: "Lifestyle", q: "morning routine OR aesthetic OR day in my life" },
  { category: "Tutorial", q: "how to OR tutorial", videoCategoryId: "26" },
];

// Ronde 3 Blok 3: trend-spotting search queries. Each is a separate
// search.list call (100 quota units), ordered by viewCount with a
// per-query freshness window, to catch viral newcomers in opkomende
// niches before they show up in mostPopular.
const TRENDING_SEARCHES: Array<{ q: string; minDays: number }> = [
  { q: "viral", minDays: 7 },
  { q: "trending OR viral now", minDays: 3 },
  { q: "everyone is talking about", minDays: 7 },
  { q: "what happened to", minDays: 14 },
  { q: "the truth about", minDays: 14 },
];

// Channel-name pattern blocklist. These channels are usually labels,
// movie studios, news networks, brands or kids/franchise factories
// where the brand pulls the views, not the thumbnail. Matched as whole
// words (\b…\b) so a creator who happens to have e.g. "Apple" in their
// channel name as part of a longer word isn't auto-rejected.
//
// Order doesn't matter — the regex is a flat alternation. Edits should
// keep entries case-insensitive (the /i flag does the lifting).
// Brand-name blocklist: match as whole word ANYWHERE in channel name.
// These are specific corporate channels, not generic suffixes.
//
// Ronde 3 Blok 2: removed TV, Media, Channel, Official — too many false
// positives (Vsauce TV, Linus Media Group, Casey Neistat-style "Channel"
// suffixes, Official remixes). Generic suffixes (Studios/Pictures/...)
// moved to CHANNEL_NAME_SUFFIX_BLOCKLIST below.
const CHANNEL_BLOCKLIST_TERMS = [
  // Movie / TV studios
  "Marvel", "Disney", "Pixar", "DreamWorks", "Warner Bros", "Universal",
  "Paramount", "Sony Pictures", "Lionsgate", "A24", "Searchlight",
  "Focus Features", "MGM", "20th Century", "Fox",
  // Streaming services
  "Netflix", "HBO", "Hulu", "Prime Video", "Apple TV", "Peacock", "Max",
  "Disney+", "Discovery", "Paramount+",
  // News networks
  "CNN", "Fox News", "MSNBC", "BBC News", "Sky News", "NBC", "ABC",
  "CBS", "ESPN", "Bloomberg", "CNBC", "Reuters", "AP", "Al Jazeera",
  // Music labels
  "Atlantic", "Capitol", "Columbia", "Republic", "Def Jam", "Interscope",
  "RCA", "Warner Music", "Sony Music", "Universal Music",
  // Kids / animation factories
  "Cocomelon", "Pinkfong", "Kids Diana", "Vlad and Niki", "Like Nastya",
  "Ryan's World",
  // Sports leagues / broadcasters
  "NBA", "NFL", "NHL", "MLB", "FIFA", "UEFA", "F1", "Sky Sports",
  // Brand channels
  "Apple", "Samsung", "Google", "Microsoft", "Coca-Cola", "Pepsi",
  "Nike", "Adidas", "McDonald's", "Tesla",
  // Trailer-channel signals — multi-word phrases unlikely to false-positive.
  "Entertainment Group", "Media Group", "Music Group", "Animation",
  "Concept", "Trailers", "Movieclips", "Movie Network", "Movies",
];
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
const CHANNEL_NAME_BLOCKLIST = new RegExp(
  `\\b(${CHANNEL_BLOCKLIST_TERMS.map(escapeRegex).join("|")})\\b`,
  "i",
);
// Generic-suffix blocklist: match ONLY when the channel name ENDS with
// one of these words. Catches "Foo Studios", "Bar Pictures", "Baz
// Shorts" while letting channels with these tokens earlier in the name
// (e.g. "Studios Quarter Reviews") through. Trailing punctuation/space
// tolerated.
const CHANNEL_NAME_SUFFIX_BLOCKLIST =
  /\b(Studios|Pictures|Films|Productions|Records|VEVO|Network|Shorts|TikTok|Reels)\s*[!.]?\s*$/i;

// Excluded YouTube category IDs.
//   1  = Film & Animation (movie trailers, studio-driven)
//   10 = Music (officially removed from the app — labels dominate the
//        space and we deliberately don't compete on music thumbnails;
//        see Music removal in Blok H spec)
const EXCLUDED_CATEGORIES = new Set(["1", "10"]);

// Hard subscriber ceiling. Above this, channels are essentially always
// corporate aggregators (T-Series, SET India, Cocomelon) or mega-creators
// where the audience picks the video, not the thumbnail. MrBeast (350M)
// gets filtered here too — that's a deliberate scoping choice, not a bug.
const MAX_SUBSCRIBER_COUNT = 50_000_000;

// ─── Blok E classifier dictionaries ──────────────────────────────────
// Order: Gaming → Music → Finance → Tech → Tutorial → Lifestyle → Vlog → Other.
// First match wins. Keywords are lowercased; the title we compare against
// is also lowercased. Use ` term ` with leading/trailing spaces if you
// need a strict word boundary (e.g. " vs " to avoid matching "advert").

const GAMING_TITLE_KEYWORDS = [
  // Game titles
  "minecraft", "fortnite", "roblox", "brookhaven", "gta", "valorant",
  "league of legends", "lol", "dota", "brawl stars", "brawler",
  "clash royale", "clash of clans", "pokemon", "zelda", "mario", "sonic",
  "fifa", "nba 2k", "madden", "call of duty", "cod", "warzone",
  "apex legends", "overwatch", "counter-strike", "csgo", "cs2",
  "rocket league", "fall guys", "among us", "the sims", "animal crossing",
  "smash bros", "splatoon", "terraria", "stardew valley", "hollow knight",
  "elden ring", "dark souls", "baldur's gate", "cyberpunk", "witcher",
  // Gaming verbs
  "gameplay", "speedrun", "let's play", "playthrough", "boss fight",
  "walkthrough", "no commentary", "hardcore mode", "raid", "pvp", "ranked",
  "esports", "tournament", "battle pass", "season pass", "mod showcase",
  "devlog", "twitch highlights",
];
const GAMING_CHANNEL_SUFFIXES = ["plays", "gaming", "gamer", "gg", "esports", "tft"];
const GAMING_CHANNEL_CONTAINS = ["plays", "gaming", "gamer"];

const MUSIC_AUDIO_EXCLUSIONS = [
  "lyric", "lyrics", "official audio", "audio only", "slowed", "reverb",
  "8d audio", "1 hour", "hours of", "sleep music", "study music",
  "lo-fi to study", "lofi study", "white noise",
];
const MUSIC_POSITIVE_KEYWORDS = [
  "official music video", "official mv", "music video", "official video",
  "vevo presents", "ft.", "feat.", "remix", "cover", "acoustic",
  "live performance", "tiny desk", "npr music", "kexp",
];

const FINANCE_TITLE_KEYWORDS = [
  "stocks", "stock market", "investing", "invest", "dividend", "dividends",
  "s&p 500", "nasdaq", "dow jones", "bitcoin", "btc", "crypto", "ethereum",
  "eth", "etf", "index fund", "mutual fund", "bonds", "treasury",
  "real estate", "reit", "passive income", "wealth", "wealthy",
  "millionaire", "broke", "salary", "paycheck", "rent", "mortgage", "debt",
  "student loan", "credit score", "retirement", "401k", "ira", "roth",
  "fire movement", "financial freedom", "financial independence", "frugal",
  "saving money", "budget", "budgeting",
];
const FINANCE_CHANNELS = new Set(
  [
    "Graham Stephan", "Andrei Jikh", "Coffeezilla", "How Money Works",
    "The Plain Bagel", "Patrick Boyle", "Ben Felix", "The Money Guy",
    "Humphrey Yang", "Nate O'Brien", "Erika Kullberg", "Money With Katie",
    "Two Cents", "Caleb Hammer", "Dave Ramsey", "Robert Kiyosaki",
  ].map((s) => s.toLowerCase()),
);

const TECH_TITLE_KEYWORDS = [
  "iphone", "android", "samsung galaxy", "google pixel", "macbook", "ipad",
  "apple watch", "m1 chip", "m2 chip", "m3 chip", "m4 chip", "intel core",
  "amd ryzen", "nvidia rtx", "gpu", "custom pc", "gaming pc", "build pc",
  "review", "unboxing", "hands-on", "ai chatbot", "gpt", "chatgpt", "openai",
  "claude", "gemini", "copilot", "llm", "machine learning", "javascript",
  "python", "react", "swift", "kubernetes", "docker", "aws", "gcp", "azure",
  "devops", "programming tutorial", "coding interview",
];
const TECH_CHANNEL_SUFFIXES = ["tech", "reviews"];
const TECH_CHANNEL_CONTAINS = [
  "mkbhd", "linus tech", "marques brownlee", "dave2d", "jerryrigeverything",
];

const TUTORIAL_TITLE_KEYWORDS = [
  "how to", "tutorial", "guide", "learn", "step by step", "explained",
  "beginner's guide", "masterclass", "course", "lesson", "fundamentals",
  "the basics of", "deep dive", "introduction to", "complete guide",
  "ultimate guide", "in 10 minutes", "in 5 minutes",
];

const LIFESTYLE_TITLE_KEYWORDS = [
  "morning routine", "night routine", "day in my life", "day in the life",
  "ditl", "week in my life", "outfit", "ootd", "fashion", "skincare",
  "makeup", "beauty", "fitness", "workout", "gym", "home gym", "diet",
  "what i eat", "meal prep", "recipe", "cooking", "baking", "minimalism",
  "declutter", "organize", "clean with me", "productivity", "journaling",
  "self care", "wellness", "aesthetic", "cottagecore", "dark academia",
  "room tour", "apartment tour", "house tour", "garden", "plants",
  "sustainable", "slow living",
];

const VLOG_TITLE_KEYWORDS = [
  "vlog", "daily vlog", "weekly vlog", "trip to", "travel vlog",
  "traveling to", "moving to", "moved out", "life update", "came back",
  "story time", "storytime", "draw my life", "q&a", "qna",
  "behind the scenes", "last week", "last month", "my first time",
];

function anyContains(haystack: string, needles: string[]): boolean {
  for (const n of needles) if (haystack.includes(n)) return true;
  return false;
}
function anyEndsWith(haystack: string, suffixes: string[]): boolean {
  for (const s of suffixes) if (haystack.endsWith(s)) return true;
  return false;
}

interface YtThumbnail {
  url: string;
  width?: number;
  height?: number;
}

interface YtVideo {
  id: string;
  snippet?: {
    publishedAt: string;
    title: string;
    description?: string;
    channelId: string;
    channelTitle: string;
    categoryId?: string;
    tags?: string[];
    thumbnails?: {
      default?: YtThumbnail;
      medium?: YtThumbnail;
      high?: YtThumbnail;
      standard?: YtThumbnail;
      maxres?: YtThumbnail;
    };
  };
  statistics?: {
    viewCount?: string;
    likeCount?: string;
  };
  contentDetails?: {
    duration?: string;
  };
}

// Zero-tolerance Shorts detection (task #19). One regex used by both the
// title and the description check. Matches optional leading `#`, the
// usual Shorts/Reels aliases, and TikTok cross-post markers, with a word
// boundary so we don't false-positive on substrings like "shortcut".
const SHORTS_TEXT_PATTERN =
  /#?(shorts|short|ytshorts|youtubeshorts|yshort|reel|reels|tiktok)\b/i;
// Hashtag-only Shorts markers — without the leading `#` these would
// false-positive on long-form content (e.g. "POV cameras explained" or
// "viral marketing"), so we require the hashtag form. Caught after the
// generic SHORTS_TEXT_PATTERN.
const SHORTS_HASHTAG_PATTERN = /#(pov|fyp|foryou|foryoupage)\b/i;
const SHORTS_TAG_PATTERN = /(short|reel)/i;

// Best landscape-vs-portrait signal we have. maxres is preferred (most
// accurate aspect for valid long-form), falls back to high so we still
// catch Shorts when maxres is missing on the rare borderline video.
function pickAspectThumbnail(v: YtVideo): YtThumbnail | null {
  return (
    v.snippet?.thumbnails?.maxres ?? v.snippet?.thumbnails?.high ?? null
  );
}

// ─── Trailer / commercial content detection (urgent patch) ────────────
// Six independent signals; a single match rejects the video. Same
// zero-tolerance posture as the Shorts gate — we'd rather over-reject a
// few legit creator videos than ship one movie-trailer thumbnail.
const TRAILER_TITLE_PATTERN =
  /\b(trailer|teaser|first look|sneak peek|coming soon|in theaters|now streaming|premieres?|official trailer|concept trailer|fan trailer|behind the scenes)\b/i;
// Year-in-parens patterns: catches "Knight Rider Rebirth (2026) | Concept
// Trailer", "Concept Trailer (2026)", etc. Two regexes because the year
// can sit on either side of the trailer keyword.
const TRAILER_YEAR_BEFORE_PATTERN =
  /\(\d{4}\).*(trailer|teaser|first look)/i;
const TRAILER_YEAR_AFTER_PATTERN =
  /(trailer|teaser|first look).*\(\d{4}\)/i;
// Cast-list pattern: "Jensen Ackles, Mads Mikkelsen, Scarlett Johansson"
// — two consecutive Capitalized two-word names separated by a comma.
// Almost exclusively a movie/show cast announcement.
const CAST_LIST_PATTERN =
  /[A-Z][a-z]+ [A-Z][a-z]+,\s*[A-Z][a-z]+ [A-Z][a-z]+/;
// Description markers — copyright/distribution language that virtually
// only appears on commercial content.
const COMMERCIAL_DESCRIPTION_PATTERN =
  /\b(in theaters|streaming on|now playing|available now|releases on|premieres on|catch (it|him|her) on|presented by|sponsored by|in association with|all rights reserved)\b/i;

// Filter 7 thresholds (logging only, not auto-skip): movie/trailer
// channels have low subs but viral single-video views.
const SUSPECT_VIEW_THRESHOLD = 10_000_000;
const SUSPECT_SUB_THRESHOLD = 1_000_000;

interface YtListResponse {
  items?: YtVideo[];
  error?: { code: number; message: string };
}

interface YtSearchItem {
  id: { kind: string; videoId?: string };
}

interface YtSearchResponse {
  items?: YtSearchItem[];
  error?: { code: number; message: string };
}

interface YtChannel {
  id: string;
  snippet?: {
    publishedAt?: string;
    thumbnails?: {
      default?: { url?: string };
      medium?: { url?: string };
      high?: { url?: string };
    };
  };
  statistics?: { subscriberCount?: string; hiddenSubscriberCount?: boolean };
}

interface YtChannelsResponse {
  items?: YtChannel[];
  error?: { code: number; message: string };
}

// ─── Helpers ──────────────────────────────────────────────────────────

function parseIsoDuration(iso: string | undefined): number | null {
  if (!iso) return null;
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso);
  if (!m) return null;
  const h = m[1] ? Number(m[1]) : 0;
  const min = m[2] ? Number(m[2]) : 0;
  const s = m[3] ? Number(m[3]) : 0;
  return h * 3600 + min * 60 + s;
}

function pickMaxresThumbnail(v: YtVideo): string | null {
  // Brief A: skip if maxres ontbreekt. Maxres-only, no fallback.
  return v.snippet?.thumbnails?.maxres?.url ?? null;
}

const STOP_WORDS = new Set([
  "the", "and", "for", "with", "this", "that", "you", "your", "are", "but",
  "from", "all", "his", "her", "they", "them", "was", "not", "have", "has",
  "official", "video", "trailer", "ft", "feat",
]);

function tokenize(title: string): Set<string> {
  const matches = title.toLowerCase().match(/\b[a-z0-9]{3,}\b/g) ?? [];
  return new Set(matches.filter((t) => !STOP_WORDS.has(t)));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

// ─── Hybrid classifier (Blok E v2) ───────────────────────────────────
//
// Order: Gaming → Music → Finance → Tech → Tutorial → Lifestyle → Vlog
// → Other. First match wins. Returns app_category + confidence.
//
// Confidence:
//   high   = categoryId match + at least one keyword/channel signal
//   medium = keyword match without supporting categoryId
//   low    = channel-pattern match only, OR catchall (Other)
type Confidence = "high" | "medium" | "low";

function classify(v: YtVideo): { category: string; confidence: Confidence } {
  const snippet = v.snippet;
  if (!snippet) return { category: "Other", confidence: "low" };
  const title = (snippet.title ?? "").toLowerCase();
  const channel = (snippet.channelTitle ?? "").toLowerCase();
  const cat = snippet.categoryId;

  // 1. Gaming
  {
    const catMatch = cat === "20";
    const kwMatch = anyContains(title, GAMING_TITLE_KEYWORDS);
    const chSuffix = anyEndsWith(channel, GAMING_CHANNEL_SUFFIXES);
    const chContain = anyContains(channel, GAMING_CHANNEL_CONTAINS);
    if (catMatch || kwMatch || chSuffix || chContain) {
      const conf: Confidence = catMatch && (kwMatch || chSuffix || chContain)
        ? "high"
        : catMatch
          ? "high" // category 20 alone is strong evidence
          : kwMatch
            ? "medium"
            : "low";
      return { category: "Gaming", confidence: conf };
    }
  }

  // 2. Music — REMOVED (Blok H). categoryId=10 is now in
  //    EXCLUDED_CATEGORIES so music videos never reach the classifier
  //    in the first place. The MUSIC_* keyword arrays are kept above as
  //    documentation of the previous heuristic in case it's ever
  //    revived; they're unused at runtime.

  // 3. Finance
  {
    const kwMatch = anyContains(title, FINANCE_TITLE_KEYWORDS);
    const chMatch = FINANCE_CHANNELS.has(channel);
    if (kwMatch || chMatch) {
      const conf: Confidence = kwMatch ? "medium" : "low";
      return { category: "Finance", confidence: conf };
    }
  }

  // 4. Tech
  {
    const catMatch = cat === "28";
    const kwMatch = anyContains(title, TECH_TITLE_KEYWORDS);
    const chSuffix = anyEndsWith(channel, TECH_CHANNEL_SUFFIXES);
    const chContain = anyContains(channel, TECH_CHANNEL_CONTAINS);
    if (catMatch || kwMatch || chSuffix || chContain) {
      const conf: Confidence = catMatch && (kwMatch || chSuffix || chContain)
        ? "high"
        : catMatch
          ? "high"
          : kwMatch
            ? "medium"
            : "low";
      return { category: "Tech", confidence: conf };
    }
  }

  // 5. Tutorial
  {
    const catMatch = cat === "26" || cat === "27";
    const kwMatch = anyContains(title, TUTORIAL_TITLE_KEYWORDS);
    if (catMatch || kwMatch) {
      const conf: Confidence = catMatch && kwMatch
        ? "high"
        : catMatch
          ? "high"
          : "medium";
      return { category: "Tutorial", confidence: conf };
    }
  }

  // 6. Lifestyle (must be People & Blogs AND lifestyle keyword)
  {
    if (cat === "22" && anyContains(title, LIFESTYLE_TITLE_KEYWORDS)) {
      return { category: "Lifestyle", confidence: "high" };
    }
  }

  // 7. Vlog (People & Blogs OR Entertainment AND vlog keyword)
  {
    if ((cat === "22" || cat === "24") && anyContains(title, VLOG_TITLE_KEYWORDS)) {
      return { category: "Vlog", confidence: "high" };
    }
  }

  // 8. Other (catchall)
  return { category: "Other", confidence: "low" };
}

// ─── Quality gate (Blok A) ────────────────────────────────────────────

const NOW_TS = () => Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

interface CandidateMeta {
  video: YtVideo;
  primaryRegion: string;        // first region we saw it in this sync
  trendingRegions: Set<string>; // all regions where it trended
  fromSearch: boolean;
}

function passesPreClassifierFilters(
  v: YtVideo,
  subscriberCount: number | null,
): string | null {
  const snippet = v.snippet;
  const stats = v.statistics;
  if (!snippet || !stats) return "missing_metadata";
  if (snippet.categoryId && EXCLUDED_CATEGORIES.has(snippet.categoryId)) {
    return "excluded_category";
  }
  if (
    snippet.channelTitle &&
    (CHANNEL_NAME_BLOCKLIST.test(snippet.channelTitle) ||
      CHANNEL_NAME_SUFFIX_BLOCKLIST.test(snippet.channelTitle))
  ) {
    return "channel_blocklist";
  }

  // ─── Zero-tolerance trailer / commercial gate (urgent patch) ─────────
  // Same posture as the Shorts gate: each signal gets its own skip-reason
  // so per-reason telemetry stays useful, and the cheapest text checks
  // run first. Placed before the duration/view/velocity gates so even a
  // viral trailer with great velocity still gets cleanly attributed.
  const title = snippet.title;
  if (TRAILER_TITLE_PATTERN.test(title)) return "trailer_title_keyword";
  if (
    TRAILER_YEAR_BEFORE_PATTERN.test(title) ||
    TRAILER_YEAR_AFTER_PATTERN.test(title)
  ) {
    return "trailer_year_pattern";
  }
  // Ronde 3 Blok 2: CAST_LIST_PATTERN dropped — too many false positives
  // on legit panel-discussion / collab titles. Trailer detection now relies
  // on TRAILER_TITLE_PATTERN + year patterns + commercial description +
  // category-1 exclusion + channel blocklist, which together already cover
  // every confirmed trailer regression we've shipped.
  void CAST_LIST_PATTERN;
  if (
    snippet.description &&
    COMMERCIAL_DESCRIPTION_PATTERN.test(snippet.description)
  ) {
    return "trailer_commercial_description";
  }
  // CategoryId 1 (Film & Animation) is already in EXCLUDED_CATEGORIES
  // above. Filter 6 extension: also reject categoryId 24 (Entertainment)
  // when the title carries a trailer keyword — keeps regular Entertainment
  // creators in the pool but kills the "uploaded under Entertainment to
  // dodge the Film&Animation block" workaround that movie channels use.
  if (
    snippet.categoryId === "24" &&
    TRAILER_TITLE_PATTERN.test(title)
  ) {
    return "trailer_entertainment_category";
  }
  // Filter 7 (logging only — not a skip). Channels with <1M subs but a
  // single video over 10M views are a textbook trailer/aggregator
  // pattern. We don't auto-skip because legit creator breakouts hit the
  // same shape (which is exactly the signal this product is designed to
  // surface), but we want a paper trail when it happens.
  const viewsForCheck = Number(stats.viewCount);
  if (
    Number.isFinite(viewsForCheck) &&
    viewsForCheck > SUSPECT_VIEW_THRESHOLD &&
    subscriberCount !== null &&
    subscriberCount < SUSPECT_SUB_THRESHOLD
  ) {
    logger.warn(
      {
        videoId: v.id,
        title,
        channelTitle: snippet.channelTitle,
        viewCount: viewsForCheck,
        subscriberCount,
      },
      "Suspect trailer/aggregator pattern (low subs, viral single video)",
    );
  }

  const publishedAt = new Date(snippet.publishedAt).getTime();
  if (!Number.isFinite(publishedAt)) return "bad_publish_date";
  const ageMs = NOW_TS() - publishedAt;
  if (ageMs > 14 * DAY_MS) return "too_old";
  if (ageMs < 0) return "future_publish_date";

  const durationSec = parseIsoDuration(v.contentDetails?.duration);
  if (durationSec === null) return "no_duration";

  // ─── Zero-tolerance Shorts gate (task #19) ───────────────────────────
  // Five independent signals; a single match rejects the video. The
  // duration floor at 180s (= YouTube's max Shorts length) deliberately
  // sacrifices legitimate sub-3-min content — the "no Shorts in pool"
  // promise is more important than catching every short tutorial.
  // These run BEFORE the generic `no_maxres` rejection so each signal
  // gets its own slot in the per-reason skip telemetry; without that
  // ordering, every no-maxres Short would silently fall into the
  // `no_maxres` bucket and we'd lose visibility into why we rejected it.
  if (durationSec <= 180) return "shorts_duration";

  // Title OR description hashtag/marker check.
  if (SHORTS_TEXT_PATTERN.test(snippet.title)) return "shorts_title_marker";
  if (SHORTS_HASHTAG_PATTERN.test(snippet.title)) return "shorts_title_hashtag";
  if (
    snippet.description &&
    (SHORTS_TEXT_PATTERN.test(snippet.description) ||
      SHORTS_HASHTAG_PATTERN.test(snippet.description))
  ) {
    return "shorts_description_marker";
  }

  // Aspect ratio: reject if portrait/square. Uses maxres → high fallback
  // because maxres is sometimes missing on borderline videos. Done before
  // the generic no_maxres rejection so the `high` fallback can actually
  // do its job for no-maxres-but-still-clearly-vertical videos.
  const aspectThumb = pickAspectThumbnail(v);
  if (
    aspectThumb &&
    typeof aspectThumb.width === "number" &&
    typeof aspectThumb.height === "number" &&
    aspectThumb.width > 0 &&
    aspectThumb.height >= aspectThumb.width
  ) {
    return "shorts_vertical_thumbnail";
  }

  // Tag array check. snippet.tags can be undefined or empty — both fine.
  if (snippet.tags && snippet.tags.length > 0) {
    for (const tag of snippet.tags) {
      if (SHORTS_TAG_PATTERN.test(tag)) return "shorts_tag";
    }
  }

  // Filter 5 from the spec: no maxres + sub-4-min = treat as Short. This
  // catches the residual case where a vertical video sneaks through with
  // a square-ish `high` thumb but no maxres — YouTube only generates
  // maxres for properly-rendered landscape uploads above a certain
  // bitrate, so its absence on short videos is itself a strong Shorts
  // signal. Has its own skip-reason so it stays visible in telemetry.
  if (!pickMaxresThumbnail(v) && durationSec < 240) {
    return "shorts_no_maxres_under_240";
  }

  // Generic quality gate for the >=240s case (Brief A: maxres-only, no
  // fallback). Now reached only by long-form videos missing maxres,
  // which is the original "low-quality upload" case this rule existed
  // for before the Shorts work piggybacked on it.
  if (!pickMaxresThumbnail(v)) return "no_maxres";

  const views = Number(stats.viewCount);
  if (!Number.isFinite(views)) return "below_min_views";

  // Ronde 3 Blok 3: tiered velocity gate — relax thresholds for breakouts
  // still in their first 72h (where total views haven't compounded yet
  // but vph is already a strong trend signal).
  //   <72h old : ≥10k views AND ≥200 vph
  //   ≥72h old : ≥25k views AND ≥500 vph
  const ageHours = Math.max(1, ageMs / (60 * 60 * 1000));
  const isYoung = ageHours < 72;
  const minViews = isYoung ? 10_000 : 25_000;
  const minVph = isYoung ? 200 : 500;
  if (views < minViews) return "below_min_views";
  const vph = views / ageHours;
  if (vph < minVph) return "below_min_velocity";

  const likes = Number(stats.likeCount);
  if (!Number.isFinite(likes)) return "no_like_count";
  const engagement = likes / views;
  if (engagement < 0.02) return "low_engagement";

  // Blok H: hard subscriber ceiling. Above 50M ≈ always corporate or
  // mega-creator territory where the thumbnail no longer drives the
  // click. Whitelisting can opt specific channels back in later.
  if (subscriberCount !== null && subscriberCount > MAX_SUBSCRIBER_COUNT) {
    return "above_sub_cap";
  }

  // Blok G: tiered overperformer threshold replaces the flat ratio check.
  // Channels with hidden subs (subscriberCount === 0) get the <1k bucket
  // (just need 10k views) — generous, but honest given we can't compute
  // a ratio for them.
  const subs = subscriberCount ?? 0;
  if (!passesTieredRatio(views, subs)) return "below_overperform_ratio";

  return null;
}

// ─── API fetchers ─────────────────────────────────────────────────────

async function fetchJson<T>(url: URL): Promise<T> {
  const res = await fetch(url.toString());
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`YouTube API ${res.status}: ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as T & { error?: { code: number; message: string } };
  if (data.error) {
    throw new Error(`YouTube API error ${data.error.code}: ${data.error.message}`);
  }
  return data;
}

async function fetchMostPopular(apiKey: string, region: string): Promise<YtVideo[]> {
  const url = new URL(`${YT_BASE}/videos`);
  // snippet already includes description + tags + thumbnails — no extra
  // `part` cost. Just kept the explicit comment so a future trim of the
  // part list doesn't accidentally drop the Shorts-filter signals.
  url.searchParams.set("part", "snippet,statistics,contentDetails");
  url.searchParams.set("chart", "mostPopular");
  url.searchParams.set("regionCode", region);
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("key", apiKey);
  const data = await fetchJson<YtListResponse>(url);
  return data.items ?? [];
}

async function fetchSearchVideoIds(
  apiKey: string,
  q: string,
  videoCategoryId: string | undefined,
  windowDays: number = 14,
): Promise<string[]> {
  const url = new URL(`${YT_BASE}/search`);
  url.searchParams.set("part", "snippet");
  url.searchParams.set("type", "video");
  url.searchParams.set("order", "viewCount");
  url.searchParams.set("maxResults", "50");
  url.searchParams.set("q", q);
  // Per-query freshness window, ISO 8601. Default 14 days for legacy
  // TARGETED_SEARCHES; trend-spotting queries override this.
  const after = new Date(Date.now() - windowDays * DAY_MS).toISOString();
  url.searchParams.set("publishedAfter", after);
  if (videoCategoryId) url.searchParams.set("videoCategoryId", videoCategoryId);
  url.searchParams.set("key", apiKey);
  const data = await fetchJson<YtSearchResponse>(url);
  return (data.items ?? [])
    .map((it) => it.id.videoId)
    .filter((id): id is string => Boolean(id));
}

async function fetchVideosByIds(apiKey: string, ids: string[]): Promise<YtVideo[]> {
  if (ids.length === 0) return [];
  const out: YtVideo[] = [];
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/videos`);
    // snippet brings description + tags + thumbnails the Shorts filter
    // (task #19) needs. No extra quota cost vs. snippet alone.
    url.searchParams.set("part", "snippet,statistics,contentDetails");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const data = await fetchJson<YtListResponse>(url);
    out.push(...(data.items ?? []));
  }
  return out;
}

interface ChannelInfo {
  subscriberCount: number;
  createdAt: Date | null;
  logoUrl: string | null;
}

async function fetchChannelInfo(
  apiKey: string,
  channelIds: string[],
): Promise<Map<string, ChannelInfo>> {
  const out = new Map<string, ChannelInfo>();
  for (let i = 0; i < channelIds.length; i += 50) {
    const batch = channelIds.slice(i, i + 50);
    const url = new URL(`${YT_BASE}/channels`);
    url.searchParams.set("part", "snippet,statistics");
    url.searchParams.set("id", batch.join(","));
    url.searchParams.set("key", apiKey);
    const data = await fetchJson<YtChannelsResponse>(url);
    for (const ch of data.items ?? []) {
      let subs = 0;
      if (!ch.statistics?.hiddenSubscriberCount) {
        const n = Number(ch.statistics?.subscriberCount);
        if (Number.isFinite(n)) subs = n;
      }
      const createdRaw = ch.snippet?.publishedAt;
      const createdAt = createdRaw ? new Date(createdRaw) : null;
      // Prefer medium (88×88) — sharp at the 22-24px sizes the UI uses
      // even on retina, and stays small enough to keep the leaderboard
      // payload light. Fall back to high → default if YouTube didn't
      // return medium for this channel.
      const logoUrl =
        ch.snippet?.thumbnails?.medium?.url ??
        ch.snippet?.thumbnails?.high?.url ??
        ch.snippet?.thumbnails?.default?.url ??
        null;
      out.set(ch.id, {
        subscriberCount: subs,
        createdAt: createdAt && !isNaN(createdAt.getTime()) ? createdAt : null,
        logoUrl,
      });
    }
  }
  return out;
}

// Blok G — tiered overperformer threshold. Returns true if the video
// passes the ratio gate appropriate for its channel size. Small channels
// must massively outperform their audience; mega channels need only a
// small ratio because hitting any % of 10M subs is hard.
function passesTieredRatio(views: number, subs: number): boolean {
  if (subs < 1_000) return views >= 10_000;
  const ratio = views / subs;
  if (subs < 10_000) return ratio >= 5.0;
  if (subs < 100_000) return ratio >= 2.0;
  if (subs < 1_000_000) return ratio >= 1.0;
  if (subs < 10_000_000) return ratio >= 0.3;
  return ratio >= 0.1;
}

function computeBreakoutScore(
  viewsPerHour: number,
  ratio: number,
  isEmerging: boolean,
  engagement: number,
): number {
  const vphTerm = Math.log10(Math.max(1, viewsPerHour)) * 30;
  const ratioTerm = Math.log10(Math.max(0, ratio) + 1) * 40;
  const emergingTerm = isEmerging ? 20 : 0;
  const engTerm = engagement * 100 * 10;
  return vphTerm + ratioTerm + emergingTerm + engTerm;
}

// ─── Sync orchestration ───────────────────────────────────────────────

interface SyncResult {
  region: string;
  fetched: number;
  inserted: number;
  updated: number;
  skipped: number;
  errors: number;
}

interface SyncSummary {
  ok: boolean;
  reason?: string;
  results: SyncResult[];
  totalCandidates?: number;
  totalAccepted?: number;
  totalArchivedByBalance?: number;
  totalArchivedAsShorts?: number;
}

export async function syncTrendingVideos(opts?: {
  regions?: string[];
  maxResults?: number; // accepted for backward-compat with admin route
}): Promise<SyncSummary> {
  const apiKey = process.env["YOUTUBE_API_KEY"];
  if (!apiKey) {
    logger.warn(
      "YOUTUBE_API_KEY not set — skipping trending sync. Real user data continues unaffected.",
    );
    return { ok: false, reason: "missing_api_key", results: [] };
  }

  const regions = opts?.regions ?? [...REGIONS];

  // ── Phase 1: fetch all sources in parallel ───────────────────────
  const candidates = new Map<string, CandidateMeta>();
  const popularSettled = await Promise.allSettled(
    regions.map(async (region) => ({ region, items: await fetchMostPopular(apiKey, region) })),
  );
  for (const r of popularSettled) {
    if (r.status === "rejected") {
      logger.error({ err: r.reason }, "mostPopular fetch failed");
      continue;
    }
    const { region, items } = r.value;
    for (const v of items) {
      if (!v.id) continue;
      const existing = candidates.get(v.id);
      if (existing) {
        existing.trendingRegions.add(region);
      } else {
        candidates.set(v.id, {
          video: v,
          primaryRegion: region,
          trendingRegions: new Set([region]),
          fromSearch: false,
        });
      }
    }
  }

  // Targeted search for under-served buckets.
  for (const search of TARGETED_SEARCHES) {
    try {
      const ids = await fetchSearchVideoIds(apiKey, search.q, search.videoCategoryId);
      const newIds = ids.filter((id) => !candidates.has(id));
      if (newIds.length === 0) continue;
      const enriched = await fetchVideosByIds(apiKey, newIds);
      for (const v of enriched) {
        if (!v.id || candidates.has(v.id)) continue;
        candidates.set(v.id, {
          video: v,
          primaryRegion: "SEARCH",
          trendingRegions: new Set(),
          fromSearch: true,
        });
      }
    } catch (err) {
      logger.error({ err, q: search.q }, "Targeted search failed");
    }
  }

  // Ronde 3 Blok 3: trend-spotting search loop. Per-query freshness
  // window so "trending viral now" pulls last 3 days while "the truth
  // about" reaches 14 days back.
  for (const search of TRENDING_SEARCHES) {
    try {
      const ids = await fetchSearchVideoIds(apiKey, search.q, undefined, search.minDays);
      const newIds = ids.filter((id) => !candidates.has(id));
      if (newIds.length === 0) continue;
      const enriched = await fetchVideosByIds(apiKey, newIds);
      for (const v of enriched) {
        if (!v.id || candidates.has(v.id)) continue;
        candidates.set(v.id, {
          video: v,
          primaryRegion: "TRENDING",
          trendingRegions: new Set(),
          fromSearch: true,
        });
      }
    } catch (err) {
      logger.error({ err, q: search.q }, "Trending search failed");
    }
  }

  // ── Phase 2: enrich with subscriber counts ────────────────────────
  const channelIds = Array.from(
    new Set(
      Array.from(candidates.values())
        .map((c) => c.video.snippet?.channelId)
        .filter((id): id is string => Boolean(id)),
    ),
  );
  let channelInfo: Map<string, ChannelInfo>;
  try {
    channelInfo = await fetchChannelInfo(apiKey, channelIds);
  } catch (err) {
    logger.error({ err }, "channels.list failed — overperformer filter will reject all");
    channelInfo = new Map();
  }

  // ── Phase 3: filter through quality gate + classify ───────────────
  interface Accepted {
    meta: CandidateMeta;
    subscriberCount: number;
    viewCount: number;
    viewsPerHour: number;
    channelCreatedAt: Date | null;
    channelAgeDays: number | null;
    isEmergingChannel: boolean;
    breakoutScore: number;
    appCategory: string;
    confidence: Confidence;
    titleTokens: Set<string>;
  }
  const totalCandidates = candidates.size;
  const accepted: Accepted[] = [];
  const skipReasons = new Map<string, number>();

  for (const meta of candidates.values()) {
    const channelId = meta.video.snippet?.channelId;
    const info = channelId ? channelInfo.get(channelId) ?? null : null;
    const subscriberCount = info ? info.subscriberCount : null;
    const reason = passesPreClassifierFilters(meta.video, subscriberCount);
    if (reason) {
      skipReasons.set(reason, (skipReasons.get(reason) ?? 0) + 1);
      continue;
    }
    const { category: appCategory, confidence } = classify(meta.video);
    const views = Number(meta.video.statistics?.viewCount ?? 0);
    const likes = Number(meta.video.statistics?.likeCount ?? 0);
    const engagement = views > 0 ? likes / views : 0;
    const publishedAt = new Date(meta.video.snippet!.publishedAt).getTime();
    const ageHours = Math.max(1, (NOW_TS() - publishedAt) / (60 * 60 * 1000));
    const viewsPerHour = views / ageHours;
    const subs = subscriberCount ?? 0;
    const ratio = subs > 0 ? views / subs : 0;
    const channelCreatedAt = info?.createdAt ?? null;
    const channelAgeDays = channelCreatedAt
      ? Math.floor((NOW_TS() - channelCreatedAt.getTime()) / DAY_MS)
      : null;
    const isEmergingChannel = channelAgeDays !== null && channelAgeDays < 180;
    const breakoutScore = computeBreakoutScore(
      viewsPerHour, ratio, isEmergingChannel, engagement,
    );
    accepted.push({
      meta,
      subscriberCount: subs,
      viewCount: views,
      viewsPerHour,
      channelCreatedAt,
      channelAgeDays,
      isEmergingChannel,
      breakoutScore,
      appCategory,
      confidence,
      titleTokens: tokenize(meta.video.snippet?.title ?? ""),
    });
  }

  // Per-category × confidence breakdown for monitoring (Blok E spec).
  const classifierStats: Record<string, { high: number; medium: number; low: number; total: number }> = {};
  for (const a of accepted) {
    const bucket = (classifierStats[a.appCategory] ??= {
      high: 0, medium: 0, low: 0, total: 0,
    });
    bucket[a.confidence] += 1;
    bucket.total += 1;
  }
  const otherPct = accepted.length > 0
    ? Math.round((100 * (classifierStats["Other"]?.total ?? 0)) / accepted.length)
    : 0;
  if (otherPct > 30) {
    logger.warn(
      { otherPct, classifierStats },
      "Classifier 'Other' bucket > 30% — keyword rules may be too strict",
    );
  }

  // ── Phase 4: Topic diversity (Jaccard < 0.4 cluster cap = 5) ─────
  // Per category, sort by overperformer ratio DESC. Greedy cluster
  // assignment: a video joins the first cluster it overlaps; if that
  // cluster already has 5 members, the video is dropped.
  const byCategory = new Map<string, Accepted[]>();
  for (const a of accepted) {
    const list = byCategory.get(a.appCategory) ?? [];
    list.push(a);
    byCategory.set(a.appCategory, list);
  }
  const diversityFiltered: Accepted[] = [];
  for (const list of byCategory.values()) {
    list.sort((x, y) => {
      const rx = x.subscriberCount > 0 ? x.viewCount / x.subscriberCount : 0;
      const ry = y.subscriberCount > 0 ? y.viewCount / y.subscriberCount : 0;
      return ry - rx;
    });
    const clusters: Array<{ tokens: Set<string>; members: Accepted[] }> = [];
    for (const cand of list) {
      let placed = false;
      for (const cluster of clusters) {
        if (jaccard(cand.titleTokens, cluster.tokens) > 0.4) {
          if (cluster.members.length < 5) {
            cluster.members.push(cand);
            for (const t of cand.titleTokens) cluster.tokens.add(t);
          }
          // else: drop (cluster full)
          placed = true;
          break;
        }
      }
      if (!placed) {
        clusters.push({ tokens: new Set(cand.titleTokens), members: [cand] });
      }
    }
    for (const c of clusters) diversityFiltered.push(...c.members);
  }

  // ── Phase 5: Channel cap (max 2 per channelId) ───────────────────
  diversityFiltered.sort((x, y) => {
    const rx = x.subscriberCount > 0 ? x.viewCount / x.subscriberCount : 0;
    const ry = y.subscriberCount > 0 ? y.viewCount / y.subscriberCount : 0;
    return ry - rx;
  });
  const perChannel = new Map<string, number>();
  const channelCapped: Accepted[] = [];
  for (const a of diversityFiltered) {
    const ch = a.meta.video.snippet?.channelId ?? "?";
    const n = perChannel.get(ch) ?? 0;
    if (n >= 2) continue;
    perChannel.set(ch, n + 1);
    channelCapped.push(a);
  }

  // ── Phase 6: Region balance (≤25% per primary region) ────────────
  const total = channelCapped.length;
  const cap = Math.max(1, Math.floor(total * 0.25));
  const perRegion = new Map<string, number>();
  const regionBalanced: Accepted[] = [];
  for (const a of channelCapped) {
    const region = a.meta.primaryRegion;
    if (region === "SEARCH") {
      regionBalanced.push(a); // search hits aren't region-attributable
      continue;
    }
    const n = perRegion.get(region) ?? 0;
    if (n >= cap) continue;
    perRegion.set(region, n + 1);
    regionBalanced.push(a);
  }

  // ── Phase 7: Upsert + view snapshot ──────────────────────────────
  const now = new Date();
  let inserted = 0;
  let updated = 0;
  for (const a of regionBalanced) {
    try {
      const v = a.meta.video;
      const snippet = v.snippet!;
      const videoId = v.id;
      const imageUrl = pickMaxresThumbnail(v)!;
      const publishedAt = new Date(snippet.publishedAt);
      const youtubeUrl = `https://www.youtube.com/watch?v=${videoId}`;
      const trendingArr = Array.from(a.meta.trendingRegions);
      const ratio = a.subscriberCount > 0 ? a.viewCount / a.subscriberCount : null;
      const categoryIdInt = snippet.categoryId ? Number(snippet.categoryId) : null;
      const durationSec = parseIsoDuration(v.contentDetails?.duration);

      const [existing] = await db
        .select()
        .from(thumbnailsTable)
        .where(eq(thumbnailsTable.youtubeVideoId, videoId))
        .limit(1);

      let thumbnailId: number;
      let prevViewCount: number | null = null;
      let prevCapturedAt: Date | null = null;

      if (existing) {
        thumbnailId = existing.id;
        const [lastSnap] = await db
          .select()
          .from(viewSnapshotsTable)
          .where(eq(viewSnapshotsTable.thumbnailId, existing.id))
          .orderBy(sql`${viewSnapshotsTable.capturedAt} DESC`)
          .limit(1);
        if (lastSnap) {
          prevViewCount = lastSnap.viewCount;
          prevCapturedAt = lastSnap.capturedAt;
        }
      } else {
        const [ins] = await db
          .insert(thumbnailsTable)
          .values({
            title: snippet.title,
            imageUrl,
            channelName: snippet.channelTitle,
            channelId: snippet.channelId ?? null,
            channelLogoUrl: channelInfo.get(snippet.channelId ?? "")?.logoUrl ?? null,
            niche: a.appCategory, // mirror app_category for legacy UI
            appCategory: a.appCategory,
            categoryId: Number.isFinite(categoryIdInt) ? categoryIdInt : null,
            youtubeUrl,
            status: "active",
            archived: false,
            source: "youtube",
            youtubeVideoId: videoId,
            viewCount: a.viewCount,
            subscriberCount: a.subscriberCount || null,
            viewToSubRatio: ratio,
            publishedAt,
            lastSyncedAt: now,
            durationSec,
            trendingRegions: trendingArr.length > 0 ? trendingArr : null,
            // Blok G
            viewsPerHour: a.viewsPerHour,
            channelCreatedAt: a.channelCreatedAt,
            channelAgeDays: a.channelAgeDays,
            isEmergingChannel: a.isEmergingChannel,
            breakoutScore: a.breakoutScore,
          })
          .returning({ id: thumbnailsTable.id });
        if (!ins) continue;
        thumbnailId = ins.id;
        inserted += 1;
      }

      let viewVelocity: number | null = existing?.viewVelocity ?? null;
      if (prevViewCount !== null && prevCapturedAt) {
        const hours = (now.getTime() - prevCapturedAt.getTime()) / (1000 * 60 * 60);
        if (hours > 0) {
          const delta = a.viewCount - prevViewCount;
          viewVelocity = Math.max(0, delta / hours);
        }
      }

      if (existing) {
        await db
          .update(thumbnailsTable)
          .set({
            title: snippet.title,
            channelName: snippet.channelTitle,
            channelId: snippet.channelId ?? null,
            channelLogoUrl: channelInfo.get(snippet.channelId ?? "")?.logoUrl ?? null,
            niche: a.appCategory,
            appCategory: a.appCategory,
            categoryId: Number.isFinite(categoryIdInt) ? categoryIdInt : null,
            imageUrl,
            youtubeUrl,
            viewCount: a.viewCount,
            viewVelocity,
            subscriberCount: a.subscriberCount || null,
            viewToSubRatio: ratio,
            publishedAt,
            lastSyncedAt: now,
            durationSec,
            trendingRegions: trendingArr.length > 0 ? trendingArr : null,
            // Re-activate if a previously archived video makes the cut again.
            archived: false,
            // Blok G — recompute every sync since vph & breakout decay/grow.
            viewsPerHour: a.viewsPerHour,
            channelCreatedAt: a.channelCreatedAt,
            channelAgeDays: a.channelAgeDays,
            isEmergingChannel: a.isEmergingChannel,
            breakoutScore: a.breakoutScore,
          })
          .where(eq(thumbnailsTable.id, thumbnailId));
        updated += 1;
      }

      await db.insert(viewSnapshotsTable).values({
        thumbnailId,
        viewCount: a.viewCount,
        capturedAt: now,
      });
    } catch (err) {
      logger.error({ err, videoId: a.meta.video.id }, "Failed to upsert YouTube video");
    }
  }

  // ── Phase 8: Category balance archive (cap 20% per category) ─────
  const totalArchivedByBalance = await enforceCategoryBalance();

  // ── Phase 9: Shorts auto-archive (defense in depth) ──────────────
  // Any row with a populated duration ≤180s is archived, every sync,
  // no questions asked. This is the durable backstop behind the sync
  // filter and the query-time gate: even if a Short slips through
  // passesPreClassifierFilters (or filter logic regresses in a future
  // change), as soon as durationSec gets set on the row it gets
  // archived on the next sync.
  const totalArchivedAsShorts = await archiveShortsByDuration();

  logger.info(
    {
      regions: regions.length,
      candidates: totalCandidates,
      accepted: accepted.length,
      afterDiversity: diversityFiltered.length,
      afterChannelCap: channelCapped.length,
      afterRegionBalance: regionBalanced.length,
      inserted,
      updated,
      archivedByBalance: totalArchivedByBalance,
      archivedAsShorts: totalArchivedAsShorts,
      skipReasons: Object.fromEntries(skipReasons),
      classifierStats,
    },
    "YouTube sync v2 completed",
  );

  return {
    ok: true,
    results: regions.map((r) => ({
      region: r,
      fetched: 0, // not tracked per-region in v2 (parallel collection)
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: 0,
    })),
    totalCandidates,
    totalAccepted: regionBalanced.length,
    totalArchivedByBalance,
    totalArchivedAsShorts,
  };
}

/**
 * Defense-in-depth: archive any active row whose stored duration is
 * ≤180 seconds. Runs at the end of every sync. Idempotent.
 *
 * Threshold matches the sync-time gate (`shorts_duration` skip reason)
 * — keep the two in sync: if the gate moves to 240, this should too.
 */
async function archiveShortsByDuration(): Promise<number> {
  const result = await db.execute(sql`
    WITH archived AS (
      UPDATE thumbnails
         SET archived = TRUE
       WHERE archived = FALSE
         AND duration_sec IS NOT NULL
         AND duration_sec <= 180
       RETURNING 1
    )
    SELECT COUNT(*)::int AS n FROM archived
  `);
  const n = (result.rows[0] as { n: number } | undefined)?.n ?? 0;
  if (n > 0) {
    logger.info({ archived: n }, "Shorts auto-archive (duration <= 180s)");
  }
  return n;
}

/**
 * Blok F: enforce ≤20% per app_category among active YouTube rows.
 * For any over-cap category, archive the lowest-ELO rows until at cap.
 * Returns the total number of rows newly archived.
 */
async function enforceCategoryBalance(): Promise<number> {
  const rows = await db
    .select()
    .from(thumbnailsTable)
    .where(
      and(
        eq(thumbnailsTable.archived, false),
        eq(thumbnailsTable.source, "youtube"),
        isNotNull(thumbnailsTable.appCategory),
      ),
    );
  if (rows.length === 0) return 0;
  // Ronde 3 Blok 2: floor at 8 to prevent the cap collapsing on a small
  // pool. With <40 active rows the 20% formula yields <8, which one
  // category sweep can wipe out entirely.
  const cap = Math.max(8, Math.floor(rows.length * 0.20));
  const byCat = new Map<string, typeof rows>();
  for (const r of rows) {
    const cat = r.appCategory ?? "Other";
    const list = byCat.get(cat) ?? [];
    list.push(r);
    byCat.set(cat, list);
  }
  let archived = 0;
  for (const [cat, list] of byCat.entries()) {
    if (list.length <= cap) continue;
    list.sort((a, b) => a.eloRating - b.eloRating); // lowest first
    const overflow = list.slice(0, list.length - cap);
    for (const row of overflow) {
      await db
        .update(thumbnailsTable)
        .set({ archived: true })
        .where(eq(thumbnailsTable.id, row.id));
      archived += 1;
    }
    logger.info(
      { category: cat, kept: cap, archived: overflow.length },
      "Category balance archive",
    );
  }
  return archived;
}

/**
 * Blok D: chronic-underperformer archive. Run daily.
 * Archives YouTube thumbnails with elo<1100 AND battle_count>=20.
 * (Mid-tier and newcomer thumbnails are protected.)
 */
export async function archiveUnderperformers(): Promise<number> {
  const result = await db
    .update(thumbnailsTable)
    .set({ archived: true })
    .where(
      and(
        eq(thumbnailsTable.archived, false),
        eq(thumbnailsTable.source, "youtube"),
        lt(thumbnailsTable.eloRating, 1100),
        gte(thumbnailsTable.battleCount, 20),
      ),
    )
    .returning({ id: thumbnailsTable.id });
  if (result.length > 0) {
    logger.info({ count: result.length }, "Archived chronic underperformers");
  }
  return result.length;
}

export type { Thumbnail };
