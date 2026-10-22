import { WebContents } from 'electron';
import { Rule } from './types';
import { safeApply } from './safeApply';

const INITIAL_DATA = 'var ytInitialData = ';
const DROP_HEADERS = new Set(['content-encoding', 'content-length']);

type HeaderEntry = { name: string; value: string };

function applyRules(json: string, rules: Rule[]): { json: string; ms: number } {
  let data = JSON.parse(json);
  let ms = 0;
  for (const rule of rules) {
    const result = safeApply(rule, data);
    data = result.data;
    ms += result.ms;
  }
  return { json: JSON.stringify(data), ms };
}

function rewriteDocument(html: string, rules: Rule[]): { body: string; ms: number } {
  const start = html.indexOf(INITIAL_DATA);
  if (start < 0) return { body: html, ms: 0 };
  const jsonStart = start + INITIAL_DATA.length;
  const jsonEnd = html.indexOf(';</script>', jsonStart);
  if (jsonEnd < 0) return { body: html, ms: 0 };
  const { json, ms } = applyRules(html.slice(jsonStart, jsonEnd), rules);
  return { body: html.slice(0, jsonStart) + json + html.slice(jsonEnd), ms };
}

// Candidate 1: rewrite responses in the main process via the Chrome DevTools Protocol.
// Only youtubei/browse and youtube.com documents are paused; media traffic never is.
export async function attachCdpRewrite(wc: WebContents, rules: Rule[]): Promise<void> {
  const dbg = wc.debugger;
  dbg.attach('1.3');

  dbg.on('message', async (_event, method, params) => {
    if (method !== 'Fetch.requestPaused') return;
    const { requestId, request, responseStatusCode, responseHeaders } = params;
    const t0 = performance.now();
    try {
      const raw = await dbg.sendCommand('Fetch.getResponseBody', { requestId });
      const text = raw.base64Encoded ? Buffer.from(raw.body, 'base64').toString('utf8') : raw.body;
      const path = new URL(request.url).pathname;

      let body: string;
      let ms: number;
      if (path.startsWith('/youtubei/v1/')) {
        ({ json: body, ms } = applyRules(text, rules));
      } else {
        ({ body, ms } = rewriteDocument(text, rules));
      }

      await dbg.sendCommand('Fetch.fulfillRequest', {
        requestId,
        responseCode: responseStatusCode,
        responseHeaders: (responseHeaders as HeaderEntry[]).filter(
          (h) => !DROP_HEADERS.has(h.name.toLowerCase()),
        ),
        body: Buffer.from(body, 'utf8').toString('base64'),
      });
      console.log(`[cdp] ${path} ${ms.toFixed(1)}ms (end-to-end ${(performance.now() - t0).toFixed(1)}ms)`);
    } catch (err) {
      console.warn(`[cdp] passthrough ${request.url}: ${(err as Error).message}`);
      await dbg.sendCommand('Fetch.continueRequest', { requestId }).catch(() => {});
    }
  });

  await dbg.sendCommand('Fetch.enable', {
    patterns: [
      { urlPattern: 'https://www.youtube.com/youtubei/v1/browse*', requestStage: 'Response' },
      { urlPattern: 'https://www.youtube.com/*', resourceType: 'Document', requestStage: 'Response' },
    ],
  });
}
