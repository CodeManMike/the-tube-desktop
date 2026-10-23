import { Plugin } from '../shared/plugin';
import { devBreak } from './devBreak';
import { hideShorts } from './hideShorts';
import { adSkip } from './adSkip';
import { pip } from './pip';
import { sponsorBlock } from './sponsorBlock';
import { queue } from './queue';

export const ALL_PLUGINS: Plugin[] = [hideShorts, queue, pip, sponsorBlock, adSkip, ...(process.env.TTD_DEV_BREAK === '1' ? [devBreak] : [])];
