import { PipState } from '../settingsStore';
import { Rect, restoreBounds, visibleOnAny } from '../windowState';

export const MIN_PIP_WIDTH = 240;
const DEFAULT = { width: 480, height: 270, margin: 24 };

// First open: bottom-right of the work area, out of the way of what you're doing.
export function defaultPipBounds(area: Rect): Rect {
  return {
    x: area.x + area.width - DEFAULT.width - DEFAULT.margin,
    y: area.y + area.height - DEFAULT.height - DEFAULT.margin,
    width: DEFAULT.width,
    height: DEFAULT.height,
  };
}

// The saved PiP position, unless its monitor is gone (then the default corner again).
export function pipBounds(saved: PipState | undefined, areas: Rect[]): Rect {
  if (!saved || !visibleOnAny(saved, areas)) return defaultPipBounds(areas[0]);
  return restoreBounds({ ...saved, maximized: false }, areas, defaultPipBounds(areas[0]));
}

// Width within [MIN_PIP_WIDTH, area width] and height within the area, at the ratio.
function sized(x: number, y: number, width: number, ratio: number, area: Rect): Rect {
  let w = Math.min(Math.max(width, MIN_PIP_WIDTH), area.width);
  let h = Math.round(w / ratio);
  if (h > area.height) {
    h = area.height;
    w = Math.round(h * ratio);
  }
  w = Math.round(w);
  // Growing (or turning portrait) must not push the window off the work area.
  return {
    x: Math.min(Math.max(x, area.x), area.x + area.width - w),
    y: Math.min(Math.max(y, area.y), area.y + area.height - h),
    width: w,
    height: h,
  };
}

// Dragging the corner grip: the top-left stays put and the axis you moved most wins.
// setAspectRatio doesn't constrain setBounds, so the ratio is applied here.
export function resizeFromCorner(start: Rect, dx: number, dy: number, ratio: number, area: Rect): Rect {
  const grow = Math.abs(dx) >= Math.abs(dy * ratio) ? dx : dy * ratio;
  return sized(start.x, start.y, start.width + grow, ratio, area);
}

export function moveBy(start: Rect, dx: number, dy: number): Rect {
  return { ...start, x: start.x + dx, y: start.y + dy };
}

// The video reported its own shape: keep the width, follow its ratio.
export function fitAspect(bounds: Rect, ratio: number, area: Rect): Rect {
  return sized(bounds.x, bounds.y, bounds.width, ratio, area);
}

// Opening PiP: the saved spot, shaped 16:9 until the video reports its own ratio (a window
// last used for a Short would otherwise reopen tall).
export function openingBounds(saved: PipState | undefined, areas: Rect[]): Rect {
  const bounds = pipBounds(saved, areas);
  const area = areas.find((a) => bounds.x >= a.x && bounds.x < a.x + a.width && bounds.y >= a.y && bounds.y < a.y + a.height) ?? areas[0];
  return fitAspect(bounds, 16 / 9, area);
}

// A page call that may never settle (a hung PiP page) must not block closing.
export function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p.catch(() => fallback), new Promise<T>((resolve) => setTimeout(() => resolve(fallback), ms))]);
}
