import { Candidate } from './shuffle';

export type FetchRequest = { requestId: string; endpoint: 'browse' | 'search'; body: object };
export type FetchedEvent = { type: 'fetched'; requestId: string; ok: boolean; items: Candidate[]; continuation: string | null };

type Pending = { resolve: (page: { items: Candidate[]; continuation: string | null }) => void; reject: (err: Error) => void; timer: NodeJS.Timeout };

// Asks the page to fetch an InnerTube page (same-origin, so it carries the user's session)
// and matches the answer back to the request. Unknown or late answers are dropped.
export class FetchBridge {
  private next = 0;
  private readonly pending = new Map<string, Pending>();

  constructor(
    private readonly send: (req: FetchRequest) => void,
    private readonly timeoutMs = 15000,
  ) {}

  request(endpoint: 'browse' | 'search', body: object): Promise<{ items: Candidate[]; continuation: string | null }> {
    const requestId = `r${++this.next}`;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`page fetch timed out (${endpoint})`));
      }, this.timeoutMs);
      this.pending.set(requestId, { resolve, reject, timer });
      this.send({ requestId, endpoint, body });
    });
  }

  resolve(event: FetchedEvent): void {
    const p = this.pending.get(event.requestId);
    if (!p) {
      console.warn(`[shuffle] ignored a page result for unknown request ${event.requestId}`);
      return;
    }
    this.pending.delete(event.requestId);
    clearTimeout(p.timer);
    if (event.ok) p.resolve({ items: event.items, continuation: event.continuation });
    else p.reject(new Error('page fetch failed'));
  }
}
