'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const evolution = require('../src/services/evolution');
const { handleConvertir } = require('../src/commands/convertir');

test('Convertir: Rechaza formato desconocido amigablemente', async () => {
    await assert.rejects(
        async () => {
            await handleConvertir({
                flags: { formato: 'formato_inventado_xyz' },
                args: []
            }, '12345@s.whatsapp.net', {});
        },
        (err) => {
            assert.ok(err.userMessage || err.message);
            const msg = err.userMessage || err.message;
            assert.ok(msg.includes('formato') || msg.includes('inválido') || msg.includes('invalido'));
            return true;
        }
    );
});

test('Convertir: Rechaza si no se adjunta archivo ni url', async () => {
    await assert.rejects(
        async () => {
            await handleConvertir({
                flags: { formato: 'pdf' },
                args: []
            }, '12345@s.whatsapp.net', {});
        },
        (err) => {
            assert.ok(err.userMessage || err.message);
            const msg = err.userMessage || err.message;
            assert.ok(msg.includes('no se encontró archivo') || msg.includes('adjunta un archivo'));
            return true;
        }
    );
});