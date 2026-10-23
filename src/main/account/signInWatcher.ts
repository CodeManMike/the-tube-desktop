const SESSION_COOKIES = new Set(['SID', '__Secure-3PSID']);
const ROTATION_GRACE_MS = 5000; // Google rotates these cookies: removed, then set again
const PROMPT_GAP_MS = 10 * 60_000;

// Notices when someone who was signed in to YouTube gets signed out (spec §2.1, "stays signed
// in"), and asks once — never for someone who never signs in.
export class SignInWatcher {
  private wasSignedIn: boolean;
  private lastPrompt = -Infinity;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;

  constructor(
    private readonly opts: {
      wasSignedIn: boolean;
      save(v: boolean): void;
      prompt(): void;
      now?: () => number;
      setTimer?: (fn: () => void, ms: number) => unknown;
      hasSidCookie(): Promise<boolean>;
    },
  ) {
    this.wasSignedIn = opts.wasSignedIn;
    this.now = opts.now ?? Date.now;
    this.setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  }

  // From a YouTube page load: ytcfg's LOGGED_IN (null when it couldn't be read).
  pageLoaded(loggedIn: boolean | null): void {
    if (loggedIn === true) {
      if (!this.wasSignedIn) this.remember(true);
      return;
    }
    if (loggedIn === false) this.maybePrompt();
  }

  cookieRemoved(name: string): void {
    if (!SESSION_COOKIES.has(name) || !this.wasSignedIn) return;
    this.setTimer(() => {
      this.opts
        .hasSidCookie()
        .then((present) => {
          if (!present) this.maybePrompt();
        })
        .catch(() => {});
    }, ROTATION_GRACE_MS);
  }

  // "Not now": quiet until the next signed-in page load.
  dismissed(): void {
    this.remember(false);
  }

  private remember(v: boolean): void {
    this.wasSignedIn = v;
    this.opts.save(v);
  }

  private maybePrompt(): void {
    if (!this.wasSignedIn || this.now() - this.lastPrompt < PROMPT_GAP_MS) return;
    this.lastPrompt = this.now();
    this.opts.prompt();
  }
}
