'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { executeTool } = require('../src/services/toolRegistry');
const { getCommandHandler, getRegisteredCommands } = require('../src/core/commandRegistry');
const evolution = require('../src/services/evolution');
const mc = require('../src/services/minecraftRemote');

// Mock transport to avoid sending real WhatsApp messages or network failures
const origPost = evolution.client.post;
const origSendText = evolution.sendText;
const origSendMedia = evolution.sendMedia;
const origReply = evolution.reply;

// Mock minecraftRemote to avoid 5-second SSH network timeouts during stress loops
const origGetRemoteServerStatus = mc.getRemoteServerStatus;
const origGetOnlinePlayers = mc.getOnlinePlayers;
const origGetActiveModsAndPacks = mc.getActiveModsAndPacks;

function setupMocks() {
    evolution.client.post = async () => ({ data: { status: 'SUCCESS' } });
    evolution.sendText = async () => true;
    evolution.sendMedia = async () => true;
    evolution.reply = async () => true;

    mc.getRemoteServerStatus = async () => ({ online: false, lag: 'Desconectado' });
    mc.getOnlinePlayers = async () => ({ players: [], count: 0, max: 0 });
    mc.getActiveModsAndPacks = async () => ({ behaviorPacks: [], resourcePacks: [] });
}

function restoreMocks() {
    evolution.client.post = origPost;
    evolution.sendText = origSendText;
    evolution.sendMedia = origSendMedia;
    evolution.reply = origReply;

    mc.getRemoteServerStatus = origGetRemoteServerStatus;
    mc.getOnlinePlayers = origGetOnlinePlayers;
    mc.getActiveModsAndPacks = origGetActiveModsAndPacks;
}

test.beforeEach(() => {
    setupMocks();
});

test.after(() => {
    // The robustness matrix may start valid empty-argument games. Dispose
    // those test-owned timers before restoring the fake transport.
    const blackjack = require('../src/commands/blackjack');
    for (const game of blackjack.activeGames.values()) clearTimeout(game.timer);
    for (const table of blackjack.activeTables.values()) clearTimeout(table.timer);
    blackjack.activeGames.clear();
    blackjack.activeTables.clear();
    restoreMocks();
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 1: executeTool Robustness with Bizarre Data Types
// ═══════════════════════════════════════════════════════════════════════════════

test('Stress: executeTool never throws an unhandled rejection with primitive or bizarre arguments', async () => {
    const bizarreArgs = [
        null,
        undefined,
        0,
        1,
        -1,
        NaN,
        Infinity,
        -Infinity,
        '',
        'random string',
        'a'.repeat(50000), // huge string
        true,
        false,
        [],
        [1, 2, 3],
        [null, undefined, Symbol('inside_array')],
        {},
        { a: 1 },
        { [Symbol('symKey')]: 'symVal' },
        () => {},
        async () => {}
    ];

    const bizarreContexts = [
        null,
        undefined,
        0,
        '',
        'from_string',
        [],
        {},
        { from: null },
        { from: 'test@s.whatsapp.net', senderJid: null },
        { from: 'test@s.whatsapp.net', messageData: null },
        { from: 'test@s.whatsapp.net', isAdmin: null, isGroup: null }
    ];

    const tools = [
        'minecraft_control',
        'ejecutar_terminal',
        'notas_tablon',
        'recordatorios_alarmas',
        'tareas_escolares',
        'google_drive',
        'descargar_multimedia',
        'sintetizar_voz',
        'juegos_y_economia',
        'afinidad_y_lore',
        'control_tv',
        'enviar_mensaje_contacto',
        'non_existent_tool_xyz'
    ];

    for (const tool of tools) {
        for (const arg of bizarreArgs) {
            for (const ctx of bizarreContexts.slice(0, 3)) {
                let res;
                try {
                    res = await executeTool(tool, arg, ctx);
                } catch (err) {
                    assert.fail(`executeTool("${tool}") threw uncaught exception with arg ${String(arg)}: ${err.stack}`);
                }
                assert.ok(typeof res === 'object' && res !== null, `executeTool("${tool}") must return an object`);
                assert.ok(typeof res.success === 'boolean', `executeTool("${tool}") result must have boolean .success`);
            }
        }
    }
});

test('Stress: executeTool with BigInt in args (must not crash JSON serialization)', async () => {
    let res;
    try {
        res = await executeTool('control_tv', { amount: 10n });
    } catch (err) {
        assert.fail(`executeTool crashed on BigInt args: ${err.message}`);
    }
    assert.ok(res);
});

test('Stress: executeTool with Circular references in args (must not crash JSON serialization)', async () => {
    const circular = { name: 'test' };
    circular.self = circular;

    let res;
    try {
        res = await executeTool('control_tv', circular);
    } catch (err) {
        assert.fail(`executeTool crashed on circular args: ${err.message}`);
    }
    assert.ok(res);
});

test('Stress: executeTool with Symbols and throwing getters in args', async () => {
    const throwingObj = {
        get badProp() {
            throw new Error('Getter intentional blowup');
        }
    };

    let res;
    try {
        res = await executeTool('control_tv', throwingObj);
    } catch (err) {
        assert.fail(`executeTool crashed on throwing getter: ${err.message}`);
    }
    assert.ok(res);
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 2: All 12 Tools with Action-Specific Bizarre Payloads
// ═══════════════════════════════════════════════════════════════════════════════

test('Stress: All 12 tools handle malformed action parameters safely', async () => {
    const testCases = [
        { tool: 'minecraft_control', args: { accion: 'comando_consola', comando: null } },
        { tool: 'minecraft_control', args: { accion: 'activar_mod', mod: null } },
        { tool: 'minecraft_control', args: { accion: 'desactivar_mod', mod: null } },
        { tool: 'minecraft_control', args: { accion: 'ciclo_vida', operacion_energia: null } },
        { tool: 'minecraft_control', args: { accion: 'invalida_xyz' } },
        { tool: 'ejecutar_terminal', args: { comando: null } },
        { tool: 'ejecutar_terminal', args: { comando: '' } },
        { tool: 'notas_tablon', args: { accion: 'guardar', contenido: null } },
        { tool: 'notas_tablon', args: { accion: 'buscar', contenido: null } },
        { tool: 'notas_tablon', args: { accion: 'borrar', id: null } },
        { tool: 'notas_tablon', args: { accion: 'borrar', id: NaN } },
        { tool: 'notas_tablon', args: { accion: 'borrar', id: Infinity } },
        { tool: 'notas_tablon', args: { accion: 'borrar', id: 'abc' } },
        { tool: 'recordatorios_alarmas', args: { accion: 'crear', minutos: NaN } },
        { tool: 'recordatorios_alarmas', args: { accion: 'crear', minutos: -10 } },
        { tool: 'recordatorios_alarmas', args: { accion: 'crear', minutos: Infinity } },
        { tool: 'recordatorios_alarmas', args: { accion: 'cancelar', id: 'xyz' } },
        { tool: 'tareas_escolares', args: { accion: 'crear', materia: null, titulo: null } },
        { tool: 'tareas_escolares', args: { accion: 'cancelar', id: 'xyz' } },
        { tool: 'google_drive', args: { accion: 'buscar', query: null } },
        { tool: 'descargar_multimedia', args: { query_o_url: null } },
        { tool: 'descargar_multimedia', args: { query_o_url: '', formato: null, calidad: null } },
        { tool: 'sintetizar_voz', args: { texto: null } },
        { tool: 'sintetizar_voz', args: { texto: '', voz: null } },
        { tool: 'juegos_y_economia', args: { juego: 'ruleta', apuesta: null } },
        { tool: 'juegos_y_economia', args: { juego: 'ruleta', apuesta: NaN } },
        { tool: 'juegos_y_economia', args: { juego: 'darxp', cantidad: null } },
        { tool: 'juegos_y_economia', args: { juego: 'darxp', cantidad: 'abc' } },
        { tool: 'juegos_y_economia', args: { juego: 'invalido' } },
        { tool: 'afinidad_y_lore', args: { accion: 'invalida' } },
        { tool: 'control_tv', args: { canal: null } },
        { tool: 'enviar_mensaje_contacto', args: { contacto: null, mensaje: null } }
    ];

    for (const tc of testCases) {
        let res;
        try {
            res = await executeTool(tc.tool, tc.args, { from: '123@s.whatsapp.net', isAdmin: true });
        } catch (err) {
            assert.fail(`executeTool("${tc.tool}") threw uncaught on args ${JSON.stringify(tc.args)}: ${err.message}`);
        }
        assert.ok(typeof res === 'object' && res !== null);
        assert.ok(typeof res.success === 'boolean');
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 3: Command Handlers Robustness (32 Command Files)
// ═══════════════════════════════════════════════════════════════════════════════

test('Stress: All exported command handlers tolerate null/undefined/malformed arguments without uncaught exceptions', async () => {
    const commandHandlers = [
        { name: 'afinidad', fn: require('../src/commands/afinidad').handleAfinidad },
        { name: 'ayuda', fn: require('../src/commands/ayuda').handleAyuda },
        { name: 'blackjack', fn: require('../src/commands/blackjack').handleBlackjack },
        { name: 'buscar', fn: require('../src/commands/buscar').handleBuscar },
        { name: 'cambiarTV:cambiarTele', fn: require('../src/commands/cambiarTV').cambiarTele },
        { name: 'cambiarTV:handleCambiarTV', fn: require('../src/commands/cambiarTV').handleCambiarTV },
        { name: 'convertir', fn: require('../src/commands/convertir').handleConvertir },
        { name: 'daily', fn: require('../src/commands/daily').handleDaily },
        { name: 'descargar', fn: require('../src/commands/descargar').handleDescargar },
        { name: 'difusion', fn: require('../src/commands/difusion').handleDifusion },
        { name: 'documentos:handleDoc', fn: require('../src/commands/documentos').handleDoc },
        { name: 'documentos:handleComprimir', fn: require('../src/commands/documentos').handleComprimir },
        { name: 'documentos:handlePdf2Img', fn: require('../src/commands/documentos').handlePdf2Img },
        { name: 'documentos:handleUnirPdf', fn: require('../src/commands/documentos').handleUnirPdf },
        { name: 'documentos:handleRecortarPdf', fn: require('../src/commands/documentos').handleRecortarPdf },
        { name: 'doxeo', fn: require('../src/commands/doxeo').handleDoxeo },
        { name: 'drive', fn: require('../src/commands/drive').handleDrive },
        { name: 'efectos', fn: require('../src/commands/efectos').handleEfecto },
        { name: 'encuesta', fn: require('../src/commands/encuesta').handleEncuesta },
        { name: 'info', fn: require('../src/commands/info').handleInfo },
        { name: 'lore', fn: require('../src/commands/lore').handleLore },
        { name: 'maicra', fn: require('../src/commands/maicra').handleMaicra },
        { name: 'mensaje', fn: require('../src/commands/mensaje').handleMensaje },
        { name: 'moderacion', fn: require('../src/commands/moderacion').handleModeracion },
        { name: 'niveles:rank', fn: require('../src/commands/niveles').handleRank },
        { name: 'niveles:top', fn: require('../src/commands/niveles').handleTop },
        { name: 'niveles:darxp', fn: require('../src/commands/niveles').handleDarXp },
        { name: 'niveles:niveles', fn: require('../src/commands/niveles').handleNiveles },
        { name: 'notas', fn: require('../src/commands/notas').handleNotas },
        { name: 'nuclear', fn: require('../src/commands/nuclear').handleNuclear },
        { name: 'ocr', fn: require('../src/commands/ocr').handleLeer },
        { name: 'qr', fn: require('../src/commands/qr').handleQr },
        { name: 'recordatorios', fn: require('../src/commands/recordatorios').handleRecordar },
        { name: 'ruleta', fn: require('../src/commands/ruleta').handleRuleta },
        { name: 'sistema', fn: require('../src/commands/sistema').handleApagar },
        { name: 'sticker', fn: require('../src/commands/sticker').handleSticker },
        { name: 'tareas', fn: require('../src/commands/tareas').handleTareas },
        { name: 'terminal', fn: require('../src/commands/terminal').handleTerminal },
        { name: 'transcribir', fn: require('../src/commands/transcribir').handleTranscribir },
        { name: 'voz', fn: require('../src/commands/voz').handleVoz }
    ];

    const malformedInputs = [
        { label: 'null arguments', args: [null, null, null] },
        { label: 'undefined arguments', args: [undefined, undefined, undefined] },
        { label: 'empty object parsed with from', args: [{}, '123@s.whatsapp.net', {}] },
        { label: 'null properties in parsed', args: [{ args: null, flags: null, command: null }, '123@s.whatsapp.net', {}] },
        { label: 'array parsed', args: [[1, 2, 3], '123@s.whatsapp.net', {}] },
        { label: 'symbols and bigints in args/flags', args: [{ args: [Symbol('s'), 100n], flags: { [Symbol('f')]: 10n } }, '123@s.whatsapp.net', {}] },
        { label: 'huge string', args: [{ args: ['x'.repeat(50000)], flags: {} }, '123@s.whatsapp.net', {}] }
    ];

    const failures = [];

    for (const ch of commandHandlers) {
        for (const input of malformedInputs) {
            try {
                await ch.fn(...input.args);
            } catch (err) {
                // Progress.fail intentionally rejects with a user-facing error.
                // Technical failures must retain their failing assertion.
                const isBusinessRejection = err instanceof Error && err.name === 'Error' &&
                    Object.hasOwn(err, 'userMessage') && typeof err.userMessage === 'string' &&
                    err.userMessage.trim().length > 0 && err.userMessage === err.message;
                if (isBusinessRejection) continue;
                failures.push({
                    command: ch.name,
                    testCase: input.label,
                    error: `${err.name}: ${err.message}`
                });
            }
        }
    }

    if (failures.length > 0) {
        const errorSummary = failures.map(f => `  - ${f.command} (${f.testCase}): ${f.error}`).join('\n');
        assert.fail(`Found ${failures.length} uncaught exceptions in command handlers:\n${errorSummary}`);
    }
});

// ═══════════════════════════════════════════════════════════════════════════════
// SUITE 4: commandRegistry.js Dispatcher Robustness
// ═══════════════════════════════════════════════════════════════════════════════

test('Stress: commandRegistry getCommandHandler handles null/empty parsed without crashing', async () => {
    const registeredCommands = getRegisteredCommands();
    const failures = [];

    const testPayloads = [
        { label: 'null parsed', params: { parsed: null, from: '123@s.whatsapp.net', messageData: {} } },
        { label: 'empty parsed', params: { parsed: {}, from: '123@s.whatsapp.net', messageData: {} } },
        { label: 'null fields', params: { parsed: { args: null, flags: null }, from: '123@s.whatsapp.net', messageData: {} } },
        { label: 'null from', params: { parsed: { args: [], flags: {} }, from: null, messageData: null } }
    ];

    for (const cmdName of registeredCommands) {
        for (const tp of testPayloads) {
            try {
                const handlerObj = await getCommandHandler(cmdName, tp.params);
                if (handlerObj && typeof handlerObj.handler === 'function') {
                    // Also attempt to execute the returned handler
                    await handlerObj.handler();
                }
            } catch (err) {
                const isBusinessRejection = err instanceof Error && err.name === 'Error' &&
                    Object.hasOwn(err, 'userMessage') && typeof err.userMessage === 'string' &&
                    err.userMessage.trim().length > 0 && err.userMessage === err.message;
                if (isBusinessRejection) continue;
                failures.push({
                    command: cmdName,
                    payload: tp.label,
                    error: `${err.name}: ${err.message}`
                });
            }
        }
    }

    if (failures.length > 0) {
        const errorSummary = failures.map(f => `  - ${f.command} (${f.payload}): ${f.error}`).join('\n');
        assert.fail(`Found ${failures.length} uncaught exceptions in commandRegistry.getCommandHandler:\n${errorSummary}`);
    }
});

test('Stress: shutdown rejects malformed destination before scheduling or invoking shell',async()=>{
    const fs=require('node:fs');const vm=require('node:vm');
    const module={exports:{}};let sends=0;let timers=0;let shellCalls=0;
    const dependencies={
        child_process:{execSync(){shellCalls++;}},
        '../services/evolution':{sendText:async()=>{sends++;}},
        '../services/logger':{warn(){},error(){}}
    };
    vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/commands/sistema.js'),'utf8'),{
        module,exports:module.exports,
        require(name){assert.ok(Object.hasOwn(dependencies,name),'Unexpected shutdown dependency');return dependencies[name];},
        setTimeout(){timers++;}
    });
    for(const from of [null,undefined,{},[],Symbol('invalid'),1n,'','   '])await module.exports.handleApagar(from);
    assert.equal(sends,0);assert.equal(timers,0);assert.equal(shellCalls,0);
});
