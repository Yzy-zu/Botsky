'use strict';

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execute = promisify(execFile);
const PROVIDER = 'youtube';
const MAX_OUTPUT_BYTES = 1024 * 1024;

function formatDuration(seconds) {
    if (!Number.isFinite(seconds) || seconds <= 0) return null;
    const total = Math.floor(seconds);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor(total / 60) % 60;
    const tail = String(total % 60).padStart(2, '0');
    return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${tail}` : `${minutes}:${tail}`;
}

function processFailureCode(error) {
    if (error?.code === 'ENOENT') return 'dependency_missing';
    if (error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'output_too_large';
    if (error?.killed || error?.code === 'ETIMEDOUT') return 'timeout';
    return 'process_failed';
}

/**
 * Metadata-only YouTube search. No shell, downloads, environment loading or
 * transports. The injected runner has the execFile promise interface.
 *
 * Result: { status: success|empty|unavailable|invalid, provider, items,
 * diagnostic: { code, elapsed_ms, received, accepted, rejected, exit_code } }.
 * Diagnostics deliberately exclude queries, URLs and provider error bodies.
 */
function createMediaSearch({ run = execute, now = Date.now } = {}) {
    return async function searchMedia(query, { limit = 8 } = {}) {
        const started = now();
        const counts = { received: 0, accepted: 0, rejected: 0 };
        const result = (status, code, items = [], exitCode = null) => ({
            status,
            provider: PROVIDER,
            items,
            diagnostic: {
                code,
                elapsed_ms: Math.max(0, now() - started),
                ...counts,
                exit_code: Number.isInteger(exitCode) ? exitCode : null
            }
        });
        if (typeof query !== 'string' || !query.trim() || query.length > 1000 ||
            !Number.isInteger(limit) || limit < 1 || limit > 20) {
            return result('invalid', 'invalid_request');
        }

        let stdout;
        try {
            ({ stdout } = await run('yt-dlp', [
                '--flat-playlist', '--skip-download', '--dump-json', '--no-warnings',
                '--', `ytsearch${limit + 5}:${query.trim()}`
            ], { timeout: 15000, killSignal: 'SIGKILL', maxBuffer: MAX_OUTPUT_BYTES, encoding: 'utf8' }));
        } catch (error) {
            return result('unavailable', processFailureCode(error), [], error?.code);
        }
        if (typeof stdout !== 'string') return result('unavailable', 'invalid_output');
        if (Buffer.byteLength(stdout, 'utf8') > MAX_OUTPUT_BYTES) return result('unavailable', 'output_too_large');

        const lines = stdout.split('\n').filter(line => line.trim());
        counts.received = lines.length;
        if (!lines.length) return result('empty', 'no_results');
        const items = [];
        const seen = new Set();
        let liveCount = 0;
        for (const line of lines) {
            let entry;
            try { entry = JSON.parse(line); }
            catch { return result('unavailable', 'invalid_output'); }
            if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
                typeof entry.id !== 'string' || !/^[A-Za-z0-9_-]{11}$/.test(entry.id)) {
                counts.rejected++;
                continue;
            }
            // Live status is metadata, never inferred from words in the title.
            if (entry.is_live === true || entry.live_status === 'is_live' || entry.live_status === 'is_upcoming') {
                liveCount++;
                counts.rejected++;
                continue;
            }
            if (seen.has(entry.id)) { counts.rejected++; continue; }
            seen.add(entry.id);
            const seconds = typeof entry.duration === 'number' && Number.isFinite(entry.duration) && entry.duration > 0
                ? entry.duration : null;
            items.push({
                title: typeof entry.title === 'string' && entry.title.trim() ? entry.title.trim() : 'Video de YouTube',
                url: `https://www.youtube.com/watch?v=${entry.id}`,
                thumbnailUrl: `https://i.ytimg.com/vi/${entry.id}/mqdefault.jpg`,
                duration: formatDuration(seconds),
                secs: seconds
            });
            counts.accepted++;
        }
        if (items.length) return result('success', 'results', items.slice(0, limit));
        if (liveCount === lines.length) return result('empty', 'live_only');
        return result('unavailable', 'invalid_results');
    };
}

module.exports = { createMediaSearch, searchMedia: createMediaSearch() };
