export type Action = 'auto' | 'button' | 'notify' | 'ignore';
export type SegmentLike = { uuid: string; category: string; start: number; end: number };
export type Decision =
  | { kind: 'skip'; segment: SegmentLike; to: number }
  | { kind: 'button'; segment: SegmentLike }
  | { kind: 'notify'; segment: SegmentLike };

// What to do at this moment of playback (spec §5.5). Runs in the page as a page function,
// so it is self-contained. Automatic skips happen only when playback enters a segment
// (including a segment the video started in); seeking into one by hand offers a button.
export function decideSkip(
  segments: SegmentLike[],
  actions: Record<string, Action>,
  prev: number,
  now: number,
  duration: number,
  seekedInto: boolean,
  handled: string[],
): Decision | null {
  const TAIL = 0.5; // a segment about to end isn't worth acting on
  const END_MARGIN = 0.25; // skipping to the very end must still let the video end
  if (!Number.isFinite(duration) || duration <= 0) return null;
  for (const segment of segments) {
    if (handled.includes(segment.uuid)) continue;
    if (now < segment.start || now >= segment.end - TAIL) continue;
    const action = actions[segment.category] ?? 'ignore';
    if (action === 'ignore') continue;
    // `prev` is where playback last was (or began, for a new video): entering means no
    // seek by hand since a position at or before the segment's start.
    const entered = !seekedInto && prev <= segment.start;
    if (action === 'notify') {
      if (entered) return { kind: 'notify', segment };
      continue;
    }
    if (action === 'auto' && entered) return { kind: 'skip', segment, to: Math.min(segment.end, duration - END_MARGIN) };
    return { kind: 'button', segment };
  }
  return null;
}
