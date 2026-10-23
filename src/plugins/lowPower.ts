import { Plugin } from '../shared/plugin';

// Hides VP9, VP8 and AV1 from the page before YouTube's player looks, so it picks H.264,
// which the GPU decodes cheaply (spec §5.7). That caps quality at 1080p SDR.
function preferH264(): void {
  const blocked = /vp0?9|vp8|av01/i;
  const ms = (globalThis as any).MediaSource;
  if (ms?.isTypeSupported) {
    const original = ms.isTypeSupported.bind(ms);
    ms.isTypeSupported = (type: string) => (blocked.test(type) ? false : original(type));
  }
  const media = (globalThis as any).HTMLMediaElement?.prototype;
  if (media?.canPlayType) {
    const original = media.canPlayType;
    media.canPlayType = function (this: unknown, type: string) {
      return blocked.test(type) ? '' : original.call(this, type);
    };
  }
}

export const lowPower: Plugin = {
  manifest: {
    id: 'lowPower',
    name: 'Low power (H.264)',
    hint: 'Uses less CPU, but caps every video at 1080p without HDR.',
    defaultEnabled: false,
    settings: [],
  },
  contexts: ['main', 'pip'],
  earlyScript: preferH264,
};
