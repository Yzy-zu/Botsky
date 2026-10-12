'use strict';

// Importing the reader does not import Evolution, load .env or start workers.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const {
    createContentReader, MAX_INLINE_BYTES, MAX_TEXT_CHARACTERS, attachmentMetadata
} = require('../src/services/contentReader');

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF');
const PNG = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.alloc(24)]);
function document(fileName, mimetype, extra = {}) {
    return { key: { id: 'file-id' }, message: { documentMessage: { fileName, mimetype, ...extra } } };
}
function reader(buffer, extra = {}) {
    return createContentReader({
        downloadMedia: async () => ({ buffer, extension: 'bin' }),
        execFile: async command => {
            assert.equal(command, 'pdfinfo');
            return { stdout: 'Pages: 4\nEncrypted: no\n' };
        }, ...extra
    });
}
async function prepare(buffer, data, extra = {}) {
    return reader(buffer, extra).prepareContent({ messageData: data, messageType: 'documentMessage' });
}

test('PDF conserva bytes nativos, páginas e identidad aunque metadata diga JPEG', async () => {
    const result = await prepare(PDF, document('ejercicios.pdf', 'image/jpeg'));
    assert.equal(result.success, true);
    assert.equal(result.mediaContext.mimetype, 'application/pdf');
    assert.equal(result.mediaContext.pageCount, 4);
    assert.equal(result.mediaContext.base64, PDF.toString('base64'));
    assert.equal(result.mediaContext.attachmentId, 'file-id');
});

test('PNG se detecta por bytes sin suponer JPEG', async () => {
    const result = await reader(PNG).prepareContent({ messageData: { message: { imageMessage: {} } }, messageType: 'imageMessage' });
    assert.equal(result.mediaContext.mimetype, 'image/png');
    assert.equal(result.mediaContext.base64, PNG.toString('base64'));
});

test('Documento con caption y envoltorio efímero mantiene metadata', () => {
    const messageData = document('../ejercicio.pdf', 'application/pdf');
    messageData.message = { ephemeralMessage: { message: { documentWithCaptionMessage: { message: messageData.message } } } };
    assert.equal(attachmentMetadata(messageData, 'documentWithCaptionMessage').fileName, 'ejercicio.pdf');
    assert.equal(attachmentMetadata(messageData).type, 'documentMessage');
});

test('Texto se extrae completo, no se disfraza de imagen', async () => {
    const text = 'Resuelve: x + 2 = 8\nExplica por qué.';
    const result = await prepare(Buffer.from(text), document('problema.txt', 'text/plain'));
    assert.equal(result.success, true);
    assert.equal(result.mediaContext.extractedText, text);
    assert.equal(result.mediaContext.base64, undefined);
});

test('Descarga fallida pide reenviar y nunca afirma haber leído contenido', async () => {
    const result = await prepare(PDF, document('a.pdf', 'application/pdf'), { downloadMedia: async () => { throw new Error('expired'); } });
    assert.equal(result.status, 'download_failed');
    assert.equal(result.success, false);
    assert.equal(result.needs_clarification, true);
    assert.match(result.question, /Reenvíalo/);
    assert.equal(result.mediaContext, undefined);
});

test('Límite declarado rechaza antes de descargar', async () => {
    let called = false;
    const result = await prepare(PDF, document('a.pdf', 'application/pdf', { fileLength: MAX_INLINE_BYTES + 1 }), {
        downloadMedia: async () => { called = true; return { buffer: PDF }; }
    });
    assert.equal(result.status, 'too_large');
    assert.equal(called, false);
});

test('Límite real comprueba los bytes aunque metadata omita el tamaño', async () => {
    const result = await prepare(Buffer.alloc(MAX_INLINE_BYTES + 1), document('a.pdf', 'application/pdf'));
    assert.equal(result.status, 'too_large');
});

test('Transporte recibe límite de bytes y un corte de tamaño se informa sin afirmar lectura', async () => {
    const result = await prepare(PDF, document('a.pdf', 'application/pdf'), {
        downloadMedia: async (_data, options) => {
            assert.equal(options.maxBytes, MAX_INLINE_BYTES);
            throw Object.assign(new Error('maxContentLength size exceeded'), { code: 'ERR_BAD_RESPONSE' });
        }
    });
    assert.equal(result.status, 'too_large');
});

test('fileLength Long serializado no oculta un archivo enorme por overflow de low', async () => {
    const result = await prepare(PDF, document('a.pdf', 'application/pdf', { fileLength: { low: -1, high: 0 } }), {
        downloadMedia: async () => { throw new Error('must not download'); }
    });
    assert.equal(result.status, 'too_large');
});

test('Firma PDF prevalece sobre una extensión Office equivocada', async () => {
    const result = await prepare(PDF, document('a.docx', OFFICE_DOCX));
    assert.equal(result.success, true);
    assert.equal(result.mediaContext.mimetype, 'application/pdf');
    assert.equal(result.mediaContext.convertedForReading, undefined);
});

test('Archivo vacío y documento sin texto piden otra copia', async () => {
    assert.equal((await prepare(Buffer.alloc(0), document('a.txt', 'text/plain'))).status, 'empty');
    assert.equal((await prepare(Buffer.from(' \n'), document('a.txt', 'text/plain'))).status, 'empty');
});

test('Texto muy largo no se trunca silenciosamente', async () => {
    const result = await prepare(Buffer.from('a'.repeat(MAX_TEXT_CHARACTERS + 1)), document('a.txt', 'text/plain'));
    assert.equal(result.status, 'too_long');
    assert.equal(result.mediaContext, undefined);
});

test('Texto con UTF-8 inválido o contenido binario no se inventa', async () => {
    assert.equal((await prepare(Buffer.from([255, 254, 253]), document('a.txt', 'text/plain'))).status, 'encoding');
    assert.equal((await prepare(Buffer.from([1, 2, 3]), document('a.txt', 'text/plain'))).status, 'corrupt');
});

test('PDF corrupto o encriptado produce preguntas específicas', async () => {
    const bad = { execFile: async () => { throw new Error('Invalid xref'); } };
    const encrypted = { execFile: async () => { throw new Error('Incorrect password'); } };
    assert.equal((await prepare(PDF, document('a.pdf', 'application/pdf'), bad)).status, 'corrupt');
    assert.equal((await prepare(PDF, document('a.pdf', 'application/pdf'), encrypted)).status, 'encrypted');
});

test('Lector PDF no disponible o timeout no se disfraza de contenido validado ni archivo corrupto', async () => {
    const data = document('a.pdf', 'application/pdf');
    assert.equal((await prepare(PDF, data, { execFile: async () => { throw Object.assign(Error('missing'), { code: 'ENOENT' }); } })).status, 'reader_unavailable');
    assert.equal((await prepare(PDF, data, { execFile: async () => { throw Object.assign(Error('timeout'), { killed: true }); } })).status, 'reading_timeout');
});

test('PDF protegido que pdfinfo consigue abrir también pide copia sin contraseña', async () => {
    const result = await prepare(PDF, document('a.pdf', 'application/pdf'), {
        execFile: async () => ({ stdout: 'Pages: 3\nEncrypted: yes (print:yes)\n' })
    });
    assert.equal(result.status, 'encrypted');
});

test('PDF sin páginas o más de 1000 páginas pide una copia manejable', async () => {
    const data = document('a.pdf', 'application/pdf');
    assert.equal((await prepare(PDF, data, { execFile: async () => ({ stdout: 'Pages: 0\nEncrypted: no\n' }) })).status, 'corrupt');
    assert.equal((await prepare(PDF, data, { execFile: async () => ({ stdout: 'Pages: 1001\nEncrypted: no\n' }) })).status, 'too_many_pages');
});

test('Formato desconocido o imagen falsa no usa fallback JPEG', async () => {
    const bytes = Buffer.from('This is not an image');
    assert.equal((await prepare(bytes, document('a.jpg', 'image/jpeg'))).status, 'unsupported');
    assert.equal((await prepare(bytes, document('a.bin', 'application/octet-stream'))).status, 'unsupported');
});

test('GIF pide una foto legible en lugar de mandar MIME no soportado', async () => {
    const result = await prepare(Buffer.from('GIF89a...............'), document('a.gif', 'image/gif'));
    assert.equal(result.status, 'unsupported');
    assert.match(result.question, /captura/);
});

test('Conversión Office es interna, usa perfil único y limpia los temporales', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'botsky-reader-test-'));
    const commands = [];
    try {
        const result = await prepare(Buffer.from([80, 75, 3, 4, 1, 2]), document('../clase.docx', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'), {
            tempRoot,
            execFile: async (command, args, options) => {
                commands.push({ command, args, options });
                if (command === 'libreoffice') {
                    const outdir = args[args.indexOf('--outdir') + 1];
                    await fs.promises.writeFile(path.join(outdir, 'input.pdf'), PDF);
                    return { stdout: 'converted' };
                }
                return { stdout: 'Pages: 2\nEncrypted: no\n' };
            }
        });
        assert.equal(result.success, true);
        assert.equal(result.mediaContext.mimetype, 'application/pdf');
        assert.equal(result.mediaContext.fileName, 'clase.docx');
        assert.equal(result.mediaContext.convertedForReading, true);
        assert.equal(result.mediaContext.pageCount, 2);
        assert.equal(commands.length, 2);
        assert.ok(commands[0].args.some(arg => arg.startsWith('-env:UserInstallation=file:')));
        assert.equal(commands[0].options.timeout, 45_000);
        assert.deepEqual(await fs.promises.readdir(tempRoot), []);
    } finally { await fs.promises.rm(tempRoot, { recursive: true, force: true }); }
});

test('Conversión fallida y PDF corrupto limpian temporales incluso en error', async () => {
    const tempRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'botsky-reader-test-'));
    try {
        const extra = { tempRoot, execFile: async () => { throw new Error('failed'); } };
        const office = await prepare(Buffer.from([80, 75, 3, 4]), document('a.docx', OFFICE_DOCX), extra);
        assert.equal(office.status, 'conversion_failed');
        assert.equal((await prepare(PDF, document('a.pdf', 'application/pdf'), extra)).status, 'corrupt');
        assert.deepEqual(await fs.promises.readdir(tempRoot), []);
    } finally { await fs.promises.rm(tempRoot, { recursive: true, force: true }); }
});
const OFFICE_DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

test('Office con extensión falsificada no se abre con LibreOffice', async () => {
    const result = await prepare(Buffer.from('not a zip'), document('a.docx', OFFICE_DOCX), {
        execFile: async () => { throw new Error('should not run'); }
    });
    assert.equal(result.status, 'corrupt');
});

test('Cita conserva identidad del adjunto original', async () => {
    const data = document('a.pdf', 'application/pdf');
    data.quotedStanzaId = 'quoted-file';
    const result = await prepare(PDF, data);
    assert.equal(result.mediaContext.attachmentId, 'quoted-file');
});

function fakeIO(overrides = {}) {
    return {
        mkdtemp: async () => '/synthetic/reading', mkdir: async () => {}, writeFile: async () => {},
        stat: async () => ({ size: PDF.length }), readFile: async () => PDF, rm: async () => {},
        ...overrides
    };
}

test('Office con nombre bin/zip usa MIME y firma, con extensión de conversión allowlisted', async () => {
    for (const fileName of ['clase.bin', 'clase.zip', '../../sin-extension']) {
        const commands = [];
        const result = await prepare(Buffer.from([80, 75, 3, 4]), document(fileName, OFFICE_DOCX), {
            fs: fakeIO(),
            execFile: async (command, args) => {
                commands.push({ command, args });
                return { stdout: 'Pages: 1\nEncrypted: no\n' };
            }
        });
        assert.equal(result.success, true);
        assert.equal(result.mediaContext.convertedForReading, true);
        assert.equal(commands[0].command, 'libreoffice');
        assert.equal(commands[0].args.at(-1), '/synthetic/reading/input.docx');
    }
});

test('MIME Office falsificado no convierte texto ni un ZIP genérico sin tipo Office conocido', async () => {
    const cannotRun = { execFile: async () => { throw Error('must not run'); } };
    assert.equal((await prepare(Buffer.from('not office bytes'), document('clase.bin', OFFICE_DOCX), cannotRun)).success, false);
    assert.equal((await prepare(Buffer.from([80, 75, 3, 4]), document('clase.zip', 'application/zip'), cannotRun)).status, 'unsupported');
});

test('Fallo de disco creando o escribiendo temporales devuelve aclaración y no lanza excepción', async () => {
    for (const operation of ['mkdtemp', 'writeFile']) {
        let cleanups = 0;
        const result = await prepare(PDF, document('clase.pdf', 'application/pdf'), {
            fs: fakeIO({
                [operation]: async () => { throw Object.assign(new Error('full'), { code: 'ENOSPC' }); },
                rm: async () => { cleanups++; }
            })
        });
        assert.equal(result.status, 'preparation_failed');
        assert.equal(result.needs_clarification, true);
        assert.equal(cleanups, operation === 'mkdtemp' ? 0 : 1);
    }
});

test('Fallo de limpieza preserva el diagnóstico original en PDF protegido', async () => {
    const warnings = [];
    const result = await prepare(PDF, document('clase.pdf', 'application/pdf'), {
        fs: fakeIO({ rm: async () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); } }),
        execFile: async () => ({ stdout: 'Pages: 1\nEncrypted: yes\n' }),
        onCleanupError: error => warnings.push(error.code)
    });
    assert.equal(result.status, 'encrypted');
    assert.deepEqual(warnings, ['EACCES']);
});

test('Fallo de limpieza después de lectura correcta termina con aclaración, sin bytes publicados', async () => {
    const result = await prepare(PDF, document('clase.pdf', 'application/pdf'), {
        fs: fakeIO({ rm: async () => { throw Error('cleanup failed'); } }), onCleanupError: () => {}
    });
    assert.equal(result.status, 'preparation_failed');
    assert.equal(result.mediaContext, undefined);
});
