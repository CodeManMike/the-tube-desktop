import { NewItem } from './model';

// A video offered by a shuffle source; watchedPercent is YouTube's own marker, when given.
export type Candidate = NewItem & { watchedPercent?: number };

type History = { get(videoId: string): { watchedSec: number; durationSec: number } | undefined };

// "Watched" (spec §5.3): YouTube's marker or TTD's local history at or above the threshold.
export function isWatched(v: { videoId: string; watchedPercent?: number }, history: History, thresholdPercent: number): boolean {
  if (typeof v.watchedPercent === 'number' && v.watchedPercent >= thresholdPercent) return true;
  const h = history.get(v.videoId);
  return !!h && h.durationSec > 0 && (h.watchedSec / h.durationSec) * 100 >= thresholdPercent;
}

// Up to n distinct videos not in `exclude`, picked uniformly (Fisher–Yates over the eligible ones).
export function pickBatch(pool: Candidate[], exclude: Set<string>, n: number, random: () => number): NewItem[] {
  const seen = new Set<string>();
  const eligible: Candidate[] = [];
  for (const c of pool) {
    if (exclude.has(c.videoId) || seen.has(c.videoId)) continue;
    seen.add(c.videoId);
    eligible.push(c);
  }
  for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
  }
  return eligible.slice(0, n).map(({ watchedPercent: _w, ...item }) => item);
}
