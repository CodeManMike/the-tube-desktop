// Hosts that load inside TTD's signed-in session. Anything else opens in the default
// browser, so third-party sites never see (or act with) the YouTube session.
const IN_APP_HOSTS = new Set([
  'www.youtube.com',
  'youtube.com',
  'm.youtube.com',
  'accounts.google.com',
  'accounts.youtube.com',
  'consent.youtube.com',
]);

export function isInAppUrl(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:') return false;
  if (IN_APP_HOSTS.has(u.hostname)) return true;
  // Google's sign-in and anti-abuse redirects pass through www.google.com.
  return u.hostname === 'www.google.com' && (u.pathname.startsWith('/sorry') || u.pathname.startsWith('/accounts'));
}

const ALLOWED_PERMISSIONS = new Set(['fullscreen', 'media', 'clipboard-sanitized-write', 'pointerLock']);

// 'media' is allowed for the microphone only (voice search); the camera never.
export function permissionAllowed(permission: string, mediaTypes?: string[]): boolean {
  if (permission === 'media') return !!mediaTypes && mediaTypes.length > 0 && mediaTypes.every((t) => t === 'audio');
  return ALLOWED_PERMISSIONS.has(permission);
}

export type Route =
  | { action: 'app' }
  | { action: 'external'; url: string }
  | { action: 'queueAdd'; videoId: string }
  | { action: 'block' };

const BLOCK: Route = { action: 'block' };

// Only plain web links ever leave the app. Anything else (search-ms:, ms-msdt:, file:,
// javascript:...) would be handed to a Windows protocol handler, so it is dropped.
function external(url: string): Route {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? { action: 'external', url: u.href } : BLOCK;
  } catch {
    return BLOCK;
  }
}

// Where a navigation or window.open should go: stay in the signed-in window, open in
// the default browser, or nowhere.
export function routeUrl(url: string): Route {
  if (!isInAppUrl(url)) return external(url);
  const u = new URL(url);
  // TTD's rewritten "Add to queue" command (see plugins/queue/transforms.ts).
  if (u.hostname === 'www.youtube.com' && u.pathname === '/ttd/queue-add') {
    const id = u.searchParams.get('v') ?? '';
    return /^[A-Za-z0-9_-]{11}$/.test(id) ? { action: 'queueAdd', videoId: id } : BLOCK;
  }
  // YouTube's outbound-link interstitial: send its real target straight to the browser.
  if (u.hostname.endsWith('youtube.com') && u.pathname === '/redirect') {
    const target = u.searchParams.get('q');
    return target ? external(target) : BLOCK;
  }
  return { action: 'app' };
}
