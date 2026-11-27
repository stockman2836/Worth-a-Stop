import { readFile, writeFile, mkdir, rename, readdir, stat, unlink } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

// Optional acceleration: missing, corrupt or unwritable files never block discovery.
export function createPlaceCache(directory, { limit = 1000 } = {}) {
  const file = key => join(directory, createHash('sha256').update(key).digest('hex') + '.json');
  return {
    async get(key) {
      try {
        const entry = JSON.parse(await readFile(file(key), 'utf8'));
        if (entry.key === key && Number.isFinite(entry.expires) && entry.value !== undefined) return entry;
      } catch { /* A cache miss is safe. */ }
    },
    async set(key, entry) {
      const temporary = file(key) + '.' + randomUUID() + '.tmp';
      try {
        await mkdir(directory, { recursive: true });
        await writeFile(temporary, JSON.stringify({ ...entry, key }));
        await rename(temporary, file(key));
        const files = (await readdir(directory)).filter(name => /^[a-f0-9]{64}\.json$/.test(name));
        if (files.length > limit) {
          const dated = await Promise.all(files.map(async name => ({ name, time: (await stat(join(directory, name))).mtimeMs })));
          const remove = Math.max(files.length - limit, Math.ceil(limit / 10));
          await Promise.all(dated.sort((a, b) => a.time - b.time).slice(0, remove).map(item => unlink(join(directory, item.name))));
        }
      } catch { /* Discovery also works without a writable cache. */ }
      finally { await unlink(temporary).catch(() => {}); }
    },
  };
}
