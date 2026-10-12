'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatWhatsAppText, splitWhatsAppText, planWhatsAppMessages, buildNativeTableMessage, formatNativeTableFallback, extractNativeTableText } = require('../src/utils/whatsappText');

test('native tables preserve response order, Unicode, blank cells and surrounding formatting', () => {
    const result = planWhatsAppMessages('**Antes**\n\n| Nombre | Valor |\n| :--- | ---: |\n| Ana 🙂 | 8 |\n| Luis | |\n\n# Después');
    assert.deepEqual(result.map(message => message.type), ['text', 'table', 'text']);
    assert.equal(result[0].text, '*Antes*');
    assert.deepEqual(result[1].headers, ['Nombre', 'Valor']);
    assert.deepEqual(result[1].rows, [['Ana 🙂', '8'], ['Luis', '']]);
    assert.equal(result[1].title, '');
    assert.equal(result[2].text, '*Después*');
    assert.match(formatWhatsAppText(result[1].text), /- Nombre: Ana/);
});

test('native table parser respects escaped pipes, inline code pipes and optional outer pipes', () => {
    const [table] = planWhatsAppMessages('Elemento | Expresión\n--- | ---\na\\|b | `x|y`\nc | ``x|`y``');
    assert.deepEqual(table.rows, [['a|b', '`x|y`'], ['c', '``x|`y``']]);
    const [escapedEnd] = planWhatsAppMessages('A | B\n--- | ---\na | b\\|');
    assert.deepEqual(escapedEnd.rows, [['a', 'b|']]);
});

test('code fences and invalid separators retain the exact legacy text behavior', () => {
    for (const source of [
        '```text\n| A | B |\n| --- | --- |\n| x | y |\n```',
        '| A | B |\n| --- |\n| x | y |',
        '| A | B |\n| -- | --- |\n| x | y |',
        '**Hola**\n' + 'párrafo 🙂 '.repeat(60),
        '', null
    ]) {
        assert.deepEqual(planWhatsAppMessages(source, { maxLength: 200 }),
            splitWhatsAppText(formatWhatsAppText(source), { maxLength: 200 }).map(text => ({ type: 'text', text })));
    }
});

test('ragged native table rows retain all cells and receive complete headers', () => {
    const [table] = planWhatsAppMessages('| A | B |\n| --- | --- |\n| x | y | z |\n| q |');
    assert.deepEqual(table.headers, ['A', 'B', 'Columna 3']);
    assert.deepEqual(table.rows, [['x', 'y', 'z'], ['q', '', '']]);
});

test('header-only tables become readable text and following tables keep their structure', () => {
    const messages = planWhatsAppMessages('| A | B |\n| --- | --- |\n\nIntermedio\n\n| C | D |\n| --- | --- |\n| 1 | 2 |');
    assert.deepEqual(messages.map(message => message.type), ['text', 'text', 'table']);
    assert.equal(messages[0].text, 'A · B');
    assert.deepEqual(messages[2].headers, ['C', 'D']);
});

test('native fallback preserves parsed escaped and inline-code pipe cells and extra columns', () => {
    const [table] = planWhatsAppMessages('| A | B |\n| --- | --- |\n| a\\|b | `x|y` | extra |');
    assert.equal(formatNativeTableFallback(table), '- A: a|b\n- B: `x|y`\n- Columna 3: extra');
    assert.equal(formatNativeTableFallback({ headers: ['A'], rows: [], title: 'Resumen' }), 'Resumen\n\nA');
});

test('native extraction reads working C envelopes with canonical escaped Markdown', () => {
    const payload = buildNativeTableMessage({ headers: ['A', 'B'], rows: [['a|b', '`x|y`'], ['🙂', '']], title: '' });
    const expected = '| A | B |\n| --- | --- |\n| a\\|b | `x\\|y` |\n| 🙂 |  |';
    assert.equal(extractNativeTableText(payload), expected);
    assert.equal(extractNativeTableText(payload.botForwardedMessage.message), expected);
    assert.deepEqual(planWhatsAppMessages(expected)[0].rows, [['a|b', '`x|y`'], ['🙂', '']]);
    const backslashes = buildNativeTableMessage({ headers: ['A'], rows: [['a\\b\\|c']], title: '' });
    assert.deepEqual(planWhatsAppMessages(extractNativeTableText(backslashes))[0].rows, [['a\\b\\|c']]);
});

test('native extraction preserves mixed submessage order and ignores unrelated text envelopes', () => {
    const payload = buildNativeTableMessage({ headers: ['A'], rows: [['x']], title: 'Título' });
    const rich = payload.botForwardedMessage.message.richResponseMessage;
    rich.submessages.unshift({ messageType: 0, messageText: 'Antes' });
    rich.submessages.push({ messageType: 0, messageText: 'Después' });
    assert.equal(extractNativeTableText(payload), 'Antes\n\nTítulo\n| A |\n| --- |\n| x |\n\nDespués');
    for (const unrelated of [null, {}, { conversation: 'hola' }, { extendedTextMessage: { text: 'hola' } }, { tableMetadata: rich.submessages[1].tableMetadata }]) {
        assert.equal(extractNativeTableText(unrelated), '');
    }
});

test('large tables split by rows with repeated headers and bounded payloads', () => {
    const expected = Array.from({ length: 30 }, (_, index) => [String(index), 'valor'.repeat(12)]);
    const source = ['| Id | Valor |', '| --- | --- |', ...expected.map(row => `| ${row.join(' | ')} |`)].join('\n');
    const messages = planWhatsAppMessages(source, { maxLength: 650 });
    assert.ok(messages.length > 1);
    assert.ok(messages.every(message => message.type === 'table'));
    assert.deepEqual(messages.flatMap(message => message.rows), expected);
    for (const message of messages) {
        assert.deepEqual(message.headers, ['Id', 'Valor']);
        assert.ok(message.text.length <= 650);
        assert.ok(JSON.stringify(buildNativeTableMessage(message)).length <= 650);
    }
});

test('oversized single cells fall back to split readable text without losing other rows', () => {
    const huge = 'contenido '.repeat(120);
    const source = `| Id | Valor |\n| --- | --- |\n| primero | 1 |\n| extenso | ${huge} |\n| último | 2 |`;
    const messages = planWhatsAppMessages(source, { maxLength: 650 });
    assert.equal(messages[0].type, 'table');
    assert.equal(messages.at(-1).type, 'table');
    assert.deepEqual(messages.at(-1).rows, [['último', '2']]);
    const text = messages.filter(message => message.type === 'text');
    assert.ok(text.length > 1);
    assert.ok(text.every(message => message.text.length <= 650));
    assert.equal(text.map(message => message.text).join(''), `- Id: extenso\n- Valor: ${huge.trim()}`);
});

test('native payload matches working C envelope and optional mentions without security metadata', () => {
    const message = buildNativeTableMessage({ headers: ['A', 'B'], rows: [['x', 'y']], title: '' }, { mentions: ['123@s.whatsapp.net'] });
    assert.deepEqual(message, { botForwardedMessage: { message: { richResponseMessage: {
        messageType: 1,
        submessages: [{ messageType: 4, tableMetadata: { title: '', rows: [
            { items: ['A', 'B'], isHeading: true }, { items: ['x', 'y'] }
        ] } }],
        contextInfo: {
            forwardingScore: 1, isForwarded: true,
            forwardedAiBotMessageInfo: { botJid: '867051314767696@bot' }, forwardOrigin: 4,
            mentionedJid: ['123@s.whatsapp.net']
        }
    } } } });
    const basic = buildNativeTableMessage({ headers: ['A'], rows: [['x']] });
    assert.equal(basic.botForwardedMessage.message.richResponseMessage.contextInfo.mentionedJid, undefined);
    assert.ok(!JSON.stringify(message).includes('unifiedResponse'));
    assert.ok(!JSON.stringify(message).includes('deviceListMetadata'));
});

test('planner validates limits consistently for empty text and table responses', () => {
    assert.throws(() => planWhatsAppMessages('', { maxLength: 31 }), RangeError);
    assert.throws(() => planWhatsAppMessages('| A |\n| --- |\n| x |', { maxLength: 1.5 }), RangeError);
});

test('native plans honor adapter column and row limits even with a generous length limit', () => {
    const rows = Array.from({ length: 101 }, (_, index) => `| ${index} | x |`);
    const plans = planWhatsAppMessages(['| Id | Valor |', '| --- | --- |', ...rows].join('\n'), { maxLength: 60000 });
    assert.deepEqual(plans.map(message => message.rows.length), [100, 1]);
    const header = Array.from({ length: 21 }, (_, index) => `C${index}`);
    const wide = planWhatsAppMessages([header.join(' | '), header.map(() => '---').join(' | '), header.map(() => 'x').join(' | ')].join('\n'));
    assert.ok(wide.every(message => message.type === 'text'));
    assert.match(wide.map(message => message.text).join(''), /- C20: x/);
});
