'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { executeTool, getToolDeclarations } = require('../src/services/toolRegistry');
const { cambiarTele, handleCambiarTV } = require('../src/commands/cambiarTV');
const { handleRank, handleTop, handleDarXp, handleNiveles } = require('../src/commands/niveles');
const { handleAyuda } = require('../src/commands/ayuda');
const { handleInfo } = require('../src/commands/info');
const { handleConvertir } = require('../src/commands/convertir');
const { handleDrive } = require('../src/commands/drive');
const { handleSticker } = require('../src/commands/sticker');
const { handleLore } = require('../src/commands/lore');
const { handleRecordar } = require('../src/commands/recordatorios');
const { handleDoc } = require('../src/commands/documentos');
const { handleDescargar } = require('../src/commands/descargar');
const evolution = require('../src/services/evolution');

test('Tool Registry Robustness: executeTool maneja tool name nulo o no string', async () => {
    const resNull = await executeTool(null, null, null);
    assert.strictEqual(resNull.success, false);
    assert.ok(resNull.error);

    const resUndefined = await executeTool(undefined, {}, {});
    assert.strictEqual(resUndefined.success, false);
    assert.ok(resUndefined.error);

    const resNumber = await executeTool(12345, {}, {});
    assert.strictEqual(resNumber.success, false);
    assert.ok(resNumber.error);
});

test('Tool Registry Robustness: executeTool maneja herramienta desconocida con contrato { success: false, error }', async () => {
    const res = await executeTool('herramienta_no_existente_xyz', null, null);
    assert.strictEqual(res.success, false);
    assert.ok(res.error);
    assert.match(res.error, /no está registrada/i);
});

test('Tool Registry Robustness: control_tv ejecuta cambiarTele y exporta handleCambiarTV', async () => {
    assert.strictEqual(typeof cambiarTele, 'function');
    assert.strictEqual(typeof handleCambiarTV, 'function');

    const origPost = evolution.client.post;
    evolution.client.post = async () => ({ data: { status: 'SUCCESS' } });

    try {
        const res1 = await executeTool('control_tv', { canal: 'futbol' }, { from: 'test_tv@s.whatsapp.net' });
        assert.strictEqual(res1.success, true);
        assert.strictEqual(res1.canal, 'futbol');

        const res2 = await executeTool('control_tv', null, { from: 'test_tv@s.whatsapp.net' });
        assert.strictEqual(res2.success, true);
        assert.strictEqual(res2.canal, 'futbol');

        // Llamada directa a ambas convenciones de cambiarTele
        await cambiarTele('test_tv@s.whatsapp.net', 'https://youtube.com/tv');
        await cambiarTele({ args: ['https://youtube.com/tv'], flags: {} }, 'test_tv@s.whatsapp.net');
        await handleCambiarTV({ args: ['https://youtube.com/tv'], flags: {} }, 'test_tv@s.whatsapp.net');
    } finally {
        evolution.client.post = origPost;
    }
});

test('Tool Registry Robustness: juegos_y_economia despacha rank, top y valida handleNiveles', async () => {
    assert.strictEqual(typeof handleRank, 'function');
    assert.strictEqual(typeof handleTop, 'function');
    assert.strictEqual(typeof handleNiveles, 'function');

    const origPost = evolution.client.post;
    evolution.client.post = async () => ({ data: { status: 'SUCCESS' } });

    try {
        const context = {
            from: 'test_group_rank@g.us',
            senderJid: 'user_rank@s.whatsapp.net',
            messageData: { key: { participant: 'user_rank@s.whatsapp.net' } }
        };

        const resRank = await executeTool('juegos_y_economia', { juego: 'rank' }, context);
        assert.strictEqual(resRank.success, true);
        assert.strictEqual(resRank.juego, 'rank');

        const resTop = await executeTool('juegos_y_economia', { juego: 'top' }, context);
        assert.strictEqual(resTop.success, true);
        assert.strictEqual(resTop.juego, 'top');

        // Validar router handleNiveles
        await handleNiveles({ args: ['rank'], command: 'rank' }, 'test_group_rank@g.us', context.messageData);
        await handleNiveles({ args: ['top'], command: 'top' }, 'test_group_rank@g.us', context.messageData);
    } finally {
        evolution.client.post = origPost;
    }
});

test('Tool Registry Robustness: juegos_y_economia rechaza apuestas o montos inválidos/NaN', async () => {
    // Ruleta con apuesta no entera
    const resString = await executeTool('juegos_y_economia', { juego: 'ruleta', apuesta: 'mucho' }, {});
    assert.strictEqual(resString.success, false);
    assert.match(resString.error, /número entero positivo/i);

    const resNeg = await executeTool('juegos_y_economia', { juego: 'ruleta', apuesta: -100 }, {});
    assert.strictEqual(resNeg.success, false);
    assert.match(resNeg.error, /número entero positivo/i);

    const resDecimal = await executeTool('juegos_y_economia', { juego: 'ruleta', apuesta: 10.5 }, {});
    assert.strictEqual(resDecimal.success, false);
    assert.match(resDecimal.error, /número entero positivo/i);

    // Darxp con cantidad no entera
    const resXpNeg = await executeTool('juegos_y_economia', { juego: 'darxp', cantidad: -50 }, {});
    assert.strictEqual(resXpNeg.success, false);
    assert.match(resXpNeg.error, /número entero positivo/i);

    const resXpNaN = await executeTool('juegos_y_economia', { juego: 'darxp', cantidad: 'cien' }, {});
    assert.strictEqual(resXpNaN.success, false);
    assert.match(resXpNaN.error, /número entero positivo/i);
});

test('Tool Registry Robustness: notas_tablon valida IDs y maneja args nulos sin excepción', async () => {
    const origPost = evolution.client.post;
    evolution.client.post = async () => ({ data: { status: 'SUCCESS' } });

    try {
        const resGuardarNoContent = await executeTool('notas_tablon', { accion: 'guardar' }, { from: 'chat@s.whatsapp.net' });
        assert.strictEqual(resGuardarNoContent.success, false);
        assert.ok(resGuardarNoContent.error);

        const resBuscarNoQuery = await executeTool('notas_tablon', { accion: 'buscar' }, { from: 'chat@s.whatsapp.net' });
        assert.strictEqual(resBuscarNoQuery.success, false);
        assert.ok(resBuscarNoQuery.error);

        const resBorrarInvalidId = await executeTool('notas_tablon', { accion: 'borrar', id: 'invalido' }, { from: 'chat@s.whatsapp.net' });
        assert.strictEqual(resBorrarInvalidId.success, false);
        assert.ok(resBorrarInvalidId.error);

        const resBorrarNegId = await executeTool('notas_tablon', { accion: 'borrar', id: -5 }, { from: 'chat@s.whatsapp.net' });
        assert.strictEqual(resBorrarNegId.success, false);
        assert.ok(resBorrarNegId.error);
    } finally {
        evolution.client.post = origPost;
    }
});

test('Tool Registry Robustness: recordatorios_alarmas valida IDs y opera con args nulos', async () => {
    const resCancelInvalid = await executeTool('recordatorios_alarmas', { accion: 'cancelar', id: 'abc' }, {});
    assert.strictEqual(resCancelInvalid.success, false);
    assert.ok(resCancelInvalid.error);

    const resCancelNeg = await executeTool('recordatorios_alarmas', { accion: 'cancelar', id: -1 }, {});
    assert.strictEqual(resCancelNeg.success, false);
    assert.ok(resCancelNeg.error);
});

test('Tool Registry Robustness: todos los command handlers toleran invocaciones vacías/nulas sin lanzar excepciones', async () => {
    const origPost = evolution.client.post;
    evolution.client.post = async () => ({ data: { status: 'SUCCESS' } });

    try {
        // Ninguna de estas invocaciones debe lanzar TypeError ni unhandled rejection
        await assert.doesNotReject(async () => await handleAyuda(null, null));
        await assert.doesNotReject(async () => await handleInfo(null, null));
        await assert.doesNotReject(async () => await handleConvertir(null, null, null));
        await assert.doesNotReject(async () => await handleDrive(null, null, null));
        await assert.doesNotReject(async () => await handleRank(null, null, null));
        await assert.doesNotReject(async () => await handleTop(null, null, null));
        await assert.doesNotReject(async () => await handleDarXp(null, null, null));
        await assert.doesNotReject(async () => await handleNiveles(null, null, null));
        await assert.doesNotReject(async () => await handleSticker(null, null, null));
        await assert.doesNotReject(async () => await handleLore(null, null, null));
        await assert.doesNotReject(async () => await handleRecordar(null, null, null));
        await assert.doesNotReject(async () => await handleDoc(null, null, null));
        await assert.doesNotReject(async () => await handleDescargar(null, null, null));
        await assert.doesNotReject(async () => await cambiarTele(null, null, null));
        await assert.doesNotReject(async () => await handleCambiarTV(null, null, null));
    } finally {
        evolution.client.post = origPost;
    }
});
