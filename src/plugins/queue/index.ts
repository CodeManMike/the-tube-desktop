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
    settings: [],
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
