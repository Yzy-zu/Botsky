'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createMediaSearch } = require('../src/services/mediaSearch');

const entry = (id = 'abcdefghijk', fields = {}) => ({ id, title: 'Clase de física', ...fields });
const output = (...entries) => entries.map(value => JSON.stringify(value)).join('\n');
const searchWith = stdout => createMediaSearch({ run: async () => ({ stdout }) });

test('Conserva resultados aunque toda la duración sea desconocida', async () => {
    const result = await searchWith(output(entry(), entry('abcdefghijl', { duration: null })))('clase de física');
    assert.equal(result.status, 'success');
    assert.equal(result.items.length, 2);
    assert.equal(result.items[0].duration, null);
    assert.equal(result.items[0].secs, null);
    assert.equal(result.diagnostic.accepted, 2);
});

test('No interpreta palabras ni símbolos del título como transmisiones en vivo', async () => {
    const result = await searchWith(output(entry('abcdefghijk', { title: '🔴 Te explico en vivo el estilo directo' })))('curso');
    assert.equal(result.status, 'success');
    assert.equal(result.items.length, 1);
});

test('Filtra únicamente metadatos de directo activo o futuro, conserva grabaciones', async () => {
    const result = await searchWith(output(
        entry('abcdefghijk', { is_live: true }),
        entry('abcdefghijl', { live_status: 'is_upcoming' }),
        entry('abcdefghijm', { live_status: 'was_live', duration: 3670 })
    ))('clase');
    assert.equal(result.status, 'success');
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].duration, '1:01:10');
    assert.equal(result.diagnostic.rejected, 2);
});

test('Resultados largos conservan el orden de relevancia y no desaparecen por duración', async () => {
    const result = await searchWith(output(entry('abcdefghijk', { duration: 18000 }), entry('abcdefghijl', { duration: 45 })))('conferencia');
    assert.equal(result.items[0].duration, '5:00:00');
    assert.equal(result.items[1].duration, '0:45');
});

test('Cero resultados reales es empty, no un fallo del proveedor', async () => {
    const result = await searchWith('')('clase');
    assert.equal(result.status, 'empty');
    assert.equal(result.diagnostic.code, 'no_results');
});

test('Solo directos activos obtiene empty con causa diferenciada', async () => {
    const result = await searchWith(output(entry('abcdefghijk', { live_status: 'is_live' })))('clase');
    assert.equal(result.status, 'empty');
    assert.equal(result.diagnostic.code, 'live_only');
});

test('Error del proceso no se convierte en búsqueda vacía ni filtra mensajes sensibles', async () => {
    for (const [error, code] of [
        [{ code: 'ENOENT', message: 'secret query' }, 'dependency_missing'],
        [{ killed: true, signal: 'SIGKILL', message: 'token=secret' }, 'timeout'],
        [{ code: 1, message: 'secret stderr' }, 'process_failed'],
        [{ code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, 'output_too_large']
    ]) {
        const result = await createMediaSearch({ run: async () => { throw error; } })('consulta privada');
        assert.equal(result.status, 'unavailable');
        assert.equal(result.diagnostic.code, code);
        assert.equal(JSON.stringify(result).includes('secret'), false);
        assert.equal(JSON.stringify(result).includes('consulta privada'), false);
    }
});

test('Salida corrupta o registros inválidos se reportan como indisponibilidad', async () => {
    for (const stdout of ['not JSON', output({ id: '../../file' }), output(null), output(entry()) + '\nnot JSON']) {
        const result = await searchWith(stdout)('clase');
        assert.equal(result.status, 'unavailable');
        assert.equal(result.items.length, 0);
    }
});

test('NDJSON mantiene tabs y nuevas líneas del título sin romper el registro', async () => {
    const result = await searchWith(output(entry('abcdefghijk', { title: 'primera\tsegunda\ntercera' })))('clase');
    assert.equal(result.status, 'success');
    assert.equal(result.items[0].title, 'primera\tsegunda\ntercera');
});

test('IDs duplicados se deduplican y el límite se aplica sin inventar URLs', async () => {
    const result = await searchWith(output(entry(), entry(), entry('abcdefghijl')))('clase', { limit: 1 });
    assert.equal(result.items.length, 1);
    assert.equal(result.items[0].url, 'https://www.youtube.com/watch?v=abcdefghijk');
    assert.equal(result.diagnostic.rejected, 1);
});

test('Valida el contrato antes del proceso', async () => {
    let calls = 0;
    const search = createMediaSearch({ run: async () => { calls++; throw Error('No ejecutar'); } });
    for (const [query, options] of [['', {}], [null, {}], ['x'.repeat(1001), {}], ['clase', { limit: 0 }], ['clase', { limit: '8' }]]) {
        assert.equal((await search(query, options)).status, 'invalid');
    }
    assert.equal(calls, 0);
});

test('Argumentos no usan shell, tienen límite de tiempo y salida, y no descargan medios', async () => {
    let call;
    let tick = 0;
    const search = createMediaSearch({ now: () => tick++, run: async (...args) => { call = args; return { stdout: '' }; } });
    const result = await search('curso $(touch /tmp/not-created)');
    assert.equal(call[0], 'yt-dlp');
    assert.equal(call[1].includes('--skip-download'), true);
    assert.equal(call[1].at(-2), '--');
    assert.equal(call[1].at(-1), 'ytsearch13:curso $(touch /tmp/not-created)');
    assert.equal(call[2].shell, undefined);
    assert.equal(call[2].timeout, 15000);
    assert.equal(call[2].maxBuffer, 1024 * 1024);
    assert.equal(call[2].killSignal, 'SIGKILL');
    assert.equal(result.diagnostic.elapsed_ms, 1);
});

test('Salida excesiva se rechaza también al usar un adaptador inyectado', async () => {
    const result = await searchWith(' '.repeat(1024 * 1024 + 1))('clase');
    assert.equal(result.status, 'unavailable');
    assert.equal(result.diagnostic.code, 'output_too_large');
});
