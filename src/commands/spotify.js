'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { sendMedia } = require('../services/evolution');
const { extractUrl } = require('../core/parser');
const logger = require('../services/logger');
const { Progress, spawnWithProgress } = require('../services/progress');

const execFileAsync = promisify(execFile);
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';

function cleanup(...dirs) {
    for (const dir of dirs) {
        try {
            if (fs.existsSync(dir)) {
                // Borrar contenido del directorio y el directorio en si
                fs.rmSync(dir, { recursive: true, force: true });
            }
        } catch (err) {
            logger.error(`Error limpiando ${dir}:`, err.message);
        }
    }
}

async function handleSpotify({ args, flags = {} }, from) {
    const url = extractUrl(args);
    const p = new Progress(from);

    if (!url || !url.includes('spotify.com')) {
        return p.fail('falta el enlace de spotify · usa `/@spotify [url]`');
    }

    // Detectar formato
    let format = 'mp3';
    if (args.includes('-flac') || flags.flac) format = 'flac';
    else if (args.includes('-m4a') || flags.m4a) format = 'm4a';

    // Detectar modo de envío (documento original o nota de voz/audio normal)
    let asDocument = true; // Por defecto es documento (-c)
    if (args.includes('-w') || flags.w) asDocument = false;
    if (args.includes('-c') || flags.c) asDocument = true;

    await p.start('buscando', `${format} · ${asDocument ? 'documento' : 'audio'}`);

    const sessionId = `spotify-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const outputDir = path.join(TMP_DIR, sessionId);
    fs.mkdirSync(outputDir, { recursive: true });

    try {
        const outputTemplate = path.join(outputDir, '{title} - {artists}.{ext}');

        const spotdlArgs = [
            'download',
            url,
            '--output', outputTemplate,
            '--format', format,
            '--threads', '4',
            '--audio', 'piped', 'youtube' // Fallback para evitar bloqueos de IP en youtube-music
        ];

        if (process.env.SPOTIFY_CLIENT_ID && process.env.SPOTIFY_CLIENT_SECRET) {
            spotdlArgs.push('--client-id', process.env.SPOTIFY_CLIENT_ID);
            spotdlArgs.push('--client-secret', process.env.SPOTIFY_CLIENT_SECRET.trim());
        }

        logger.cmd(`spotdl ${spotdlArgs.join(' ')}`);

        await p.phase('descargando');

        await execFileAsync('spotdl', spotdlArgs, {
            timeout: 3 * 60 * 1000, // 3 minutos maximo para evitar bloqueos por Rate Limit
            maxBuffer: 50 * 1024 * 1024
        });

        const files = fs.readdirSync(outputDir).filter(f => f.match(/\.(mp3|flac|m4a|ogg|wav)$/i) && fs.statSync(path.join(outputDir, f)).isFile());

        if (files.length === 0) {
            throw new Error('spotdl no pudo generar ningun archivo (pistas no encontradas o error)');
        }

        if (files.length === 1) {
            await p.phase('enviando', files[0].slice(0, 40));
            await sendMedia(from, path.join(outputDir, files[0]), '', asDocument);
        } else {
            await p.phase('comprimiendo', `${files.length} canciones → zip`);

            const zipFileName = 'playlist.zip';
            const zipPath = path.join(outputDir, zipFileName);
            await execFileAsync('zip', ['-j', zipFileName, ...files], { cwd: outputDir });

            await p.phase('enviando', `${files.length} canciones`);
            await sendMedia(from, zipPath, '> playlist en zip', true);
        }

        await p.done(`${files.length} ${files.length === 1 ? 'canción' : 'canciones'}`);

    } catch (err) {
        logger.error('spotify:', err.message);

        let msg = err.message;
        if (err.message.includes('No matches found')) {
            msg = 'no se encontró equivalencia para esa canción';
        } else if (err.message.includes('ENOENT') && err.message.includes('spotdl')) {
            msg = 'spotdl no está instalado';
        } else if (err.message.includes('ENOENT') && err.message.includes('zip')) {
            msg = 'zip no está instalado. no se pudo comprimir la playlist';
        }

        await p.fail(msg);
    } finally {
        cleanup(outputDir);
    }
}

module.exports = { handleSpotify };
