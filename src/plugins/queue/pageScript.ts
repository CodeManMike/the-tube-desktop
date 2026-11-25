// The queue's page side: renders the panel, reports what happens to the main process,
// and carries out navigation commands. Serialised with toString(), so self-contained.
export function queuePageScript(_settings: Record<string, unknown>): void {
  const api = (window as any).ttd?.queue;
  if (!api) return;

  type Item = { uid: string; videoId: string; title: string; channel: string; thumbnail: string; durationSec?: number; played?: true; source?: 'shuffle' | 'autoplay' };
  type Point = { kind: 'video'; videoId: string; timeSec: number } | { kind: 'queue'; items: Item[]; current: number | null; resumeTimeSec: number };
  type Shuffle = { kind: 'creators'; creators: { channelId: string; name: string }[] } | { kind: 'topic'; query: string };
  type State = { items: Item[]; current: number | null; returnStack: Point[]; shuffle: Shuffle | null; shuffleExhausted: boolean; detourVideoId: string | null; sourceListId: string | null };

  let state: State | null = null;
  let lastSeq = 0;
  let lastPlaying: { videoId: string; timeSec: number; title?: string; channel?: string } | null = null;
  let lastReportedNav = '';
  // What was playing when the current navigation started (see yt-navigate-start below).
  let navFrom: { videoId: string; timeSec: number; title?: string; channel?: string } | null = null;
  let drawer: HTMLElement | null = null;
  let panel: HTMLElement | null = null;
  let toggle: HTMLButtonElement | null = null;
  let feedback: HTMLElement | null = null;
  let feedbackTimer: ReturnType<typeof setTimeout> | undefined;
  let videoMenu: HTMLElement | null = null;
  let isOpen = false;
  let savedScroll = 0;
  let queueNext: string | null = null;
  let miniPlayer: Element | null = null;
  const miniPlayerSelector = 'ytd-miniplayer[active], ytd-app[miniplayer-is-active] ytd-miniplayer';
  let dragUid: string | null = null;
  let lastCurrentUid: string | null = null;
  // The current video's creator (from the watch data), for the Shuffle menu.
  let currentOwner: { channelId: string; name: string } | null = null;
  let menuOpen = false;
  let topicInput = false;
  let activePlayerId: string | null = null;
  let reportedEnd: string | null = null;
  // What's typed in the topic box, kept across re-renders (state updates rebuild the panel).
  let topicDraft = '';
  const hookedPlayers = new WeakSet<object>();

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
  const navigate = (videoId: string, timeSec: number, playlistId?: string) => {
    const p = player();
    if (!playlistId && location.pathname !== '/watch' && document.querySelector(miniPlayerSelector) && p?.loadVideoById) {
      p.loadVideoById(videoId, timeSec);
      return;
    }
    if (!playlistId && !new URLSearchParams(location.search).has('list') && urlVideoId() === videoId && player()?.seekTo) {
      player().seekTo(timeSec, true);
      player().playVideo?.();
      return;
    }
    const t = Math.floor(timeSec);
    const params = new URLSearchParams({ v: videoId });
    if (playlistId) params.set('list', playlistId);
    if (t > 0) params.set('t', t + 's');
    const url = '/watch?' + params;
    document.querySelector('ytd-app')?.dispatchEvent(
      new CustomEvent('yt-navigate', {
        bubbles: true,
        composed: true,
        detail: {
          endpoint: {
            commandMetadata: { webCommandMetadata: { url, webPageType: 'WEB_PAGE_TYPE_WATCH', rootVe: 3832 } },
            watchEndpoint: { videoId, ...(playlistId && { playlistId }), ...(t > 0 && { startTimeSeconds: t }) },
          },
        },
      }),
    );
  };

  const cardSelector = 'ytd-rich-item-renderer, ytd-video-renderer, ytd-compact-video-renderer, ytd-grid-video-renderer, yt-lockup-view-model';
  const videoCard = (target: Element) => target.closest('ytd-rich-item-renderer') ?? target.closest(cardSelector);
  const validId = (id: unknown): id is string => typeof id === 'string' && /^[\w-]{11}$/.test(id);
  const itemFor = (videoId: string, title?: string, channel?: string) => ({
    videoId, title: title?.trim() || videoId, channel: channel?.trim() || '',
    thumbnail: 'https://i.ytimg.com/vi/' + videoId + '/mqdefault.jpg',
  });

  const currentItem = () => {
    const video = player()?.getVideoData?.();
    const id = urlVideoId() ?? (document.querySelector(miniPlayerSelector) ? video?.video_id : null);
    if (!validId(id)) return null;
    return itemFor(id, video?.video_id === id ? video.title : undefined, video?.video_id === id ? video.author : undefined);
  };

  const cardItem = (card: Element) => {
    const link = card.querySelector<HTMLAnchorElement>('a[href^="/watch?"], a[href^="https://www.youtube.com/watch?"]');
    if (!link) return null;
    const id = new URL(link.href).searchParams.get('v');
    if (!validId(id)) return null;
    const title = card.querySelector('#video-title, .yt-lockup-metadata-view-model__title');
    return itemFor(id, title?.textContent ?? link.getAttribute('aria-label') ?? undefined, card.querySelector('#channel-name')?.textContent ?? undefined);
  };

  const addItem = (item: ReturnType<typeof itemFor>, fromPlayer = false) => {
    api.report({ type: 'add', item, ...(fromPlayer && { fromPlayer: true }) });
    if (!feedback) return;
    feedback.textContent = 'Added to queue · ' + item.title;
    clearTimeout(feedbackTimer);
    feedbackTimer = setTimeout(() => { if (feedback) feedback.textContent = ''; }, 3000);
  };

  const closeVideoMenu = () => {
    videoMenu?.remove();
    videoMenu = null;
  };

  const mixFor = (videoId: string) => navigate(videoId, 0, 'RD' + videoId);

  const addCardButton = (event: Event) => {
    const card = event.target instanceof Element ? videoCard(event.target) : null;
    if (!card || card.querySelector('.ttd-card-add') || !cardItem(card)) return;
    const add = el('button', 'ttd-card-add', '+ Queue');
    add.setAttribute('aria-label', 'Add to queue');
    add.setAttribute('title', 'Add to queue');
    add.addEventListener('click', (click) => {
      click.preventDefault();
      click.stopPropagation();
      const item = cardItem(card);
      if (item) addItem(item);
    });
    card.classList.add('ttd-queue-card');
    card.append(add);
  };

  window.addEventListener('pointerover', addCardButton, true);
  window.addEventListener('focusin', addCardButton, true);
  window.addEventListener('contextmenu', (event) => {
    if (!(event.target instanceof Element) || drawer?.contains(event.target)) return;
    const inPlayer = !!event.target.closest('#movie_player, ytd-miniplayer');
    const card = videoCard(event.target);
    const item = inPlayer ? currentItem() : card && cardItem(card);
    if (!item || !document.body) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    closeVideoMenu();
    videoMenu = el('div', 'ttd-queue-context ttd-queue');
    const option = (label: string, action: () => void) => {
      const button = el('button', undefined, label);
      button.addEventListener('click', () => { closeVideoMenu(); action(); });
      videoMenu!.append(button);
    };
    option('Add to queue', () => addItem(item, inPlayer));
    if (inPlayer) option('Make a mix from this video', () => mixFor(item.videoId));
    (document.fullscreenElement ?? document.body).append(videoMenu);
    videoMenu.style.left = Math.max(4, Math.min(event.clientX, innerWidth - videoMenu.offsetWidth - 4)) + 'px';
    videoMenu.style.top = Math.max(4, Math.min(event.clientY, innerHeight - videoMenu.offsetHeight - 4)) + 'px';
    videoMenu.querySelector('button')?.focus();
  }, true);

  window.addEventListener('pointerdown', (event) => {
    if (event.target instanceof Node && !videoMenu?.contains(event.target)) closeVideoMenu();
  }, true);
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && videoMenu) {
      event.stopImmediatePropagation();
      closeVideoMenu();
    }
  }, true);

  // Route the player's own buttons through the same model as the tray and PiP controls.
  window.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return;
    const control = event.target.closest('.ytp-next-button, .ytp-prev-button');
    if (!control) return;
    const next = control.classList.contains('ytp-next-button');
    if (next ? !queueNext : state?.current == null && !state?.detourVideoId) return;
    const id = player()?.getVideoData?.()?.video_id ?? urlVideoId();
    if (!validId(id)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    api.report({ type: 'action', action: next ? 'next' : 'previous', videoId: id });
  }, true);

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
    if (s.items.filter((item, index) => !item.played && index !== s.current).length > 1) {
      option('Shuffle queue', () => api.report({ type: 'action', action: 'shufflePending' }));
    }
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

  const spaceForMiniPlayer = () => {
    if (!drawer) return;
    const bounds = miniPlayer?.getBoundingClientRect();
    // We keep the list usable above the player when there's room, and let the
    // player cover the drawer on short windows rather than covering its controls.
    if (bounds && bounds.height > 0 && bounds.right > innerWidth / 2) {
      drawer.style.setProperty('--ttd-queue-bottom', Math.max(16, innerHeight - bounds.top + 8) + 'px');
    } else {
      drawer.style.removeProperty('--ttd-queue-bottom');
    }
  };

  const miniPlayerResize = new ResizeObserver(spaceForMiniPlayer);
  const miniPlayerVisibility = new MutationObserver(() => {
    reportActivePlayer();
    render();
  });
  let observedApp: Element | null = null;
  let observedMiniPlayer: Element | null = null;

  const placeDrawer = () => {
    if (!drawer || !document.body) return;
    const app = document.querySelector('ytd-app');
    const fullscreen = document.fullscreenElement;
    const host = fullscreen && !fullscreen.matches('video') ? fullscreen : app ?? document.body;
    if (drawer.parentElement !== host) host.append(drawer);
    drawer.classList.toggle('ttd-queue-fullscreen', !!fullscreen);

    const mini = document.querySelector('ytd-miniplayer');
    if (app !== observedApp || mini !== observedMiniPlayer) {
      miniPlayerVisibility.disconnect();
      if (app) miniPlayerVisibility.observe(app, { attributes: true, attributeFilter: ['miniplayer-is-active'] });
      if (mini) miniPlayerVisibility.observe(mini, { attributes: true, attributeFilter: ['active'] });
      observedApp = app;
      observedMiniPlayer = mini;
    }
    const active = fullscreen ? null : document.querySelector(miniPlayerSelector);
    if (active !== miniPlayer) {
      miniPlayerResize.disconnect();
      if (active) miniPlayerResize.observe(active);
      miniPlayer = active;
    }
    spaceForMiniPlayer();
  };

  const render = () => {
    if (!state || !document.body) return;
    if (!drawer) {
      drawer = el('div', 'ttd-queue-drawer');
      toggle = el('button', 'ttd-queue-toggle') as HTMLButtonElement;
      toggle.setAttribute('aria-controls', 'ttd-queue-panel');
      toggle.addEventListener('click', () => {
        isOpen = !isOpen;
        if (!isOpen) menuOpen = false;
        render();
      });
      feedback = el('div', 'ttd-queue-feedback');
      feedback.setAttribute('role', 'status');
      panel = el('section', 'ttd-queue');
      panel.id = 'ttd-queue-panel';
      panel.setAttribute('aria-label', 'Playback queue');
      drawer.append(toggle, panel, feedback);
    }
    placeDrawer();
    if (!panel || !toggle) return;

    const s = state;
    toggle.textContent = 'Queue (' + s.items.length + ')';
    toggle.setAttribute('aria-expanded', String(isOpen));
    const oldList = panel.querySelector('.ttd-queue-list');
    if (oldList && !panel.hidden) savedScroll = oldList.scrollTop;
    panel.hidden = !isOpen;
    if (!isOpen) return;
    const head = el('div', 'ttd-queue-head');
    const title = el('div', 'ttd-queue-title', 'Queue');
    title.append(el('span', 'ttd-queue-count', s.items.length ? `${s.items.length} video${s.items.length === 1 ? '' : 's'}` : ''));
    head.append(title);
    const back = backLabel(s);
    if (back) {
      const btn = el('button', 'ttd-queue-back', back);
      btn.title = back;
      btn.addEventListener('click', () => {
        const restoringQueue = s.returnStack[s.returnStack.length - 1]?.kind === 'queue';
        if (restoringQueue && s.items.length && !window.confirm('Return to the previous queue? This discards the current list.')) return;
        api.report({ type: 'action', action: 'back' });
      });
      head.append(btn);
    }
    const shuffleBtn = el('button', 'ttd-queue-back ttd-shuffle-toggle', 'Shuffle ▾');
    shuffleBtn.addEventListener('click', () => {
      menuOpen = !menuOpen;
      topicInput = false;
      render();
    });
    head.append(shuffleBtn);
    if (s.items.length || s.returnStack.length) {
      const clearBtn = el('button', 'ttd-queue-back', 'Clear');
      clearBtn.title = 'Clear the queue and saved return points';
      clearBtn.addEventListener('click', () => {
        if (confirmClear()) api.report({ type: 'action', action: 'clear' });
      });
      head.append(clearBtn);
    }

    const children: HTMLElement[] = [head];
    const watching = currentItem();
    if (watching) {
      const actions = el('div', 'ttd-queue-tools');
      const add = el('button', 'ttd-queue-back', 'Add current video');
      add.addEventListener('click', () => addItem(watching, true));
      const mix = el('button', 'ttd-queue-back', 'Make a mix');
      mix.addEventListener('click', () => mixFor(watching.videoId));
      actions.append(add, mix);
      children.push(actions);
    }
    if (s.sourceListId) children.push(el('div', 'ttd-queue-section', s.sourceListId.startsWith('RD') ? 'YouTube Mix' : 'YouTube playlist'));
    const current = s.current === null ? null : s.items[s.current];
    const sourceLabel = (item: Item) => item.source === 'shuffle' ? ' · Shuffle' : item.source === 'autoplay' ? ' · YouTube autoplay' : '';
    const now = s.detourVideoId && watching
      ? 'Watching outside queue · ' + watching.title
      : current && 'Now playing · ' + current.title + sourceLabel(current);
    if (now) {
      const label = el('div', 'ttd-queue-now', now);
      label.title = now;
      children.push(label);
    }
    if (!current && s.items.some((item) => !item.played)) {
      const start = el('button', 'ttd-queue-back ttd-queue-start', 'Play queue');
      start.addEventListener('click', () => api.report({ type: 'action', action: 'start' }));
      children.push(start);
    }
    if (menuOpen) children.push(shuffleMenu(s));
    const chip = shuffleChip(s);
    if (chip) children.push(chip);
    if (!s.items.length) {
      children.push(el('div', 'ttd-queue-empty', 'Use “Add to queue” on any video to start a queue. It stays put while you browse.'));
    } else {
      const list = el('div', 'ttd-queue-list');
      const pending = s.items.filter((item, index) => index !== s.current && !item.played);
      const history = s.items.filter((item, index) => index !== s.current && item.played);
      const ordered = [...pending, ...history];
      if (pending.length) list.append(el('div', 'ttd-queue-section', 'Up next'));
      ordered.forEach((item, index) => {
        if (item.played && index === pending.length) list.append(el('div', 'ttd-queue-section', 'Played or skipped'));
        const row = el('div', 'ttd-q-item');
        if (item.played) row.classList.add('played');
        row.draggable = !item.played;
        row.tabIndex = 0;
        row.addEventListener('keydown', (event) => {
          if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
          event.preventDefault();
          event.stopPropagation();
          api.report({ type: 'action', action: 'jump', uid: item.uid });
        });
        row.append(el('div', 'ttd-q-index', item.played ? '✓' : String(index + 1)));
        const img = el('img', 'ttd-q-thumb') as HTMLImageElement;
        img.src = item.thumbnail;
        img.alt = '';
        img.loading = 'lazy';
        const text = el('div', 'ttd-q-text');
        text.append(el('div', 'ttd-q-name', item.title), el('div', 'ttd-q-channel', item.channel + sourceLabel(item)));
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
        if (!item.played) {
          action('⤒', 'Move to top', () => api.report({ type: 'move', uid: item.uid, toIndex: 0 }));
          action('⤓', 'Move to bottom', () => api.report({ type: 'move', uid: item.uid, toIndex: s.items.length - 1 }));
        }
        action('✕', 'Remove', () => api.report({ type: 'action', action: 'remove', uid: item.uid }));
        row.append(actions);

        row.addEventListener('click', () => {
          api.report({ type: 'action', action: 'jump', uid: item.uid });
        });
        row.addEventListener('dragstart', (e) => {
          dragUid = item.uid;
          e.dataTransfer?.setData('text/plain', item.uid);
        });
        row.addEventListener('dragover', (e) => {
          if (!dragUid || item.played) return;
          e.preventDefault();
          row.classList.add('drop-before');
        });
        row.addEventListener('dragleave', () => row.classList.remove('drop-before'));
        row.addEventListener('drop', (e) => {
          if (!dragUid || item.played) return;
          e.preventDefault();
          row.classList.remove('drop-before');
          const from = s.items.findIndex((i) => i.uid === dragUid);
          const to = s.items.findIndex((i) => i.uid === item.uid);
          if (from >= 0 && dragUid !== item.uid) api.report({ type: 'move', uid: dragUid, toIndex: from < to ? to - 1 : to });
          dragUid = null;
        });
        row.addEventListener('dragend', () => { dragUid = null; });
        list.append(row);
      });
      children.push(list);
    }
    panel.replaceChildren(...children);

    const list = panel.querySelector('.ttd-queue-list');
    const currentUid = current?.uid ?? null;
    if (list) list.scrollTop = currentUid !== lastCurrentUid ? 0 : savedScroll;
    lastCurrentUid = currentUid;
  };

  const reportActivePlayer = () => {
    const id = currentItem()?.videoId ?? null;
    if (id === activePlayerId) return;
    activePlayerId = id;
    api.report({ type: 'activePlayer', videoId: id });
  };

  const reportProgress = (p: any, playing: boolean, seek = false) => {
    if (p.matches('.ad-showing, .ad-interrupting')) return;
    const vd = p.getVideoData?.() ?? {};
    if (!validId(vd.video_id) || currentItem()?.videoId !== vd.video_id) return;
    lastPlaying = { videoId: vd.video_id, timeSec: p.getCurrentTime(), title: vd.title, channel: vd.author };
    api.report({ type: 'progress', ...lastPlaying, durationSec: p.getDuration() || 0, playing, rate: p.getPlaybackRate?.() ?? 1, ...(seek && { seek: true }) });
  };

  window.addEventListener('seeking', (event) => {
    if (event.target instanceof HTMLVideoElement && event.target.closest('#movie_player') === player()) {
      const p = player();
      if (p) reportProgress(p, false, true);
    }
  }, true);

  const reportEnded = (id: unknown) => {
    if (!validId(id) || reportedEnd === id) return;
    reportedEnd = id;
    api.report({ type: 'ended', videoId: id });
  };

  window.addEventListener('ended', (event) => {
    if (!(event.target instanceof HTMLVideoElement) || event.target.closest('#movie_player') !== player()) return;
    const p = player();
    if (p?.matches('.ad-showing, .ad-interrupting')) return;
    const id = p?.getVideoData?.()?.video_id;
    if (!validId(id) || currentItem()?.videoId !== id) return;
    if (queueNext && (state?.current == null || state.items[state.current]?.videoId === id || state.detourVideoId === id)) {
      event.stopImmediatePropagation();
    }
    reportEnded(id);
  }, true);

  const hookPlayer = () => {
    const p = player();
    if (!p?.addEventListener || hookedPlayers.has(p)) return;
    hookedPlayers.add(p);
    p.addEventListener('onStateChange', (st: number) => {
      const videoId = p.getVideoData?.()?.video_id ?? urlVideoId();
      if (st === 0 && !p.matches('.ad-showing, .ad-interrupting')) reportEnded(videoId);
      else if (st === 1 || st === 2 || st === 3) {
        if (st === 1) reportedEnd = null;
        reportProgress(p, st === 1);
      }
      reportActivePlayer();
    });
  };

  const confirmClear = (reason = 'Clear the queue?') => {
    const saved = state?.returnStack.length ? ' This also discards saved return points and previous lineups.' : '';
    return window.confirm(reason + saved + ' Select OK to clear or Cancel to keep it.');
  };

  const reportNavigation = () => {
    if (!state) return;
    const videoId = urlVideoId();
    if (!videoId) {
      lastReportedNav = '';
      currentOwner = null;
      return;
    }
    if (location.href === lastReportedNav) return;
    currentOwner = null;
    lastReportedNav = location.href;
    const from = navFrom ?? lastPlaying;
    navFrom = null;
    const listParam = new URL(location.href).searchParams.get('list');
    const depth = state?.returnStack.filter((point) => point.kind === 'video').length ?? 0;
    const savedQueues = state?.returnStack.filter((point) => point.kind === 'queue').length ?? 0;
    const isNewList = !!listParam && listParam !== state?.sourceListId;
    const isNewDetour = !!state?.detourVideoId && videoId !== state.detourVideoId &&
      !state.items.some((item) => item.videoId === videoId) &&
      !state.returnStack.some((point) => point.kind === 'video' && point.videoId === videoId) && !isNewList;
    const mustClear = (isNewDetour && depth >= 2) || (isNewList && savedQueues >= 10);
    if (mustClear) {
      const p = player();
      const wasPlaying = p?.getPlayerState?.() === 1;
      if (wasPlaying) p.pauseVideo?.();
      if (!confirmClear('Continuing will clear your saved queue.')) {
        const detourId = state?.detourVideoId;
        const savedId = state?.current == null ? null : state.items[state.current]?.videoId;
        const origin = isNewDetour ? detourId : from?.videoId ?? detourId ?? savedId;
        if (origin) navigate(origin, from?.videoId === origin ? from.timeSec : 0);
        return;
      }
      api.report({ type: 'action', action: 'clear' });
      if (wasPlaying) p.playVideo?.();
    }
    api.report({ type: 'navigated', videoId, from: from && (from.videoId !== videoId || listParam) ? from : null });
    // In-app navigations don't pass through the fetch hook: read the watch page's own data
    // (ytd-watch-flexy), which YouTube swaps in shortly after yt-navigate-finish. Wait until
    // it belongs to this video, so another video's playlist or autoplay pick is never used.
    let tries = 0;
    const expectedUrl = location.href;
    const sendWatchData = () => {
      if (location.href !== expectedUrl) return;
      const flexy = document.querySelector('ytd-watch-flexy') as any;
      const pageData = flexy?.__data?.data ?? flexy?.data;
      if (pageData && typeof (globalThis as any).__ttdCaptureWatch === 'function') (globalThis as any).__ttdCaptureWatch(pageData, {});
      const captured = (globalThis as any).__ttdLastWatchData;
      const matchesWatch = captured?.videoId === videoId;
      const matchesPlaylist = !listParam || captured?.playlist?.playlistId === listParam;
      if ((!matchesWatch || !matchesPlaylist) && ++tries < 16) {
        setTimeout(sendWatchData, 250);
        return;
      }
      const data = matchesWatch ? captured : {};
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
    queueNext = payload.nextVideoId;
    render();
    if (payload.command && payload.seq > lastSeq) navigate(payload.command.navigate.videoId, payload.command.navigate.timeSec);
    else if (!lastReportedNav) reportNavigation();
    lastSeq = Math.max(lastSeq, payload.seq);
  });

  // YouTube fires yt-navigate-start after the URL has changed but while the player still
  // holds the outgoing video: snapshot it then. The 5 s progress sample alone can be stale
  // or already overwritten by the next video.
  document.addEventListener('yt-navigate-start', () => {
    closeVideoMenu();
    const p = player();
    const vd = p?.getVideoData?.() ?? {};
    if (typeof vd.video_id === 'string' && vd.video_id) {
      navFrom = { videoId: vd.video_id, timeSec: p.getCurrentTime(), title: vd.title, channel: vd.author };
    }
  });

  document.addEventListener('yt-navigate-finish', () => {
    hookPlayer();
    reportNavigation();
    reportActivePlayer();
    render();
  });

  document.addEventListener('fullscreenchange', () => {
    closeVideoMenu();
    placeDrawer();
  });
  window.addEventListener('resize', placeDrawer);

  // Progress for watch history and return points, and remount if the page replaces its app root.
  setInterval(() => {
    hookPlayer();
    const p = player();
    if (p?.getPlayerState?.() === 1) reportProgress(p, true);
    reportActivePlayer();
    if (state && !drawer?.isConnected) render();
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
  hookPlayer();
  reportNavigation();
  reportActivePlayer();
}
