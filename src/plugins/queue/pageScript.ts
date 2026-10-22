// The queue's page side: renders the panel, reports what happens to the main process,
// and carries out navigation commands. Serialised with toString(), so self-contained.
export function queuePageScript(_settings: Record<string, unknown>): void {
  const api = (window as any).ttd?.queue;
  if (!api) return;

  type Item = { uid: string; videoId: string; title: string; channel: string; thumbnail: string; durationSec?: number };
  type Point = { kind: 'video'; videoId: string; timeSec: number } | { kind: 'queue'; items: Item[]; current: number | null; resumeTimeSec: number };
  type State = { items: Item[]; current: number | null; returnStack: Point[] };

  let state: State | null = null;
  let lastSeq = 0;
  let lastPlaying: { videoId: string; timeSec: number; title?: string; channel?: string } | null = null;
  let lastReportedNav = '';
  // What was playing when the current navigation started (see yt-navigate-start below).
  let navFrom: { videoId: string; timeSec: number; title?: string; channel?: string } | null = null;
  let panel: HTMLElement | null = null;
  let dragUid: string | null = null;
  let playerHooked = false;

  const player = () => document.querySelector('#movie_player') as any;
  const urlVideoId = () => (location.pathname === '/watch' ? new URL(location.href).searchParams.get('v') : null);
  const fmt = (sec?: number) => {
    if (sec === undefined || !Number.isFinite(sec)) return '';
    const s = Math.floor(sec % 60).toString().padStart(2, '0');
    const m = Math.floor(sec / 60) % 60;
    const h = Math.floor(sec / 3600);
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  };
  const el = (tag: string, cls?: string, text?: string) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  // In-app navigation through YouTube's own router (no page reload).
  const navigate = (videoId: string, timeSec: number) => {
    if (urlVideoId() === videoId && player()?.seekTo) {
      player().seekTo(timeSec, true);
      player().playVideo?.();
      return;
    }
    const t = Math.floor(timeSec);
    const url = `/watch?v=${videoId}${t > 0 ? `&t=${t}s` : ''}`;
    document.querySelector('ytd-app')?.dispatchEvent(
      new CustomEvent('yt-navigate', {
        bubbles: true,
        composed: true,
        detail: {
          endpoint: {
            commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } },
            watchEndpoint: { videoId, ...(t > 0 && { startTimeSeconds: t }) },
          },
        },
      }),
    );
  };

  const backLabel = (s: State): string | null => {
    const top = s.returnStack[s.returnStack.length - 1];
    if (!top) return null;
    if (top.kind === 'queue') return '↩ Back to previous queue';
    const title = s.items.find((i) => i.videoId === top.videoId)?.title ?? 'previous video';
    return `↩ Back to ${title} (${fmt(top.timeSec)})`;
  };

  const render = () => {
    const host = document.querySelector('#secondary-inner');
    if (location.pathname !== '/watch' || !state || !host) {
      panel?.remove();
      return;
    }
    if (!panel) panel = el('div', 'ttd-queue');
    if (host.firstElementChild !== panel) host.prepend(panel);

    const s = state;
    const head = el('div', 'ttd-queue-head');
    const title = el('div', 'ttd-queue-title', 'Queue');
    title.append(el('span', 'ttd-queue-count', s.items.length ? `${s.items.length} video${s.items.length === 1 ? '' : 's'}` : ''));
    head.append(title);
    const back = backLabel(s);
    if (back) {
      const btn = el('button', 'ttd-queue-back', back);
      btn.title = back;
      btn.addEventListener('click', () => api.report({ type: 'action', action: 'back' }));
      head.append(btn);
    }

    const children: HTMLElement[] = [head];
    if (!s.items.length) {
      children.push(el('div', 'ttd-queue-empty', 'Use “Add to queue” on any video to start a queue. It stays put while you browse.'));
    } else {
      const list = el('div', 'ttd-queue-list');
      s.items.forEach((item, index) => {
        const row = el('div', 'ttd-q-item');
        if (index === s.current) row.classList.add('current');
        else if (s.current !== null && index < s.current) row.classList.add('played');
        row.draggable = true;
        row.append(el('div', 'ttd-q-index', index === s.current ? '▶' : String(index + 1)));
        const img = el('img', 'ttd-q-thumb') as HTMLImageElement;
        img.src = item.thumbnail;
        img.alt = '';
        img.loading = 'lazy';
        const text = el('div', 'ttd-q-text');
        text.append(el('div', 'ttd-q-name', item.title), el('div', 'ttd-q-channel', item.channel));
        row.append(img, text, el('div', 'ttd-q-len', fmt(item.durationSec)));

        const actions = el('div', 'ttd-q-actions');
        const action = (label: string, hint: string, run: () => void) => {
          const b = el('button', undefined, label);
          b.title = hint;
          b.addEventListener('click', (e) => {
            e.stopPropagation();
            run();
          });
          actions.append(b);
        };
        action('⏭', 'Play next', () => api.report({ type: 'action', action: 'playNext', uid: item.uid }));
        action('⤒', 'Move to top', () => api.report({ type: 'move', uid: item.uid, toIndex: 0 }));
        action('⤓', 'Move to bottom', () => api.report({ type: 'move', uid: item.uid, toIndex: s.items.length - 1 }));
        action('✕', 'Remove', () => api.report({ type: 'action', action: 'remove', uid: item.uid }));
        row.append(actions);

        row.addEventListener('click', () => api.report({ type: 'action', action: 'jump', uid: item.uid }));
        row.addEventListener('dragstart', (e) => {
          dragUid = item.uid;
          e.dataTransfer?.setData('text/plain', item.uid);
        });
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          row.classList.add('drop-before');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('drop-before');
          if (dragUid && dragUid !== item.uid) api.report({ type: 'move', uid: dragUid, toIndex: index });
          dragUid = null;
        });
        list.append(row);
      });
      children.push(list);
    }
    panel.replaceChildren(...children);
  };

  const hookPlayer = () => {
    const p = player();
    if (playerHooked || !p?.addEventListener) return;
    playerHooked = true;
    p.addEventListener('onStateChange', (st: number) => {
      const videoId = urlVideoId();
      if (st === 0 && videoId) api.report({ type: 'ended', videoId });
    });
  };

  const reportNavigation = () => {
    const videoId = urlVideoId();
    if (!videoId || location.href === lastReportedNav) return;
    lastReportedNav = location.href;
    const from = navFrom ?? lastPlaying;
    navFrom = null;
    api.report({ type: 'navigated', videoId, from: from && from.videoId !== videoId ? from : null });
    const data = (globalThis as any).__ttdLastWatchData ?? {};
    api.report({
      type: 'watchData',
      videoId,
      playlist: data.playlist ?? null,
      autoplay: data.autoplay ?? null,
      listParam: new URL(location.href).searchParams.get('list'),
    });
  };

  api.onState((payload: any) => {
    state = payload.state;
    (globalThis as any).__ttdQueue = { nextVideoId: payload.nextVideoId };
    render();
    if (payload.command && payload.seq > lastSeq) navigate(payload.command.navigate.videoId, payload.command.navigate.timeSec);
    lastSeq = Math.max(lastSeq, payload.seq);
  });

  // YouTube fires yt-navigate-start after the URL has changed but while the player still
  // holds the outgoing video: snapshot it then. The 5 s progress sample alone can be stale
  // or already overwritten by the next video.
  document.addEventListener('yt-navigate-start', () => {
    const p = player();
    const vd = p?.getVideoData?.() ?? {};
    if (typeof vd.video_id === 'string' && vd.video_id) {
      navFrom = { videoId: vd.video_id, timeSec: p.getCurrentTime(), title: vd.title, channel: vd.author };
    }
  });

  document.addEventListener('yt-navigate-finish', () => {
    hookPlayer();
    reportNavigation();
    render();
  });

  // Progress for watch history and return points; also keeps the panel attached if
  // YouTube re-renders the side column.
  setInterval(() => {
    hookPlayer();
    const p = player();
    if (p?.getPlayerState?.() === 1) {
      const vd = p.getVideoData?.() ?? {};
      if (typeof vd.video_id === 'string') {
        lastPlaying = { videoId: vd.video_id, timeSec: p.getCurrentTime(), title: vd.title, channel: vd.author };
        api.report({ type: 'progress', ...lastPlaying, durationSec: p.getDuration() || 0 });
      }
    }
    if (location.pathname === '/watch' && panel && !panel.isConnected) render();
  }, 5000);

  console.log('[ttd] queue page script ready');
  api.ready();
  if (location.pathname === '/watch') {
    hookPlayer();
    reportNavigation();
  }
}
