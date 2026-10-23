import { Plugin } from '../shared/plugin';
import { devBreak } from './devBreak';
import { hideShorts } from './hideShorts';
import { pip } from './pip';
import { queue } from './queue';

export const ALL_PLUGINS: Plugin[] = [hideShorts, queue, pip, ...(process.env.TTD_DEV_BREAK === '1' ? [devBreak] : [])];
