import { asExpression } from '../main/pluginRegistry';
import { PageEntry } from '../shared/plugin';

// The PiP window's watch page: only the player, filling the window, plus our hover
// controls. YouTube's own chrome and end cards are hidden (they'd be clickable here).
// No -webkit-app-region: drag areas swallow hover, so moving is done by pointer events.
export const PIP_CSS = `
  html, body { overflow: hidden !important; background: #000 !important; }
  ytd-masthead, #masthead-container, #secondary, #below, #comments, tp-yt-app-drawer { display: none !important; }
  .ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom,
  .ytp-ce-element, .ytp-endscreen-content, .ytp-pause-overlay { display: none !important; }
  #movie_player { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 9998 !important; }
  #ttd-pip { position: fixed; inset: 0; z-index: 9999; opacity: 0; transition: opacity .15s; }
  #ttd-pip:hover, #ttd-pip.dragging { opacity: 1; }
  #ttd-pip .strip { position: absolute; top: 0; left: 0; right: 0; height: 40px; cursor: move;
    background: linear-gradient(rgba(0,0,0,.7), transparent); }
  #ttd-pip .center { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; gap: 16px; }
  #ttd-pip .corner { position: absolute; top: 6px; right: 6px; display: flex; gap: 4px; }
  #ttd-pip button { display: flex; align-items: center; justify-content: center; border: 0; padding: 0; cursor: pointer;
    background: rgba(0,0,0,.55); border-radius: 50%; width: 48px; height: 48px; }
  #ttd-pip .corner button { width: 30px; height: 30px; }
  #ttd-pip button:hover { background: rgba(255,255,255,.25); }
  #ttd-pip button.on { background: rgba(62,166,255,.75); }
  #ttd-pip svg { width: 60%; height: 60%; fill: #fff; pointer-events: none; }
  #ttd-pip .grip { position: absolute; right: 0; bottom: 0; width: 18px; height: 18px; cursor: nwse-resize; }
  #ttd-pip .grip svg { width: 100%; height: 100%; fill: rgba(255,255,255,.85); }
`;

// Runs in the PiP window's page (serialised; self-contained, DOM APIs only because of
// Trusted Types). Talks to the app only through window.ttdPip (see preload/pip.ts).
export function pipPageScript(): void {
  const bridge = (window as any).ttdPip;
  if (!bridge || (window as any).__ttdPip) return;
  (window as any).__ttdPip = true;

  const ICONS: Record<string, string> = {
    previous: 'M6 6h2v12H6zm3.5 6l8.5 6V6z',
    next: 'M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z',
    play: 'M8 5v14l11-7z',
    pause: 'M6 19h4V5H6v14zm8-14v14h4V5h-4z',
    pin: 'M16 9V4h1c.55 0 1-.45 1-1s-.45-1-1-1H7c-.55 0-1 .45-1 1s.45 1 1 1h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z',
    back: 'M19 19H5V5h7V3H5a2 2 0 00-2 2v14a2 2 0 002 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z',
    grip: 'M22 22h-2v-2h2v2m0-4h-2v-2h2v2m-4 4h-2v-2h2v2m0-4h-2v-2h2v2m-4 4h-2v-2h2v2m8-8h-2v-2h2v2z',
  };
  const NS = 'http://www.w3.org/2000/svg';
  const icon = (name: string) => {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.appendChild(path);
    return svg;
  };
  const setIcon = (b: Element, name: string) => b.replaceChildren(icon(name));
  const player = () => document.querySelector('#movie_player') as any;
  const videoId = (): string | null => player()?.getVideoData?.()?.video_id || new URL(location.href).searchParams.get('v');

  const button = (name: string, title: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.title = title;
    setIcon(b, name);
    b.addEventListener('click', onClick);
    b.addEventListener('pointerdown', (e) => e.stopPropagation()); // not a drag
    return b;
  };
  const step = (action: 'next' | 'previous') => {
    const id = videoId();
    if (id) bridge.report({ type: 'action', action, videoId: id });
  };

  const root = document.createElement('div');
  root.id = 'ttd-pip';
  const strip = document.createElement('div');
  strip.className = 'strip';
  const corner = document.createElement('div');
  corner.className = 'corner';
  const pin = button('pin', 'Always on top', () => bridge.control({ kind: 'toggleOnTop' }));
  corner.append(pin, button('back', 'Back to the main window', () => bridge.control({ kind: 'return' })));
  const center = document.createElement('div');
  center.className = 'center';
  const playPause = button('pause', 'Play/pause', () => {
    const p = player();
    if (p?.getPlayerState?.() === 1) p.pauseVideo();
    else p?.playVideo?.();
  });
  center.append(button('previous', 'Previous', () => step('previous')), playPause, button('next', 'Next', () => step('next')));
  const grip = document.createElement('div');
  grip.className = 'grip';
  grip.title = 'Resize';
  grip.appendChild(icon('grip'));
  root.append(strip, corner, center, grip);
  document.body.appendChild(root);

  // Moving and resizing: the main process sizes the window from where the drag started.
  const drag = (el: HTMLElement, mode: 'move' | 'resize') => {
    let frame = 0;
    let last: PointerEvent | null = null;
    el.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      root.classList.add('dragging');
      bridge.control({ kind: 'dragStart', mode, screenX: e.screenX, screenY: e.screenY });
    });
    el.addEventListener('pointermove', (e) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      last = e;
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (last) bridge.control({ kind: 'dragMove', screenX: last.screenX, screenY: last.screenY });
      });
    });
    const end = (e: PointerEvent) => {
      if (!el.hasPointerCapture(e.pointerId)) return;
      el.releasePointerCapture(e.pointerId);
      root.classList.remove('dragging');
      bridge.control({ kind: 'dragEnd' });
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
  };
  drag(strip, 'move');
  drag(grip, 'resize');

  const progress = () => {
    const p = player();
    const vd = p?.getVideoData?.() ?? {};
    if (typeof vd.video_id === 'string' && vd.video_id) {
      bridge.report({ type: 'progress', videoId: vd.video_id, timeSec: p.getCurrentTime(), title: vd.title, channel: vd.author, durationSec: p.getDuration() || 0 });
    }
  };

  // The player appears after the page script runs; hook it once it's there.
  let hooked = false;
  let lastNav = '';
  const reportNavigation = () => {
    const id = new URL(location.href).searchParams.get('v');
    if (!id || location.href === lastNav) return;
    lastNav = location.href;
    bridge.report({ type: 'navigated', videoId: id, from: null });
  };
  const sendAspect = () => {
    const v = document.querySelector('#movie_player video') as HTMLVideoElement | null;
    if (v && v.videoWidth && v.videoHeight) bridge.control({ kind: 'aspect', ratio: v.videoWidth / v.videoHeight });
  };
  const hook = () => {
    const p = player();
    if (hooked || !p?.addEventListener) return;
    hooked = true;
    p.addEventListener('onStateChange', (st: number) => {
      setIcon(playPause, st === 1 ? 'pause' : 'play');
      const id = videoId();
      if (st === 0 && id) bridge.report({ type: 'ended', videoId: id });
      if (st === 1) progress();
    });
    document.querySelector('#movie_player video')?.addEventListener('loadedmetadata', sendAspect);
    sendAspect();
    reportNavigation();
  };
  document.addEventListener('yt-navigate-finish', () => {
    hook();
    reportNavigation();
  });
  setInterval(() => {
    hook();
    if (player()?.getPlayerState?.() === 1) progress();
  }, 5000);
  const early = setInterval(() => {
    hook();
    if (hooked) clearInterval(early);
  }, 250);

  // Commands from the queue: the same seek-or-navigate as the main window's queue script.
  bridge.onCommand((cmd: any) => {
    if (cmd && typeof cmd.onTop === 'boolean') pin.classList.toggle('on', cmd.onTop);
    const nav = cmd?.navigate;
    if (!nav || typeof nav.videoId !== 'string') return;
    const t = Math.floor(nav.timeSec || 0);
    const p = player();
    if (videoId() === nav.videoId && p?.seekTo) {
      p.seekTo(t, true);
      p.playVideo?.();
      return;
    }
    const url = `/watch?v=${nav.videoId}${t > 0 ? `&t=${t}s` : ''}`;
    document.querySelector('ytd-app')?.dispatchEvent(
      new CustomEvent('yt-navigate', {
        bubbles: true,
        composed: true,
        detail: {
          endpoint: {
            commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } },
            watchEndpoint: { videoId: nav.videoId, ...(t > 0 && { startTimeSeconds: t }) },
          },
        },
      }),
    );
  });
  bridge.ready();
}

// YouTube's own autoplay pick never plays in PiP: only the queue decides what's next.
export function stripAutoplay(data: any): any {
  const watch = data?.contents?.twoColumnWatchNextResults;
  if (watch && 'autoplay' in watch) delete watch.autoplay;
  const overlay = data?.playerOverlays?.playerOverlayRenderer;
  if (overlay && 'autoplay' in overlay) delete overlay.autoplay;
  return data;
}

// The PiP window's whole page bundle: one fixed entry, no user plugins (see plan ruling 8).
export function pipEntry(): PageEntry {
  return {
    id: 'pip',
    settings: {},
    transforms: { next: asExpression(stripAutoplay), initialData: asExpression(stripAutoplay) },
    css: PIP_CSS,
    script: asExpression(pipPageScript),
  };
}
