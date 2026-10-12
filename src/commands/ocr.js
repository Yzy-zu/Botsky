'use strict';

const { cleanup } = require('../utils/cleanup');

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { sendText, downloadMedia } = require('../services/evolution');
const logger = require('../services/logger');

const execAsync = promisify(exec);
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';



async function handleLeer(parsed, from, messageData) {
    if (!messageData?.messageType?.includes('image') && !messageData?.messageType?.includes('document')) {
        return sendText(from, 'Responde a la imagen con `leer` y saco el texto.');
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    let outputPath = null;

    try {
        const { buffer, extension } = await downloadMedia(messageData);

        inputPath = path.join(TMP_DIR, `${sessionId}-input.${extension}`);
        fs.writeFileSync(inputPath, buffer);

        const outputBase = path.join(TMP_DIR, `${sessionId}-out`);
        const cmd = `tesseract "${inputPath}" "${outputBase}" -l spa+eng`;

        logger.cmd(cmd);
        await execAsync(cmd, { timeout: 60_000 });

        outputPath = `${outputBase}.txt`;

        if (!fs.existsSync(outputPath)) {
            throw new Error('Tesseract no genero el archivo de salida');
        }

        const textResult = fs.readFileSync(outputPath, 'utf8').trim();

        if (!textResult) {
            await sendText(from, 'No alcancé a leer texto. Prueba con una foto más nítida, de frente y con buena luz.');
        } else {
            await sendText(from, `Esto alcancé a leer:\n\n${textResult}`);
        }

    } catch (err) {
        logger.error('leer:', err.message);
        let msg = 'No pude leer esa imagen. Intenta de nuevo con una foto más nítida.';
        if (err.message.includes('tesseract: command not found')) {
            msg = 'La lectura de imágenes no está disponible por ahora. Avísale al administrador.';
        }
        await sendText(from, msg);
    } finally {
        cleanup(inputPath, outputPath);
    }
}

module.exports = { handleLeer };
