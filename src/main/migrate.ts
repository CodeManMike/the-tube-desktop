import fs from 'fs';
import path from 'path';

// The Phase 0 spike ran unnamed, so Electron stored its session under %APPDATA%\Electron.
// Copy that signed-in partition once so the renamed app starts signed in.
export function migrateLegacyProfile(legacyUserData: string, userData: string): 'migrated' | 'skipped' {
  const from = path.join(legacyUserData, 'Partitions', 'tube');
  const to = path.join(userData, 'Partitions', 'tube');
  if (!fs.existsSync(from) || fs.existsSync(to)) return 'skipped';
  fs.cpSync(from, to, { recursive: true });
  return 'migrated';
}
