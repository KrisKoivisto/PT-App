import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import path from 'node:path';

// Tiny JSON-file store. Writes go through a temp file so a crash can't leave
// half a profile behind.
export class JsonFile {
  constructor(file, fallback) {
    this.file = file;
    this.fallback = fallback;
    this.data = null;
    this.pending = Promise.resolve();
  }

  async load() {
    if (this.data) return this.data;
    try {
      this.data = JSON.parse(await readFile(this.file, 'utf8'));
    } catch {
      this.data = structuredClone(this.fallback);
    }
    return this.data;
  }

  save() {
    this.pending = this.pending.then(async () => {
      await mkdir(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      await writeFile(tmp, JSON.stringify(this.data));
      await rename(tmp, this.file);
    });
    return this.pending;
  }
}

export const defaultProfile = () => ({
  region: 'US',
  services: [],
  includeRentBuy: false,
  minSeedRating: 8,
  ratings: [],
  watchlist: [],
});
