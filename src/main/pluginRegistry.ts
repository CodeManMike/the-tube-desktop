import { Endpoint, MainContext, PageContext, PageEntry, Plugin, PluginManifest } from '../shared/plugin';
import { SettingsStore } from './settingsStore';

// Turn a function's source into an expression. Method shorthand
// ("browse(data) {...}") is only valid inside an object literal.
export function asExpression(fn: Function): string {
  const src = fn.toString();
  const isMethod = /^(async\s+)?[A-Za-z_$][\w$]*\s*\(/.test(src) && !/^(async\s+)?function\b/.test(src);
  return isMethod ? `({${src}})[${JSON.stringify(fn.name)}]` : `(${src})`;
}

export class PluginRegistry {
  private readonly sessionDisabled = new Set<string>();

  constructor(
    private readonly plugins: Plugin[],
    private readonly store: SettingsStore,
  ) {
    const seen = new Set<string>();
    for (const p of plugins) {
      if (seen.has(p.manifest.id)) throw new Error(`duplicate plugin id: ${p.manifest.id}`);
      seen.add(p.manifest.id);
    }
  }

  private enabled(p: Plugin): boolean {
    return this.store.isEnabled(p.manifest.id, p.manifest.defaultEnabled);
  }

  list(): { manifest: PluginManifest; enabled: boolean }[] {
    return this.plugins.map((p) => ({ manifest: p.manifest, enabled: this.enabled(p) }));
  }

  pageEntries(context: PageContext = 'main'): PageEntry[] {
    const runsIn = (p: Plugin) => (p.contexts ?? ['main']).includes(context);
    return this.plugins.filter((p) => runsIn(p) && this.enabled(p) && !this.sessionDisabled.has(p.manifest.id)).map((p) => {
      const transforms: Partial<Record<Endpoint, string>> = {};
      for (const [endpoint, fn] of Object.entries(p.transforms ?? {})) {
        transforms[endpoint as Endpoint] = Array.isArray(fn) ? `[${fn.map(asExpression).join(',')}]` : asExpression(fn);
      }
      return {
        id: p.manifest.id,
        settings: { ...this.store.values(p.manifest.id, p.manifest.settings), ...this.borrowed(p) },
        transforms,
        css: p.css,
        script: p.pageScript && asExpression(p.pageScript),
        early: p.earlyScript && asExpression(p.earlyScript),
        ...(p.pageFunctions && {
          functions: Object.fromEntries(Object.entries(p.pageFunctions).map(([name, fn]) => [name, asExpression(fn)])),
        }),
      };
    });
  }

  private borrowed(p: Plugin): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const [key, from] of Object.entries(p.borrows ?? {})) {
      const owner = this.plugins.find((o) => o.manifest.id === from.plugin);
      if (owner) out[key] = this.store.values(owner.manifest.id, owner.manifest.settings)[from.key];
    }
    return out;
  }

  // Spec §6: a plugin that keeps failing is off for the rest of the session.
  disableForSession(id: string): void {
    this.sessionDisabled.add(id);
  }

  private readonly disposers = new Map<string, () => void>();

  // Stops every running main hook, then starts the enabled ones with their current settings.
  // Called at startup and after any settings change.
  // `onlyId` restarts one plugin's hook (the one whose settings changed), leaving the rest.
  restartMainHooks(ctx: MainContext, onlyId?: string): void {
    for (const [id, dispose] of this.disposers) {
      if (onlyId && id !== onlyId) continue;
      try {
        dispose();
      } catch (err) {
        ctx.log(`[ttd] ${id} main hook cleanup failed: ${(err as Error).message}`);
      }
      this.disposers.delete(id);
    }
    for (const p of this.plugins) {
      if (onlyId && p.manifest.id !== onlyId) continue;
      if (!p.main || !this.enabled(p)) continue;
      try {
        const dispose = p.main({ ...ctx, settings: { ...this.store.values(p.manifest.id, p.manifest.settings), ...this.borrowed(p) } });
        if (typeof dispose === 'function') this.disposers.set(p.manifest.id, dispose);
      } catch (err) {
        ctx.log(`[ttd] ${p.manifest.id} main hook failed: ${(err as Error).message}`);
      }
    }
  }
}
