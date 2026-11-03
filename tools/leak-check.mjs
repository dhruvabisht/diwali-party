#!/usr/bin/env node
/**
 * Safety net: fails if any private detail from private/secrets.json appears in a file
 * that git would publish. Runs automatically as a pre-commit hook (see README).
 *
 *   node tools/leak-check.mjs
 */
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let secrets;
try {
  secrets = JSON.parse(await readFile(path.join(root, 'private', 'secrets.json'), 'utf8'));
} catch {
  console.log('leak-check: no private/secrets.json here, nothing to compare against.');
  process.exit(0);
}

const inv = secrets.invite || {};
const squash = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
const needles = new Set();
const add = (s) => { const q = squash(s); if (q.length >= 6) needles.add(q); };
(inv.addressLines || []).forEach(add);
[inv.mapsQuery, inv.googleMapsUrl, inv.appleMapsUrl, inv.phone, inv.phoneDisplay, inv.rsvpUrl, secrets.key, secrets.rsvpToken]
  .filter(Boolean).forEach(add);
if (inv.phone) add(String(inv.phone).replace(/^\+353/, '0')); // local Irish format
const tokens = (inv.addressLines || []).join(' ').split(/[\s,]+/).filter((w) => w.length >= 6 && !/^(dublin|apartments?|north|south)$/i.test(w));
tokens.forEach(add);

// Files git would publish: staged + tracked + untracked-but-not-ignored.
const list = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
const files = new Set([
  ...list(['ls-files']),
  ...list(['ls-files', '--others', '--exclude-standard']),
  ...list(['diff', '--cached', '--name-only', '--diff-filter=ACMR']),
]);

const leaks = [];
for (const f of files) {
  if (/\.(woff2|png|jpg|ico)$/i.test(f)) continue;
  let text;
  try { text = await readFile(path.join(root, f), 'utf8'); } catch { continue; }
  const hay = squash(text);
  for (const n of needles) if (hay.includes(n)) leaks.push(`${f}: contains a private detail (…${n.slice(0, 3)}…)`);
}

if (leaks.length) {
  console.error('🚫 leak-check failed. These files would publish private details:\n  ' + leaks.join('\n  '));
  process.exit(1);
}
console.log(`✅ leak-check: ${files.size} publishable files scanned, no private details found.`);
