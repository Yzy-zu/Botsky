'use strict';

const { execFile: execFileCallback } = require('child_process');
const { promisify } = require('util');
const fs = require('fs');
const execFile = promisify(execFileCallback);

function createAudioDuration({ execute = execFile, remove = file => fs.promises.rm(file, { force: true }) } = {}) {
    async function measureAudioDuration(filePath) {
        const { stdout } = await execute('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', filePath], { timeout: 15000, maxBuffer: 16384 });
        const duration = Number(String(stdout).trim());
        if (!Number.isFinite(duration) || duration <= 0) throw new Error('No pude medir la duración del audio.');
        return duration;
    }
    async function fitAudioDuration(result, target) {
        if (!Number.isFinite(target) || target <= 0) throw new Error('La duración solicitada no es válida.');
        const measured = await measureAudioDuration(result.filePath);
        const factor = measured / target;
        if (Math.abs(measured - target) <= 0.5 || factor < 0.85 || factor > 1.15) {
            return { ...result, durationSeconds: measured, timingAdjusted: false };
        }
        const output = result.filePath + '.timed.mp3';
        try {
            await execute('ffmpeg', ['-y', '-i', result.filePath, '-af', `atempo=${factor.toFixed(6)}`, '-c:a', 'libmp3lame', output], { timeout: 60000, maxBuffer: 65536 });
            const actual = await measureAudioDuration(output);
            return { ...result, filePath: output, durationSeconds: actual, timingAdjusted: true,
                cleanup: async () => { try { await remove(output); } finally { await result.cleanup?.(); } } };
        } catch (error) {
            await remove(output).catch(() => {});
            throw error;
        }
    }
    return { measureAudioDuration, fitAudioDuration };
}

module.exports = { createAudioDuration, ...createAudioDuration() };
