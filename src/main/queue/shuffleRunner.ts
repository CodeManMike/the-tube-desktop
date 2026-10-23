import { QueueModel, ShuffleSource } from './model';
import { Candidate, pickBatch } from './shuffle';

type Endpoint = 'browse' | 'search';
type Request = (endpoint: Endpoint, body: object) => Promise<{ items: Candidate[]; continuation: string | null }>;
type PendingRequest = { endpoint: Endpoint; body: object };
// One creator's uploads or one topic's search results, fetched page by page and kept
// across sources, so adding a creator to a shuffle only fetches that creator.
type Feed = { items: Candidate[]; pending: PendingRequest[]; started: boolean; emptyStreak: number; creatorName?: string };

export const REFILL_WHEN_REMAINING_BELOW = 3;
const MAX_PAGES_PER_REFILL = 5;
// A feed whose pages keep coming back empty is treated as ended, not fetched forever.
const MAX_EMPTY_PAGES = 3;
// After a failed fetch (YouTube refusing, offline), every refill waits: 10 minutes,
// doubling with each further failure, up to an hour.
const BACKOFF_FIRST_MS = 10 * 60_000;
const BACKOFF_MAX_MS = 60 * 60_000;
// YouTube's search filter for "videos only".
const SEARCH_VIDEOS_ONLY = 'EgIQAQ%3D%3D';

const sourceKey = (s: ShuffleSource) =>
  s.kind === 'topic' ? `topic:${s.query}` : `creators:${s.creators.map((c) => c.channelId).sort().join(',')}`;

function feedSpecs(s: ShuffleSource): { key: string; first: PendingRequest; creatorName?: string }[] {
  if (s.kind === 'topic') return [{ key: `topic:${s.query}`, first: { endpoint: 'search', body: { query: s.query, params: SEARCH_VIDEOS_ONLY } } }];
  // Each creator's uploads playlist is "UU" + the channel id after "UC".
  return s.creators.map((c) => ({ key: `creator:${c.channelId}`, first: { endpoint: 'browse', body: { browseId: 'VLUU' + c.channelId.slice(2) } }, creatorName: c.name }));
}

// Keeps candidate pools per creator / topic and tops the queue up a batch at a time,
// fetching at most a few pages per refill and only one refill at a time.
export class ShuffleRunner {
  private readonly feeds = new Map<string, Feed>();
  private busy = false;
  // An explicit pick that arrived while a refill was running; carried out right after it.
  private queuedPick: { model: QueueModel; batchSize: number } | null = null;
  private failures = 0;
  private pausedUntil = 0;

  constructor(
    private readonly request: Request,
    private readonly isWatched: (c: Candidate) => boolean,
    private readonly random: () => number = Math.random,
    private readonly now: () => number = Date.now,
  ) {}

  // `force` adds a batch now (the user just picked a source); otherwise only when running low.
  async refill(model: QueueModel, batchSize: number, opts: { force?: boolean } = {}): Promise<boolean> {
    const start = model.state();
    if (!start.shuffle || start.shuffleExhausted) return false;
    if (this.busy) {
      if (opts.force) this.queuedPick = { model, batchSize };
      return false;
    }
    if (this.now() < this.pausedUntil) return false;
    if (!opts.force && model.remainingAfterCurrent() >= REFILL_WHEN_REMAINING_BELOW) return false;
    this.busy = true;
    try {
      return await this.fill(model, start.shuffle, batchSize);
    } finally {
      this.busy = false;
      const pick = this.queuedPick;
      this.queuedPick = null;
      if (pick) void this.refill(pick.model, pick.batchSize, { force: true });
    }
  }

  private async fill(model: QueueModel, source: ShuffleSource, batchSize: number): Promise<boolean> {
    const key = sourceKey(source);
    const feeds = feedSpecs(source).map(({ key: k, first, creatorName }) => {
      let feed = this.feeds.get(k);
      if (!feed) {
        feed = { items: [], pending: [first], started: false, emptyStreak: 0, creatorName };
        this.feeds.set(k, feed);
      }
      return feed;
    });
    const pool = () => feeds.flatMap((f) => f.items);
    const queued = () => new Set(model.state().items.map((i) => i.videoId));
    const eligible = () => {
      const q = queued();
      return pool().filter((c) => !q.has(c.videoId) && !this.isWatched(c)).length;
    };
    // Every feed's first page is fetched before picking, so a combined source really mixes
    // its creators (one creator's 100-video page would otherwise satisfy the batch alone).
    // A feed not yet started goes first (a newly added creator), then the one with the least.
    const nextFeed = () =>
      feeds.find((f) => !f.started) ??
      feeds.filter((f) => f.pending.length > 0).sort((a, b) => a.items.length - b.items.length)[0];
    const needMore = () => eligible() < batchSize || feeds.some((f) => !f.started);

    for (let pages = 0; pages < MAX_PAGES_PER_REFILL && needMore(); pages++) {
      const feed = nextFeed();
      if (!feed || feed.pending.length === 0) break;
      const next = feed.pending.shift()!;
      let page;
      try {
        page = await this.request(next.endpoint, next.body);
      } catch (err) {
        feed.pending.unshift(next); // keep it for after the pause
        this.failures++;
        const wait = Math.min(BACKOFF_FIRST_MS * 2 ** (this.failures - 1), BACKOFF_MAX_MS);
        this.pausedUntil = this.now() + wait;
        console.warn(`[shuffle] fetch failed (${(err as Error).message}); pausing shuffle for ${Math.round(wait / 60_000)} min`);
        break;
      }
      this.failures = 0;
      feed.started = true;
      feed.emptyStreak = page.items.length === 0 ? feed.emptyStreak + 1 : 0;
      // Uploads lists leave the creator name out of each item; fill it in from the source.
      feed.items.push(...page.items.map((c) => (c.channel || !feed.creatorName ? c : { ...c, channel: feed.creatorName })));
      if (page.continuation && feed.emptyStreak < MAX_EMPTY_PAGES) feed.pending.push({ endpoint: next.endpoint, body: { continuation: page.continuation } });
      else if (page.continuation) console.warn(`[shuffle] ${MAX_EMPTY_PAGES} empty pages in a row; treating the feed as ended`);
    }

    // The source may have changed while fetching; only fill for the source we fetched.
    const now = model.state();
    if (!now.shuffle || sourceKey(now.shuffle) !== key) return false;
    const items = pool();
    const watched = items.filter((c) => this.isWatched(c)).map((c) => c.videoId);
    const batch = pickBatch(items, new Set([...queued(), ...watched]), batchSize, this.random);
    if (batch.length > 0) {
      model.appendItems(batch);
      return true;
    }
    if (feeds.every((f) => f.started && f.pending.length === 0)) model.markShuffleExhausted();
    return false;
  }
}
