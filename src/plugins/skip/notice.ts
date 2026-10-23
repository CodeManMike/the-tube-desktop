// The skip note (spec §5.5, "my call"): one at a time, bottom-left over the player, with an
// optional action (Undo, Skip). A page function, so it is self-contained. Fixed to the page
// rather than inside the player, so it stays clickable above PiP's own overlay; it follows
// the player through resizes, theatre mode and fullscreen.
export function ttdNotice(text: string, action?: { label: string; run: () => void }, ms = 5000): { close(): void; isOpen(): boolean } {
  const g = globalThis as any;
  g.__ttdNoticeClose?.();
  const note = document.createElement('div');
  note.className = 'ttd-skip-note';
  note.setAttribute('role', 'status');
  note.style.cssText =
    'position:fixed;z-index:10000;display:flex;align-items:center;gap:12px;' +
    'padding:8px 10px 8px 14px;border-radius:8px;background:rgba(28,28,28,.9);color:#fff;font:500 14px Roboto,Arial,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4)';
  const label = document.createElement('span');
  label.textContent = text;
  note.appendChild(label);
  // In fullscreen only the fullscreen element is visible, so the note must live inside it.
  const place = () => {
    const host = document.fullscreenElement ?? document.body;
    if (note.parentElement !== host) host.appendChild(note);
    const player = document.querySelector('#movie_player') as HTMLElement | null;
    const r = player?.getBoundingClientRect() ?? { left: 0, bottom: innerHeight };
    note.style.left = `${Math.round(r.left + 12)}px`;
    note.style.top = `${Math.round(r.bottom - 64)}px`;
  };
  let timer = 0;
  const close = () => {
    clearTimeout(timer);
    removeEventListener('resize', place);
    document.removeEventListener('fullscreenchange', place);
    note.remove();
    if (g.__ttdNoticeClose === close) g.__ttdNoticeClose = null;
  };
  if (action) {
    const b = document.createElement('button');
    b.textContent = action.label;
    b.style.cssText = 'border:0;border-radius:16px;padding:6px 12px;cursor:pointer;background:#3ea6ff;color:#0f0f0f;font:500 13px Roboto,Arial,sans-serif';
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      close();
      action.run();
    });
    note.appendChild(b);
  }
  place();
  addEventListener('resize', place);
  document.addEventListener('fullscreenchange', place);
  if (ms > 0) timer = window.setTimeout(close, ms);
  g.__ttdNoticeClose = close;
  return { close, isOpen: () => note.isConnected };
}
