// Usage: node scripts/build-data.mjs path/to/Playbook.xls
// Regenerates public/data/playbook.json from the Must Use Mail Playbook workbook.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const XLSX = require('xlsx');
const P = require('../lib/parse.js');

const file = process.argv[2];
if (!file) { console.error('Usage: node scripts/build-data.mjs <playbook.xls>'); process.exit(1); }
const wb = XLSX.readFile(file);
const sheets = wb.SheetNames.map((name) => ({
  name,
  rows: XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: '', blankrows: true }),
}));
const data = P.parseWorkbook(sheets);
data.meta.source = path.basename(file);
data.meta.built = new Date().toISOString();
const out = path.join(process.cwd(), 'public', 'data', 'playbook.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(data));
console.log('Wrote', out);
console.log({ foreclosure: data.foreclosure.length, legacy: data.legacy.length, collections: data.collections.length, client: data.client.length, notes: data.notes.length });
