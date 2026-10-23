// Premium already removes YouTube's ads; this is the fallback for when it doesn't (spec
// §5.5). Removes the ad placements from player data (/player and ytInitialPlayerResponse).
// It runs as a transform, serialised on its own, so it reads the ad mode itself.
export function stripAds(data: any, settings: Record<string, unknown> = {}): any {
  if (settings.mode === 'off' || !data || typeof data !== 'object') return data;
  for (const key of ['adPlacements', 'playerAds', 'adSlots', 'adBreakHeartbeatParams']) delete data[key];
  return data;
}
