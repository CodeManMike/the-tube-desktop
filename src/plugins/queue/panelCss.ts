// Styled after YouTube's dark playlist panel. TTD's queue replaces YouTube's own
// playlist panel and miniplayer queue while the plugin is on.
export const QUEUE_CSS = `
ytd-watch-flexy ytd-playlist-panel-renderer#playlist { display: none !important; }
ytd-miniplayer #playlist, ytd-miniplayer ytd-playlist-panel-renderer { display: none !important; }

.ttd-queue {
  border: 1px solid var(--yt-spec-10-percent-layer, rgba(255,255,255,.1));
  border-radius: 12px; margin: 0 0 16px; overflow: hidden;
  font-family: Roboto, Arial, sans-serif; color: var(--yt-spec-text-primary, #f1f1f1);
  background: var(--yt-spec-base-background, #0f0f0f);
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
.ttd-queue-list { max-height: 420px; overflow-y: auto; padding: 4px 0; position: relative; }
.ttd-queue-empty { padding: 12px 16px 16px; font-size: 13px; color: var(--yt-spec-text-secondary, #aaa); }
.ttd-q-item { display: flex; align-items: center; gap: 8px; padding: 4px 8px 4px 4px; cursor: pointer; position: relative; }
.ttd-q-item:hover { background: var(--yt-spec-badge-chip-background, rgba(255,255,255,.08)); }
.ttd-q-item.current { background: rgba(255, 59, 48, .14); }
.ttd-q-item.played { opacity: .55; }
.ttd-q-item.drop-before { box-shadow: inset 0 2px 0 #ff3b30; }
.ttd-q-index { width: 22px; text-align: center; font-size: 12px; color: var(--yt-spec-text-secondary, #aaa); flex: none; }
.ttd-q-item.current .ttd-q-index { color: #ff3b30; }
.ttd-q-thumb { width: 100px; height: 56px; border-radius: 6px; object-fit: cover; flex: none; background: #222; }
.ttd-q-text { flex: 1; min-width: 0; }
.ttd-q-name { font-size: 13px; font-weight: 500; line-height: 18px; max-height: 36px; overflow: hidden; }
.ttd-q-channel { font-size: 12px; color: var(--yt-spec-text-secondary, #aaa); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ttd-q-len { font-size: 12px; color: var(--yt-spec-text-secondary, #aaa); flex: none; }
.ttd-q-actions { display: none; gap: 2px; position: absolute; right: 8px; top: 50%; transform: translateY(-50%); background: var(--yt-spec-base-background, #0f0f0f); border-radius: 8px; padding: 2px; }
.ttd-q-item:hover .ttd-q-actions { display: flex; }
.ttd-q-actions button {
  border: 0; background: transparent; color: inherit; width: 28px; height: 28px; border-radius: 50%;
  cursor: pointer; font-size: 14px; line-height: 28px;
}
.ttd-q-actions button:hover { background: var(--yt-spec-10-percent-layer, rgba(255,255,255,.15)); }
`;
