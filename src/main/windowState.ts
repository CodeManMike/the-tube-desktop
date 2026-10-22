import { WindowState } from './settingsStore';

export type Rect = { x: number; y: number; width: number; height: number };

const MIN_VISIBLE = 100;

function overlap(a: Rect, b: Rect): { w: number; h: number } {
  return {
    w: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)),
    h: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)),
  };
}

function fit(rect: Rect, area: Rect): Rect {
  const width = Math.min(rect.width, area.width);
  const height = Math.min(rect.height, area.height);
  return {
    x: Math.min(Math.max(rect.x, area.x), area.x + area.width - width),
    y: Math.min(Math.max(rect.y, area.y), area.y + area.height - height),
    width,
    height,
  };
}

// Restore the saved window unless the monitor it was on is gone (or it would be
// mostly off-screen): then centre the fallback size on the first work area.
export function restoreBounds(saved: WindowState | undefined, workAreas: Rect[], fallback: Rect): Rect {
  if (saved) {
    const rect = { x: saved.x, y: saved.y, width: saved.width, height: saved.height };
    const visible = workAreas
      .map((area) => ({ area, o: overlap(rect, area) }))
      .filter(({ o }) => o.w >= MIN_VISIBLE && o.h >= MIN_VISIBLE);
    // Prefer the monitor holding the window's top-left corner (where the user put it),
    // otherwise the one showing most of it.
    const holdsCorner = visible.find(({ area }) =>
      rect.x >= area.x && rect.x < area.x + area.width && rect.y >= area.y && rect.y < area.y + area.height,
    );
    const best = holdsCorner ?? visible.sort((a, b) => b.o.w * b.o.h - a.o.w * a.o.h)[0];
    if (best) return fit(rect, best.area);
  }
  const area = workAreas[0];
  const width = Math.min(fallback.width, area.width);
  const height = Math.min(fallback.height, area.height);
  return {
    x: area.x + Math.round((area.width - width) / 2),
    y: area.y + Math.round((area.height - height) / 2),
    width,
    height,
  };
}
