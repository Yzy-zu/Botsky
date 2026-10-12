'use strict';

const { cleanup } = require('../utils/cleanup');

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { sendText, sendVoiceNote, downloadMedia } = require('../services/evolution');
const logger = require('../services/logger');

const execAsync = promisify(exec);
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';



const EFECTOS = {
    ardilla: '-filter_complex "rubberband=pitch=1.5"',
    robot: '-filter_complex "afftfilt=real=\'hypot(re,im)*sin(0)\':imag=\'hypot(re,im)*cos(0)\':win_size=512:overlap=0.75"',
    lento: '-filter_complex "rubberband=tempo=0.5"',
    rapido: '-filter_complex "rubberband=tempo=2.0"',
    grave: '-filter_complex "rubberband=pitch=0.7"',
    eco: '-filter_complex "aecho=0.8:0.88:60:0.4"',
    reversa: '-af areverse',
};

async function handleEfecto(parsed, from, messageData) {
    const efecto = parsed.args[0]?.toLowerCase();

    if (!efecto || !EFECTOS[efecto]) {
        return sendText(from, `¿Qué efecto le ponemos? Usa efecto ardilla.\nTambién hay: \`${Object.keys(EFECTOS).join('\` \`')}\``);
    }

    if (!messageData?.messageType?.toLowerCase().includes('audio') && !messageData?.messageType?.toLowerCase().includes('video')) {
        return sendText(from, 'Responde a un audio o video con `efecto ardilla`, por ejemplo.');
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    let outputPath = null;

    try {
        const { buffer, extension } = await downloadMedia(messageData);
        inputPath = path.join(TMP_DIR, `${sessionId}-input.${extension}`);
        outputPath = path.join(TMP_DIR, `${sessionId}-output.ogg`);
        fs.writeFileSync(inputPath, buffer);

        // Obtener el filtro correspondiente al efecto seleccionado
        const filterStr = EFECTOS[efecto];

        // Convertir a ogg con codec libopus para enviarlo como audio de voz
        const cmd = `ffmpeg -y -i "${inputPath}" ${filterStr} -c:a libopus -b:a 74k -vn "${outputPath}"`;
        logger.cmd(cmd);
        await execAsync(cmd, { timeout: 60_000 });

        if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
            throw new Error('ffmpeg no pudo generar el audio.');
        }

        await sendVoiceNote(from, outputPath);
    } catch (err) {
        logger.error('efecto:', err.message);
        await sendText(from, 'No pude aplicar el efecto. Prueba de nuevo con otro audio.');
    } finally {
        cleanup(inputPath, outputPath);
    }
}

module.exports = { handleEfecto };
