import { createHash } from 'crypto';

// SponsorBlock (spec §5.5) with the privacy-preserving lookup: only the first 4 hex of
// sha256(videoId) leaves the machine, and the reply holds every video in that bucket.
export const SB_CATEGORIES = ['sponsor', 'selfpromo', 'interaction', 'intro', 'outro', 'preview', 'filler', 'music_offtopic'] as const;
export type SbCategory = (typeof SB_CATEGORIES)[number];
export type Segment = { uuid: string; category: SbCategory; start: number; end: number };

const API = 'https://sponsor.ajay.app/api/skipSegments/';
const MAX_SEGMENTS = 50;
const HIT_TTL_MS = 60 * 60_000;
const MISS_TTL_MS = 2 * 60_000;
const CACHE_SIZE = 200;

export function hashPrefix(videoId: string): string {
  return createHash('sha256').update(videoId).digest('hex').slice(0, 4);
}

export function segmentsUrl(prefix: string): string {
  const q = new URLSearchParams({ categories: JSON.stringify(SB_CATEGORIES), actionTypes: JSON.stringify(['skip']) });
  return `${API}${prefix}?${q}`;
}

const isCategory = (c: unknown): c is SbCategory => (SB_CATEGORIES as readonly unknown[]).includes(c);

export function parseSegments(json: unknown, videoId: string): Segment[] {
  if (!Array.isArray(json)) return [];
  const entry = json.find((v) => v && typeof v === 'object' && v.videoID === videoId);
  if (!entry || !Array.isArray(entry.segments)) return [];
  const out: Segment[] = [];
  for (const s of entry.segments) {
    if (!s || s.actionType !== 'skip' || !isCategory(s.category)) continue;
    const [start, end] = Array.isArray(s.segment) ? s.segment : [];
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end) continue;
    if (typeof s.UUID !== 'string' || !s.UUID || s.UUID.length > 128) continue;
    out.push({ uuid: s.UUID, category: s.category, start, end });
  }
  return out.sort((a, b) => a.start - b.start).slice(0, MAX_SEGMENTS);
}

type Entry = { segments: Segment[]; expires: number };

// Looks segments up once per video and keeps them for an hour; a failed lookup (offline,
// timeout, HTTP error) is remembered as "none" for two minutes so nothing retries per frame.
export class SponsorBlockClient {
  private readonly cache = new Map<string, Entry>();
  private readonly inFlight = new Map<string, Promise<Segment[]>>();

  constructor(
    private readonly fetchJson: (url: string) => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}

  segments(videoId: string): Promise<Segment[]> {
    const hit = this.cache.get(videoId);
    if (hit && hit.expires > this.now()) return Promise.resolve(hit.segments);
    const pending = this.inFlight.get(videoId);
    if (pending) return pending;
    const lookup = this.fetchJson(segmentsUrl(hashPrefix(videoId)))
      .then((json) => this.remember(videoId, parseSegments(json, videoId), HIT_TTL_MS))
      .catch((err) => {
        console.warn(`[sponsorblock] lookup failed for ${videoId}: ${(err as Error).message}`);
        return this.remember(videoId, [], MISS_TTL_MS);
      })
      .finally(() => this.inFlight.delete(videoId));
    this.inFlight.set(videoId, lookup);
    return lookup;
  }

  private remember(videoId: string, segments: Segment[], ttl: number): Segment[] {
    this.cache.delete(videoId);
    this.cache.set(videoId, { segments, expires: this.now() + ttl });
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return segments;
  }
}
