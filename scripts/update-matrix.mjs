#!/usr/bin/env node
// Generates REQUIREMENT_TRACEABILITY_MATRIX.md from REQUIREMENTS.md + status overrides.
// Status overrides live in scripts/requirement-status.json (maintained as work progresses).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reqText = fs.readFileSync(path.join(root, 'docs/REQUIREMENTS.md'), 'utf8');
const statusFile = path.join(root, 'scripts/requirement-status.json');
const status = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : {};

const lines = reqText.split('\n');
const rows = [];
let module = '';
for (const line of lines) {
  const h = line.match(/^## (REQ-[A-Z0-9]+) — (.+)$/);
  if (h) { module = h[2]; continue; }
  const m = line.match(/^\| (REQ-[A-Z0-9]+-\d+) \| (.+) \|$/);
  if (m) {
    const id = m[1];
    const s = status[id] || { status: 'PLANNED', files: '', tables: '', tests: '', testStatus: 'NOT RUN', issues: '' };
    rows.push({ id, module, desc: m[2], ...s });
  }
}

const counts = {};
for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
const summary = Object.entries(counts).map(([k, v]) => `${k}: ${v}`).join(' · ');

let out = `# Requirement Traceability Matrix\n\n`;
out += `Auto-generated from REQUIREMENTS.md + scripts/requirement-status.json. ${rows.length} requirements. ${summary}\n\n`;
out += `Statuses: NOT STARTED · PLANNED · IN PROGRESS · IMPLEMENTED · INTEGRATED · TESTED · VERIFIED · BLOCKED\n\n`;
out += `| ID | Module | Requirement | Status | Source files | DB tables | Tests | Test execution | Issues |\n`;
out += `|---|---|---|---|---|---|---|---|---|\n`;
for (const r of rows) {
  out += `| ${r.id} | ${r.module} | ${r.desc} | ${r.status} | ${r.files || '—'} | ${r.tables || '—'} | ${r.tests || '—'} | ${r.testStatus || 'NOT RUN'} | ${r.issues || '—'} |\n`;
}
fs.writeFileSync(path.join(root, 'docs/REQUIREMENT_TRACEABILITY_MATRIX.md'), out);
console.log(`Matrix updated: ${rows.length} requirements. ${summary}`);
