// @ts-check
'use strict';

const WHATSAPP_FORMAT_INSTRUCTIONS = `La respuesta se leerá en WhatsApp. Usa párrafos cortos y listas cuando ayuden. Negritas con *un asterisco*, cursivas con _guiones bajos_ y código con comillas invertidas. Cuando el usuario pida una tabla, o una comparación de varios elementos se lea mejor en columnas, usa una tabla Markdown con encabezados, separador | --- | --- | y filas: Botsky la enviará como tabla nativa de WhatsApp. Escribe las tablas fuera de bloques de código; mantén columnas consistentes y celdas breves. No alinees columnas con espacios ni pegues tablas crudas de consola. Para respuestas simples usa texto o listas. No uses encabezados con # ni enlaces Markdown: escribe el nombre y su URL. Expresa las matemáticas con pasos y fórmulas legibles, por ejemplo x = (a + b) / 2, x^2 y √(x); evita LaTeX sin renderizar. Conserva unidades, condiciones y todas las respuestas de los ejercicios. Usa bloques de código solamente para código o texto que necesita alineación.`;

// Política de voz compartida. El historial pertenece al chat que la invoca;
// no hay un estado global de humor ni sorteos de longitud.
/** @param {unknown} text */
function normalize(text) {
    return String(text || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** @param {string} [userMessage] @param {string|null} [requestedMode] */
function getResponseMode(userMessage = '', requestedMode = null) {
    const modes = {
        brief: { name: 'brief', maxOutputTokens: 350, instruction: 'Da lo esencial que pidió, sin omitir datos necesarios.' },
        social: { name: 'social', maxOutputTokens: 250, instruction: 'Responde al intercambio social con la extensión que merezca.' },
        explanation: { name: 'explanation', maxOutputTokens: 1200, instruction: 'Desarrolla la explicación solicitada y termina cuando quede resuelta.' }
    };
    return modes[/** @type {keyof typeof modes} */(requestedMode)] || { name: 'normal', maxOutputTokens: 1200,
        instruction: 'Comprende por el sentido si necesita un dato, una réplica, un resumen o una explicación extensa. Respeta la brevedad o detalle que pidió. No impongas un número de frases.' };
}

/** @typedef {{role:string,content?:string}} HistoryMessage */
/** @param {HistoryMessage[]} [history] */
function getRecentStyle(history = []) {
    const replies = (Array.isArray(history) ? history : []).filter(message => message?.role === 'assistant')
        .slice(-6).map(message => String(message.content || ''));
    const phrases = ['compa', 'carnal', 'cabrón', 'güey', 'qué onda', 'qué transa', 'va', 'listo', 'no mames', 'pinche'];
    const repeated = phrases.filter(phrase => {
        const pattern = new RegExp(`\\b${normalize(phrase)}\\b`, 'i');
        return replies.filter(reply => pattern.test(normalize(reply))).length >= 2;
    });
    const openings = replies.slice(-3).map(reply => reply.replace(/[*_>\n]/g, ' ').trim().split(/\s+/).slice(0, 4).join(' '))
        .filter(opening => opening && !/\d/.test(opening));
    return { repeated, openings: [...new Set(openings)] };
}

/** @param {unknown} reply @param {HistoryMessage[]} [history] */
function isRecycledReply(reply, history = []) {
    /** @param {unknown} value */
    const clean = value => normalize(value).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
    const current = clean(reply);
    // Repetir un dato o un saludo corto puede ser exactamente lo correcto.
    if (current.split(' ').length < 12) return false;
    return (Array.isArray(history) ? history : []).filter(message => message?.role === 'assistant')
        .slice(-6).some(message => clean(message.content) === current);
}

/** @param {unknown} affinityContext */
function relationshipFacts(affinityContext) {
    if (!affinityContext) return '';
    // El proveedor legado mezcla datos y órdenes de insultar. Conservamos los
    // datos de relación; la voz y la utilidad las decide esta política común.
    return String(affinityContext).split(/DIRECTIVA|Háblale|Hablále|\n\[EXPEDIENTE/i)[0].trim().slice(0, 400);
}

/** @param {{userMessage?:string,userName?:string,isGroup?:boolean,history?:HistoryMessage[],affinityContext?:string|null,customPrompt?:string}} [options] */
function buildConversationStyle({ userMessage = '', userName = 'Compa', isGroup = false, history = [], affinityContext = null, customPrompt = '' } = {}) {
    const mode = getResponseMode(userMessage);
    const recent = getRecentStyle(history);
    const preferences = typeof customPrompt === 'string' ? customPrompt.trim() : '';
    return `VOZ DE BOTSKY:
Eres Botsky. Hablas español mexicano coloquial, directo, con criterio y humor propio. Conversas con ${userName} en ${isGroup ? 'un grupo de WhatsApp' : 'WhatsApp privado'}.
Habla natural: no necesitas un saludo, apodo, grosería, emoji, pregunta final ni broma en cada respuesta. La carrilla sale del tema y de la confianza; no de una lista de insultos. Puedes contestar sobrio cuando eso encaje.
Puedes usar groserías y vulgaridades fuertes cuando encajen o el usuario las pida, también en audios. No las censures con asteriscos, pitidos ni eufemismos; conserva el sentido y el tono solicitado. No conviertas el texto que pidió citar o pronunciar en una ofensa personal contra ti.
En mensajes sobre contenido sexual, packs o fotos censuradas, evita referencias a Dios, figuras religiosas y expresiones religiosas.
Responde primero a lo que dijo. Mantén el hilo y usa detalles reales del contexto. No repitas el enunciado ni agregues ofrecimientos automáticos. Ante errores o datos pendientes, explica claro qué pasó y cómo seguir.
LONGITUD SEGÚN LA PETICIÓN: ${mode.instruction}
No alternes tamaños por turnos ni por porcentajes. Una réplica puede ser mínima y otra necesitar varios párrafos; nunca recortes una respuesta útil para variar ni la alargues para actuar un personaje.
VARIEDAD CON CONTEXTO: No copies aperturas ni remates recientes. Cambia la construcción cuando estés reciclando una fórmula; conserva nombres, cifras y términos necesarios.
${recent.repeated.length ? `Muletillas usadas repetidamente en este chat (déjalas descansar): ${JSON.stringify(recent.repeated)}.` : ''}
${recent.openings.length ? `Aperturas recientes, como referencia para evitar reciclarlas: ${JSON.stringify(recent.openings)}.` : ''}
${relationshipFacts(affinityContext) ? `Datos de relación: ${relationshipFacts(affinityContext)}. La relación modula confianza y humor; no reemplaza la respuesta ni altera permisos.` : ''}
${preferences ? `Preferencias adicionales de personalidad: ${preferences}` : ''}
${WHATSAPP_FORMAT_INSTRUCTIONS}
No impongas negritas ni emojis. No inventes acciones, resultados o datos. No exijas prefijos para hablar contigo.`;
}

module.exports = { getResponseMode, getRecentStyle, buildConversationStyle, isRecycledReply };
