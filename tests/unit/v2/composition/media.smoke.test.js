'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { createMediaServices } = require('../../../../src/v2/composition/media');
const { SystemClock } = require('../../../../src/v2/platform/clock');

const execFileAsync = promisify(execFile);

function ppmRgb(data) {
    let offset = 0;
    const token = () => {
        while (offset < data.length) {
            if (data[offset] === 35) { while (offset < data.length && data[offset] !== 10) offset++; }
            else if ([9, 10, 13, 32].includes(data[offset])) offset++;
            else break;
        }
        const start = offset;
        while (offset < data.length && ![9, 10, 13, 32, 35].includes(data[offset])) offset++;
        return data.toString('ascii', start, offset);
    };
    assert.equal(token(), 'P6');
    const width = Number(token()), height = Number(token()), max = Number(token());
    assert.equal(max, 255);
    if (data[offset] === 13 && data[offset + 1] === 10) offset += 2;
    else offset++;
    const rgb = data.subarray(offset);
    assert.equal(rgb.length, width * height * 3);
    return { width, height, rgb };
}

function pdfWithSingleImage({ width, height, rgb }) {
    const content = Buffer.from('q\n600 0 0 200 0 0 cm\n/Im0 Do\nQ\n', 'ascii');
    const objects = [
        Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),
        Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),
        Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 200] /Resources << /XObject << /Im0 5 0 R >> >> /Contents 4 0 R >>'),
        Buffer.concat([Buffer.from(`<< /Length ${content.length} >>\nstream\n`), content, Buffer.from('endstream')]),
        Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${width} /Height ${height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Length ${rgb.length} >>\nstream\n`), rgb, Buffer.from('\nendstream')])
    ];
    const chunks = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')], offsets = [0];
    let length = chunks[0].length;
    objects.forEach((object, index) => {
        offsets.push(length);
        const chunk = Buffer.concat([Buffer.from(`${index + 1} 0 obj\n`), object, Buffer.from('\nendobj\n')]);
        chunks.push(chunk); length += chunk.length;
    });
    const xrefOffset = length;
    const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n', ...offsets.slice(1).map(value => `${String(value).padStart(10, '0')} 00000 n \n`)];
    chunks.push(Buffer.from(`${xref.join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`));
    return Buffer.concat(chunks);
}

test('scanned PDF read falls back to QR/OCR adapter after pdftotext returns no text', async t => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-scanned-pdf-smoke-'));
    t.after(() => fs.rm(root, { recursive: true, force: true }));
    const ppm = path.join(root, 'scan.ppm');
    await execFileAsync('convert', ['-size', '1200x400', 'xc:white', '-font', '/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf',
        '-pointsize', '90', '-fill', 'black', '-annotate', '+30+250', 'SCANNED PDF OCR OK', '-depth', '8', ppm], { timeout: 15_000 });
    const pdf = pdfWithSingleImage(ppmRgb(await fs.readFile(ppm)));
    const calls = [];
    const runtime = createMediaServices({
        config: { TMP_DIR: path.join(root, 'media-root') }, clock: new SystemClock(),
        llm: { generate: async () => { throw Error('LLM should not be called'); } },
        evolution: { downloadMedia: async (message, options) => {
            calls.push(message.key.id); options.signal.throwIfAborted();
            return { buffer: pdf, extension: 'pdf', mimeType: 'application/pdf' };
        } },
        http: { post: async () => { throw Error('HTTP should not be called'); } },
        formData: () => { throw Error('FormData should not be called'); }
    });
    t.after(() => runtime.dispose());
    const attachment = { id: 'synthetic-scan', ownerJid: '525550000001@s.whatsapp.net', chatId: '525550000001@s.whatsapp.net',
        expiresAt: Date.now() + 60_000, ref: 'encrypted-synthetic', mime: 'application/pdf', kind: 'document' };
    const ctx = { attachment, event: { id: 'synthetic-event', chatId: attachment.chatId,
        sender: { jid: attachment.ownerJid }, raw: { key: { id: attachment.id, remoteJid: attachment.chatId, participant: attachment.ownerJid, fromMe: false } } } };
    const command = runtime.features.find(feature => feature.id === 'documents').commands.find(item => item.name === 'leer');
    const result = await command.handler(ctx, {}, new AbortController().signal);
    assert.match(result.parts[0].text, /SCANNED PDF OCR OK/i);
    assert.deepEqual(calls, ['synthetic-scan', 'synthetic-scan'], 'PDF text extraction and OCR fallback each hydrate the attachment by identity');
});
