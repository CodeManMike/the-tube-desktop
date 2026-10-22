import fs from 'fs';

// Write to a temp file then rename, so a crash mid-write never leaves a torn file.
// On Windows the rename can briefly fail while antivirus or indexing holds the file;
// retry a few times, then log and report failure rather than throw.
export function writeFileAtomic(file: string, text: string): boolean {
  const tmp = `${file}.tmp`;
  for (let attempt = 1; ; attempt++) {
    try {
      fs.writeFileSync(tmp, text);
      fs.renameSync(tmp, file);
      return true;
    } catch (err) {
      if (attempt >= 5) {
        console.warn(`[file] save failed for ${file}: ${(err as Error).message}`);
        return false;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20 * attempt);
    }
  }
}
