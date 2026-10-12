'use strict';

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { execFile } = require('child_process');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

const evolution = require('../src/services/evolution');
const { handleRecortarPdf, handleDoc } = require('../src/commands/documentos');
const { isRegisteredCommand } = require('../src/core/commandRegistry');

const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';

test('Recortar PDF: Flujo completo con Ghostscript real', async () => {
    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR, { recursive: true });
    }

    // 1. Generar un PDF de 5 páginas de prueba
    const testPdfPath = path.join(TMP_DIR, `test-fixture-${Date.now()}.pdf`);
    await execFileAsync('gs', [
        '-sDEVICE=pdfwrite',
        '-dNOPAUSE',
        '-dBATCH',
        '-dSAFER',
        `-sOutputFile=${testPdfPath}`,
        '-c', 'showpage',
        '-c', 'showpage',
        '-c', 'showpage',
        '-c', 'showpage',
        '-c', 'showpage'
    ]);

    const pdfBuffer = fs.readFileSync(testPdfPath);

    // 2. Mocks de Evolution API
    const sentTexts = [];
    const sentMedias = [];

    const origSendText = evolution.sendText;
    const origSendMedia = evolution.sendMedia;
    const origDownloadMedia = evolution.downloadMedia;

    evolution.sendText = async (to, text) => {
        sentTexts.push({ to, text });
        return { success: true };
    };

    evolution.sendMedia = async (to, filePath, caption, forceDoc, isHd, delay, fileName) => {
        // Verificar que el archivo generado existe y tiene páginas válidas
        const { stdout } = await execFileAsync('pdfinfo', [filePath]);
        const match = stdout.match(/^Pages:\s*(\d+)/m);
        const pages = match ? parseInt(match[1], 10) : 0;
        sentMedias.push({ to, filePath, caption, fileName, pages, exists: fs.existsSync(filePath) });
        return { success: true };
    };

    evolution.downloadMedia = async () => ({
        buffer: pdfBuffer,
        extension: 'pdf',
        originalFileName: 'documento_largo.pdf'
    });

    try {
        const dummyMessageData = {
            messageType: 'documentMessage',
            message: {
                documentMessage: {
                    mimetype: 'application/pdf',
                    fileName: 'documento_largo.pdf'
                }
            }
        };

        // Caso 1: Recortar páginas 2-4 (deben ser 3 páginas)
        await handleRecortarPdf({
            command: 'recortar',
            flags: {},
            args: ['2-4']
        }, 'test_user', dummyMessageData);

        assert.equal(sentMedias.length, 1);
        assert.equal(sentMedias[0].pages, 3);
        assert.ok(sentMedias[0].caption.includes('2-4'));
        assert.ok(sentMedias[0].fileName.includes('documento_largo'));

        // Caso 2: Recortar desde la página 3 (deben ser páginas 3-5 = 3 páginas)
        await handleRecortarPdf({
            command: 'recortar',
            flags: { p: 'desde 3' },
            args: []
        }, 'test_user', dummyMessageData);

        assert.equal(sentMedias.length, 2);
        assert.equal(sentMedias[1].pages, 3);
        assert.ok(sentMedias[1].caption.includes('3-5'));

        // Caso 3: Solicitar páginas fuera de rango (ej. página 10 en un PDF de 5 páginas)
        sentTexts.length = 0;
        await handleRecortarPdf({
            command: 'recortar',
            flags: {},
            args: ['10']
        }, 'test_user', dummyMessageData);

        assert.ok(sentTexts.some(t => t.text.includes('supera el total de páginas (5)')));

        // Caso 4: No especificar páginas
        sentTexts.length = 0;
        await handleRecortarPdf({
            command: 'recortar',
            flags: {},
            args: []
        }, 'test_user', dummyMessageData);

        assert.ok(sentTexts.some(t => t.text.includes('indica qué páginas recortar')));

        // Caso 5: Redirección automática desde handleDoc cuando se envía un PDF con páginas
        sentMedias.length = 0;
        await handleDoc({
            command: 'doc',
            flags: { f: 'pdf', paginas: '1,3' },
            args: []
        }, 'test_user', dummyMessageData);

        assert.equal(sentMedias.length, 1);
        assert.equal(sentMedias[0].pages, 2);
        assert.ok(sentMedias[0].caption.includes('1,3'));

    } finally {
        evolution.sendText = origSendText;
        evolution.sendMedia = origSendMedia;
        evolution.downloadMedia = origDownloadMedia;
        try { fs.unlinkSync(testPdfPath); } catch {}
    }
});

test('Recortar PDF: Registro y alias en commandRegistry', () => {
    assert.equal(isRegisteredCommand('recortar'), true);
    assert.equal(isRegisteredCommand('recortarpdf'), true);
    assert.equal(isRegisteredCommand('cortar'), true);
    assert.equal(isRegisteredCommand('cortarpdf'), true);
    assert.equal(isRegisteredCommand('extraerpdf'), true);
});
