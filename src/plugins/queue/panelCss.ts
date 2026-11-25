// Styled after YouTube's dark playlist panel. TTD's queue replaces YouTube's own
// playlist panel and miniplayer queue while the plugin is on.
export const QUEUE_CSS = `
ytd-watch-flexy ytd-playlist-panel-renderer#playlist { display: none !important; }
ytd-miniplayer #playlist, ytd-miniplayer ytd-playlist-panel-renderer { display: none !important; }
ytd-miniplayer[active], ytd-app[miniplayer-is-active] ytd-miniplayer { z-index: 2110 !important; }

.ttd-queue {
  border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,.1));
  border-radius: 12px; overflow: hidden;
  font-family: Roboto, Arial, sans-serif; color: var(--yt-spec-text-primary, #f1f1f1);
  background: var(--yt-spec-base-background, #0f0f0f);
}
.ttd-queue-drawer {
  position: fixed; inset: 64px 16px min(var(--ttd-queue-bottom, 16px), 45vh) auto; z-index: 2100;
  display: flex; flex-direction: column; align-items: flex-end; gap: 8px;
  pointer-events: none;
  font-family: Roboto, Arial, sans-serif; color: var(--yt-spec-text-primary, #f1f1f1);
}
.ttd-queue-drawer .ttd-queue {
  width: min(440px, calc(100vw - 32px)); min-height: 0; overflow-y: auto;
  box-shadow: 0 8px 24px rgba(0,0,0,.34);
}
.ttd-queue-drawer > :not([hidden]) { pointer-events: auto; }
.ttd-queue-drawer.ttd-queue-fullscreen { top: 16px; z-index: 10001; }
.ttd-queue-drawer .ttd-queue[hidden] { display: none; }
.ttd-queue-toggle, .ttd-card-add {
  border: 1px solid var(--yt-spec-20-percent-layer, rgba(255,255,255,.22));
  border-radius: 18px; padding: 7px 13px; cursor: pointer; font: 600 13px Roboto, Arial, sans-serif;
  color: var(--yt-spec-text-primary, #fff); background: var(--yt-spec-base-background, #181818);
}
.ttd-queue-toggle:hover, .ttd-card-add:hover { background: var(--yt-spec-menu-background, #303030); }
.ttd-queue-feedback {
  max-width: min(400px, calc(100vw - 48px)); padding: 8px 12px;
  border-radius: 10px; background: var(--yt-spec-menu-background, #303030); font-size: 13px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ttd-queue-feedback:empty { display: none; }
.ttd-queue-tools { display: flex; gap: 8px; padding: 8px 16px; }
.ttd-queue-now, .ttd-queue-section {
  padding: 8px 16px; overflow: hidden; white-space: nowrap; text-overflow: ellipsis;
}
.ttd-queue-now { font-size: 13px; background: rgba(255,59,48,.14); }
.ttd-queue-section { font-size: 12px; font-weight: 600; color: var(--yt-spec-text-secondary, #aaa); }
.ttd-queue-start { margin: 8px 16px; }
.ttd-queue-card { position: relative; }
.ttd-card-add { position: absolute; top: 8px; left: 8px; z-index: 2; }
.ttd-queue-card:not(:hover):not(:focus-within) .ttd-card-add { opacity: 0; pointer-events: none; }
.ttd-queue-context { position: fixed; z-index: 2200; padding: 4px; min-width: 160px; box-shadow: 0 8px 24px rgba(0,0,0,.34); }
.ttd-queue-context button {
  display: block; width: 100%; padding: 8px 10px; border: 0; border-radius: 6px; text-align: left;
  color: inherit; background: transparent; cursor: pointer; white-space: nowrap;
}
.ttd-queue-context button:hover, .ttd-queue-context button:focus-visible {
  background: var(--yt-spec-20-percent-layer, rgba(255,255,255,.2));
}
.ttd-queue-head { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: var(--yt-spec-badge-chip-background, rgba(255,255,255,.05)); }
.ttd-queue-title { font-size: 16px; font-weight: 700; flex: 1; }
.ttd-queue-count { font-size: 12px; color: var(--yt-spec-text-secondary, #aaa); font-weight: 400; margin-left: 6px; }
.ttd-queue-back {
  border: 0; border-radius: 16px; padding: 6px 12px; cursor: pointer; font: 500 12px Roboto, Arial, sans-serif;
  background: var(--yt-spec-10-percent-layer, rgba(255,255,255,.1)); color: inherit; max-width: 260px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.ttd-queue-back:hover { background: var(--yt-spec-20-percent-layer, rgba(255,255,255,.2)); }
.ttd-queue-list { max-height: min(420px, 54vh); overflow-y: auto; padding: 4px 0; position: relative; }
.ttd-queue-empty { padding: 12px 16px 16px; font-size: 13px; color: var(--yt-spec-text-secondary, #aaa); }
.ttd-q-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 4px; cursor: pointer; position: relative; }
.ttd-q-item:hover { background: var(--yt-spec-badge-chip-background, rgba(255,255,255,.08)); }
.ttd-q-item.played { opacity: .55; }
.ttd-q-item.drop-before { box-shadow: inset 0 2px 0 #ff3b30; }
.ttd-q-index { width: 22px; text-align: center; font-size: 12px; color: var(--yt-spec-text-secondary, #aaa); flex: none; }
.ttd-q-thumb { width: 76px; height: 43px; border-radius: 6px; object-fit: cover; flex: none; background: #222; }
.ttd-q-text { flex: 1; min-width: 0; }
.ttd-q-name { font-size: 13px; font-weight: 500; line-height: 18px; max-height: 36px; overflow: hidden; }
.ttd-q-channel { font-size: 12px; color: var(--yt-spec-text-secondary, #aaa); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttd-q-len { font-size: 12px; color: var(--yt-spec-text-secondary, #aaa); flex: none; }
.ttd-q-actions { display: flex; flex: none; gap: 2px; }
.ttd-q-actions button {
  border: 0; background: transparent; color: inherit; width: 28px; height: 28px; border-radius: 50%;
  cursor: pointer; font-size: 14px; line-height: 28px;
}
.ttd-q-actions button:hover { background: var(--yt-spec-10-percent-layer, rgba(255,255,255,.15)); }
.ttd-shuffle-menu { display: flex; flex-direction: column; padding: 6px 8px; gap: 2px; border-bottom: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,.1)); }
.ttd-shuffle-menu button {
  text-align: left; border: 0; background: transparent; color: inherit; padding: 8px 10px; border-radius: 8px;
  font: 400 13px Roboto, Arial, sans-serif; cursor: pointer;
}
.ttd-shuffle-menu button:hover { background: var(--yt-spec-10-percent-layer, rgba(255,255,255,.1)); }
.ttd-shuffle-topic {
  margin: 4px 2px; padding: 8px 10px; border-radius: 8px; border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,.2));
  background: var(--yt-spec-base-background, #0f0f0f); color: inherit; font: 400 13px Roboto, Arial, sans-serif;
}
.ttd-shuffle-chip {
  display: flex; align-items: center; gap: 8px; margin: 8px 16px 4px; padding: 6px 6px 6px 12px; border-radius: 16px;
  background: rgba(255, 59, 48, .14); font-size: 12px; width: fit-content; max-width: calc(100% - 32px);
}
.ttd-shuffle-chip span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ttd-shuffle-chip button { border: 0; background: transparent; color: inherit; cursor: pointer; border-radius: 50%; width: 22px; height: 22px; }
.ttd-shuffle-chip button:hover { background: rgba(255,255,255,.15); }
`;
