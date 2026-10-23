import { Plugin } from '../shared/plugin';

// Adds a PiP button to the player's right-hand controls (Ctrl+Shift+P does the same).
function pipButtonScript(): void {
  const api = (window as any).ttd;
  if (!api?.pip) return;
  const NS = 'http://www.w3.org/2000/svg';
  const make = () => {
    const b = document.createElement('button');
    b.className = 'ytp-button ttd-pip-button';
    b.title = 'Picture-in-picture (Ctrl+Shift+P)';
    b.setAttribute('aria-label', 'Picture-in-picture');
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '100%');
    svg.setAttribute('height', '100%');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', 'M19 11h-8v6h8v-6zm4 8V4.98C23 3.88 22.1 3 21 3H3c-1.1 0-2 .88-2 1.98V19c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2zm-2 .02H3V4.97h18v14.05z');
    path.setAttribute('fill', '#fff');
    path.setAttribute('transform', 'translate(6 6) scale(0.5)');
    svg.appendChild(path);
    b.appendChild(svg);
    b.addEventListener('click', () => api.pip.open());
    return b;
  };
  // YouTube rebuilds the controls on some navigations; put the button back when it does.
  const ensure = () => {
    const controls = document.querySelector('#movie_player .ytp-right-controls');
    if (controls && !controls.querySelector('.ttd-pip-button')) controls.prepend(make());
  };
  document.addEventListener('yt-navigate-finish', ensure);
  setInterval(ensure, 2000);
  ensure();
}

export const pip: Plugin = {
  manifest: {
    id: 'pip',
    name: 'Picture-in-picture button',
    description: 'Adds a button to the player that opens the video in a small always-on-top window.',
    defaultEnabled: true,
    settings: [],
  },
  pageScript: pipButtonScript,
};
