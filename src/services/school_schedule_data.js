'use strict';

/**
 * Horario escolar cuatrimestral UTM (TI-7B) - Septiembre a Diciembre 2026.
 * Días de la semana en formato estándar:
 * 0: Domingo, 1: Lunes, 2: Martes, 3: Miércoles, 4: Jueves, 5: Viernes, 6: Sábado
 */

const UTM_SCHEDULE_TI7B = [
    // ── Lunes (1) ──
    { weekday: 1, subject: 'Inglés VI', startTime: '07:00', endTime: '08:00', room: 'A6', teacher: 'Israel Cuitlahuac Gonzalez Sanchez' },
    { weekday: 1, subject: 'Fundamentos de Inteligencia Artificial', startTime: '08:00', endTime: '10:00', room: 'Lab Multimedia', teacher: 'Paulina Solorzano Salgado' },
    { weekday: 1, subject: 'Ética y Legislación en Tecnologías de la Información', startTime: '10:00', endTime: '11:00', room: 'Lab Cómputo B1', teacher: 'Jose Luis Cendejas Valdez' },
    { weekday: 1, subject: 'Optativa I', startTime: '11:00', endTime: '13:00', room: 'Lab Cómputo A2', teacher: 'Gustavo Abraham Vanegas Contreras' },

    // ── Martes (2) ──
    { weekday: 2, subject: 'Seguridad Informática', startTime: '07:00', endTime: '09:00', room: 'Lab Cómputo A1', teacher: 'Rosario Hernandez Calderon' },
    { weekday: 2, subject: 'Ética y Legislación en Tecnologías de la Información', startTime: '09:00', endTime: '10:00', room: 'Lab Cómputo B1', teacher: 'Jose Luis Cendejas Valdez' },
    { weekday: 2, subject: 'Formulación de Proyectos de Tecnología', startTime: '10:00', endTime: '12:00', room: 'Lab Multimedia', teacher: 'Paulina Solorzano Salgado' },
    { weekday: 2, subject: 'Habilidades Gerenciales', startTime: '12:00', endTime: '13:00', room: 'A6', teacher: 'Martha Yadira Leyva Gil' },

    // ── Miércoles (3) ──
    { weekday: 3, subject: 'Inglés VI', startTime: '07:00', endTime: '08:00', room: 'A6', teacher: 'Israel Cuitlahuac Gonzalez Sanchez' },
    { weekday: 3, subject: 'Fundamentos de Inteligencia Artificial', startTime: '08:00', endTime: '10:00', room: 'Lab Multimedia', teacher: 'Paulina Solorzano Salgado' },
    { weekday: 3, subject: 'Seguridad Informática', startTime: '10:00', endTime: '12:00', room: 'Lab Cómputo A1', teacher: 'Rosario Hernandez Calderon' },
    { weekday: 3, subject: 'Habilidades Gerenciales', startTime: '12:00', endTime: '13:00', room: 'A6', teacher: 'Martha Yadira Leyva Gil' },
    { weekday: 3, subject: 'Ética y Legislación en Tecnologías de la Información', startTime: '13:00', endTime: '14:00', room: 'A6', teacher: 'Jose Luis Cendejas Valdez' },

    // ── Jueves (4) ──
    { weekday: 4, subject: 'Seguridad Informática', startTime: '07:00', endTime: '09:00', room: 'Lab Cómputo A1', teacher: 'Rosario Hernandez Calderon' },
    { weekday: 4, subject: 'Optativa I', startTime: '09:00', endTime: '11:00', room: 'Lab Cómputo A2', teacher: 'Gustavo Abraham Vanegas Contreras' },
    { weekday: 4, subject: 'Formulación de Proyectos de Tecnología', startTime: '11:00', endTime: '13:00', room: 'Lab Multimedia', teacher: 'Paulina Solorzano Salgado' },
    { weekday: 4, subject: 'Inglés VI', startTime: '13:00', endTime: '15:00', room: 'A6', teacher: 'Israel Cuitlahuac Gonzalez Sanchez' },

    // ── Viernes (5) ──
    { weekday: 5, subject: 'Inglés VI', startTime: '07:00', endTime: '08:00', room: 'A6', teacher: 'Israel Cuitlahuac Gonzalez Sanchez' },
    { weekday: 5, subject: 'Habilidades Gerenciales', startTime: '08:00', endTime: '09:00', room: 'A6', teacher: 'Martha Yadira Leyva Gil' },
    { weekday: 5, subject: 'Optativa I', startTime: '09:00', endTime: '11:00', room: 'Lab Cómputo A2', teacher: 'Gustavo Abraham Vanegas Contreras' },
    { weekday: 5, subject: 'Fundamentos de Inteligencia Artificial', startTime: '11:00', endTime: '13:00', room: 'Lab Multimedia', teacher: 'Paulina Solorzano Salgado' },
    { weekday: 5, subject: 'Habilidades Gerenciales', startTime: '13:00', endTime: '14:00', room: 'A6', teacher: 'Martha Yadira Leyva Gil' },
    { weekday: 5, subject: 'Ética y Legislación en Tecnologías de la Información', startTime: '14:00', endTime: '15:00', room: 'Lab Cómputo B1', teacher: 'Jose Luis Cendejas Valdez' }
];

const CANONICAL_SUBJECTS = [
    'Formulación de Proyectos de Tecnología',
    'Fundamentos de Inteligencia Artificial',
    'Seguridad Informática',
    'Ética y Legislación en Tecnologías de la Información',
    'Optativa I',
    'Habilidades Gerenciales',
    'Inglés VI'
];

const SUBJECT_ALIASES = {
    // Formulación de proyectos
    'formulacion': 'Formulación de Proyectos de Tecnología',
    'formulación': 'Formulación de Proyectos de Tecnología',
    'proyectos': 'Formulación de Proyectos de Tecnología',
    'formulacion de proyectos': 'Formulación de Proyectos de Tecnología',
    'formulación de proyectos': 'Formulación de Proyectos de Tecnología',
    'formulacion de proyectos de tecnologia': 'Formulación de Proyectos de Tecnología',
    'formulación de proyectos de tecnología': 'Formulación de Proyectos de Tecnología',
    'proyectos de tecnologia': 'Formulación de Proyectos de Tecnología',
    'proyectos de tecnología': 'Formulación de Proyectos de Tecnología',

    // Inteligencia Artificial
    'ia': 'Fundamentos de Inteligencia Artificial',
    'inteligencia artificial': 'Fundamentos de Inteligencia Artificial',
    'fundamentos de ia': 'Fundamentos de Inteligencia Artificial',
    'fundamentos de inteligencia artificial': 'Fundamentos de Inteligencia Artificial',
    'artifical': 'Fundamentos de Inteligencia Artificial',

    // Seguridad Informática
    'seguridad': 'Seguridad Informática',
    'seguridad informatica': 'Seguridad Informática',
    'seguridad informática': 'Seguridad Informática',
    'ciberseguridad': 'Seguridad Informática',

    // Ética y Legislación
    'etica': 'Ética y Legislación en Tecnologías de la Información',
    'ética': 'Ética y Legislación en Tecnologías de la Información',
    'legislacion': 'Ética y Legislación en Tecnologías de la Información',
    'legislación': 'Ética y Legislación en Tecnologías de la Información',
    'etica y legislacion': 'Ética y Legislación en Tecnologías de la Información',
    'ética y legislación': 'Ética y Legislación en Tecnologías de la Información',
    'etica y legislacion en ti': 'Ética y Legislación en Tecnologías de la Información',
    'ética y legislación en ti': 'Ética y Legislación en Tecnologías de la Información',

    // Optativa I
    'optativa': 'Optativa I',
    'optativa 1': 'Optativa I',
    'optativa i': 'Optativa I',
    'optativa uno': 'Optativa I',

    // Habilidades Gerenciales
    'habilidades': 'Habilidades Gerenciales',
    'gerenciales': 'Habilidades Gerenciales',
    'habilidades gerenciales': 'Habilidades Gerenciales',
    'habilidad gerencial': 'Habilidades Gerenciales',

    // Inglés VI
    'ingles': 'Inglés VI',
    'inglés': 'Inglés VI',
    'ingles 6': 'Inglés VI',
    'inglés 6': 'Inglés VI',
    'ingles vi': 'Inglés VI',
    'inglés vi': 'Inglés VI'
};

const WEEKDAY_NAMES_ES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];

/**
 * Normaliza cualquier variante de nombre de materia al nombre canónico oficial.
 * @param {string} raw
 * @returns {string}
 */
function normalizeSubject(raw) {
    if (typeof raw !== 'string' || !raw.trim()) return '';
    const clean = raw.trim().toLowerCase();
    return SUBJECT_ALIASES[clean] || CANONICAL_SUBJECTS.find(value => value.toLowerCase() === clean) || raw.trim();
}

/**
 * Obtiene los días de la semana (1 a 5) en los que se imparte una materia.
 * @param {string} canonicalSubject
 * @param {Array} schedule
 * @returns {number[]} Array de números de día (1: Lunes .. 5: Viernes) ordenados
 */
function getDaysForSubject(canonicalSubject, schedule = UTM_SCHEDULE_TI7B) {
    const days = new Set();
    const target = canonicalSubject.trim().toLowerCase();

    for (const item of schedule) {
        if (item.subject.toLowerCase() === target || item.subject.toLowerCase().includes(target)) {
            days.add(item.weekday);
        }
    }

    return Array.from(days).sort((a, b) => a - b);
}

/**
 * Calcula la siguiente fecha y día relativo en que hay clase de la materia,
 * a partir de la fecha y hora de referencia.
 *
 * @param {string} rawSubject
 * @param {Date|number} [referenceTime]
 * @param {Array} [schedule]
 * @param {string} [timezone]
 * @returns {{
 *   canonicalSubject: string,
 *   nextDayIndex: number,
 *   daysUntil: number,
 *   dueTimestamp: number,
 *   relativeLabel: string,
 *   formattedDate: string,
 *   fullDeliveryText: string
 * }}
 */
function calculateNextClassDueDate(rawSubject, referenceTime = new Date(), schedule = UTM_SCHEDULE_TI7B, timezone = 'America/Mexico_City') {
    const canonical = normalizeSubject(rawSubject);
    const classDays = getDaysForSubject(canonical, schedule);

    const refDate = new Date(referenceTime);
    // Obtener día de la semana local en la zona horaria
    const localDayStr = new Intl.DateTimeFormat('en-US', { timeZone: timezone, weekday: 'short' }).format(refDate);
    const dayMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    const currentDay = dayMap[localDayStr] ?? refDate.getDay();

    if (!classDays.length) {
        // Fallback si la materia no está en el horario: entrega para mañana
        const nextDayDate = new Date(refDate);
        nextDayDate.setDate(nextDayDate.getDate() + 1);
        nextDayDate.setHours(23, 59, 59, 999);
        return {
            canonicalSubject: canonical || rawSubject,
            nextDayIndex: (currentDay + 1) % 7,
            daysUntil: 1,
            dueTimestamp: nextDayDate.getTime(),
            relativeLabel: 'Mañana',
            formattedDate: new Intl.DateTimeFormat('es-MX', { timeZone: timezone, dateStyle: 'medium' }).format(nextDayDate),
            fullDeliveryText: 'Mañana'
        };
    }

    // Buscar el siguiente día en el ciclo semanal
    // Si la clase ya se tuvo hoy (asumiendo que las tareas se registran durante o después de clase),
    // la entrega es para la SIGUIENTE clase (daysUntil >= 1)
    let minDays = null;
    let targetDay = null;

    for (const day of classDays) {
        let diff = day - currentDay;
        if (diff <= 0) {
            diff += 7; // Próxima semana
        }
        if (minDays === null || diff < minDays) {
            minDays = diff;
            targetDay = day;
        }
    }

    const dueDate = new Date(refDate);
    dueDate.setDate(dueDate.getDate() + minDays);
    dueDate.setHours(23, 59, 59, 999);

    const targetDayName = WEEKDAY_NAMES_ES[targetDay];
    let relativeLabel = targetDayName;
    if (minDays === 1) {
        relativeLabel = `Mañana (${targetDayName})`;
    } else if (minDays === 2) {
        relativeLabel = `Pasado mañana (${targetDayName})`;
    } else if (minDays >= 6) {
        relativeLabel = `Próximo ${targetDayName}`;
    }

    const formattedDate = new Intl.DateTimeFormat('es-MX', {
        timeZone: timezone,
        day: 'numeric',
        month: 'long'
    }).format(dueDate);

    const fullDeliveryText = `${relativeLabel} (${formattedDate})`;

    return {
        canonicalSubject: canonical,
        nextDayIndex: targetDay,
        daysUntil: minDays,
        dueTimestamp: dueDate.getTime(),
        relativeLabel,
        formattedDate,
        fullDeliveryText
    };
}

module.exports = {
    UTM_SCHEDULE_TI7B,
    CANONICAL_SUBJECTS,
    SUBJECT_ALIASES,
    normalizeSubject,
    getDaysForSubject,
    calculateNextClassDueDate
};
