import { Plugin } from '../../shared/plugin';
import { QUEUE_CSS } from './panelCss';
import { queuePageScript } from './pageScript';
import { parseVideoPage } from './parse';
import { capturePlaylistAndAutoplay, interceptAddToQueue } from './transforms';

export const queue: Plugin = {
  manifest: {
    id: 'queue',
    name: 'Queue',
    defaultEnabled: true,
    settings: [
      { key: 'batchSize', label: 'Shuffle batch size', type: 'number', default: 10, min: 5, max: 25 },
      { key: 'watchedPercent', label: 'Counts as watched at (%)', hint: 'Used by shuffle and Hide watched.', type: 'number', default: 80, min: 50, max: 100 },
    ],
  },
  transforms: {
    browse: interceptAddToQueue,
    search: interceptAddToQueue,
    next: [interceptAddToQueue, capturePlaylistAndAutoplay],
    initialData: [interceptAddToQueue, capturePlaylistAndAutoplay],
  },
  css: QUEUE_CSS,
  pageScript: queuePageScript,
  pageFunctions: { parseVideoPage },
};
