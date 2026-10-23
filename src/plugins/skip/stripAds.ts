// Premium already removes YouTube's ads; this is the fallback for when it doesn't (spec
// §5.5). Removes the ad placements from player data (/player and ytInitialPlayerResponse).
export function stripAds(data: any): any {
  if (!data || typeof data !== 'object') return data;
  for (const key of ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']) delete data[key];
  return data;
}
