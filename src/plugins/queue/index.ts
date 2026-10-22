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
  transforms: {
    browse: interceptAddToQueue,
    search: interceptAddToQueue,
    next: [interceptAddToQueue, pointAutoplayAtQueue, capturePlaylistAndAutoplay],
    initialData: [interceptAddToQueue, pointAutoplayAtQueue, capturePlaylistAndAutoplay],
  },
  css: QUEUE_CSS,
  pageScript: queuePageScript,
};
