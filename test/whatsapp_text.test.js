'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { formatWhatsAppText: format, splitWhatsAppText: split, WHATSAPP_FORMAT_INSTRUCTIONS } = require('../src/utils/whatsappText');

test('WhatsApp instructions and Markdown typography become native syntax', () => {
    assert.match(WHATSAPP_FORMAT_INSTRUCTIONS, /WhatsApp/);
    assert.equal(format('# Resultado\n**Correcto** y __claro__, ~~antes~~.'), '*Resultado*\n*Correcto* y _claro_, ~antes~.');
    assert.equal(format('# Resultado **final**'), '*Resultado final*');
});

test('tables preserve every cell, empty headers and escaped pipes as readable entries', () => {
    const output = format('| Alumno | | Puntos |\n| :--- | --- | ---: |\n| Ana | a\\|b | 8 |\n| Luis | | 10 |');
    assert.equal(output, '- Alumno: Ana\n- Columna 2: a|b\n- Puntos: 8\n\n- Alumno: Luis\n- Columna 2: \n- Puntos: 10');
    assert.equal(format(output), output);
});

test('links, URLs, algebra and Unicode remain readable without destructive replacements', () => {
    assert.equal(format('[Guía](https://ejemplo.mx/a_b?x=**a**&p=$5)\nx_y = a*b + 2; ¡sí! θ ≥ 0'), 'Guía: https://ejemplo.mx/a_b?x=**a**&p=$5\nx_y = a*b + 2; ¡sí! θ ≥ 0');
    assert.equal(format('Costo: $5.00 y $10.00'), 'Costo: $5.00 y $10.00');
});

test('balanced mathematical expressions preserve nested numerator/denominator and units', () => {
    assert.equal(format('\\[x = \\frac{1 + \\frac{a}{b}}{\\sqrt{x^{2}+1}} \\leq 4\\]'), 'x = (1 + (a) / (b)) / (√(x^(2)+1)) ≤ 4');
    assert.equal(format('\\(\\sqrt[3]{8} = 2\\) y $\\text{kg} \\times 3$'), 'root[3](8) = 2 y kg × 3');
    assert.equal(format('$$\\custom{a}{b} + \\frac{x}{y}$$'), 'custom{a}{b} + (x) / (y)');
});

test('fenced and inline code are protected from typography, tables, links and math conversions', () => {
    const code = '```js\nconst x_y = "**literal**";\n// $\\frac{a}{b}$\n| x | y |\n| --- | --- |\n```';
    const source = `**Ejemplo**\n${code}\nUsa \`**x** + $5$\`.`;
    assert.equal(format(source), `*Ejemplo*\n${code}\nUsa \`**x** + $5$\`.`);
});

test('formatter is idempotent across representative mixed responses', () => {
    const source = '# Solución\n**Respuesta**: $\\frac{x}{2}$\n\n| Paso | Valor |\n| --- | --- |\n| 1 | \\(x^{2}\\) |\n\n[Más](https://example.com/x_y)\n```text\n**literal**\n```';
    assert.equal(format(format(source)), format(source));
});

test('long paragraphs split safely without losing textual content or Unicode', () => {
    const source = Array.from({ length: 25 }, (_, i) => `Párrafo ${i}: ${'🙂 texto '.repeat(8)}`).join('\n\n');
    const chunks = split(source, { maxLength: 180 });
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every(chunk => chunk.length <= 180));
    assert.equal(chunks.join(''), source);
    assert.ok(chunks.every(chunk => !/[\uD800-\uDBFF]$/.test(chunk)));
});

test('long bold content closes and reopens native formatting without changing algebra', () => {
    const source = `*${'explicación '.repeat(30)}*\nx_y = a*b`;
    const chunks = split(source, { maxLength: 120 });
    assert.ok(chunks.every(chunk => chunk.length <= 120));
    assert.ok(chunks.slice(0, -1).every(chunk => chunk.startsWith('*') && chunk.endsWith('*')));
    assert.match(chunks.at(-1), /x_y = a\*b$/);
    assert.equal(chunks.join('').replace(/\*\*/g, ''), source);
});

test('long fenced code remains fenced in each chunk and preserves language', () => {
    const source = `\`\`\`js\n${'const x_y = a*b;\n'.repeat(30)}\`\`\``;
    const chunks = split(source, { maxLength: 120 });
    assert.ok(chunks.length > 2);
    assert.ok(chunks.every(chunk => chunk.length <= 120));
    assert.ok(chunks.every(chunk => chunk.startsWith('```js\n') && chunk.endsWith('```')));
    const code = chunks.map(chunk => chunk.slice(6, -3).replace(/\n$/, '')).join('\n');
    assert.equal(code, 'const x_y = a*b;\n'.repeat(30).trimEnd());
});

test('small chunks do not create empty code messages and preserve nested formatting', () => {
    const code = split(`\`\`\`javascript\n${'a'.repeat(80)}\n\`\`\``, { maxLength: 32 });
    assert.ok(code.every(chunk => chunk.includes('a\n```') && chunk.length <= 32));
    const nested = split(`*_texto ${'contenido '.repeat(20)}_*`, { maxLength: 64 });
    assert.ok(nested.every(chunk => chunk.startsWith('*_') && chunk.endsWith('_*') && chunk.length <= 64));
});

function loadTransport(failureAt = null, responseData = null, failureStatus = 500, failureCode = null, postHook = null) {
    const requests = [];
    const recorded = [];
    let attempts = 0;
    let mockNow = Date.now();
    const http = { post: async (endpoint, payload, config) => {
        attempts++;
        requests.push({ endpoint, payload: { ...payload }, config });
        if (postHook) postHook(endpoint, payload, attempts);
        if (attempts === failureAt) throw Object.assign(new Error('fallo simulado'), { response: { status: failureStatus, data: failureCode ? { code: failureCode } : undefined } });
        return { data: responseData || { key: { id: `sent-${attempts}` } } };
    } };
    const mocks = {
        dotenv: { config() {} }, axios: { create: () => http },
        fs: { statSync: () => ({ size: 10 }), promises: { readFile: async () => Buffer.from('documento') } },
        path, '../services/logger': { info() {}, warn() {} },
        './history': { addMessage: (...args) => recorded.push(args) },
        '../utils/whatsappText': require('../src/utils/whatsappText')
    };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../src/services/evolution.js'), 'utf8'), {
        require: name => { if (!(name in mocks)) throw new Error(`Unexpected import: ${name}`); return mocks[name]; },
        module, exports: module.exports, Buffer, process: { env: { EVOLUTION_API_URL: 'http://mock', EVOLUTION_API_KEY: 'mock', EVOLUTION_INSTANCE: 'mock' } },
        Date: class extends Date { static now() { return mockNow; } },
        global: {}, setTimeout: () => { throw new Error('No retries expected'); }
    });
    return { transport: module.exports, requests, recorded, advance: ms => { mockNow += ms; } };
}

test('voice delivery records its actual transcript only after success and does not replay uncertain sends', async () => {
    const h = loadTransport();
    await h.transport.sendVoiceNote('521111111111', '/tmp/fake.mp3', { transcript: 'Qué pinche pedo, cabrón.', durationSeconds: 30.1 });
    assert.equal(h.requests.length, 1);
    assert.equal(h.recorded.length, 1);
    assert.match(h.recorded[0][2], /Nota de voz de 30 s: Qué pinche pedo, cabrón/);
    const failed = loadTransport(1);
    await assert.rejects(failed.transport.sendVoiceNote('chat@g.us', '/tmp/fake.mp3', { transcript: 'hola' }));
    assert.equal(failed.requests.length, 1);
    assert.equal(failed.recorded.length, 0);
});

test('sendText formats once, sends chunks sequentially and records only successful chunks', async () => {
    const { transport, requests, recorded } = loadTransport();
    const result = await transport.sendText('521111111111', `**Hola**\n${'texto '.repeat(80)}`, { maxLength: 120, delay: 3, mentions: ['521222222222'] });
    assert.ok(requests.length > 2);
    assert.equal(result.data.key.id, `sent-${requests.length}`);
    assert.equal(recorded.length, requests.length);
    for (let i = 0; i < requests.length; i++) {
        assert.equal(recorded[i][0], '521111111111@s.whatsapp.net');
        assert.equal(recorded[i][2], requests[i].payload.text);
        assert.deepEqual(Array.from(requests[i].payload.options.mentions.mentioned), ['521222222222@s.whatsapp.net']);
        assert.equal(requests[i].payload.delay, 3);
    }
});

test('partial send failure reports delivered chunks without automatic replay or phantom history', async () => {
    const { transport, requests, recorded } = loadTransport(2);
    await assert.rejects(transport.sendText('chat@g.us', 'respuesta '.repeat(100), { maxLength: 120 }), error => {
        assert.equal(error.sentChunks, 1);
        assert.equal(error.partialDelivery, true);
        return true;
    });
    assert.equal(requests.length, 2);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0][2], requests[0].payload.text);
});

test('failed first send adds no history and raw mode preserves explicitly literal output', async () => {
    const failure = loadTransport(1);
    await assert.rejects(failure.transport.sendText('chat@g.us', '**hola**'));
    assert.equal(failure.recorded.length, 0);
    const literal = loadTransport();
    await literal.transport.sendText('chat@g.us', '# literal\n**igual**', { raw: true });
    assert.equal(literal.requests[0].payload.text, '# literal\n**igual**');
});

test('media captions use the same formatter and long captions continue only after successful media send', async () => {
    const { transport, requests, recorded } = loadTransport();
    await transport.sendMedia('chat@g.us', '/mock/test.pdf', `# Ejercicios\n${'desarrollo '.repeat(180)}`);
    assert.match(requests[0].payload.caption, /^\*Ejercicios\*/);
    assert.ok(requests[0].payload.caption.length <= 1024);
    assert.match(requests[0].endpoint, /sendMedia/);
    assert.ok(requests.slice(1).every(request => request.endpoint.includes('sendText')));
    assert.equal(recorded.length, requests.length);
});

test('media failure never sends a detached caption or stores undelivered text', async () => {
    const { transport, requests, recorded } = loadTransport(1);
    await assert.rejects(transport.sendMedia('chat@g.us', '/mock/test.pdf', 'desarrollo '.repeat(180)));
    assert.equal(requests.length, 1);
    assert.equal(recorded.length, 0);
});

test('media success followed by caption failure reports partial delivery without replaying media', async () => {
    const { transport, requests, recorded } = loadTransport(2);
    await assert.rejects(transport.sendMedia('chat@g.us', '/mock/test.pdf', 'desarrollo '.repeat(180)), error => {
        assert.equal(error.sentMedia, true);
        assert.equal(error.partialDelivery, true);
        return true;
    });
    assert.equal(requests.length, 2);
    assert.equal(recorded.length, 1);
});

test('bounded media downloads constrain HTTP body and validate decoded bytes before returning', async () => {
    const response = { base64: Buffer.from('%PDF-file').toString('base64'), mediaType: 'document', mimetype: 'application/pdf' };
    const { transport, requests } = loadTransport(null, response);
    const result = await transport.downloadMedia({ key: { id: 'file-1' }, message: { documentMessage: { fileName: 'clase.pdf' } } }, { maxBytes: 100 });
    assert.equal(result.buffer.toString(), '%PDF-file');
    assert.equal(result.extension, 'pdf');
    assert.equal(result.mimeType, 'application/pdf');
    assert.equal(requests[0].config.maxContentLength, Math.ceil(100 * 4 / 3) + 64 * 1024);
});

test('oversized decoded downloads and HTTP 413 produce the same clear non-retried limit error', async () => {
    const tooBig = loadTransport(null, { base64: Buffer.alloc(101).toString('base64'), mediaType: 'image' });
    await assert.rejects(tooBig.transport.downloadMedia({ key: {}, message: {} }, { maxBytes: 100 }), error => {
        assert.equal(error.code, 'MEDIA_TOO_LARGE');
        assert.match(error.userMessage, /páginas o imágenes/);
        return true;
    });
    const httpFailure = loadTransport(1, null, 413);
    await assert.rejects(httpFailure.transport.downloadMedia({ key: {}, message: {} }, { maxBytes: 100 }), error => error.code === 'MEDIA_TOO_LARGE');
    assert.equal(httpFailure.requests.length, 1);
});

test('data URI media yields MIME and magic extension; malformed Base64 is rejected', async () => {
    const data = loadTransport(null, { base64: `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64')}`, mediaType: 'image' });
    const result = await data.transport.downloadMedia({ key: {}, message: {} }, { maxBytes: 100 });
    assert.equal(result.mimeType, 'image/png');
    assert.equal(result.extension, 'png');
    const invalid = loadTransport(null, { base64: '%broken!', mediaType: 'image' });
    await assert.rejects(invalid.transport.downloadMedia({ key: {}, message: {} }, { maxBytes: 100 }), /no se pudo leer/);
});

test('late split-message echoes are consumed by exact chat/id while manual messages remain independent', async () => {
    const { transport, requests, recorded } = loadTransport();
    await transport.sendText('521111111111', 'respuesta extensa '.repeat(100), { maxLength: 120 });
    const count = recorded.length;
    for (let i = requests.length - 1; i >= 0; i--) {
        assert.equal(transport.consumeOutboundEcho({ chatId: '521111111111:40@s.whatsapp.net', messageId: `sent-${i + 1}`, text: requests[i].payload.text }), true);
    }
    assert.equal(recorded.length, count);
    assert.equal(transport.consumeOutboundEcho({ chatId: '521111111111@s.whatsapp.net', messageId: 'manual-1', text: requests[0].payload.text }), false);
    assert.equal(transport.consumeOutboundEcho({ chatId: 'otro@g.us', messageId: 'sent-1', text: requests[0].payload.text }), false);
    assert.equal(transport.consumeOutboundEcho({ chatId: '521111111111@s.whatsapp.net', text: requests[0].payload.text }), false);
});

test('echo before HTTP acknowledgement is consumed but history waits for delivery evidence', async () => {
    const { transport, recorded } = loadTransport();
    const originalPost = transport.client.post;
    transport.client.post = async (endpoint, payload, config) => {
        assert.equal(recorded.length, 0);
        assert.equal(transport.consumeOutboundEcho({ chatId: payload.number, messageId: 'early-id', text: payload.text }), true);
        assert.equal(recorded.length, 0);
        return originalPost(endpoint, payload, config);
    };
    await transport.sendText('chat@g.us', '**entregado**');
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0][2], '*entregado*');
    assert.equal(transport.consumeOutboundEcho({ chatId: 'chat@g.us', messageId: 'early-id', text: '*entregado*' }), true);
});

test('definitive failure removes pending text correlation and never records a phantom send', async () => {
    const { transport, recorded } = loadTransport(1, null, 400);
    await assert.rejects(transport.sendText('chat@g.us', 'falló'));
    assert.equal(recorded.length, 0);
    assert.equal(transport.consumeOutboundEcho({ chatId: 'chat@g.us', messageId: 'manual', text: 'falló' }), false);
});

test('confirmed webhook delivery is recorded once even if HTTP acknowledgement times out', async () => {
    const { transport, recorded } = loadTransport();
    transport.client.post = async (_, payload) => {
        transport.consumeOutboundEcho({ chatId: payload.number, messageId: 'confirmed', text: payload.text });
        throw new Error('timeout');
    };
    await assert.rejects(transport.sendText('chat@g.us', 'sí llegó'), /timeout/);
    assert.equal(recorded.length, 1);
    assert.equal(recorded[0][2], 'sí llegó');
    assert.equal(transport.consumeOutboundEcho({ chatId: 'chat@g.us', messageId: 'confirmed', text: 'sí llegó' }), true);
    assert.equal(recorded.length, 1);
});

test('outbound echo registry expires and remains bounded without periodic background work', async () => {
    const { transport, advance } = loadTransport();
    for (let i = 0; i < 1001; i++) await transport.sendText('chat@g.us', `mensaje ${i}`);
    assert.equal(transport.consumeOutboundEcho({ chatId: 'chat@g.us', messageId: 'sent-1', text: 'mensaje 0' }), false);
    assert.equal(transport.consumeOutboundEcho({ chatId: 'chat@g.us', messageId: 'sent-1001', text: 'mensaje 1000' }), true);
    advance(5 * 60 * 1000 + 1);
    assert.equal(transport.consumeOutboundEcho({ chatId: 'chat@g.us', messageId: 'sent-1001', text: 'mensaje 1000' }), false);
});


test('Forwarded bot media downloads with the original chat, id and fromMe flag', async () => {
    const h = loadTransport(null, { base64: Buffer.from('voice').toString('base64'), mediaType: 'audio' });
    await h.transport.downloadMedia({ key: { id: 'current-request', remoteJid: 'sender@s.whatsapp.net' },
        quotedStanzaId: 'actual-audio', quotedRemoteJid: 'original@g.us', quotedFromMe: true,
        message: { audioMessage: { mimetype: 'audio/ogg' } } });
    const key = h.requests[0].payload.message.key;
    assert.equal(key.id, 'actual-audio'); assert.equal(key.remoteJid, 'original@g.us'); assert.equal(key.fromMe, true);
});


test('Partial quote without a media key asks Evolution for the original instead of posting broken metadata', async () => {
    const h = loadTransport(null, { base64: Buffer.from('image').toString('base64'), mediaType: 'image' });
    await h.transport.downloadMedia({ key: { id: 'request', remoteJid: 'sender@s.whatsapp.net' }, quotedStanzaId: 'photo-id',
        message: { imageMessage: { caption: 'only a partial quote' } } });
    assert.equal(h.requests[0].payload.message.key.id, 'photo-id');
    assert.equal(h.requests[0].payload.message.message, undefined);
});

test('Generic HTTP 400 is a download failure and never fictitious proof of expiration', async () => {
    const h = loadTransport(1, null, 400);
    await assert.rejects(h.transport.downloadMedia({ key: { id: 'photo-id' }, message: { imageMessage: {} } }), error => {
        assert.equal(error.code, 'MEDIA_DOWNLOAD_FAILED');
        assert.ok(!/expir/i.test(error.message)); return true;
    });
});

const nativeTableSource = '| Producto | Cantidad |\n| --- | --- |\n| Manzanas | 2 |\n| Pan | 1 |';

test('native tables go through the table endpoint between prose, retaining history and mentions', async () => {
    const h = loadTransport();
    await h.transport.sendText('521111111111', `**Compra**\n\n${nativeTableSource}\n\nFin.`, { delay: 0, mentions: ['521222222222'] });
    assert.deepEqual(h.requests.map(request => request.endpoint), ['/message/sendText/mock', '/message/sendNativeTable/mock', '/message/sendText/mock']);
    assert.deepEqual(JSON.parse(JSON.stringify(h.requests[1].payload.table)), { headers: ['Producto', 'Cantidad'], rows: [['Manzanas', '2'], ['Pan', '1']], title: '' });
    assert.deepEqual(Array.from(h.requests[1].payload.mentions), ['521222222222@s.whatsapp.net']);
    assert.equal(h.requests[1].payload.delay, 0);
    assert.equal(h.recorded.length, 3);
    assert.match(h.recorded[1][2], /\| Manzanas \| 2 \|/);
    assert.equal(h.transport.consumeOutboundEcho({ chatId: '521111111111@s.whatsapp.net', messageId: 'sent-2', text: h.recorded[1][2] }), true);
});

test('missing native endpoint falls back only after rejection, preserving parsed cells and extra columns', async () => {
    const h = loadTransport(1, null, 404);
    await h.transport.sendText('521111111111', '| A | B |\n| --- | --- |\n| a\\|b | `x|y` | extra |');
    assert.equal(h.requests.length, 2);
    assert.match(h.requests[0].endpoint, /sendNativeTable/);
    assert.match(h.requests[1].endpoint, /sendText/);
    assert.match(h.requests[1].payload.text, /- A: a\|b\n- B: `x\|y`\n- Columna 3: extra/);
    assert.equal(h.recorded.length, 1);
    assert.equal(h.recorded[0][2], h.requests[1].payload.text);
});

test('only explicit pre-send native rejection permits text fallback', async () => {
    for (const code of ['NATIVE_TABLE_INVALID', 'NATIVE_TABLE_UNSUPPORTED']) {
        const h = loadTransport(1, null, 400, code);
        await h.transport.sendText('521111111111', nativeTableSource);
        assert.equal(h.requests.length, 2);
        assert.match(h.requests[1].payload.text, /- Producto: Manzanas/);
    }
    for (const [status, code] of [[400, null], [500, null], [undefined, null], [404, 'INSTANCE_NOT_FOUND']]) {
        const h = loadTransport(1, null, status, code);
        await assert.rejects(h.transport.sendText('521111111111', nativeTableSource), error => error.sentChunks === 0 && error.totalChunks === 1);
        assert.equal(h.requests.length, 1);
        assert.equal(h.recorded.length, 0);
    }
});

test('native failure after delivered prose reports partial delivery without replay', async () => {
    const h = loadTransport(2);
    await assert.rejects(h.transport.sendText('521111111111', `Compra\n\n${nativeTableSource}\n\nFin`), error => error.partialDelivery && error.sentChunks === 1 && error.totalChunks === 3);
    assert.equal(h.requests.length, 2);
    assert.equal(h.recorded.length, 1);
    assert.equal(h.recorded[0][2], 'Compra');
});

test('raw messages preserve literal tables without native dispatch', async () => {
    const h = loadTransport();
    await h.transport.sendText('521111111111', nativeTableSource, { raw: true });
    assert.equal(h.requests.length, 1);
    assert.match(h.requests[0].endpoint, /sendText/);
    assert.equal(h.requests[0].payload.text, nativeTableSource);
});

test('media caption prose stays with the file while tables follow as native messages', async () => {
    const h = loadTransport();
    await h.transport.sendMedia('521111111111', '/tmp/fake.pdf', `**Compra**\n\n${nativeTableSource}\n\nFin.`, true);
    assert.deepEqual(h.requests.map(request => request.endpoint), ['/message/sendMedia/mock', '/message/sendNativeTable/mock', '/message/sendText/mock']);
    assert.equal(h.requests[0].payload.caption, '*Compra*');
    assert.equal(h.requests[2].payload.text, 'Fin.');
    assert.equal(h.recorded.length, 3);
    const failed = loadTransport(2);
    await assert.rejects(failed.transport.sendMedia('521111111111', '/tmp/fake.pdf', nativeTableSource, true), error => error.sentMedia && error.partialDelivery);
    assert.equal(failed.requests.length, 2);
});

test('Gemini shared style permits native tables and quoted tables retain all data', () => {
    const { buildConversationStyle } = require('../src/services/conversationStyle');
    const { buildNativeTableMessage } = require('../src/utils/whatsappText');
    const { extractQuotedText } = require('../src/utils/messageText');
    const prompt = buildConversationStyle({ userMessage: 'Compara estos productos en una tabla' });
    assert.match(prompt, /tabla nativa de WhatsApp/);
    assert.match(prompt, /fuera de bloques de código/);
    assert.ok(!prompt.includes('No uses tablas Markdown'));
    const message = buildNativeTableMessage({ headers: ['Producto', 'Cantidad'], rows: [['Manzanas', '2'], ['Pan', '1']] });
    const quote = { extendedTextMessage: { text: '¿Cuál cuesta menos?', contextInfo: { quotedMessage: message } } };
    assert.match(extractQuotedText(quote), /\| Producto \| Cantidad \|/);
    assert.match(extractQuotedText(quote), /\| Pan \| 1 \|/);
});

test('native webhook echo before HTTP acknowledgement correlates canonical cells without duplicate history or replay', async () => {
    const { buildNativeTableMessage, extractNativeTableText } = require('../src/utils/whatsappText');
    let h;
    h = loadTransport(1, null, undefined, null, (endpoint, payload) => {
        assert.match(endpoint, /sendNativeTable/);
        const text = extractNativeTableText(buildNativeTableMessage(payload.table));
        assert.equal(h.transport.consumeOutboundEcho({ chatId: payload.number, messageId: 'native-echo', text }), true);
        assert.equal(h.recorded.length, 0);
    });
    await assert.rejects(h.transport.sendText('521111111111', '| A | B |\n| --- | --- |\n| a\\|b | `x|y` |'), error => error.sentChunks === 1 && error.partialDelivery);
    assert.equal(h.requests.length, 1);
    assert.equal(h.recorded.length, 1);
    assert.match(h.recorded[0][2], /a\\\|b/);
});
