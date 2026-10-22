// Injected into the PiP window's watch page: strip everything but the player and
// add hover-only controls. Uses DOM APIs only (YouTube enforces Trusted Types,
// so innerHTML is off limits).
const CSS = `
  html, body { overflow: hidden !important; background: #000 !important; }
  ytd-masthead, #masthead-container, #secondary, #below, #comments, tp-yt-app-drawer { display: none !important; }
  .ytp-chrome-top, .ytp-chrome-bottom, .ytp-gradient-top, .ytp-gradient-bottom { display: none !important; }
  #movie_player { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 9998 !important; }
  #tube-pip { position: fixed; inset: 0; z-index: 9999; opacity: 0; transition: opacity .15s; font-family: sans-serif; }
  #tube-pip:hover { opacity: 1; }
  #tube-pip .drag { position: absolute; top: 0; left: 0; right: 0; height: 36px; -webkit-app-region: drag;
    background: linear-gradient(rgba(0,0,0,.7), transparent); }
  #tube-pip .center { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); display: flex; gap: 14px; }
  #tube-pip .corner { position: absolute; top: 5px; right: 6px; display: flex; gap: 4px; }
  #tube-pip button { -webkit-app-region: no-drag; border: 0; cursor: pointer; color: #fff;
    background: rgba(0,0,0,.55); border-radius: 50%; width: 44px; height: 44px; font-size: 20px; }
  #tube-pip .corner button { width: 28px; height: 28px; font-size: 14px; }
  #tube-pip button:hover { background: rgba(255,255,255,.25); }
  #tube-pip button.on { background: rgba(62,166,255,.7); }
`;

function overlay(css: string): void {
  if ((window as any).__tubePip) return;
  (window as any).__tubePip = true;
  const tube = (window as any).tube;
  const player = () => document.querySelector('#movie_player') as any;

  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);

  const root = document.createElement('div');
  root.id = 'tube-pip';
  const button = (label: string, title: string, onClick: (b: HTMLButtonElement) => void) => {
    const b = document.createElement('button');
    b.textContent = label;
    b.title = title;
    b.addEventListener('click', () => onClick(b));
    return b;
  };

  const drag = document.createElement('div');
  drag.className = 'drag';
  const corner = document.createElement('div');
  corner.className = 'corner';
  const pin = button('📌', 'Always on top', (b) => {
    tube.toggleOnTop();
    b.classList.toggle('on');
  });
  pin.classList.add('on');
  corner.append(pin, button('⤢', 'Back to main window', () => tube.close(player().getCurrentTime())));

  const center = document.createElement('div');
  center.className = 'center';
  center.append(
    button('⏮', 'Previous', () => player().previousVideo()),
    button('⏯', 'Play/pause', () => (player().getPlayerState() === 1 ? player().pauseVideo() : player().playVideo())),
    button('⏭', 'Next', () => player().nextVideo()),
  );

  root.append(drag, corner, center);
  document.body.appendChild(root);
  window.dispatchEvent(new Event('resize'));

  const video = document.querySelector('#movie_player video') as HTMLVideoElement | null;
  const sendAspect = () => video && video.videoWidth && tube.setAspect(video.videoWidth / video.videoHeight);
  video?.addEventListener('loadedmetadata', sendAspect);
  sendAspect();
}

export function overlayScript(): string {
  return `(${overlay.toString()})(${JSON.stringify(CSS)});`;
}
