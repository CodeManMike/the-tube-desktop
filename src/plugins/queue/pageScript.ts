// The queue's page side: renders the panel, reports what happens to the main process,
// and carries out navigation commands. Serialised with toString(), so self-contained.
export function queuePageScript(_settings: Record<string, unknown>): void {
  const api = (window as any).ttd?.queue;
  if (!api) return;

  type Item = { uid: string; videoId: string; title: string; channel: string; thumbnail: string; durationSec?: number };
  type Point = { kind: 'video'; videoId: string; timeSec: number } | { kind: 'queue'; items: Item[]; current: number | null; resumeTimeSec: number };
  type Shuffle = { kind: 'creators'; creators: { channelId: string; name: string }[] } | { kind: 'topic'; query: string };
  type State = { items: Item[]; current: number | null; returnStack: Point[]; shuffle: Shuffle | null; shuffleExhausted: boolean };

  let state: State | null = null;
  let lastSeq = 0;
  let lastPlaying: { videoId: string; timeSec: number; title?: string; channel?: string } | null = null;
  let lastReportedNav = '';
  // What was playing when the current navigation started (see yt-navigate-start below).
  let navFrom: { videoId: string; timeSec: number; title?: string; channel?: string } | null = null;
  let panel: HTMLElement | null = null;
  let dragUid: string | null = null;
  let lastCurrentUid: string | null = null;
  // The current video's creator (from the watch data), for the Shuffle menu.
  let currentOwner: { channelId: string; name: string } | null = null;
  let menuOpen = false;
  let topicInput = false;
  // Clear asks once ("Clear 12?") before wiping, and gives up asking after a few seconds.
  let clearArmed = false;
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  // What's typed in the topic box, kept across re-renders (state updates rebuild the panel).
  let topicDraft = '';
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

  const shuffleLabel = (sh: Shuffle) =>
    sh.kind === 'topic' ? `topic: ${sh.query}` : sh.creators.map((c) => c.name || 'a creator').join(', ');

  const shuffleChip = (s: State): HTMLElement | null => {
    if (!s.shuffle) return null;
    const chip = el('div', 'ttd-shuffle-chip');
    const label = shuffleLabel(s.shuffle);
    chip.append(el('span', undefined, s.shuffleExhausted ? `No more unwatched videos from ${label}` : `Shuffling ${label}`));
    const stop = el('button', undefined, '✕');
    stop.title = 'Stop shuffling';
    stop.addEventListener('click', () => api.report({ type: 'shuffle', action: 'stop' }));
    chip.append(stop);
    return chip;
  };

  const shuffleMenu = (s: State): HTMLElement => {
    const menu = el('div', 'ttd-shuffle-menu');
    const option = (label: string, run: () => void) => {
      const b = el('button', undefined, label);
      b.addEventListener('click', () => {
        menuOpen = false;
        run();
        render();
      });
      menu.append(b);
    };
    if (currentOwner) {
      const owner = currentOwner;
      option(`Shuffle ${owner.name}`, () => api.report({ type: 'shuffle', action: 'creator', channelId: owner.channelId, name: owner.name }));
      if (s.shuffle?.kind === 'creators' && !s.shuffle.creators.some((c) => c.channelId === owner.channelId)) {
        option(`Add ${owner.name} to shuffle`, () => api.report({ type: 'shuffle', action: 'addCreator', channelId: owner.channelId, name: owner.name }));
      }
    }
    if (topicInput) {
      const input = el('input', 'ttd-shuffle-topic') as HTMLInputElement;
      input.placeholder = 'Topic, e.g. lofi';
      input.maxLength = 200;
      input.value = topicDraft;
      input.addEventListener('input', () => (topicDraft = input.value));
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // keep YouTube's keyboard shortcuts out of the text box
        if (e.key === 'Enter' && input.value.trim()) {
          api.report({ type: 'shuffle', action: 'topic', query: input.value.trim() });
          topicDraft = '';
          menuOpen = false;
          topicInput = false;
          render();
        } else if (e.key === 'Escape') {
          topicDraft = '';
          menuOpen = false;
          topicInput = false;
          render();
        }
      });
      menu.append(input);
      setTimeout(() => input.focus(), 0);
    } else {
      const b = el('button', undefined, 'Shuffle a topic…');
      b.addEventListener('click', () => {
        topicInput = true;
        render();
      });
      menu.append(b);
    }
    if (s.shuffle) option('Stop shuffling', () => api.report({ type: 'shuffle', action: 'stop' }));
    return menu;
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
    const previousScroll = panel.querySelector('.ttd-queue-list')?.scrollTop ?? 0;
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
    const shuffleBtn = el('button', 'ttd-queue-back ttd-shuffle-toggle', 'Shuffle ▾');
    shuffleBtn.addEventListener('click', () => {
      menuOpen = !menuOpen;
      topicInput = false;
      render();
    });
    head.append(shuffleBtn);
    if (s.items.length) {
      const clearBtn = el('button', clearArmed ? 'ttd-queue-back ttd-queue-clear armed' : 'ttd-queue-back ttd-queue-clear', clearArmed ? `Clear ${s.items.length}?` : 'Clear');
      clearBtn.title = clearArmed ? 'Click again to empty the queue' : 'Empty the queue';
      clearBtn.addEventListener('click', () => {
        clearTimeout(clearTimer);
        if (clearArmed) {
          clearArmed = false;
          api.report({ type: 'action', action: 'clear' });
          return;
        }
        clearArmed = true;
        clearTimer = setTimeout(() => {
          clearArmed = false;
          render();
        }, 4000);
        render();
      });
      head.append(clearBtn);
    } else clearArmed = false;

    const children: HTMLElement[] = [head];
    if (menuOpen) children.push(shuffleMenu(s));
    const chip = shuffleChip(s);
    if (chip) children.push(chip);
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

        row.addEventListener('click', () => {
          if (index !== s.current) api.report({ type: 'action', action: 'jump', uid: item.uid });
        });
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
          // Dropping on a row places the dragged item before it; the model removes the item
          // first, so moving down lands one index earlier.
          const from = s.items.findIndex((i) => i.uid === dragUid);
          if (dragUid && from >= 0 && dragUid !== item.uid) api.report({ type: 'move', uid: dragUid, toIndex: from < index ? index - 1 : index });
          dragUid = null;
        });
        list.append(row);
      });
      children.push(list);
    }
    panel.replaceChildren(...children);

    // Keep the list where the user left it; bring the current item into view when it changes.
    const list = panel.querySelector('.ttd-queue-list') as HTMLElement | null;
    if (list) {
      list.scrollTop = previousScroll;
      const currentUid = s.current === null ? null : s.items[s.current].uid;
      if (currentUid !== lastCurrentUid && s.current !== null) {
        const row = list.children[s.current] as HTMLElement | undefined;
        if (row) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.clientHeight / 2);
      }
      lastCurrentUid = currentUid;
    }
  };

  const hookPlayer = () => {
    const p = player();
    if (playerHooked || !p?.addEventListener) return;
    playerHooked = true;
    p.addEventListener('onStateChange', (st: number) => {
      // From the player, not the URL: the miniplayer keeps playing while you browse.
      const videoId = p.getVideoData?.()?.video_id ?? urlVideoId();
      if (st === 0 && videoId) api.report({ type: 'ended', videoId });
      // Report playing straight away (not on the next 5 s tick), so PiP closes promptly.
      if (st === 1 && videoId) {
        const vd = p.getVideoData?.() ?? {};
        api.report({ type: 'progress', videoId, timeSec: p.getCurrentTime(), title: vd.title, channel: vd.author, durationSec: p.getDuration() || 0 });
      }
    });
  };

  const reportNavigation = () => {
    const videoId = urlVideoId();
    if (!videoId || location.href === lastReportedNav) return;
    lastReportedNav = location.href;
    const from = navFrom ?? lastPlaying;
    navFrom = null;
    api.report({ type: 'navigated', videoId, from: from && from.videoId !== videoId ? from : null });
    // In-app navigations don't pass through the fetch hook: read the watch page's own data
    // (ytd-watch-flexy), which YouTube swaps in shortly after yt-navigate-finish. Wait until
    // it belongs to this video, so another video's playlist or autoplay pick is never used.
    const listParam = new URL(location.href).searchParams.get('list');
    let tries = 0;
    const sendWatchData = () => {
      const flexy = document.querySelector('ytd-watch-flexy') as any;
      const pageData = flexy?.__data?.data ?? flexy?.data;
      if (pageData && typeof (globalThis as any).__ttdCaptureWatch === 'function') (globalThis as any).__ttdCaptureWatch(pageData, {});
      const captured = (globalThis as any).__ttdLastWatchData;
      if ((!captured || captured.videoId !== videoId) && ++tries < 16) {
        setTimeout(sendWatchData, 250);
        return;
      }
      const data = captured && captured.videoId === videoId ? captured : {};
      currentOwner = data.owner ?? null;
      api.report({
        type: 'watchData',
        videoId,
        playlist: data.playlist ?? null,
        autoplay: data.autoplay ?? null,
        listParam,
        owner: data.owner ?? null,
        playlistMeta: data.playlistMeta ?? null,
      });
      render();
    };
    sendWatchData();
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

  // Page fetches for shuffle sources and full playlists. Same-origin, so the request carries
  // your YouTube session; only YouTube's browse and search APIs are ever called.
  api.onFetch?.(async (req: any) => {
    const report = (ok: boolean, page?: { items: unknown[]; continuation: string | null }) =>
      api.report({ type: 'fetched', requestId: req?.requestId, ok, items: page?.items ?? [], continuation: page?.continuation ?? null });
    try {
      if (req?.endpoint !== 'browse' && req?.endpoint !== 'search') return report(false);
      const ytcfg = (window as any).ytcfg;
      const res = await fetch(`/youtubei/v1/${req.endpoint}?prettyPrint=false`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ context: ytcfg?.get?.('INNERTUBE_CONTEXT'), ...req.body }),
      });
      if (!res.ok) return report(false);
      report(true, (globalThis as any).__ttdFns.parseVideoPage(await res.json()));
    } catch {
      report(false);
    }
  });

  console.log('[ttd] queue page script ready');
  api.ready();
  if (location.pathname === '/watch') {
    hookPlayer();
    reportNavigation();
  }
}
