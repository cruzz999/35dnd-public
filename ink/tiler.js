// ink/tiler.js
import { openDb, idbPut, idbGet } from '../persistence/idb.js';

export const TILE_PX = 2048;

export function tileKey(tx, ty) { return `${tx},${ty}`; }

export function worldToTile(x, y) {
  const tx = Math.floor(x / TILE_PX);
  const ty = Math.floor(y / TILE_PX);
  const localX = x - tx * TILE_PX;
  const localY = y - ty * TILE_PX;
  return { tx, ty, localX, localY };
}

// Save a tile canvas to IndexedDB as a blob (png)
export async function saveTileCanvas(tx, ty, canvas) {
  const db = await openDb();
  return new Promise((res, rej) => {
    if (!canvas || typeof canvas.toBlob !== 'function') {
      rej(new Error('Invalid canvas provided to saveTileCanvas'));
      return;
    }
    canvas.toBlob(async (blob) => {
      try {
        await idbPut(db, 'inkTiles', { tileKey: tileKey(tx, ty), tx, ty, blob, updated: Date.now() });
        res(true);
      } catch (e) { rej(e); }
    }, 'image/png');
  });
}

export async function loadTile(tx, ty) {
  const db = await openDb();
  const key = tileKey(tx, ty);
  const rec = await idbGet(db, 'inkTiles', key);
  return rec || null;
}
