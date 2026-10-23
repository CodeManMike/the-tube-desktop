import { Plugin } from '../shared/plugin';
import { channelBlocklist } from './channelBlocklist';
import { devBreak } from './devBreak';
import { hideShorts } from './hideShorts';
import { hideWatched } from './hideWatched';
import { hotkeys } from './hotkeys';
import { adSkip } from './adSkip';
import { lowPower } from './lowPower';
import { pinnedQuality } from './pinnedQuality';
import { pip } from './pip';
import { sponsorBlock } from './sponsorBlock';
import { theme } from './theme';
import { tray } from './tray';
import { queue } from './queue';
import { ryd } from './ryd';

export const ALL_PLUGINS: Plugin[] = [hideShorts, queue, pip, sponsorBlock, adSkip, lowPower, pinnedQuality, hideWatched, channelBlocklist, ryd, theme, hotkeys, tray, ...(process.env.TTD_DEV_BREAK === '1' ? [devBreak] : [])];
