'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const util = require('node:util');
const assert = require('node:assert/strict');
function createMinecraftOffline() {
    const calls = [];
    function execFile() { throw new Error('Use async SSH fixture'); }
    execFile[util.promisify.custom] = async (binary, args) => {
        assert.equal(binary, 'ssh');
        assert.equal(args[1], 'BatchMode=yes');
        assert.equal(args[4], 'fixture-ssh.invalid');
        const command = args[5];
        const encoded = command.match(/Buffer\.from\("([A-Za-z0-9+/=]+)","base64"\)/);
        const script = encoded ? Buffer.from(encoded[1], 'base64').toString() : command;
        calls.push(script);
        let data;
        if (script.includes('mod_inexistente_xyz_123')) data = { success: false, message: 'No se encontró el mod solicitado en el catálogo fixture.' };
        else if (script.includes('statusInspect, props, stats, disk')) data = {
            statusInspect: 'running|2026-01-01T00:00:00Z|healthy',
            props: { activeWorld: 'Supervivencia', maxPlayers: '10', gamemode: 'survival', difficulty: 'normal' },
            stats: '2.5%|1.45GiB / 8GiB|100kB / 50kB', disk: '122GB disponibles' };
        else if (script.includes('bpManifests,')) data = { activeWorld: 'Supervivencia',
            activeBP: [{ pack_id: 'fixture-pack', version: [1, 0, 0] }], activeRP: [],
            bpManifests: { 'fixture-pack': { name: 'Fixture Addon', folder: 'fixture', description: 'Synthetic', version: '1.0.0' } },
            rpManifests: {}, globalMods: [{ fileName: 'Fixture.mcaddon', sizeMb: 1 }] };
        else if (script.includes('activeWorld, worlds')) data = { activeWorld: 'Supervivencia', worlds: [{ name: 'Supervivencia', isActive: true }] };
        else if (script.includes('list') && script.includes('docker')) return { stdout: 'There are 2/10 players online: FixtureOne, FixtureTwo', stderr: '' };
        else throw new Error('Unrecognized SSH fixture operation');
        return { stdout: JSON.stringify(data), stderr: '' };
    };
    const module = { exports: {} };
    const deps = { child_process: { execFile }, util, path, './logger': { info() {}, warn() {}, error() {} } };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../../src/services/minecraftRemote.js'), 'utf8'), {
        module, exports: module.exports, Buffer, Date, Map, Set,
        process: { env: { MINECRAFT_SSH_HOST: 'fixture-ssh.invalid', MINECRAFT_CONTAINER: 'fixture-bedrock', MINECRAFT_BASE_PATH: '/fixture/minecraft' } },
        require(id) { assert.ok(id in deps, `Missing Minecraft fixture dependency ${id}`); return deps[id]; }
    }, { filename: 'minecraftRemote-offline.js' });
    return { remote: module.exports, calls };
}
module.exports = { createMinecraftOffline };
