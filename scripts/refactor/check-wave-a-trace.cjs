#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

// Wave A follows plan.md §12 (Fase 4): help/system-info, QR/OCR/stickers and collage,
// document conversion/content reading, transcription and voice. These source
// files contain inventory rows explicitly assigned to those features. The
// cross-wave entries are intentionally filtered by the feature column per row.
const WAVE_A_FILES = Object.freeze([
  { file: 'test/commandRegistry.test.js', reason: 'cross-wave registry coverage, limited to the document crop alias case', crossWave: true },
  { file: 'test/content_reader.test.js', reason: 'document conversion and contentReader' },
  { file: 'test/convertir_documentos.test.js', reason: 'convertir/documentos' },
  { file: 'test/dispatcher.test.js', reason: 'cross-wave routing coverage, limited to the help fast-path case', crossWave: true },
  { file: 'test/e2e_requirements.test.js', reason: 'cross-wave system scenarios; include only rows assigned to Wave A features', crossWave: true },
  { file: 'test/mediaUxIntegration.test.js', reason: 'cross-wave media/pipeline scenarios; include only rows assigned to Wave A features', crossWave: true },
  { file: 'test/multimedia_drive_estado_ux.test.js', reason: 'cross-wave documents and Drive/status scenarios; include only Wave A feature rows', crossWave: true },
  { file: 'test/recortarPdf.test.js', reason: 'document crop/conversion' },
  { file: 'test/reminderNotesUx.test.js', reason: 'cross-wave attachment continuity scenario; include only document-reader rows', crossWave: true },
  { file: 'test/semanticVoice.test.js', reason: 'voice feature semantics' },
  { file: 'test/thumbnailCollage.test.js', reason: 'sticker and thumbnail collage' },
  { file: 'test/tts.test.js', reason: 'voice synthesis/TTS' },
  { file: 'test/voiceUx.test.js', reason: 'voice feature behavior' },
  { file: 'test/whisper.test.js', reason: 'transcription' },
]);

// A few baseline rows describe Wave A behavior through shared pipeline/platform
// stages rather than a feature name. Keep the exception list exact and auditable.
const WAVE_A_SHARED_CASES = Object.freeze({
  'test/commandRegistry.test.js': ['TR-0147'], // document-crop aliases
  'test/dispatcher.test.js': ['TR-0283'], // help command remains available
  'test/e2e_requirements.test.js': ['TR-0305', 'TR-0314'], // help routing and guide layout
  'test/mediaUxIntegration.test.js': ['TR-0443'], // QR with text cannot inherit an old attachment
  'test/multimedia_drive_estado_ux.test.js': ['TR-0487'], // local status avoids URL/yt-dlp work
});

// Neighbouring behavior is kept visible without silently charging it to Wave A:
// voice synthesis belongs to A, while attachment policy and outbound messaging
// are shared/Phase 4 Wave B in plan.md §12. A wave owner may later reclassify
// individual IDs after reviewing the protected behavior.
const WAVE_A_BOUNDARY_CANDIDATES = Object.freeze([
  { file: 'test/attachment_context.test.js', ids: ['TR-0085', 'TR-0086', 'TR-0087', 'TR-0088', 'TR-0089', 'TR-0090', 'TR-0091'], reason: 'shared attachment policy/context; document and voice flows consume it, but the inventory maps the suite to S08/S09/S17 rather than a Wave A feature' },
  { file: 'test/mediaDelivery.test.js', ids: ['TR-0406', 'TR-0407', 'TR-0408', 'TR-0409', 'TR-0410', 'TR-0411', 'TR-0412', 'TR-0413', 'TR-0414', 'TR-0415', 'TR-0416', 'TR-0417', 'TR-0418', 'TR-0419'], reason: 'outbound messaging is Wave B; generated/quoted audio intersects Wave A voice but delivery behavior stays outside the Wave A tally' },
]);

const WAVE_A_FEATURE = /\bfeatures\/(?:help|system-info|qr|ocr|sticker|sticker-effects|efectos|imageCensor|thumbnailCollage|convertir|documentos|documents|contentReader|transcripcion|transcription|whisper|audioDuration|voice|voiceScript)\b/i;
const PORTED_STATE = /^\s*(?:\*\*)?(?:ported|implemented|implementado)\b/i;

function parseRows(inventoryText) {
  const rows = [];
  let sourceFile = null;
  for (const [lineIndex, line] of inventoryText.split(/\r?\n/).entries()) {
    const heading = line.match(/^##\s+(test\/[^\s]+)\s*$/);
    if (heading) {
      sourceFile = heading[1];
      continue;
    }
    if (!sourceFile || !/^\|\s*TR-\d{4}\s*\|/.test(line)) continue;
    const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
    if (cells.length < 6) continue;
    rows.push({
      id: cells[0],
      title: cells[2],
      feature: cells[3],
      scenario: cells[4],
      status: cells[5],
      sourceFile,
      line: lineIndex + 1,
    });
  }
  return rows;
}

function targetPathFromStatus(status) {
  const match = status.replace(/`/g, '').match(/(?:^|\s)(tests\/(?:unit|contract|scenario)\/[^\s;]+\.test\.cjs|tests\/(?:unit|contract|scenario)\/[^\s;]+\.test\.js)/);
  return match ? match[1] : null;
}

function auditWaveATrace({ inventoryText, root, baselineCount }) {
  const rows = parseRows(inventoryText);
  const byFile = new Map(WAVE_A_FILES.map(entry => [entry.file, { ...entry, cases: [] }]));
  const errors = [];
  const ids = new Map();
  for (const row of rows) ids.set(row.id, [...(ids.get(row.id) || []), row]);
  for (const [id, duplicates] of ids) {
    if (duplicates.length > 1) errors.push(`duplicate inventory ID ${id}: ${duplicates.map(row => `${row.sourceFile}:${row.line}`).join(', ')}`);
  }
  const baselineIds = baselineCount === undefined
    ? null
    : Array.from({ length: baselineCount }, (_, index) => `TR-${String(index + 1).padStart(4, '0')}`);
  const missingBaselineIds = baselineIds ? baselineIds.filter(id => !ids.has(id)) : [];
  if (missingBaselineIds.length) errors.push(`missing ${missingBaselineIds.length} baseline IDs: ${missingBaselineIds.join(', ')}`);
  const idsOutsideBaseline = baselineIds ? [...ids.keys()].filter(id => !baselineIds.includes(id)) : [];

  for (const row of rows) {
    const group = byFile.get(row.sourceFile);
    const sharedCase = (WAVE_A_SHARED_CASES[row.sourceFile] || []).includes(row.id);
    if (!group || (!WAVE_A_FEATURE.test(row.feature) && !sharedCase)) continue;
    const isPorted = PORTED_STATE.test(row.status);
    const item = { ...row, state: isPorted ? 'ported' : 'pending' };
    if (isPorted) {
      const destination = targetPathFromStatus(`${row.scenario} ${row.status}`);
      if (!destination) {
        errors.push(`${row.id} (${row.sourceFile}:${row.line}) is marked ported but has no tests/{unit,contract,scenario} destination path`);
      } else {
        const absolute = path.resolve(root, destination);
        const testRoot = path.resolve(root, 'tests');
        if (absolute !== testRoot && !absolute.startsWith(`${testRoot}${path.sep}`)) {
          errors.push(`${row.id} destination escapes tests/: ${destination}`);
        } else if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
          errors.push(`${row.id} destination test does not exist: ${destination}`);
        } else if (!fs.readFileSync(absolute, 'utf8').includes(row.id)) {
          errors.push(`${row.id} is absent from destination test: ${destination}`);
        } else {
          item.destination = destination;
        }
      }
    }
    group.cases.push(item);
  }

  const selectedKeys = new Set([...byFile.values()].flatMap(file => file.cases.map(row => `${row.sourceFile}:${row.id}`)));
  const unlistedFeatureRows = rows.filter(row => WAVE_A_FEATURE.test(row.feature)
    && !selectedKeys.has(`${row.sourceFile}:${row.id}`));
  const boundaryCandidates = WAVE_A_BOUNDARY_CANDIDATES.map(candidate => ({
    ...candidate,
    cases: rows.filter(row => row.sourceFile === candidate.file && candidate.ids.includes(row.id)),
  }));

  const files = [...byFile.values()].map(group => {
    const pending = group.cases.filter(item => item.state === 'pending');
    const ported = group.cases.filter(item => item.state === 'ported');
    return {
      ...group,
      portedCount: ported.length,
      pendingCount: pending.length,
      pendingIds: pending.map(item => item.id),
      cases: group.cases,
    };
  });
  const cases = files.flatMap(file => file.cases);
  return {
    status: 'open',
    files,
    unlistedFeatureRows,
    boundaryCandidates,
    baseline: baselineIds ? { expectedCount: baselineCount, actualCount: rows.length, uniqueCount: ids.size, missingIds: missingBaselineIds, idsOutsideBaseline } : null,
    totals: {
      filesWithInventory: files.filter(file => file.cases.length > 0).length,
      relevantCases: cases.length,
      ported: cases.filter(item => item.state === 'ported').length,
      pending: cases.filter(item => item.state === 'pending').length,
    },
    errors,
  };
}

function formatReport(report) {
  const lines = [
    'Wave A traceability audit: OPEN (this inventory check does not close Gate 4 or canary review)',
    `Relevant inventory rows: ${report.totals.relevantCases}; ported: ${report.totals.ported}; pending: ${report.totals.pending}`,
  ];
  if (report.baseline) lines.push(`Original inventory baseline: ${report.baseline.uniqueCount}/${report.baseline.expectedCount} unique IDs present; missing: ${report.baseline.missingIds.length}; IDs outside baseline: ${report.baseline.idsOutsideBaseline.length}`);
  for (const file of report.files) {
    if (!file.cases.length) {
      lines.push(`${file.file}: no Wave A inventory rows (${file.reason})`);
      continue;
    }
    const marker = file.crossWave ? ' [cross-wave; filtered by feature column]' : '';
    const ids = file.pendingIds.length ? ` — pending ${file.pendingIds.join(', ')}` : ' — no pending Wave A rows';
    lines.push(`${file.file}: ${file.portedCount} ported, ${file.pendingCount} pending${marker}${ids}`);
  }
  lines.push(`Feature-assigned Wave A candidates outside the explicit row selection: ${report.unlistedFeatureRows.length}`);
  for (const row of report.unlistedFeatureRows) lines.push(`- ${row.sourceFile} ${row.id}: ${row.feature}`);
  lines.push('Cross-wave boundary candidates (visible, excluded from Wave A totals until classified):');
  for (const candidate of report.boundaryCandidates) {
    const found = candidate.cases.map(row => row.id);
    lines.push(`- ${candidate.file}: ${found.length ? found.join(', ') : 'no matching inventory IDs found'} — ${candidate.reason}`);
  }
  if (report.errors.length) lines.push('Validation errors:', ...report.errors.map(error => `- ${error}`));
  lines.push('Scope: curated rows from plan.md §12 Fase 4, plus exact shared-case IDs. Counts are not a completeness claim or canary-closure claim. ID presence verifies inventory linkage only; it does not prove assertions pass or establish behavioral equivalence.');
  return lines.join('\n');
}

function main() {
  const root = path.resolve(__dirname, '../..');
  const inventoryPath = path.join(root, 'docs/refactor/test-traceability.md');
  const report = auditWaveATrace({ inventoryText: fs.readFileSync(inventoryPath, 'utf8'), root, baselineCount: 804 });
  process.stdout.write(`${formatReport(report)}\n`);
  if (report.errors.length) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { WAVE_A_FILES, auditWaveATrace, formatReport, parseRows };
