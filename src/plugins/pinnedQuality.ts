import { Plugin } from '../shared/plugin';

// The quality to pin from what the player offers (spec §5.7): the preferred one, else the
// best lower one, else the lowest one offered. Never 'auto'. A page function: self-contained.
export function chooseQuality(available: string[], preferred: string): string | null {
  const ORDER = ['hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium', 'small', 'tiny'];
  const offered = ORDER.filter((q) => available.includes(q));
  if (!offered.length) return null;
  if (preferred === 'highest') return offered[0];
  const want = ORDER.indexOf(preferred);
  if (want < 0) return offered[0];
  return offered.find((q) => ORDER.indexOf(q) >= want) ?? offered[offered.length - 1];
}

// Pins the chosen quality on every new video, once the player knows what it offers.
function pinnedQualityScript(settings: Record<string, unknown>): void {
  const fns = (globalThis as any).__ttdFns;
  const player = () => document.querySelector('#movie_player') as any;
  let pinnedFor: string | null = null;
  const apply = () => {
    const p = player();
    const id = p?.getVideoData?.()?.video_id;
    if (!id || id === pinnedFor || !p.setPlaybackQualityRange) return;
    const q = fns?.chooseQuality?.(p.getAvailableQualityLevels?.() ?? [], String(settings.quality ?? 'highest'));
    if (!q) return; // levels not known yet; try again on the next event
    p.setPlaybackQualityRange(q, q);
    pinnedFor = id;
  };
  const hooked = new WeakSet<Element>();
  const hook = () => {
    const v = document.querySelector('#movie_player video.html5-main-video');
    if (!v || hooked.has(v)) return;
    hooked.add(v);
    for (const ev of ['loadedmetadata', 'canplay', 'playing']) v.addEventListener(ev, apply);
  };
  document.addEventListener('yt-navigate-finish', () => {
    hook();
    apply();
  });
  setInterval(() => {
    hook();
    apply();
  }, 2000);
}

const LEVELS = ['highest', 'hd2160', 'hd1440', 'hd1080', 'hd720', 'large', 'medium'];

export const pinnedQuality: Plugin = {
  manifest: {
    id: 'pinnedQuality',
    name: 'Pinned quality',
    defaultEnabled: true,
    settings: [
      {
        key: 'quality',
        label: 'Quality',
        type: 'enum',
        default: 'highest',
        options: LEVELS,
        optionLabels: { highest: 'Highest available', hd2160: '2160p', hd1440: '1440p', hd1080: '1080p', hd720: '720p', large: '480p', medium: '360p' },
      },
    ],
  },
  contexts: ['main', 'pip'],
  pageScript: pinnedQualityScript,
  pageFunctions: { chooseQuality },
};
