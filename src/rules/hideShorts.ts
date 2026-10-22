import { Rule } from '../rewrite/types';

export const hideShorts: Rule = {
  name: 'hideShorts',
  // Helpers live inside transform so its toString() is runnable on its own.
  transform(data: any): any {
    const MARKERS = ['reelShelfRenderer', 'shortsLockupViewModel', 'reelItemRenderer'];

    function isShorts(node: any, depth: number): boolean {
      if (!node || typeof node !== 'object' || depth > 4) return false;
      if (Array.isArray(node)) return node.some((n) => isShorts(n, depth + 1));
      for (const key of Object.keys(node)) {
        if (MARKERS.includes(key)) return true;
        if (key === 'richShelfRenderer' && node[key] && node[key].isShorts) return true;
        if (isShorts(node[key], depth + 1)) return true;
      }
      return false;
    }

    function walk(node: any): void {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) {
        for (let i = node.length - 1; i >= 0; i--) {
          if (isShorts(node[i], 0)) node.splice(i, 1);
          else walk(node[i]);
        }
        return;
      }
      for (const key of Object.keys(node)) walk(node[key]);
    }

    walk(data);
    return data;
  },
};
