import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { KlipyGif } from './klipy';

const dataFile = join(process.cwd(), 'data', 'recent-gifs.json');

type RecentStore = Record<string, Array<KlipyGif & { usedAt: number }>>;

function readStore(): RecentStore {
  try {
    if (!existsSync(dataFile)) return {};
    return JSON.parse(readFileSync(dataFile, 'utf8')) as RecentStore;
  } catch {
    return {};
  }
}

function writeStore(store: RecentStore) {
  mkdirSync(dirname(dataFile), { recursive: true });
  writeFileSync(dataFile, JSON.stringify(store, null, 2), 'utf8');
}

export function rememberGif(userId: string, gif: KlipyGif) {
  const store = readStore();
  const existing = store[userId] ?? [];
  const withoutDuplicate = existing.filter((item) => item.id !== gif.id);
  store[userId] = [{ ...gif, usedAt: Date.now() }, ...withoutDuplicate].slice(0, 100);
  writeStore(store);
}

export function getRecentGifs(userId: string, offset = 0, limit = 20) {
  const store = readStore();
  const all = store[userId] ?? [];
  return {
    gifs: all.slice(offset, offset + limit),
    hasMore: offset + limit < all.length
  };
}
