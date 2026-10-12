'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { formatWhatsAppText: format, splitWhatsAppText: split, WHATSAPP_FORMAT_INSTRUCTIONS } = require('../../src/v2/adapters/evolution/whatsappText');

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
