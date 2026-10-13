'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
if(!process.env.DATA_DIR?.startsWith('/tmp/botsky-data'))throw Error('Run integration tests with isolated Docker verifier');
// These canonical command tests must never infer through a live provider.
const axios=require('axios');const originalPost=axios.post;
axios.post=async()=>{throw Error('Unexpected unification HTTP/provider call');};
test.after(()=>{axios.post=originalPost;});

const evolution = require('../src/services/evolution');
const db = require('../src/services/db');
const { handleTareas } = require('../src/commands/tareas');
const { handleMaicra } = require('../src/commands/maicra');
const { handleDrive } = require('../src/commands/drive');
const { handleBuscar } = require('../src/commands/buscar');
const { handleDescargar } = require('../src/commands/descargar');
const { handleVoz } = require('../src/commands/voz');
const { handleTerminal } = require('../src/commands/terminal');
const { handleEncuesta, parseCreation } = require('../src/commands/encuesta');
const { handleNotas } = require('../src/commands/notas');
const { handleRecordar } = require('../src/commands/recordatorios');
const minecraftRemote = require('../src/services/minecraftRemote');
const driveService = require('../src/services/drive');

test('Unificación: applyAiArgsToParsed y handleTareas soporta JSON nativo y CLI legacy', async () => {
    const adminUser = '5214435810175@s.whatsapp.net';
    process.env.ALLOWED_NUMBERS_ADMIN = '5214435810175';
    process.env.ALLOWED_NUMBERS_TASKS = '5214435810175';

    const sent = [];
    const origSend = evolution.sendText;
    evolution.sendText = async (to, text) => {
        sent.push({ to, text });
        return { success: true };
    };

    try {
        // 1. Configurar grupo primero
        await handleTareas({
            aiArgs: { accion: 'grupo', grupo: '12345678@g.us' }
        }, adminUser, { key: { remoteJid: adminUser, participant: adminUser } });

        assert.ok(sent.some(s => s.text.includes('Grupo escolar configurado')));

        // 2. Crear tarea usando JSON nativo
        sent.length = 0;
        await handleTareas({
            aiArgs: {
                accion: 'crear',
                materia: 'Arquitectura Cloud',
                titulo: 'Proyecto Microservicios',
                fecha: new Date(Date.now()+7*86400000).toISOString(),
                detalles: 'Subir a GitHub'
            }
        }, adminUser, { key: { remoteJid: adminUser, participant: adminUser } });

        assert.ok(sent.some(s => s.text.includes('Arquitectura Cloud') && s.text.includes('Proyecto Microservicios')));
        const match = sent[0].text.match(/#(\d+)/);
        assert.ok(match, 'Debe devolver el ID de la tarea');
        const taskId = parseInt(match[1], 10);

        // 3. Listar tareas con JSON nativo
        sent.length = 0;
        await handleTareas({
            aiArgs: { accion: 'listar' }
        }, adminUser, { key: { remoteJid: adminUser, participant: adminUser } });

        assert.ok(sent.some(s => s.text.includes('Arquitectura Cloud')));

        // 4. Cancelar tarea con JSON nativo
        sent.length = 0;
        await handleTareas({
            aiArgs: { accion: 'cancelar', id: taskId }
        }, adminUser, { key: { remoteJid: adminUser, participant: adminUser } });

        assert.ok(sent.some(s => s.text.includes(`Tarea #${taskId} cancelada`)));

        // 5. Backwards compatibility: Crear tarea usando CLI positional
        sent.length = 0;
        await handleTareas({
            args: ['crear', 'Redes', 'Configurar Router', new Date(Date.now()+8*86400000).toISOString()]
        }, adminUser, { key: { remoteJid: adminUser, participant: adminUser } });

        assert.ok(sent.some(s => s.text.includes('Redes') && s.text.includes('Configurar Router')));
        const match2 = sent[0].text.match(/#(\d+)/);
        if (match2) {
            await db.cancelSchoolTask(parseInt(match2[1], 10));
        }
    } finally {
        evolution.sendText = origSend;
    }
});

test('Unificación: handleMaicra responde a JSON nativo y CLI legacy', async () => {
    const origStatus = minecraftRemote.getRemoteServerStatus;
    const origPlayers = minecraftRemote.getOnlinePlayers;
    const origSend = evolution.sendText;

    const sent = [];
    evolution.sendText = async (to, text) => {
        sent.push({ to, text });
        return { success: true };
    };

    minecraftRemote.getRemoteServerStatus = async () => ({
        activeWorld: 'Bedrock level',
        gamemode: 'survival',
        difficulty: 'hard',
        allowCheats: false,
        serverPort: 19132,
        onlineMode: true,
        cpu: '1.2%',
        mem: '320MB / 2048MB'
    });

    minecraftRemote.getOnlinePlayers = async () => ({
        online: true,
        count: 2,
        max: 10,
        players: ['Alex', 'Steve']
    });

    try {
        // Invocación nativa con aiArgs
        sent.length = 0;
        await handleMaicra({
            aiArgs: { subcomando: 'estado' }
        }, '5214435810175@s.whatsapp.net', {});

        assert.ok(sent.length > 0);
        assert.ok(sent[0].text.includes('Minecraft Bedrock'));

        // Invocación nativa jugadores con subcomando
        sent.length = 0;
        await handleMaicra({
            aiArgs: { accion: 'jugadores' }
        }, '5214435810175@s.whatsapp.net', {});

        assert.ok(sent.length > 0);
        assert.ok(sent[0].text.includes('Alex, Steve'));

        // Invocación CLI legacy
        sent.length = 0;
        await handleMaicra({
            args: ['jugadores']
        }, '5214435810175@s.whatsapp.net', {});

        assert.ok(sent.length > 0);
        assert.ok(sent[0].text.includes('Alex, Steve'));
    } finally {
        minecraftRemote.getRemoteServerStatus = origStatus;
        minecraftRemote.getOnlinePlayers = origPlayers;
        evolution.sendText = origSend;
    }
});

test('Unificación: handleDrive y handleBuscar responden a JSON nativo', async () => {
    const origQuota = driveService.getQuota;
    const origSearch = driveService.searchFiles;
    const origSend = evolution.sendText;

    const sent = [];
    evolution.sendText = async (to, text) => {
        sent.push({ to, text });
        return { success: true };
    };

    driveService.getQuota = async () => ({
        limit: (15 * (1024 ** 3)).toString(),
        usage: (5 * (1024 ** 3)).toString()
    });

    driveService.searchFiles = async (q) => [
        { id: 'file123', name: 'reporte_anual.pdf', mimeType: 'application/pdf' }
    ];

    try {
        // Drive espacio nativo
        sent.length = 0;
        await handleDrive({
            aiArgs: { accion: 'espacio' }
        }, '5214435810175@s.whatsapp.net', {});

        assert.ok(sent.some(s => s.text.includes('Google Drive') && s.text.includes('5.00 GB')));

        // Buscar nativo
        sent.length = 0;
        await handleBuscar({
            aiArgs: { query: 'reporte' }
        }, '5214435810175@s.whatsapp.net', {});

        assert.ok(sent.some(s => s.text.includes('reporte_anual.pdf')));
    } finally {
        driveService.getQuota = origQuota;
        driveService.searchFiles = origSearch;
        evolution.sendText = origSend;
    }
});

test('Unificación: parseCreation en encuesta soporta JSON nativo y CLI', () => {
    // Objeto nativo
    const resNative = parseCreation({
        aiArgs: {
            pregunta: '¿A qué hora jugamos?',
            opciones: ['8pm', '9pm', '10pm']
        }
    });
    assert.strictEqual(resNative.question, '¿A qué hora jugamos?');
    assert.deepStrictEqual(resNative.options, ['8pm', '9pm', '10pm']);

    // CLI con pipes
    const resCli = parseCreation({
        raw: 'encuesta crear ¿Cena hoy? | Tacos | Pizza | Hamburguesas'
    });
    assert.strictEqual(resCli.question, '¿Cena hoy?');
    assert.deepStrictEqual(resCli.options, ['Tacos', 'Pizza', 'Hamburguesas']);
});

test('Unificación: handleNotas y handleRecordar con JSON nativo', async () => {
    const chat = 'test_unif_chat@g.us';
    const user = '5214435810175@s.whatsapp.net';
    const sent = [];
    const origSend = evolution.sendText;
    evolution.sendText = async (to, text) => {
        sent.push({ to, text });
        return { success: true };
    };

    try {
        // Notas: guardar con JSON nativo
        sent.length = 0;
        await handleNotas({
            aiArgs: { accion: 'guardar', contenido: 'Llave de paso cerrada' }
        }, chat, { key: { remoteJid: chat, participant: user }, pushName: 'Tester' });

        assert.ok(sent.some(s => /guardé la nota/i.test(s.text)&&s.text.includes('Llave de paso cerrada')));
        const notes=await db.getNotes(chat);assert.ok(notes.some(n=>n.content==='Llave de paso cerrada'));

        // Recordatorios: crear con JSON nativo
        sent.length = 0;
        await handleRecordar({
            aiArgs: { accion: 'crear', mensaje: 'Hacer el commit de git', minutos: 15 }
        }, chat, { key: { remoteJid: chat, participant: user }, pushName: 'Tester' });

        assert.ok(sent.some(s => s.text.includes('Hacer el commit de git')));
    } finally {
        evolution.sendText = origSend;
        try {
            await new Promise((resolve) => {
                db.db.run(`DELETE FROM notes WHERE target_jid = ?`, [chat], () => {
                    db.db.run(`DELETE FROM reminders WHERE target_jid = ?`, [chat], () => resolve());
                });
            });
        } catch (_) {}
    }
});

test('Unificación: handleVoz y handleTerminal con JSON nativo', async () => {
    const adminUser = '5214435810175@s.whatsapp.net';
    process.env.ALLOWED_NUMBERS_ADMIN = '5214435810175';

    const tts = require('../src/services/tts');
    const agent = require('../src/services/agent');

    const origSend = evolution.sendText;
    const origSendVoice = evolution.sendVoiceNote;
    const origRecording=evolution.sendRecording;evolution.sendRecording=async()=>{};
    const origTTS = tts.generateVoiceNote;
    const origAgent = agent.runAgentWithTerminal;

    const sent = [];
    evolution.sendText = async (to, text) => {
        sent.push({ to, text });
        return { success: true };
    };

    let generatedVoice = null;
    tts.generateVoiceNote = async (text, options) => {
        generatedVoice = { text, options };
        return { filePath: '/tmp/fake.ogg', profile: { name: options.voz }, cleanup: () => {} };
    };
    evolution.sendVoiceNote = async (to, filePath) => {
        sent.push({ to, filePath });
        return { success: true };
    };

    let executedCommand = null;
    agent.runAgentWithTerminal = async (params) => {
        executedCommand = params.userMessage;
        return { text: 'Agente ejecutado con éxito' };
    };

    try {
        // Voz nativa
        await handleVoz({
            aiArgs: { texto_literal: 'Buenas tardes a todos', modo:'verbatim',destino_scope:'current_chat',voz: 'dross' }
        }, adminUser, {});

        assert.ok(generatedVoice);
        assert.strictEqual(generatedVoice.text, 'Buenas tardes a todos');
        assert.strictEqual(generatedVoice.options.voz, 'dross');

        // Terminal nativo
        sent.length = 0;
        await handleTerminal({
            aiArgs: { comando: 'df -h' }
        }, adminUser, { key: { remoteJid: adminUser, participant: adminUser } });

        assert.strictEqual(executedCommand, 'df -h');
        assert.ok(sent.some(s => s.text.includes('Agente ejecutado')));
    } finally {
        evolution.sendText = origSend;
        evolution.sendVoiceNote = origSendVoice;
        evolution.sendRecording=origRecording;
        tts.generateVoiceNote = origTTS;
        agent.runAgentWithTerminal = origAgent;
    }
});
