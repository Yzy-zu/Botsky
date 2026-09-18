'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { sendText, downloadMedia } = require('../services/evolution');
const logger = require('../services/logger');

const execAsync = promisify(exec);
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';

function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignorar */ }
    }
}

async function handleLeer(parsed, from, messageData) {
    if (!messageData?.messageType?.includes('image') && !messageData?.messageType?.includes('document')) {
        return sendText(from, '> adjunta una imagen\nusa `/@ leer`');
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
            await sendText(from, '> no se detecto texto en la imagen');
        } else {
            await sendText(from, `> texto extraido\n\n${textResult}`);
        }

    } catch (err) {
        logger.error('leer:', err.message);
        let msg = `> error \`${err.message}\``;
        if (err.message.includes('tesseract: command not found')) {
            msg = '> tesseract no esta instalado';
        }
        await sendText(from, msg);
    } finally {
        cleanup(inputPath, outputPath);
    }
}

module.exports = { handleLeer };
