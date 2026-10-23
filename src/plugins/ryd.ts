import { Plugin } from '../shared/plugin';

// "521K", "1.2M", "999": the way YouTube shows its like count (one decimal only below 10
// of a unit, the rest cut off rather than rounded). A page function.
export function compactCount(n: number): string {
  if (!Number.isFinite(n) || n < 1000) return String(Math.max(0, Math.floor(n || 0)));
  const [unit, suffix] = n >= 1e9 ? [1e9, 'B'] : n >= 1e6 ? [1e6, 'M'] : [1e3, 'K'];
  const value = n / unit;
  const shown = value < 10 ? Math.floor(value * 10) / 10 : Math.floor(value);
  return `${shown}${suffix}`;
}

// Puts the estimated dislike count inside YouTube's dislike button on each watch page.
function rydScript(_settings: Record<string, unknown>): void {
  const bridge = (window as any).ttdRyd;
  const fns = (globalThis as any).__ttdFns;
  if (!bridge || !fns?.compactCount) return;
  let shownFor: string | null = null;
  let asking: string | null = null;
  const update = () => {
    if (location.pathname !== '/watch') return;
    const id = new URL(location.href).searchParams.get('v');
    const button = document.querySelector('dislike-button-view-model button') as HTMLElement | null;
    if (!id || !button) return;
    const existing = button.querySelector('.ttd-dislikes');
    if (id === shownFor && existing) return;
    if (asking === id) return;
    asking = id;
    bridge
      .votes(id)
      .then((v: any) => {
        asking = null;
        const now = new URL(location.href).searchParams.get('v');
        if (now !== id || !v || !Number.isFinite(v.dislikes)) return;
        const btn = document.querySelector('dislike-button-view-model button') as HTMLElement | null;
        if (!btn) return;
        let span = btn.querySelector('.ttd-dislikes') as HTMLElement | null;
        if (!span) {
          span = document.createElement('span');
          span.className = 'ttd-dislikes';
          // Match the like button's count text.
          const likeText = document.querySelector('like-button-view-model .ytSpecButtonShapeNextButtonTextContent, like-button-view-model [class*="TextContent"]');
          if (likeText) span.className += ' ' + likeText.className;
          span.style.marginLeft = '6px';
          btn.appendChild(span);
        }
        span.textContent = fns.compactCount(v.dislikes);
        shownFor = id;
      })
      .catch(() => (asking = null));
  };
  document.addEventListener('yt-navigate-finish', update);
  setInterval(update, 2000); // the buttons re-render after navigation
  update();
}

export const ryd: Plugin = {
  manifest: {
    id: 'ryd',
    name: 'Show dislikes',
    hint: 'Estimated by Return YouTube Dislike. The video ID is sent to their server.',
    defaultEnabled: true,
    settings: [],
  },
  pageScript: rydScript,
  pageFunctions: { compactCount },
};
