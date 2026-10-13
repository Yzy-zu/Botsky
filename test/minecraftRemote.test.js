'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const {
    getRemoteServerStatus,
    getOnlinePlayers,
    getActiveModsAndPacks,
    getWorldsList,
    deactivateWorldPack,
    activateWorldPack,
    formatModsSummary,
    formatStatusSummary,
    invalidateManifestCache
} = require('./helpers/minecraftOffline').createMinecraftOffline().remote;

// ─── Pruebas Unitarias de Formato y Lógica Pura ──────────────────────────────

test('MinecraftRemote 1: formatStatusSummary genera texto offline cuando no está online', () => {
    const statusData = {
        online: false,
        reachable: true,
        containerStatus: 'exited',
        activeWorld: 'Supervivencia'
    };
    const formatted = formatStatusSummary(statusData, null);
    assert.ok(formatted.includes('Apagado'));
    assert.ok(formatted.includes('Supervivencia'));
    assert.ok(formatted.includes('prende el server de maicra'));
});

test('MinecraftRemote 2: formatStatusSummary formatea métricas en vivo correctamente', () => {
    const statusData = {
        online: true,
        reachable: true,
        containerStatus: 'running',
        uptime: '2 días, 4 horas',
        activeWorld: 'Supervivencia',
        cpu: '2.5%',
        memory: '1.45GiB / 8GiB',
        network: '100kB / 50kB'
    };
    const playersData = {
        online: true,
        count: 2,
        max: 10,
        players: ['Petrov', 'ElChiqui']
    };

    const formatted = formatStatusSummary(statusData, playersData);
    assert.ok(formatted.includes('Minecraft Bedrock Online'));
    assert.ok(formatted.includes('Petrov, ElChiqui'));
    assert.ok(formatted.includes('(2/10)'));
    assert.ok(formatted.includes('2 días, 4 horas'));
    assert.ok(formatted.includes('*CPU:* `2.5%`'));
    assert.ok(formatted.includes('*RAM:* `1.45GiB / 8GiB`'));
});

test('MinecraftRemote 3: formatModsSummary maneja addons activos y catálogo global', () => {
    const modsData = {
        activeWorld: 'Supervivencia',
        totalActive: 2,
        behaviorPacks: [
            { name: 'Aplok Guns', version: '1.8.8', description: 'Armas de fuego' }
        ],
        resourcePacks: [
            { name: 'Actions And Stuff', version: '1.9', description: '' }
        ],
        globalMods: [
            { fileName: 'Peppa_Maldita.mcaddon', sizeMb: 0.8 }
        ]
    };

    const formatted = formatModsSummary(modsData);
    assert.ok(formatted.includes('Mundo activo:* `Supervivencia`'));
    assert.ok(formatted.includes('Total de Addons activos:* `2`'));
    assert.ok(formatted.includes('Aplok Guns'));
    assert.ok(formatted.includes('Actions And Stuff'));
    assert.ok(formatted.includes('Peppa_Maldita.mcaddon'));
});

test('MinecraftRemote 4: Invalidate manifest cache limpia caché en memoria', () => {
    assert.doesNotThrow(() => {
        invalidateManifestCache();
    });
});

// ─── Pruebas de Contrato offline con respuestas SSH de fixture ───────────────────

test('MinecraftRemote 5 [SSH fixture]: getRemoteServerStatus consulta contenedor en redspi', async () => {
    const status = await getRemoteServerStatus(true);
    assert.strictEqual(typeof status, 'object');
    assert.strictEqual(status.reachable, true);
    assert.strictEqual(status.online, true);
    assert.strictEqual(status.containerStatus, 'running');
    assert.ok(status.uptime.length > 0);
    assert.ok(status.activeWorld.length > 0);
    assert.ok(status.cpu.includes('%'));
    assert.ok(status.memory.includes('iB') || status.memory.includes('B'));
});

test('MinecraftRemote 6 [SSH fixture]: getOnlinePlayers obtiene jugadores y límite de slots', async () => {
    const players = await getOnlinePlayers();
    assert.strictEqual(typeof players, 'object');
    assert.strictEqual(players.online, true);
    assert.strictEqual(typeof players.count, 'number');
    assert.strictEqual(typeof players.max, 'number');
    assert.ok(players.max > 0);
    assert.ok(Array.isArray(players.players));
});

test('MinecraftRemote 7 [SSH fixture]: getActiveModsAndPacks extrae addons y global_mods', async () => {
    const mods = await getActiveModsAndPacks();
    assert.strictEqual(typeof mods, 'object');
    assert.strictEqual(typeof mods.activeWorld, 'string');
    assert.ok(mods.activeWorld.length > 0);
    assert.ok(Array.isArray(mods.behaviorPacks));
    assert.ok(Array.isArray(mods.resourcePacks));
    assert.ok(Array.isArray(mods.globalMods));
    assert.ok(mods.globalMods.length > 0, 'Debería detectar addons en global_mods');
});

test('MinecraftRemote 8 [SSH fixture]: getWorldsList lista los mundos creados en redspi', async () => {
    const data = await getWorldsList();
    assert.strictEqual(typeof data, 'object');
    assert.ok(Array.isArray(data.worlds));
    assert.ok(data.worlds.length >= 1);
    const active = data.worlds.find(w => w.isActive);
    assert.ok(active, 'Debería haber un mundo activo');
});

test('MinecraftRemote 9 [SSH fixture]: deactivateWorldPack maneja mod no existente con mensaje claro', async () => {
    const res = await deactivateWorldPack('mod_inexistente_xyz_123', false);
    assert.strictEqual(typeof res, 'object');
    assert.strictEqual(res.success, false);
    assert.ok(res.message.includes('No se encontró'));
});

test('MinecraftRemote 10 [SSH fixture]: activateWorldPack maneja mod no existente con mensaje claro', async () => {
    const res = await activateWorldPack('mod_inexistente_xyz_123', false);
    assert.strictEqual(typeof res, 'object');
    assert.strictEqual(res.success, false);
    assert.ok(res.message.includes('No se encontró'));
});
