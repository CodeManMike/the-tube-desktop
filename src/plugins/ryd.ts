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
  // YouTube keeps a hidden copy of the like/dislike buttons; only the visible one counts.
  const visible = (selector: string) =>
    [...document.querySelectorAll<HTMLElement>(selector)].find((el) => el.getBoundingClientRect().width > 0) ?? null;
  const update = () => {
    if (location.pathname !== '/watch') return;
    const id = new URL(location.href).searchParams.get('v');
    const button = visible('dislike-button-view-model button');
    if (!id || !button) return;
    const existing = button.querySelector('.ttd-dislikes') as HTMLElement | null;
    if (id === shownFor && existing) {
      button.classList.replace('ytSpecButtonShapeNextIconButton', 'ytSpecButtonShapeNextIconLeading');
      return;
    }
    // A new video: never leave the previous video's count showing while (or if) the lookup fails.
    if (id !== shownFor) document.querySelectorAll('.ttd-dislikes').forEach((s) => s.remove());
    if (asking === id) return;
    asking = id;
    bridge
      .votes(id)
      .then((v: any) => {
        asking = null;
        const now = new URL(location.href).searchParams.get('v');
        if (now !== id || !v || !Number.isFinite(v.dislikes)) return;
        const btn = visible('dislike-button-view-model button');
        if (!btn) return;
        let span = btn.querySelector('.ttd-dislikes') as HTMLElement | null;
        if (!span) {
          span = document.createElement('span');
          span.className = 'ttd-dislikes';
          // Match the like button's count text (the visible one's leaf element holding digits).
          const like = visible('like-button-view-model button');
          const likeText = like && [...like.querySelectorAll('*')].find((el) => el.children.length === 0 && /\d/.test(el.textContent ?? ''));
          if (likeText?.className) span.className += ' ' + likeText.className;
          span.style.marginLeft = '6px';
          btn.appendChild(span);
        }
        span.textContent = fns.compactCount(v.dislikes);
        // YouTube's dislike button is icon-only (fixed width); the like button's icon-and-text
        // shape gives the count room.
        btn.classList.replace('ytSpecButtonShapeNextIconButton', 'ytSpecButtonShapeNextIconLeading');
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
