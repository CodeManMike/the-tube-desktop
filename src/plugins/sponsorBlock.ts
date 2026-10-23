import { Plugin } from '../shared/plugin';
import { SettingDef } from '../shared/settings';
import { decideSkip } from './skip/decide';
import { ttdNotice } from './skip/notice';

const ACTION_LABELS = { auto: 'Skip automatically', button: 'Show a skip button', notify: 'Notify only', ignore: 'Ignore' };
const CATEGORIES: [key: string, label: string, def: string][] = [
  ['sponsor', 'Sponsor', 'auto'],
  ['selfpromo', 'Self-promotion', 'auto'],
  ['interaction', 'Interaction reminder', 'auto'],
  ['intro', 'Intro', 'button'],
  ['outro', 'Outro / end cards', 'button'],
  ['preview', 'Preview / recap', 'button'],
  ['filler', 'Filler', 'ignore'],
  ['music_offtopic', 'Music: non-music section', 'auto'],
];

// Watches the <video> and acts on the current video's SponsorBlock segments (looked up by
// the app, see main/skip/sponsorBlock.ts). Settings hold one action per category.
function sponsorBlockScript(settings: Record<string, unknown>): void {
  const bridge = (window as any).ttdSkip;
  const fns = (globalThis as any).__ttdFns;
  if (!bridge || !fns?.decideSkip || !fns?.ttdNotice) return;
  const NAMES: Record<string, string> = {
    sponsor: 'sponsor', selfpromo: 'self-promotion', interaction: 'interaction reminder', intro: 'intro',
    outro: 'outro', preview: 'preview', filler: 'filler', music_offtopic: 'non-music section',
  };
  const title = (category: string) => (NAMES[category] ?? category).replace(/^./, (c: string) => c.toUpperCase());
  const player = () => document.querySelector('#movie_player') as any;
  const video = () => document.querySelector('#movie_player video.html5-main-video') as HTMLVideoElement | null;
  // Our own seeks (a skip) must not count as "seeking in by hand" for the next segment.
  let selfSeek = false;
  const seek = (t: number) => {
    selfSeek = true;
    const p = player();
    if (p?.seekTo) p.seekTo(t, true);
    else if (video()) video()!.currentTime = t;
  };

  let videoId: string | null = null;
  let looked = false;
  let segments: any[] = [];
  let handled: string[] = [];
  let prev = 0;
  let seeked = false;
  let buttonFor: string | null = null;
  let buttonNote: { close(): void; isOpen(): boolean } | null = null;
  let skipNote: { close(): void } | null = null;
  let timer = 0;
  const hooked = new WeakSet<HTMLVideoElement>();

  const closeButton = () => {
    buttonNote?.close();
    buttonNote = null;
    buttonFor = null;
  };

  // A new video: forget the last one's segments and notes. `prev` starts where playback
  // began (the media element's played range resets per source), so a segment the video
  // started in still counts as entered even if this script hooked in late.
  const reset = (id: string, v: HTMLVideoElement) => {
    videoId = id;
    looked = false;
    segments = [];
    handled = [];
    closeButton();
    skipNote?.close();
    skipNote = null;
    clearTimeout(timer);
    prev = v.played.length ? v.played.start(0) : v.currentTime;
    seeked = false;
  };

  // Look up once the duration is known; never for live streams or premieres.
  const lookUp = (id: string, v: HTMLVideoElement) => {
    if (looked || v.readyState < 1 || !Number.isFinite(v.duration) || v.duration <= 0) return;
    if (player()?.getVideoData?.()?.isLive === true) return;
    looked = true;
    bridge
      .segments(id)
      .then((s: any[]) => {
        if (videoId !== id || !Array.isArray(s)) return;
        segments = s;
        tick(); // a segment the video is already inside gets decided now, not at the next tick
      })
      .catch(() => {});
  };

  const tick = () => {
    const v = video();
    if (!v) return;
    // Ads play in the same <video>: their time has nothing to do with this video's segments.
    if (player()?.classList?.contains('ad-showing')) {
      closeButton();
      return;
    }
    const id = player()?.getVideoData?.()?.video_id;
    if (!id) return;
    if (id !== videoId) reset(id, v);
    lookUp(id, v);
    if (!segments.length) return; // keep `prev` and `seeked` until the segments are known
    // Another note (an ad, a notify) may have replaced the skip button: offer it again.
    if (buttonFor && !buttonNote?.isOpen()) buttonFor = null;
    const now = v.currentTime;
    const d = fns.decideSkip(segments, settings, prev, now, v.duration, seeked, handled);
    prev = now;
    seeked = false;
    if (!d || d.kind !== 'button' || d.segment.uuid !== buttonFor) closeButton();
    if (d?.kind === 'skip') {
      handled.push(d.segment.uuid);
      seek(d.to);
      prev = d.to;
      const seg = d.segment;
      skipNote = fns.ttdNotice(`Skipped ${NAMES[seg.category] ?? seg.category}`, {
        label: 'Undo',
        run: () => {
          if (videoId === id) seek(seg.start); // never seek a video the queue moved on to
        },
      });
    } else if (d?.kind === 'button' && d.segment.uuid !== buttonFor) {
      const seg = d.segment;
      buttonFor = seg.uuid;
      buttonNote = fns.ttdNotice(title(seg.category), {
        label: 'Skip',
        run: () => {
          if (videoId !== id) return;
          handled.push(seg.uuid);
          buttonFor = null;
          seek(Math.min(seg.end, v.duration - 0.25));
        },
      }, 0);
    } else if (d?.kind === 'notify') {
      fns.ttdNotice(title(d.segment.category));
    }
    schedule();
  };

  // timeupdate fires about every 250 ms; also wake exactly at the next segment's start.
  const schedule = () => {
    clearTimeout(timer);
    const v = video();
    if (!v || v.paused || !segments.length) return;
    const next = segments.find((s) => s.start > v.currentTime && !handled.includes(s.uuid) && (settings[s.category] ?? 'ignore') !== 'ignore');
    if (next) timer = window.setTimeout(tick, ((next.start - v.currentTime) / (v.playbackRate || 1)) * 1000 + 20);
  };

  const hook = () => {
    const v = video();
    if (!v || hooked.has(v)) return;
    hooked.add(v);
    v.addEventListener('timeupdate', tick);
    v.addEventListener('seeking', () => {
      if (selfSeek) selfSeek = false;
      else seeked = true;
    });
    for (const ev of ['play', 'ratechange', 'seeked', 'loadedmetadata']) v.addEventListener(ev, tick);
  };
  document.addEventListener('yt-navigate-finish', hook);
  setInterval(hook, 2000);
  hook();
}

export const sponsorBlock: Plugin = {
  manifest: {
    id: 'sponsorBlock',
    name: 'SponsorBlock',
    description: 'Skips sponsor reads and other segments marked by the SponsorBlock community. Only a short hash of the video id is sent.',
    defaultEnabled: true,
    settings: CATEGORIES.map(([key, label, def]): SettingDef => ({
      key,
      label,
      type: 'enum',
      default: def,
      options: Object.keys(ACTION_LABELS),
      optionLabels: ACTION_LABELS,
    })),
  },
  contexts: ['main', 'pip'],
  pageScript: sponsorBlockScript,
  pageFunctions: { decideSkip, ttdNotice },
};
