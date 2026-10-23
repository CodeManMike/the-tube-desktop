import { Plugin } from '../shared/plugin';
import { ttdNotice } from './skip/notice';
import { stripAds } from './skip/stripAds';

// Anything that gets past the stripped player data: YouTube marks the player with
// `ad-showing` while an ad plays in the same <video>.
function adSkipScript(settings: Record<string, unknown>): void {
  if (settings.mode === 'off') return;
  const fns = (globalThis as any).__ttdFns;
  const SKIP_BUTTONS = '.ytp-skip-ad-button, .ytp-ad-skip-button-modern, .ytp-ad-skip-button';
  const video = () => document.querySelector('#movie_player video.html5-main-video') as HTMLVideoElement | null;
  let inAd = false;
  let wasMuted = false;
  let note: { close(): void } | null = null;
  let retry = 0;

  const skip = () => {
    const button = document.querySelector(SKIP_BUTTONS) as HTMLElement | null;
    if (button) button.click();
    else {
      const v = video();
      if (v && Number.isFinite(v.duration) && v.duration > 0) v.currentTime = v.duration;
    }
  };

  const onAdChange = (showing: boolean) => {
    if (showing === inAd) return;
    inAd = showing;
    const v = video();
    if (showing) {
      if (settings.mode === 'auto') {
        wasMuted = !!v?.muted;
        if (v) v.muted = true;
        skip();
        retry = window.setInterval(skip, 500); // a skip button can appear a few seconds in
        note = fns?.ttdNotice?.('Skipped an ad');
      } else {
        note = fns?.ttdNotice?.('Ad playing', { label: 'Skip ad', run: skip }, 0);
      }
    } else {
      clearInterval(retry);
      if (settings.mode === 'auto' && v) v.muted = wasMuted;
      if (settings.mode !== 'auto') note?.close();
      note = null;
    }
  };

  let observed: Element | null = null;
  const observer = new MutationObserver(() => onAdChange(!!observed?.classList.contains('ad-showing')));
  const attach = () => {
    const p = document.querySelector('#movie_player');
    if (!p || p === observed) return;
    observer.disconnect();
    observed = p;
    observer.observe(p, { attributes: true, attributeFilter: ['class'] });
    onAdChange(p.classList.contains('ad-showing'));
  };
  document.addEventListener('yt-navigate-finish', attach);
  setInterval(attach, 2000);
  attach();
}

export const adSkip: Plugin = {
  manifest: {
    id: 'adSkip',
    name: 'Ad skip',
    hint: "Only matters when YouTube Premium isn't removing ads.",
    defaultEnabled: true,
    settings: [
      {
        key: 'mode',
        label: 'When an ad gets through',
        type: 'enum',
        default: 'auto',
        options: ['off', 'auto', 'button'],
        optionLabels: { off: 'Off', auto: 'Skip automatically', button: 'Show a skip button' },
      },
    ],
  },
  contexts: ['main', 'pip'],
  transforms: { player: stripAds, initialPlayerResponse: stripAds },
  pageScript: adSkipScript,
  pageFunctions: { ttdNotice },
};
