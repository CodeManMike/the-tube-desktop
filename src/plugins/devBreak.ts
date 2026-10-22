import { Plugin } from '../shared/plugin';

// Test-only plugin (TTD_DEV_BREAK=1): its transform always throws, to exercise the
// page runtime's fail-safe in the real app.
export const devBreak: Plugin = {
  manifest: {
    id: 'devBreak',
    name: 'Dev: always fails',
    description: 'Test-only. Throws on every feed response to prove the fail-safe.',
    defaultEnabled: true,
    settings: [],
  },
  transforms: {
    browse() {
      throw new Error('deliberate failure');
    },
  },
};
