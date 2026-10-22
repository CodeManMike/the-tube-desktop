import { Endpoint, MainContext, PageEntry, Plugin, PluginManifest } from '../shared/plugin';
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

  pageEntries(): PageEntry[] {
    return this.plugins.filter((p) => this.enabled(p) && !this.sessionDisabled.has(p.manifest.id)).map((p) => {
      const transforms: Partial<Record<Endpoint, string>> = {};
      for (const [endpoint, fn] of Object.entries(p.transforms ?? {})) {
        transforms[endpoint as Endpoint] = asExpression(fn);
      }
      return {
        id: p.manifest.id,
        settings: this.store.values(p.manifest.id, p.manifest.settings),
        transforms,
        css: p.css,
        script: p.pageScript && asExpression(p.pageScript),
      };
    });
  }

  // Spec §6: a plugin that keeps failing is off for the rest of the session.
  disableForSession(id: string): void {
    this.sessionDisabled.add(id);
  }

  runMainHooks(ctx: MainContext): void {
    for (const p of this.plugins) {
      if (!p.main || !this.enabled(p)) continue;
      try {
        p.main(ctx);
      } catch (err) {
        ctx.log(`[ttd] ${p.manifest.id} main hook failed: ${(err as Error).message}`);
      }
    }
  }
}
