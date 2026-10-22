import { QueueModel, ShuffleSource } from './model';
import { Candidate, pickBatch } from './shuffle';

type Endpoint = 'browse' | 'search';
type Request = (endpoint: Endpoint, body: object) => Promise<{ items: Candidate[]; continuation: string | null }>;
type PendingRequest = { endpoint: Endpoint; body: object; creatorName?: string; firstPage?: boolean };
type Pool = { items: Candidate[]; pending: PendingRequest[] };

export const REFILL_WHEN_REMAINING_BELOW = 3;
const MAX_PAGES_PER_REFILL = 5;
// YouTube's search filter for "videos only".
const SEARCH_VIDEOS_ONLY = 'EgIQAQ%3D%3D';

const sourceKey = (s: ShuffleSource) =>
  s.kind === 'topic' ? `topic:${s.query}` : `creators:${s.creators.map((c) => c.channelId).sort().join(',')}`;

function firstRequests(s: ShuffleSource): PendingRequest[] {
  if (s.kind === 'topic') return [{ endpoint: 'search', body: { query: s.query, params: SEARCH_VIDEOS_ONLY } }];
  // Each creator's uploads playlist is "UU" + the channel id after "UC".
  return s.creators.map((c) => ({ endpoint: 'browse', body: { browseId: 'VLUU' + c.channelId.slice(2) }, creatorName: c.name, firstPage: true }));
}

// Keeps a shuffle source's candidate pool and tops the queue up a batch at a time,
// fetching at most a few pages per refill and only one refill at a time.
export class ShuffleRunner {
  private readonly pools = new Map<string, Pool>();
  private busy = false;

  constructor(
    private readonly request: Request,
    private readonly isWatched: (c: Candidate) => boolean,
    private readonly random: () => number = Math.random,
  ) {}

  // `force` adds a batch now (the user just picked a source); otherwise only when running low.
  async refill(model: QueueModel, batchSize: number, opts: { force?: boolean } = {}): Promise<boolean> {
    const start = model.state();
    if (!start.shuffle || start.shuffleExhausted || this.busy) return false;
    if (!opts.force && model.remainingAfterCurrent() >= REFILL_WHEN_REMAINING_BELOW) return false;
    this.busy = true;
    try {
      const key = sourceKey(start.shuffle);
      let pool = this.pools.get(key);
      if (!pool) {
        pool = { items: [], pending: firstRequests(start.shuffle) };
        this.pools.set(key, pool);
      }
      const queued = () => new Set(model.state().items.map((i) => i.videoId));
      const eligible = () => {
        const q = queued();
        return pool!.items.filter((c) => !q.has(c.videoId) && !this.isWatched(c)).length;
      };

      // Every creator's first page is fetched before picking, so a combined source really
      // mixes them (one creator's 100-video page would otherwise satisfy the batch alone).
      const needMore = () => eligible() < batchSize || pool!.pending.some((r) => r.firstPage);
      for (let pages = 0; needMore() && pool.pending.length > 0 && pages < MAX_PAGES_PER_REFILL; pages++) {
        const next = pool.pending.shift()!;
        let page;
        try {
          page = await this.request(next.endpoint, next.body);
        } catch (err) {
          console.warn(`[shuffle] fetch failed: ${(err as Error).message}`);
          pool.pending.unshift(next); // keep it for the next refill
          break;
        }
        // Uploads lists leave the creator name out of each item; fill it in from the source.
        pool.items.push(...page.items.map((c) => (c.channel || !next.creatorName ? c : { ...c, channel: next.creatorName })));
        if (page.continuation) pool.pending.push({ endpoint: next.endpoint, body: { continuation: page.continuation }, creatorName: next.creatorName });
      }

      // The source may have changed while fetching; only fill for the source we fetched.
      const now = model.state();
      if (!now.shuffle || sourceKey(now.shuffle) !== key) return false;
      const watched = pool.items.filter((c) => this.isWatched(c)).map((c) => c.videoId);
      const batch = pickBatch(pool.items, new Set([...queued(), ...watched]), batchSize, this.random);
      if (batch.length > 0) {
        model.appendItems(batch);
        return true;
      }
      if (pool.pending.length === 0) model.markShuffleExhausted();
      return false;
    } finally {
      this.busy = false;
    }
  }
}
