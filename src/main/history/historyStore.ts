import fs from 'fs';
import { writeFileAtomic } from '../atomicFile';

export type HistoryEntry = {
  videoId: string;
  title: string;
  channel: string;
  durationSec: number;
  watchedSec: number;
  lastWatched: number;
};

// Local watch history: groundwork for "skip watched" and the future suggestion engine.
// Kept in memory and written in batches (flush), never sent anywhere.
export class HistoryStore {
  private entries = new Map<string, HistoryEntry>();
  private dirty = false;

  constructor(
    private readonly file: string,
    private readonly now: () => number = Date.now,
    private readonly cap = 20000,
  ) {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      for (const e of Array.isArray(parsed?.entries) ? parsed.entries : []) {
        if (typeof e?.videoId === 'string') this.entries.set(e.videoId, e);
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.warn(`[history] reset: ${(err as Error).message}`);
    }
  }

  record(e: { videoId: string; title?: string; channel?: string; durationSec?: number; timeSec: number }): void {
    const prev = this.entries.get(e.videoId);
    this.entries.delete(e.videoId); // re-insert so Map order tracks recency
    this.entries.set(e.videoId, {
      videoId: e.videoId,
      title: e.title ?? prev?.title ?? '',
      channel: e.channel ?? prev?.channel ?? '',
      durationSec: e.durationSec ?? prev?.durationSec ?? 0,
      watchedSec: Math.max(prev?.watchedSec ?? 0, e.timeSec),
      lastWatched: this.now(),
    });
    // Map iteration order is insertion order, so the first key is the least recently watched.
    while (this.entries.size > this.cap) this.entries.delete(this.entries.keys().next().value!);
    this.dirty = true;
  }

  get(videoId: string): HistoryEntry | undefined {
    return this.entries.get(videoId);
  }

  // Videos watched at least `thresholdPercent` of the way, most recent first (Hide watched).
  watchedIds(thresholdPercent: number, limit = 5000): string[] {
    return [...this.entries.values()]
      .filter((e) => e.durationSec > 0 && (e.watchedSec / e.durationSec) * 100 >= thresholdPercent)
      .sort((a, b) => b.lastWatched - a.lastWatched)
      .slice(0, limit)
      .map((e) => e.videoId);
  }

  flush(): boolean {
    if (!this.dirty) return true;
    const ok = writeFileAtomic(this.file, JSON.stringify({ version: 1, entries: [...this.entries.values()] }));
    if (ok) this.dirty = false;
    return ok;
  }
}
