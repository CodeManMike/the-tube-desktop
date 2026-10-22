import { Plugin } from '../../shared/plugin';
import { QUEUE_CSS } from './panelCss';
import { queuePageScript } from './pageScript';
import { capturePlaylistAndAutoplay, interceptAddToQueue, pointAutoplayAtQueue } from './transforms';

export const queue: Plugin = {
  manifest: {
    id: 'queue',
    name: 'Queue',
    description: 'Keeps your queue across navigation and restarts, with detours you can return from.',
    defaultEnabled: true,
    settings: [
      { key: 'batchSize', label: 'Shuffle adds this many videos at a time', type: 'number', default: 10, min: 5, max: 25 },
      { key: 'watchedPercent', label: 'Count a video as watched at (%)', type: 'number', default: 80, min: 50, max: 100 },
    ],
  },
  // Capture runs before the autoplay redirect so it records YouTube's real pick.
  transforms: {
    browse: interceptAddToQueue,
    search: interceptAddToQueue,
    next: [interceptAddToQueue, capturePlaylistAndAutoplay, pointAutoplayAtQueue],
    initialData: [interceptAddToQueue, capturePlaylistAndAutoplay, pointAutoplayAtQueue],
  },
  css: QUEUE_CSS,
  pageScript: queuePageScript,
};
