// Return YouTube Dislike (spec §5.7): estimated like and dislike counts. Looked up from
// main (no YouTube cookies), once per video for 10 minutes; a failure is remembered for 2.
export type Votes = { likes: number; dislikes: number };

const API = 'https://returnyoutubedislikeapi.com/votes?videoId=';
const HIT_TTL_MS = 10 * 60_000;
const MISS_TTL_MS = 2 * 60_000;
const CACHE_SIZE = 200;

export class RydClient {
  private readonly cache = new Map<string, { votes: Votes | null; expires: number }>();

  constructor(
    private readonly fetchJson: (url: string) => Promise<unknown>,
    private readonly now: () => number = Date.now,
  ) {}

  async votes(videoId: string): Promise<Votes | null> {
    const hit = this.cache.get(videoId);
    if (hit && hit.expires > this.now()) return hit.votes;
    let votes: Votes | null = null;
    let ttl = MISS_TTL_MS;
    try {
      const r: any = await this.fetchJson(API + encodeURIComponent(videoId));
      if (r?.id === videoId && Number.isFinite(r.likes) && Number.isFinite(r.dislikes)) {
        votes = { likes: r.likes, dislikes: r.dislikes };
        ttl = HIT_TTL_MS;
      }
    } catch (err) {
      console.warn(`[ryd] lookup failed for ${videoId}: ${(err as Error).message}`);
    }
    this.cache.delete(videoId);
    this.cache.set(videoId, { votes, expires: this.now() + ttl });
    if (this.cache.size > CACHE_SIZE) this.cache.delete(this.cache.keys().next().value!);
    return votes;
  }
}
