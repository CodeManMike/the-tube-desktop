// Mute and volume travel with playback between the main window and PiP: each window has
// its own player, so without this a muted video comes back with sound in the other one.
export type AudioState = { muted: boolean; volume: number };

export function audioOf(report: unknown): AudioState | null {
  const r = report as any;
  if (!r || typeof r.muted !== 'boolean' || typeof r.volume !== 'number') return null;
  if (!Number.isFinite(r.volume) || r.volume < 0 || r.volume > 100) return null;
  return { muted: r.muted, volume: Math.round(r.volume) };
}

// Runs in a page; true once the player took it (false if the player isn't there yet).
export function applyAudioScript(a: AudioState): string {
  return `(() => {
  const p = document.querySelector('#movie_player');
  if (!p || !p.setVolume) return false;
  p.setVolume(${Math.round(a.volume)});
  ${a.muted ? 'p.mute()' : 'p.unMute()'};
  return true;
})()`;
}
