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

export function permissionAllowed(permission: string): boolean {
  return ALLOWED_PERMISSIONS.has(permission);
}
