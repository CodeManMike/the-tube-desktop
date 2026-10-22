import { Rule } from './types';

// Fail safe: a throwing rule leaves the data exactly as YouTube sent it.
export function safeApply(rule: Rule, data: any): { data: any; ms: number } {
  const start = performance.now();
  try {
    return { data: rule.transform(data), ms: performance.now() - start };
  } catch (err) {
    console.warn(`[rewrite] ${rule.name} failed: ${(err as Error).message}`);
    return { data, ms: performance.now() - start };
  }
}
