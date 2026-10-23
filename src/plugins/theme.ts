import { Plugin } from '../shared/plugin';

// The stylesheet for a preset plus the user's own CSS (spec §5.7). Presets override
// YouTube's own colour variables in dark mode. A page function: self-contained.
export function themeCss(preset: string, custom: string): string {
  const PRESETS: Record<string, string> = {
    black: 'html[dark] { --yt-spec-base-background: #000; --yt-spec-raised-background: #0a0a0a; --yt-spec-menu-background: #111; }',
    dim: 'html[dark] { --yt-spec-base-background: #1b1f24; --yt-spec-raised-background: #232830; --yt-spec-menu-background: #2a3038; }',
  };
  return [PRESETS[preset] ?? '', custom.trim()].filter(Boolean).join('\n');
}

function themeScript(settings: Record<string, unknown>): void {
  const css = (globalThis as any).__ttdFns?.themeCss?.(String(settings.preset ?? 'default'), String(settings.customCss ?? ''));
  if (!css) return;
  const style = document.createElement('style');
  style.id = 'ttd-theme';
  style.textContent = css;
  document.head.appendChild(style);
}

export const theme: Plugin = {
  manifest: {
    id: 'theme',
    name: 'Theme',
    defaultEnabled: true,
    settings: [
      {
        key: 'preset',
        label: 'Colours',
        type: 'enum',
        default: 'default',
        options: ['default', 'black', 'dim'],
        optionLabels: { default: 'YouTube default', black: 'Pure black (OLED)', dim: 'Dim' },
      },
      { key: 'customCss', label: 'Custom CSS', type: 'text', default: '', maxLength: 20000 },
    ],
  },
  pageScript: themeScript,
  pageFunctions: { themeCss },
};
