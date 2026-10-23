import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_PLUGINS } from '../plugins';

// Owner rule (2026-10-23): names and labels say what a thing is; a hint (tooltip) only for
// what the user can't see but needs to know. The M4b plan's ruling 1 is the source of truth.
type Copy = { name?: string; hint?: string | null; settings?: Record<string, { label: string; hint?: string | null }> };
const NONE = null;
const COPY: Record<string, Copy> = {
  hideShorts: { name: 'Hide Shorts', hint: NONE },
  queue: {
    name: 'Queue',
    hint: NONE,
    settings: {
      batchSize: { label: 'Shuffle batch size', hint: NONE },
      watchedPercent: { label: 'Counts as watched at (%)', hint: 'Used by shuffle and Hide watched.' },
    },
  },
  pip: { name: 'Picture-in-picture button', hint: 'Ctrl+Shift+P also opens picture-in-picture.' },
  sponsorBlock: {
    name: 'SponsorBlock',
    hint: 'Segments come from the SponsorBlock community. Only a short hash of the video ID is sent.',
    settings: {
      sponsor: { label: 'Sponsor', hint: NONE },
      selfpromo: { label: 'Self-promotion', hint: NONE },
      interaction: { label: 'Interaction reminder', hint: 'Reminders to like, subscribe or follow.' },
      intro: { label: 'Intro', hint: NONE },
      outro: { label: 'Outro / end cards', hint: NONE },
      preview: { label: 'Preview / recap', hint: "Clips of what's coming up or what happened before." },
      filler: { label: 'Filler', hint: "Tangents that aren't needed to follow the video." },
      music_offtopic: { label: 'Non-music section', hint: 'Talking or skits in music videos.' },
    },
  },
  adSkip: { name: 'Ad skip', hint: "Only matters when YouTube Premium isn't removing ads." },
  pinnedQuality: { name: 'Pinned quality', hint: NONE },
  hideWatched: { name: 'Hide watched', hint: "Uses YouTube's own progress bars, which include phone and TV viewing, plus TTD's history." },
  channelBlocklist: { name: 'Channel blocklist', hint: "Add channels from a video's ⋮ menu → Block channel." },
  ryd: { name: 'Show dislikes', hint: 'Estimated by Return YouTube Dislike. The video ID is sent to their server.' },
  theme: { name: 'Theme', hint: NONE },
  lowPower: { name: 'Low power (H.264)', hint: 'Uses less CPU, but caps every video at 1080p without HDR.' },
};

test("every plugin's copy follows the table", () => {
  for (const p of ALL_PLUGINS) {
    const want = COPY[p.manifest.id];
    if (!want) continue;
    assert.equal(p.manifest.name, want.name, `${p.manifest.id} name`);
    assert.equal(p.manifest.hint ?? NONE, want.hint, `${p.manifest.id} hint`);
    for (const [key, s] of Object.entries(want.settings ?? {})) {
      const def = p.manifest.settings.find((d) => d.key === key);
      assert.ok(def, `${p.manifest.id}.${key} exists`);
      assert.equal(def!.label, s.label, `${p.manifest.id}.${key} label`);
      assert.equal(def!.hint ?? NONE, s.hint, `${p.manifest.id}.${key} hint`);
    }
  }
});

test('no plugin has a description', () => {
  for (const p of ALL_PLUGINS) if (p.manifest.id !== 'devBreak') assert.equal(p.manifest.description, undefined, p.manifest.id);
});

test('every shipped plugin is in the copy table', () => {
  for (const p of ALL_PLUGINS) if (p.manifest.id !== 'devBreak') assert.ok(COPY[p.manifest.id], `${p.manifest.id} missing from COPY`);
});
