import { Plugin } from '../shared/plugin';
import { devBreak } from './devBreak';
import { hideShorts } from './hideShorts';
import { queue } from './queue';

export const ALL_PLUGINS: Plugin[] = [hideShorts, queue, ...(process.env.TTD_DEV_BREAK === '1' ? [devBreak] : [])];
