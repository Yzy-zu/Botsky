'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../src/services/db');
const {
    parseDueDate,
    parseClock,
    localParts,
    extractSchoolTaskDetails,
    handleDirectTaskMessage,
    publishDailySchoolDigest,
    publishDueSchoolTasks
} = require('../src/services/school');
const {
    calculateNextClassDueDate,
    normalizeSubject,
    UTM_SCHEDULE_TI7B
} = require('../src/services/school_schedule_data');
const { parseScheduleLine } = require('../src/commands/tareas');

test('School: parsea horas y fechas escolares en español', () => {
    assert.equal(parseClock('15:00'), '15:00');
    assert.equal(parseClock('25:00'), null);
    assert.equal(parseScheduleLine('lunes | Matemáticas | 08:00-09:00 | salón 3').weekday, 1);
    assert.equal(parseScheduleLine('día inválido | Materia'), null);

    const now = new Date(2026, 8, 27, 10, 0, 0);
    const due = parseDueDate('viernes', now);
    assert.equal(new Date(due).getDay(), 5);
    assert.ok(due > now.getTime());
});

test('School: guarda tareas, configuración y publicaciones sin duplicar', async () => {
    const ownerJid = `school_owner_${Date.now()}@s.whatsapp.net`;
    const groupJid = `school_group_${Date.now()}@g.us`;
    const settings = await db.saveSchoolSettings({
        ownerJid,
        targetGroupJid: groupJid,
        firstPublishTime: '15:00',
        secondPublishTime: '18:00'
    });
    assert.equal(settings.target_group_jid, groupJid);

    const task = await db.createSchoolTask({
        ownerJid,
        targetGroupJid: groupJid,
        subject: 'Historia',
        title: 'Leer capítulo 3',
        details: 'Tomar notas',
        dueAt: Date.now() + 86400000
    });
    const tasks = await db.getSchoolTasks(ownerJid);
    assert.equal(tasks.length, 1);
    assert.equal(tasks[0].subject, 'Historia');

    assert.equal(await db.claimSchoolPublication(task.id, '2026-09-27', 'first'), true);
    assert.equal(await db.claimSchoolPublication(task.id, '2026-09-27', 'first'), false);
    assert.equal(await db.claimSchoolPublication(task.id, '2026-09-27', 'second'), true);
});

test('School: localParts respeta una fecha estable', () => {
    const parts = localParts(Date.parse('2026-09-27T21:00:00Z'), 'America/Mexico_City');
    assert.match(parts.date, /^2026-09-27$/);
    assert.match(parts.time, /^\d{2}:\d{2}$/);
});

test('School: Horario UTM TI-7B mapea materias y calcula próximas entregas', () => {
    assert.equal(normalizeSubject('formulacion de proyectos'), 'Formulación de Proyectos de Tecnología');
    assert.equal(normalizeSubject('ia'), 'Fundamentos de Inteligencia Artificial');
    assert.equal(normalizeSubject('seguridad'), 'Seguridad Informática');
    assert.equal(normalizeSubject('etica'), 'Ética y Legislación en Tecnologías de la Información');
    assert.equal(normalizeSubject('optativa 1'), 'Optativa I');
    assert.equal(normalizeSubject('habilidades gerenciales'), 'Habilidades Gerenciales');
    assert.equal(normalizeSubject('ingles'), 'Inglés VI');

    // Simular Martes 29 de Septiembre de 2026
    const martes = new Date(2026, 8, 29, 11, 0, 0);
    const dueMartes = calculateNextClassDueDate('formulacion de proyectos', martes);
    assert.equal(dueMartes.canonicalSubject, 'Formulación de Proyectos de Tecnología');
    assert.equal(dueMartes.nextDayIndex, 4); // Jueves
    assert.equal(dueMartes.relativeLabel, 'Pasado mañana (Jueves)');

    // Simular Jueves 1 de Octubre de 2026
    const jueves = new Date(2026, 9, 1, 12, 0, 0);
    const dueJueves = calculateNextClassDueDate('formulacion de proyectos', jueves);
    assert.equal(dueJueves.nextDayIndex, 2); // Martes siguiente
    assert.match(dueJueves.fullDeliveryText, /Martes/i);

    // Simular Viernes 2 de Octubre de 2026 para IA
    const viernes = new Date(2026, 9, 2, 12, 0, 0);
    const dueIA = calculateNextClassDueDate('ia', viernes);
    assert.equal(dueIA.nextDayIndex, 1); // Lunes siguiente
    assert.match(dueIA.fullDeliveryText, /Lunes/i);
});

test('School: extractSchoolTaskDetails extrae materia y descripción en lenguaje natural', async () => {
    const raw1 = '/! tarea de formulacion de proyectos dejo hacer la pagina de classrom donde estan las preguntas y hcerlas en la libreta';
    const res1 = await extractSchoolTaskDetails(raw1);
    assert.match(res1.subject, /Formulación de Proyectos/i);
    assert.match(res1.task, /classro?om/i);

    const raw2 = '/! anotar 3 ejemplos de empresas de capital de materia de optativa';
    const res2 = await extractSchoolTaskDetails(raw2);
    assert.match(res2.subject, /Optativa/i);
    assert.match(res2.task, /anotar 3 ejemplos/i);
});

test('School: fallback local extrae limpiamente fecha y tarea sin borrar la descripción (Bug 4.1)', async () => {
    const aiModule = require('../src/services/ai');
    const origCallGemini = aiModule.callGemini;
    aiModule.callGemini = async () => { throw new Error('Simulated Gemini API offline'); };

    try {
        const raw = '/! proyecto de formulacion de proyectos se entrega el 24 de octubre hacer el prototipo funcional';
        const res = await extractSchoolTaskDetails(raw);

        assert.equal(res.subject, 'Formulación de Proyectos de Tecnología');
        assert.match(res.explicit_due, /24 de octubre/i);
        assert.match(res.task, /hacer el prototipo funcional/i);
        assert.doesNotMatch(res.task, /se entrega/i, 'No debe incluir la frase de fecha en la descripción');

        const raw2 = '/! tarea de optativa para el viernes anotar 3 ejemplos de empresas';
        const res2 = await extractSchoolTaskDetails(raw2);
        assert.equal(res2.subject, 'Optativa I');
        assert.match(res2.explicit_due, /viernes/i);
        assert.match(res2.task, /anotar 3 ejemplos de empresas/i);
    } finally {
        aiModule.callGemini = origCallGemini;
    }
});

test('School: handleDirectTaskMessage procesa /! y registra tarea en lote del día', async () => {
    const evolution = require('../src/services/evolution');
    const origSendText = evolution.sendText;
    let sentMsg = '';
    evolution.sendText = async (to, msg) => { sentMsg = msg; return { success: true }; };

    try {
        const testAdmin = '5214439998888';
        process.env.ALLOWED_NUMBERS_ADMIN = testAdmin;

        const from = `${testAdmin}@s.whatsapp.net`;
        const messageData = { key: { remoteJid: from, participant: from } };

        const handled = await handleDirectTaskMessage({
            text: '/! tarea de seguridad informatica investigar puertos tcp y udp',
            from,
            messageData,
            norm: { actualMessageType: 'conversation' }
        });

        assert.equal(handled, true);
        assert.match(sentMsg, /tarea registrada/i);
        assert.match(sentMsg, /Seguridad Informática/i);
        assert.match(sentMsg, /Entrega/i);

        const tasks = await db.getSchoolTasks(from);
        assert.ok(tasks.length >= 1);
        const lastTask = tasks[0];
        assert.match(lastTask.subject, /Seguridad Informática/i);
        assert.match(lastTask.title, /puertos tcp y udp/i);
        assert.ok(lastTask.due_text && lastTask.due_text.length > 0);

        // Probar cancelación inmediata con prefijo recortado por normalizador: "cancelar <id>"
        const cancelWithoutPrefix = await handleDirectTaskMessage({
            text: `cancelar ${lastTask.id}`,
            from,
            messageData,
            norm: { actualMessageType: 'conversation', isTaskDirectCommand: true }
        });
        assert.equal(cancelWithoutPrefix, true);
        assert.match(sentMsg, /cancelada correctamente/i);
    } finally {
        evolution.sendText = origSendText;
    }
});

test('School: publishDailySchoolDigest consolida tareas del día a las 15:00 y 18:00', async () => {
    const evolution = require('../src/services/evolution');
    const origSendText = evolution.sendText;
    const sentMessages = [];
    evolution.sendText = async (to, msg) => { sentMessages.push({ to, msg }); return { success: true }; };

    try {
        const groupJid = `school_digest_group_${Date.now()}@g.us`;
        const testOwner = `digest_owner_${Date.now()}@s.whatsapp.net`;
        await db.saveSchoolSettings({
            ownerJid: testOwner,
            targetGroupJid: groupJid,
            firstPublishTime: '15:00',
            secondPublishTime: '18:00'
        });

        const todayParts = localParts(Date.now(), 'America/Mexico_City');
        await db.createSchoolTask({
            ownerJid: testOwner,
            targetGroupJid: groupJid,
            subject: 'Seguridad Informática',
            title: 'Configurar firewall iptables',
            details: 'Reglas de INPUT y FORWARD',
            dueAt: Date.now() + 86400000,
            dueText: 'Jueves (1 de octubre)',
            batchDate: todayParts.date
        });

        await publishDailySchoolDigest(Date.now(), 'first');
        const firstMsg = sentMessages.find(m => m.to === groupJid);
        assert.ok(firstMsg, 'Debe haber enviado mensaje a groupJid');
        assert.match(firstMsg.msg, /TAREAS ASIGNADAS HOY/i);
        assert.match(firstMsg.msg, /Seguridad Informática/i);
        assert.match(firstMsg.msg, /firewall iptables/i);

        // Recordatorio de las 18:00
        sentMessages.length = 0;
        await publishDailySchoolDigest(Date.now(), 'second');
        const secondMsg = sentMessages.find(m => m.to === groupJid);
        assert.ok(secondMsg, 'Debe haber enviado recordatorio a groupJid');
        assert.match(secondMsg.msg, /RECORDATORIO DE TAREAS/i);
        assert.match(secondMsg.msg, /Seguridad Informática/i);
    } finally {
        evolution.sendText = origSendText;
    }
});

test('School: parseDueDate soporta fechas explícitas en español (24 de octubre, en 1 mes)', () => {
    const now = new Date(2026, 8, 28, 10, 0, 0); // 28 de septiembre 2026
    const oct24 = parseDueDate('24 de octubre', now);
    assert.ok(oct24);
    const dOct = new Date(oct24);
    assert.equal(dOct.getDate(), 24);
    assert.equal(dOct.getMonth(), 9); // Octubre (0-indexed: 9)

    const enUnMes = parseDueDate('en 1 mes', now);
    assert.ok(enUnMes);
    const dMes = new Date(enUnMes);
    assert.equal(dMes.getMonth(), 9);

    const enTresDias = parseDueDate('en 3 días', now);
    assert.ok(enTresDias);
    const dDias = new Date(enTresDias);
    assert.equal(dDias.getDate(), 1); // 28 + 3 = 1 oct
});

test('School: handleDirectTaskMessage respeta fecha explícita especificada por el usuario', async () => {
    const evolution = require('../src/services/evolution');
    const origSendText = evolution.sendText;
    let sentMsg = '';
    evolution.sendText = async (to, msg) => { sentMsg = msg; return { success: true }; };

    try {
        const testAdmin = '5214437776655';
        process.env.ALLOWED_NUMBERS_ADMIN = `5214439998888,${testAdmin}`;

        const from = `${testAdmin}@s.whatsapp.net`;
        const messageData = { key: { remoteJid: from, participant: from } };

        const handled = await handleDirectTaskMessage({
            text: '/! proyecto de formulacion de proyectos se entrega el 24 de octubre hacer el prototipo',
            from,
            messageData,
            norm: { actualMessageType: 'conversation' }
        });

        assert.equal(handled, true);
        assert.match(sentMsg, /tarea registrada/i);
        assert.match(sentMsg, /24 de octubre/i);

        const tasks = await db.getSchoolTasks(from);
        assert.ok(tasks.length >= 1);
        const lastTask = tasks[0];
        assert.match(lastTask.due_text, /24 de octubre/i);
    } finally {
        evolution.sendText = origSendText;
    }
});

test('School: publishDailySchoolDigest incluye sección de pendientes de días anteriores', async () => {
    const evolution = require('../src/services/evolution');
    const origSendText = evolution.sendText;
    const sentMessages = [];
    evolution.sendText = async (to, msg) => { sentMessages.push({ to, msg }); return { success: true }; };

    try {
        const groupJid = `school_digest_upcoming_${Date.now()}@g.us`;
        const testOwner = `upcoming_owner_${Date.now()}@s.whatsapp.net`;
        await db.saveSchoolSettings({
            ownerJid: testOwner,
            targetGroupJid: groupJid,
            firstPublishTime: '15:00',
            secondPublishTime: '18:00'
        });

        const todayParts = localParts(Date.now(), 'America/Mexico_City');

        // Tarea de hoy
        await db.createSchoolTask({
            ownerJid: testOwner,
            targetGroupJid: groupJid,
            subject: 'Inglés VI',
            title: 'Ejercicios de workbook página 40',
            dueAt: Date.now() + 86400000,
            dueText: 'Mañana (Martes)',
            batchDate: todayParts.date
        });

        // Tarea de hace 2 días (batchDate anterior) con entrega en 1 mes
        await db.createSchoolTask({
            ownerJid: testOwner,
            targetGroupJid: groupJid,
            subject: 'Formulación de Proyectos de Tecnología',
            title: 'Entrega de prototipo funcional',
            dueAt: Date.now() + 86400000 * 20,
            dueText: '24 de octubre',
            batchDate: '2026-09-20'
        });

        await publishDailySchoolDigest(Date.now(), 'first');
        const upcomingMsg = sentMessages.find(m => m.to === groupJid);
        assert.ok(upcomingMsg, 'Debe haber enviado mensaje a groupJid');
        const text = upcomingMsg.msg;
        assert.match(text, /TAREAS ASIGNADAS HOY/i);
        assert.match(text, /Inglés VI/i);
        assert.match(text, /PENDIENTES Y PRÓXIMAS ENTREGAS/i);
        assert.match(text, /Formulación de Proyectos/i);
        assert.match(text, /prototipo funcional/i);
    } finally {
        evolution.sendText = origSendText;
    }
});

test('School: getSchoolSchedule devuelve horario UTM TI-7B si no hay datos guardados', async () => {
    const randomUser = `student_${Date.now()}@s.whatsapp.net`;
    const schedule = await db.getSchoolSchedule(randomUser);
    assert.ok(Array.isArray(schedule));
    assert.equal(schedule.length, UTM_SCHEDULE_TI7B.length);
    assert.equal(schedule[0].subject, 'Inglés VI');
});

test('School: publishDueSchoolTasks a las 15:00 no genera duplicados individuales para tareas con lote (Bug 1.1)', async () => {
    const evolution = require('../src/services/evolution');
    const origSendText = evolution.sendText;
    const sentMessages = [];
    evolution.sendText = async (to, msg) => { sentMessages.push({ to, msg }); return { success: true }; };

    try {
        const groupJid = `school_digest_nospam_${Date.now()}@g.us`;
        const testOwner = `nospam_owner_${Date.now()}@s.whatsapp.net`;
        await db.saveSchoolSettings({
            ownerJid: testOwner,
            targetGroupJid: groupJid,
            firstPublishTime: '15:00',
            secondPublishTime: '18:00'
        });

        // 15:00 en Ciudad de México para simular
        const simulatedAt1500 = new Date('2026-09-28T15:00:00-06:00').getTime();
        const todayParts = localParts(simulatedAt1500, 'America/Mexico_City');

        // Crear 2 tareas registradas hoy con lote
        await db.createSchoolTask({
            ownerJid: testOwner,
            targetGroupJid: groupJid,
            subject: 'Seguridad Informática',
            title: 'Reporte de puertos',
            dueAt: simulatedAt1500 + 86400000,
            dueText: 'Mañana',
            batchDate: todayParts.date
        });
        await db.createSchoolTask({
            ownerJid: testOwner,
            targetGroupJid: groupJid,
            subject: 'Inglés VI',
            title: 'Ejercicios unidad 4',
            dueAt: simulatedAt1500 + 86400000,
            dueText: 'Mañana',
            batchDate: todayParts.date
        });

        // Ejecutar publicador a las 15:00
        await publishDueSchoolTasks(simulatedAt1500);

        // Filtrar mensajes enviados a este grupo
        const groupMsgs = sentMessages.filter(m => m.to === groupJid);

        // Debe haber EXACTAMENTE 1 mensaje al grupo (el digest consolidado), NINGÚN mensaje individual separado
        assert.equal(groupMsgs.length, 1, 'Debe haber exactamente 1 mensaje consolidado en el grupo');
        assert.match(groupMsgs[0].msg, /TAREAS ASIGNADAS HOY/i);
        assert.match(groupMsgs[0].msg, /Seguridad Informática/i);
        assert.match(groupMsgs[0].msg, /Inglés VI/i);

        // Verificar que no se enviaron mensajes individuales con la plantilla "📚 *TAREA DEL DÍA*\nMateria:"
        const individualMsgs = groupMsgs.filter(m => m.msg.includes('📚 *TAREA DEL DÍA*\nMateria:'));
        assert.equal(individualMsgs.length, 0, 'No debe haber mensajes individuales repetidos');
    } finally {
        evolution.sendText = origSendText;
    }
});

test('School: rescata tareas en pending_group cuando se configura el grupo escolar (Bug 1.3)', async () => {
    const testOwner = `rescue_owner_${Date.now()}@s.whatsapp.net`;
    const targetGroup = `rescue_group_${Date.now()}@g.us`;
    const todayParts = localParts(Date.now(), 'America/Mexico_City');

    // Tarea creada cuando el grupo aún no estaba definido (pending_group)
    const task = await db.createSchoolTask({
        ownerJid: testOwner,
        targetGroupJid: 'pending_group',
        subject: 'Optativa I',
        title: 'Proyecto final',
        dueAt: Date.now() + 86400000,
        dueText: 'Mañana',
        batchDate: todayParts.date
    });

    // Luego el usuario configura el grupo escolar con /tareas grupo
    await db.saveSchoolSettings({
        ownerJid: testOwner,
        targetGroupJid: targetGroup
    });

    // Verificar que la tarea fue migrada de pending_group al grupo real
    const tasks = await db.getSchoolTasks(testOwner);
    const updatedTask = tasks.find(t => t.id === task.id);
    assert.equal(updatedTask.target_group_jid, targetGroup);

    // Verificar que getAllDailySchoolTasksForDate la devuelve con el grupo real
    const dailyTasks = await db.getAllDailySchoolTasksForDate(todayParts.date);
    const foundDaily = dailyTasks.find(t => t.id === task.id);
    assert.ok(foundDaily);
    assert.equal(foundDaily.target_group_jid, targetGroup);
});

test('School: getAllUpcomingSchoolTasks no incluye tareas expiradas de días pasados (Bug 1.4)', async () => {
    const testOwner = `past_owner_${Date.now()}@s.whatsapp.net`;
    const groupJid = `past_group_${Date.now()}@g.us`;
    const now = Date.now();

    // 1. Tarea que venció en el pasado (dueAt < now)
    await db.createSchoolTask({
        ownerJid: testOwner,
        targetGroupJid: groupJid,
        subject: 'Habilidades Gerenciales',
        title: 'Ensayo de liderazgo vencido ayer',
        dueAt: now - 3600000 * 12, // venció hace 12 horas
        dueText: 'Ayer',
        batchDate: '2026-09-20'
    });

    // 2. Tarea activa para el futuro (dueAt > now)
    const futureTask = await db.createSchoolTask({
        ownerJid: testOwner,
        targetGroupJid: groupJid,
        subject: 'Fundamentos de Inteligencia Artificial',
        title: 'Proyecto de red neuronal',
        dueAt: now + 86400000 * 5, // vence en 5 días
        dueText: 'En 5 días',
        batchDate: '2026-09-20'
    });

    const upcoming = await db.getAllUpcomingSchoolTasks('2026-09-28', now);
    const expiredFound = upcoming.find(t => t.title.includes('vencido ayer'));
    const futureFound = upcoming.find(t => t.id === futureTask.id);

    assert.equal(expiredFound, undefined, 'No debe incluir tareas vencidas en el pasado');
    assert.ok(futureFound, 'Debe incluir tareas pendientes en el futuro');
});

test('School: elimina archivo local al cancelar tarea con multimedia (Bug 2.1)', async () => {
    const fs = require('fs');
    const path = require('path');
    const testAdmin = '5214438887766';
    process.env.ALLOWED_NUMBERS_ADMIN = `5214439998888,${testAdmin}`;
    const from = `${testAdmin}@s.whatsapp.net`;
    const messageData = { key: { remoteJid: from, participant: from } };

    // Crear un archivo temporal en data/school_media
    const mediaDir = path.join(process.cwd(), 'data', 'school_media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    const dummyFile = path.join(mediaDir, `task_test_${Date.now()}.jpg`);
    fs.writeFileSync(dummyFile, Buffer.from('fake image content'));
    assert.ok(fs.existsSync(dummyFile));

    const task = await db.createSchoolTask({
        ownerJid: from,
        targetGroupJid: 'group_media@g.us',
        subject: 'Optativa I',
        title: 'Ejercicio de pizarra',
        mediaPath: dummyFile
    });

    const evolution = require('../src/services/evolution');
    const origSendText = evolution.sendText;
    evolution.sendText = async () => ({ success: true });

    try {
        await handleDirectTaskMessage({
            text: `cancelar ${task.id}`,
            from,
            messageData,
            norm: { actualMessageType: 'conversation', isTaskDirectCommand: true }
        });

        // Verificar que el archivo fue eliminado del disco
        assert.equal(fs.existsSync(dummyFile), false, 'El archivo en disco debe haberse borrado al cancelar');
    } finally {
        evolution.sendText = origSendText;
        if (fs.existsSync(dummyFile)) fs.unlinkSync(dummyFile);
    }
});

test('School: cleanSchoolMediaDirectory purga imágenes antiguas de más de 7 días (Bug 2.1)', async () => {
    const fs = require('fs');
    const path = require('path');
    const { cleanSchoolMediaDirectory } = require('../src/services/cleanup');

    const mediaDir = path.join(process.cwd(), 'data', 'school_media');
    if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });
    const oldFile = path.join(mediaDir, `task_old_${Date.now()}.jpg`);
    fs.writeFileSync(oldFile, Buffer.from('old image'));

    // Modificar mtime para simular archivo de hace 10 días
    const tenDaysAgo = (Date.now() - 10 * 24 * 60 * 60 * 1000) / 1000;
    fs.utimesSync(oldFile, tenDaysAgo, tenDaysAgo);

    await cleanSchoolMediaDirectory();
    assert.equal(fs.existsSync(oldFile), false, 'La imagen antigua debe haber sido purgada');
});

test('School: descarga imagen correctamente cuando es un mensaje citado / quoted (Bug 2.2)', async () => {
    const fs = require('fs');
    const evolution = require('../src/services/evolution');
    const origSendText = evolution.sendText;
    const origDownloadMedia = evolution.downloadMedia;

    let downloadedFrom = null;
    evolution.sendText = async () => ({ success: true });
    evolution.downloadMedia = async (msgData) => {
        downloadedFrom = msgData;
        return {
            buffer: Buffer.from('downloaded-quoted-image'),
            extension: 'jpg'
        };
    };

    const testAdmin = '5214436665544';
    process.env.ALLOWED_NUMBERS_ADMIN = `5214439998888,${testAdmin}`;
    const from = `${testAdmin}@s.whatsapp.net`;
    const messageData = { key: { remoteJid: from, participant: from } };

    const quotedImagePayload = {
        key: { remoteJid: from, id: 'QUOTED_STANZA_123' },
        message: { imageMessage: { url: 'https://whatsapp.net/image.jpg' } },
        quotedStanzaId: 'QUOTED_STANZA_123'
    };

    try {
        const handled = await handleDirectTaskMessage({
            text: '/! tarea de habilidades gerenciales resolver el caso de la foto',
            from,
            messageData,
            norm: {
                actualMessageType: 'imageMessage',
                actualMessageData: quotedImagePayload,
                isTaskDirectCommand: true
            }
        });

        assert.equal(handled, true);
        assert.ok(downloadedFrom, 'downloadMedia debe haber sido invocado');
        assert.equal(downloadedFrom.quotedStanzaId, 'QUOTED_STANZA_123', 'Debe descargar usando los datos del mensaje citado');

        const tasks = await db.getSchoolTasks(from);
        const matchingTasks = tasks.filter(t => t.title.toLowerCase().includes('resolver el caso'));
        const lastTask = matchingTasks.sort((a, b) => b.id - a.id)[0];
        assert.ok(lastTask, 'Debe encontrar la tarea creada');
        assert.ok(lastTask.media_path, 'Debe haber guardado el path de la foto citada');
        assert.ok(fs.existsSync(lastTask.media_path), 'El archivo descargado debe existir en disco');

        // Limpiar archivo creado
        if (lastTask.media_path && fs.existsSync(lastTask.media_path)) {
            fs.unlinkSync(lastTask.media_path);
        }
    } finally {
        evolution.sendText = origSendText;
        evolution.downloadMedia = origDownloadMedia;
    }
});

test('School: school_publications no tiene violaciones de claves foráneas con batch keys (Bug 3.1)', async () => {
    // Reclamar con clave de texto tipo batch
    const claimBatchKey = `batch_group_fktest_${Date.now()}@g.us_2026-09-28_first`;
    const claimed = await db.claimSchoolPublication(claimBatchKey, '2026-09-28', 'first');
    assert.equal(claimed, true);

    // Verificar en SQLite que no existan violaciones de clave foránea
    const violations = await new Promise((resolve, reject) => {
        db.db.all('PRAGMA foreign_key_check(school_publications)', (err, rows) => err ? reject(err) : resolve(rows || []));
    });
    assert.equal(violations.length, 0, 'No deben existir violaciones de FK en school_publications');
});

test('School: reintenta publicación si sendText falla temporalmente por red (Bug 3.2)', async () => {
    const evolution = require('../src/services/evolution');
    const origSendText = evolution.sendText;

    let shouldFail = true;
    const sentMessages = [];
    evolution.sendText = async (to, msg) => {
        if (shouldFail) {
            throw new Error('ECONNRESET: WhatsApp Gateway temporarily unreachable');
        }
        sentMessages.push({ to, msg });
        return { success: true };
    };

    const groupJid = `school_retry_group_${Date.now()}@g.us`;
    const testOwner = `retry_owner_${Date.now()}@s.whatsapp.net`;
    const simulatedAt1500 = new Date('2026-09-28T15:00:00-06:00').getTime();
    const todayParts = localParts(simulatedAt1500, 'America/Mexico_City');

    await db.saveSchoolSettings({
        ownerJid: testOwner,
        targetGroupJid: groupJid,
        firstPublishTime: '15:00',
        secondPublishTime: '18:00'
    });

    await db.createSchoolTask({
        ownerJid: testOwner,
        targetGroupJid: groupJid,
        subject: 'Ética y Legislación en Tecnologías de la Información',
        title: 'Análisis de caso de privacidad',
        dueAt: simulatedAt1500 + 86400000,
        dueText: 'Mañana',
        batchDate: todayParts.date
    });

    try {
        // Intento 1: Falla por red a las 15:00:00
        await publishDailySchoolDigest(simulatedAt1500, 'first');
        assert.equal(sentMessages.length, 0, 'No debe haber enviado el mensaje en el fallo');

        // Intento 2: 10 segundos después a las 15:00:10 la red se recupera
        shouldFail = false;
        await publishDailySchoolDigest(simulatedAt1500 + 10000, 'first');

        const retryMsg = sentMessages.find(m => m.to === groupJid);
        assert.ok(retryMsg, 'Debe haber enviado el digest tras recuperarse de la caída de red');
        assert.match(retryMsg.msg, /Ética y Legislación/i);

        // Intento 3: A las 15:00:20 ya está reclamado con éxito y no reenvía duplicado
        sentMessages.length = 0;
        await publishDailySchoolDigest(simulatedAt1500 + 20000, 'first');
        assert.equal(sentMessages.length, 0, 'No debe duplicar una vez entregado con éxito');
    } finally {
        evolution.sendText = origSendText;
    }
});

test('School: usuario en ALLOWED_NUMBERS_TASKS puede registrar tareas escolares', async () => {
    const { isAuthorizedTaskUploader } = require('../src/core/auth');
    const { handleTareas } = require('../src/commands/tareas');

    const origTasks = process.env.ALLOWED_NUMBERS_TASKS;
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;

    process.env.ALLOWED_NUMBERS_TASKS = '4431851495, 5214431851495';
    process.env.ALLOWED_NUMBERS_ADMIN = '5214435810175';

    try {
        // Formato 13 dígitos
        assert.equal(isAuthorizedTaskUploader('5214431851495@s.whatsapp.net'), true);
        // Formato 12 dígitos
        assert.equal(isAuthorizedTaskUploader('524431851495@s.whatsapp.net'), true);
        // Admin también está autorizado
        assert.equal(isAuthorizedTaskUploader('5214435810175@s.whatsapp.net'), true);
        // Desconocido NO está autorizado
        assert.equal(isAuthorizedTaskUploader('5219999999999@s.whatsapp.net'), false);

        // Prueba en handleTareas
        let sentMessage = '';
        const evolution = require('../src/services/evolution');
        const origSendText = evolution.sendText;
        evolution.sendText = async (to, text) => {
            sentMessage = text;
            return { messageId: 'test_123' };
        };

        try {
            // Usuario autorizado consulta uploaders
            await handleTareas({ args: ['uploaders'] }, '5214431851495@s.whatsapp.net');
            assert.match(sentMessage, /USUARIOS AUTORIZADOS/i);
            assert.match(sentMessage, /4431851495/);

            // Usuario no autorizado es rechazado
            sentMessage = '';
            await handleTareas({ args: ['lista'] }, '5219999999999@s.whatsapp.net');
            assert.match(sentMessage, /Sólo las personas autorizadas/i);
        } finally {
            evolution.sendText = origSendText;
        }
    } finally {
        process.env.ALLOWED_NUMBERS_TASKS = origTasks;
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
    }
});

test.after(async () => {
    await new Promise((resolve) => {
        db.db.run(
            `DELETE FROM school_settings WHERE owner_jid LIKE '%owner%' OR target_group_jid LIKE '%school_%' OR target_group_jid LIKE '%digest%' OR target_group_jid LIKE '%past_%' OR target_group_jid LIKE '%rescue_%' OR target_group_jid LIKE '%retry_%' OR target_group_jid = '12345678@g.us' OR target_group_jid = 'group_media@g.us' OR owner_jid = '5214438887766@s.whatsapp.net'`,
            [],
            () => resolve()
        );
    });
    await new Promise((resolve) => {
        db.db.run(
            `DELETE FROM school_tasks WHERE owner_jid LIKE '%owner%' OR target_group_jid LIKE '%school_%' OR target_group_jid LIKE '%digest%' OR target_group_jid LIKE '%past_%' OR target_group_jid LIKE '%rescue_%' OR target_group_jid LIKE '%retry_%' OR target_group_jid = '12345678@g.us' OR target_group_jid = 'group_media@g.us' OR owner_jid = '5214438887766@s.whatsapp.net'`,
            [],
            () => resolve()
        );
    });
    await new Promise((resolve) => {
        db.db.run(
            `DELETE FROM school_publications WHERE task_id NOT LIKE 'batch_%' AND task_id NOT IN (SELECT id FROM school_tasks)`,
            [],
            () => resolve()
        );
    });
});


