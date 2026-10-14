'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { auditWaveATrace, formatReport } = require('../../../scripts/refactor/check-wave-a-trace.cjs');

function inventory(rows) {
  return [
    '# inventory fixture',
    '## test/content_reader.test.js',
    '| ID | Legacy | Title | Feature | Scenario | Status |',
    '|---|---:|---|---|---|---|',
    ...rows,
    '',
    '## test/drive.test.js',
    '| TR-0999 | 1 | B-only row | features/drive | Scenario | pending: not Wave A |',
  ].join('\n');
}

function makeRoot(destinationText) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wave-a-trace-'));
  const destination = path.join(root, 'tests/unit/v2/contentReader.test.js');
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, destinationText);
  return { root, cleanup: () => fs.rmSync(root, { recursive: true, force: true }) };
}

test('Wave A audit validates only declared ported destinations and reports relevant pending rows', () => {
  const temp = makeRoot('// TR-0175 has a corresponding offline assertion');
  try {
    const text = inventory([
      '| TR-0175 | 101 | PDF signature wins | features/contentReader | `tests/unit/v2/contentReader.test.js` — `TR-0175: signature` | implemented: verified |',
      '| TR-0176 | 108 | Empty file asks for a copy | features/contentReader | No direct scenario | pending: port later |',
      '| TR-0998 | 1 | unrelated Wave B case | features/drive | No direct scenario | pending: port later |',
    ]);
    const report = auditWaveATrace({ inventoryText: text, root: temp.root });
    assert.deepEqual(report.errors, []);
    assert.equal(report.status, 'open');
    assert.deepEqual(report.totals, { filesWithInventory: 1, relevantCases: 2, ported: 1, pending: 1 });
    const contentReader = report.files.find(file => file.file === 'test/content_reader.test.js');
    assert.deepEqual(contentReader.pendingIds, ['TR-0176']);
    assert.match(formatReport(report), /OPEN/);
    assert.match(formatReport(report), /TR-0176/);
    assert.match(formatReport(report), /not a completeness claim or canary-closure claim/);
  } finally {
    temp.cleanup();
  }
});

test('Wave A audit rejects a ported row with no destination or missing ID in its destination', () => {
  const temp = makeRoot('// a different ID');
  try {
    const report = auditWaveATrace({
      inventoryText: inventory([
        '| TR-0175 | 101 | PDF signature wins | features/contentReader | no destination | ported: equivalent exists |',
        '| TR-0177 | 113 | Does not truncate | features/contentReader | `tests/unit/v2/contentReader.test.js` | implemented: destination listed |',
      ]),
      root: temp.root,
    });
    assert.equal(report.errors.length, 2);
    assert.match(report.errors[0], /TR-0175.*no tests/);
    assert.match(report.errors[1], /TR-0177.*absent from destination test/);
  } finally {
    temp.cleanup();
  }
});

test('Wave A filter is explicit and cross-wave files are marked instead of claiming every row', () => {
  const temp = makeRoot('// unused');
  try {
    const report = auditWaveATrace({
      inventoryText: [
        '## test/mediaUxIntegration.test.js',
        '| TR-0437 | 113 | PDF reading | features/contentReader + pipeline/router | S08 | pending: todo |',
        '| TR-0438 | 124 | Poll flow | features/polls | S08 | pending: todo |',
      ].join('\n'),
      root: temp.root,
    });
    const row = report.files.find(file => file.file === 'test/mediaUxIntegration.test.js');
    assert.equal(row.crossWave, true);
    assert.deepEqual(row.pendingIds, ['TR-0437']);
    assert.equal(report.totals.relevantCases, 1);
    assert.ok(report.files.some(file => file.file === 'test/thumbnailCollage.test.js'));
  } finally {
    temp.cleanup();
  }
});

test('shared pipeline rows enter Wave A only through the exact documented ID allowlist', () => {
  const temp = makeRoot('// unused');
  try {
    const report = auditWaveATrace({
      inventoryText: [
        '## test/dispatcher.test.js',
        '| TR-0283 | 317 | Help command remains available | pipeline/router | no direct scenario | pending: todo |',
        '| TR-0284 | 318 | Unrelated message flow | pipeline/router | no direct scenario | pending: todo |',
      ].join('\n'),
      root: temp.root,
    });
    const file = report.files.find(item => item.file === 'test/dispatcher.test.js');
    assert.deepEqual(file.pendingIds, ['TR-0283']);
  } finally {
    temp.cleanup();
  }
});

test('audit reports newly feature-assigned rows outside its source allowlist and boundary candidates separately', () => {
  const temp = makeRoot('// unused');
  try {
    const report = auditWaveATrace({
      inventoryText: [
        '## test/newVoiceFeature.test.js',
        '| TR-0900 | 1 | Voice script behavior | features/voiceScript | no direct scenario | pending: todo |',
        '## test/attachment_context.test.js',
        '| TR-0089 | 97 | Binary metadata forms | policies/attachment.policy + pipeline/context | S08 | pending: todo |',
      ].join('\n'),
      root: temp.root,
    });
    assert.deepEqual(report.unlistedFeatureRows.map(row => row.id), ['TR-0900']);
    assert.deepEqual(report.boundaryCandidates[0].cases.map(row => row.id), ['TR-0089']);
    assert.match(formatReport(report), /TR-0900.*features\/voiceScript/);
    assert.match(formatReport(report), /excluded from Wave A totals until classified/);
  } finally {
    temp.cleanup();
  }
});

test('duplicate trace IDs fail validation even when the duplicate rows are outside Wave A', () => {
  const temp = makeRoot('// unused');
  try {
    const report = auditWaveATrace({
      inventoryText: [
        '## test/drive.test.js',
        '| TR-0999 | 1 | Drive case | features/drive | no scenario | pending: todo |',
        '## test/notes.test.js',
        '| TR-0999 | 2 | Reused ID | features/notes | no scenario | pending: todo |',
      ].join('\n'),
      root: temp.root,
    });
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0], /duplicate inventory ID TR-0999/);
    assert.equal(report.totals.relevantCases, 0);
  } finally {
    temp.cleanup();
  }
});
