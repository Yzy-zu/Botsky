'use strict';

require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const { dispatch } = require('../core/dispatcher');
const history = require('../services/history');
const logger = require('../services/logger');
const { startCleanupCron } = require('../services/cleanup');
const db = require('../services/db');
const { handleDrive } = require('../commands/drive');
const {
    normalizeIncomingMessage,
    getCachedMediaById,
    extractText
} = require('./message_normalizer');

// Iniciar cronjob de mantenimiento
startCleanupCron();

// ─── Monitor de RAM preventivo (Bug #25) ──────────────────────────────────────
// PM2 reinicia a 1GB sin aviso. Este monitor loggea advertencias antes de llegar al límite.
const RAM_WARN_MB  = parseInt(process.env.RAM_WARN_MB  ?? '700', 10); // ~70% de 1GB
const RAM_CRIT_MB  = parseInt(process.env.RAM_CRIT_MB  ?? '900', 10); // ~90% de 1GB
let _ramWarnFired  = false;
let _ramCritFired  = false;

setInterval(() => {
    const heapMB = process.memoryUsage().rss / (1024 * 1024);
    if (heapMB >= RAM_CRIT_MB && !_ramCritFired) {
        _ramCritFired = true;
        logger.error(`[RAM] ⛔ CRÍTICO: ${heapMB.toFixed(0)}MB — PM2 reiniciará el bot pronto`);
    } else if (heapMB >= RAM_WARN_MB && !_ramWarnFired) {
        _ramWarnFired = true;
        logger.warn(`[RAM] ⚠️  ADVERTENCIA: ${heapMB.toFixed(0)}MB — acercándose al límite de PM2`);
        if (typeof global.gc === 'function') {
            logger.info('[RAM] 🧹 Forzando Garbage Collection preventiva...');
            try { global.gc(); } catch (_) {}
        }
    } else if (heapMB < RAM_WARN_MB) {
        // Resetear flags si la memoria bajó (por GC o cleanup)
        _ramWarnFired = false;
        _ramCritFired = false;
    }
}, 60000).unref();

const app = express();
const PORT = parseInt(process.env.WEBHOOK_PORT ?? '3000', 10);
const HOST = process.env.WEBHOOK_HOST ?? '172.17.0.1';

// Asegurar directorio temporal
fs.mkdirSync(process.env.TMP_DIR ?? '/tmp/whatsapp-bot', { recursive: true });

// ─── Middlewares ──────────────────────────────────────────────────────────────
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ─── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
});

// ─── Webhook principal ────────────────────────────────────────────────────────
app.post('/webhook', async (req, res) => {
    // Responder rápido a Evolution API para evitar retries
    res.sendStatus(200);

    try {
        const body = req.body;
        if (body.event !== 'messages.upsert') return;

        const data = body.data;
        if (!data) return;

        const from = data.key?.remoteJid;
        if (!from) return;

        // Registrar respuestas del bot en el historial
        if (data.key?.fromMe) {
            const text = extractText(data.message).trim();
            if (text) {
                history.addMessage(from, 'assistant', text, 'Botsky');
            }
            return;
        }

        // Normalizar y enriquecer el mensaje recibido
        const norm = normalizeIncomingMessage(data);
        if (!norm) return;

        // Subida a Google Drive mediante reacción 👍
        if (norm.isReaction) {
            if (norm.reactionText === '👍' && norm.targetMsgId) {
                const cachedMedia = getCachedMediaById(norm.targetMsgId);
                if (cachedMedia) {
                    handleDrive(cachedMedia.data, from, norm.targetMsgId).catch(err => {
                        logger.error('[Drive] Error al subir por reacción:', err.message);
                    });
                }
            }
            return;
        }

        // Sistema de Experiencia (solo en grupos y mensajes normales)
        if (norm.isGroup && !norm.hasPrefix && norm.actualMessageType !== 'unknown') {
            db.addXp(norm.participant).catch(err => {
                logger.error(`[XP] Error sumando XP a ${norm.participant}:`, err.message);
            });
        }

        // Si no califica como comando (ej: plática informal en grupo)
        if (!norm.shouldDispatch) {
            if (norm.isGroup && norm.text) {
                history.addMessage(from, 'user', norm.text, norm.pushName);
            }
            return;
        }

        logger.info(`[${norm.pushName} | ${from}] ${norm.actualMessageType}: "${norm.text.slice(0, 80)}"`);

        // Despachar el comando normalizado
        await dispatch({
            from,
            text: norm.text,
            messageType: norm.actualMessageType,
            messageData: norm.actualMessageData,
            isPollCommand: norm.isPollCommand
        });

    } catch (err) {
        logger.error('Webhook error:', err.message, err.stack?.split('\n')[1]);
    }
});

// ─── Ruta de estado de la cola ────────────────────────────────────────────────
app.get('/status', (req, res) => {
    const queue = require('../core/queue');
    res.json({
        status: 'running',
        queue: queue.stats,
        time: new Date().toISOString(),
        uptime: process.uptime(),
        memory: process.memoryUsage(),
    });
});

// ─── Iniciar servidor ─────────────────────────────────────────────────────────
async function startServer() {
    app.listen(PORT, HOST, () => {
        logger.success(`Bot iniciado en http://${HOST}:${PORT}`);
        logger.info(`Webhook:  POST http://${HOST}:${PORT}/webhook`);
        logger.info(`Status:   GET  http://${HOST}:${PORT}/status`);
        logger.info(`Instancia Evolution API: ${process.env.EVOLUTION_INSTANCE}`);
        logger.info('Modo:     Comandos directos (/@) autónomos con Dispatcher + NLP (sin Ollama)');

        const allowed = process.env.ALLOWED_NUMBERS_NORMAL;
        if (allowed) {
            logger.info(`Números autorizados: ${allowed}`);
        } else {
            logger.warn('⚠️  Sin ALLOWED_NUMBERS definidos — cualquier número puede usar el bot.');
        }
    });
}

startServer().catch(err => {
    logger.error('Fallo crítico al iniciar el bot:', err);
    process.exit(1);
});

// ─── Manejo de errores no capturados ─────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
    logger.error('UnhandledRejection:', reason?.message ?? reason);
});
process.on('uncaughtException', (err) => {
    logger.error('UncaughtException:', err.message);
});
