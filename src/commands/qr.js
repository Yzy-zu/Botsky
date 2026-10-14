'use strict';

const { cleanup } = require('../utils/cleanup');

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { sendText, sendMedia, downloadMedia } = require('../services/evolution');
const logger = require('../services/logger');

const execFileAsync = promisify(execFile);
const TMP_DIR = process.env.TMP_DIR ?? '/tmp/whatsapp-bot';



async function handleQr(parsed, from, messageData) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    messageData = messageData && typeof messageData === 'object' && !Array.isArray(messageData) ? messageData : {};
    const textToEncode = parsed.args.join(' ');
    const isImage = messageData?.messageType?.toLowerCase().includes('image');

    if (!textToEncode && !isImage) {
        return sendText(from, '¿Lo creamos o lo leemos?\nCrear: `qr [texto o enlace]`.\nLeer: responde a la imagen con `qr`.');
    }

    if (!fs.existsSync(TMP_DIR)) {
        fs.mkdirSync(TMP_DIR, { recursive: true });
    }

    const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    let inputPath = null;
    let outputPath = null;

    try {
        if (isImage) {
            const { buffer, extension } = await downloadMedia(messageData);
            inputPath = path.join(TMP_DIR, `${sessionId}-input.${extension}`);
            fs.writeFileSync(inputPath, buffer);

            logger.cmd(`zbarimg --quiet --raw "${inputPath}"`);

            try {
                const { stdout } = await execFileAsync('zbarimg', ['--quiet', '--raw', inputPath], { timeout: 30_000 });
                const result = stdout.trim();
                if (result) {
                    await sendText(from, `El QR dice:\n\`\`\`\n${result}\n\`\`\``);
                } else {
                    await sendText(from, 'No encontré un QR en esa imagen. Prueba con una foto de frente y sin recortar el código.');
                }
            } catch (err) {
                await sendText(from, 'No pude leer el QR. Prueba con una foto más nítida y con el código completo.');
            }

        } else {
            outputPath = path.join(TMP_DIR, `${sessionId}-qr.png`);

            logger.cmd(`qrencode -s 10 -m 2 -o "${outputPath}" <payload>`);
            await execFileAsync('qrencode', ['-s', '10', '-m', '2', '-o', outputPath, '--', textToEncode], { timeout: 30_000 });

            if (!fs.existsSync(outputPath)) {
                throw new Error('no se pudo generar el qr');
            }

            await sendMedia(from, outputPath, 'Listo, aquí está tu QR.');
        }

    } catch (err) {
        logger.error('qr:', err.message);
        let msg = 'No pude generar el QR. Prueba con un texto más corto o un enlace.';
        if (err.message.includes('command not found')) {
            msg = 'Los códigos QR no están disponibles por ahora. Avísale al administrador.';
        }
        await sendText(from, msg);
    } finally {
        cleanup(inputPath, outputPath);
    }
}

module.exports = { handleQr };
