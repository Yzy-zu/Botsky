'use strict';

const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const { promisify } = require('util');
const { sendText, sendMedia, downloadMedia } = require('../services/evolution');
const logger = require('../services/logger');

const execAsync = promisify(exec);
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';

function cleanup(...files) {
    for (const f of files) {
        try { if (f && fs.existsSync(f)) fs.unlinkSync(f); } catch { /* ignorar */ }
    }
}

async function handleQr(parsed, from, messageData) {
    const textToEncode = parsed.args.join(' ');
    const isImage = messageData?.messageType?.toLowerCase().includes('image');

    if (!textToEncode && !isImage) {
        return sendText(from, '> para crear: `/@ qr [texto]`\n> para leer: responde una imagen con `/@ qr`');
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    let outputPath = null;

    try {
        if (isImage) {
            const { buffer, extension } = await downloadMedia(messageData);
            inputPath = path.join(TMP_DIR, `${sessionId}-input.${extension}`);
            fs.writeFileSync(inputPath, buffer);

            const cmd = `zbarimg --quiet --raw "${inputPath}"`;
            logger.cmd(cmd);

            try {
                const { stdout } = await execAsync(cmd, { timeout: 30_000 });
                const result = stdout.trim();
                if (result) {
                    await sendText(from, `> contenido\n\`\`\`\n${result}\n\`\`\``);
                } else {
                    await sendText(from, '> no se detecto qr en la imagen');
                }
            } catch (err) {
                await sendText(from, '> no se detecto qr valido');
            }

        } else {
            outputPath = path.join(TMP_DIR, `${sessionId}-qr.png`);

            const safeText = textToEncode.replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
            const cmd = `qrencode -s 10 -m 2 -o "${outputPath}" "${safeText}"`;
            logger.cmd(cmd);
            await execAsync(cmd, { timeout: 30_000 });

            if (!fs.existsSync(outputPath)) {
                throw new Error('no se pudo generar el qr');
            }

            await sendMedia(from, outputPath, '> qr generado');
        }

    } catch (err) {
        logger.error('qr:', err.message);
        let msg = `> error \`${err.message}\``;
        if (err.message.includes('command not found')) {
            msg = '> qrencode o zbar-tools no estan instalados';
        }
        await sendText(from, msg);
    } finally {
        cleanup(inputPath, outputPath);
    }
}

module.exports = { handleQr };
