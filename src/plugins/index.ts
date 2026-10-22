import { Plugin } from '../shared/plugin';
import { devBreak } from './devBreak';
import { hideShorts } from './hideShorts';

export const ALL_PLUGINS: Plugin[] = [hideShorts, ...(process.env.TTD_DEV_BREAK === '1' ? [devBreak] : [])];
