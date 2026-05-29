// data/slots.js
import { openDb, idbPut } from '../persistence/idb.js';

export const slotsModel = {
  byId: {},
  list() { return Object.values(this.byId); }
};

function parseCsvRows(csvText) {
  const lines = csvText.trim().split(/\r?\n/).filter(Boolean);
  const headers = lines.shift().split(',').map(h => h.trim());
  return lines.map(line => {
    const cols = line.split(',');
    const obj = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]] = (cols[i] || '').trim();
    return obj;
  });
}

export async function ingestSlotsCsv(csvText, sourceMeta = {}) {
  const rows = parseCsvRows(csvText);
  const db = await openDb();
  for (const r of rows) {
    const cls = r.Class || r.class || r['Class Name'] || '';
    const lvl = Number(r.Level || r.level || r.Lvl || 0);
    const slots = Number(r.Slots || r.slots || r['Spell Slots'] || 0);
    const id = r.id || `${cls}-${lvl}`;
    const normalized = {
      id,
      class: cls,
      level: lvl,
      slots,
      raw: r,
      source: sourceMeta
    };
    slotsModel.byId[id] = normalized;
    await idbPut(db, 'slots', normalized);
  }
}
