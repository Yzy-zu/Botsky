'use strict';

const { sendText } = require('../services/evolution');
const logger = require('../services/logger');

const RESPUESTAS = {
    saludo: [
        (name) => `¡Qué onda${name ? ', ' + name : ''}! ¿Qué rollo? Pásame un link, archivo o escribe */@ ayuda* para ver qué puedo hacer 😎`,
        (name) => `¡Epa${name ? ' ' + name : ''}! Aquí andamos al 100 y al tiro. ¿Qué vamos a bajar, convertir o recortar hoy? 🚀`,
        (name) => `¡Wena wena${name ? ', ' + name : ''}! Todo listo por acá. ¿En qué te puedo hacer el paro hoy? 🤖⚡`,
        (name) => `¡Hola${name ? ' ' + name : ''}! Todo en orden por los servidores. Mándame tu comando o enlace al tiro 🤙`,
        (name) => `¡Quiubole${name ? ' ' + name : ''}! ¿Qué hay pa hoy? Pásame video, audio o documento y lo chambeamos 🔥`
    ],
    agradecimiento: [
        (name) => `¡A huevo, de nada${name ? ' ' + name : ''}! Para eso estamos pa, cuando ocupes otra cosa aquí ando 🤙`,
        (name) => `¡De nada mi pa! Quedó al tiro. Avísame si necesitas algo más 🔥`,
        (name) => `¡Un placer${name ? ', ' + name : ''}! Aquí andamos 24/7 echando la mano al 100% 😉⚡`,
        (name) => `¡No hay de qué${name ? ' ' + name : ''}! Ya sabes que aquí Botsky no se raja 🤖💪`,
        (name) => `¡Joya! Para servirte${name ? ', ' + name : ''}, tú nomás pide y aquí se hace en fa 🚀`
    ],
    despedida: [
        (name) => `¡Fuga! Ahí nos vidrios${name ? ' ' + name : ''}, cuídate un chingo 🤙`,
        (name) => `¡Nos vemos mi pa! Que descanses y tengas un día perrón ✨`,
        (name) => `¡Chao${name ? ', ' + name : ''}! Cualquier cosa que ocupes me echas un grito por acá ⚡`,
        (name) => `¡Cámara${name ? ' ' + name : ''}! Ahí nos guachamos al rato ✌️`
    ],
    identidad: [
        (name) => `¡Qué onda! Soy *Botsky* 🤖⚡, tu asistente todoterreno en WhatsApp.\n\nTe descargo videos de TikTok/Reels/YT en Full HD, bajo rolitas de Spotify, hago stickers recortados o animados, uno y convierto PDFs, leo texto de fotos (OCR), modulo voces y controlo el server de Minecraft.\n\nEscribe */@ ayuda* para ver la lista completa.`,
        (name) => `Me llamo *Botsky* 😎. Soy un bot autónomo ultra optimizado con Inteligencia Artificial NLP local para hacerte la vida fácil en WhatsApp. Escribe */@ ayuda* para conocer todos mis poderes.`
    ],
    estado: [
        (name) => `¡Al 100 y pasadito${name ? ' ' + name : ''}! Todo el sistema corriendo fino y listo para chambear. ¿Tú qué tal? 😎`,
        (name) => `¡Al tiro mi pa! Memoria fresca, cola de procesos en verde y servidores listos. ¿Qué se arma hoy? 🚀`,
        (name) => `¡Vivito y coleando! Listo para cualquier tarea que le avientes al bot. ¿Qué ocupas hoy${name ? ', ' + name : ''}? 🤖`
    ],
    reaccion: [
        () => `Jajaja a huevo 😂🔥`,
        () => `Jajaja te mamaste xd 🤙`,
        () => `Jajaja al chile sí estuvo bueno eso 😂`,
        () => `Jajaja no manches xd 🤣`
    ]
};

async function handleSocial(intent, context) {
    const { from, messageData } = context;
    const name = messageData?.pushName || '';
    const cleanName = (name && name !== 'Usuario') ? name : '';

    const pool = RESPUESTAS[intent] || RESPUESTAS.saludo;
    const fn = pool[Math.floor(Math.random() * pool.length)];
    const text = fn(cleanName);

    logger.info(`[SOCIAL] Respondiendo a '${intent}' para ${from}: "${text.slice(0, 30)}..."`);
    await sendText(from, text);
}

module.exports = {
    handleSocial,
    SOCIAL_INTENTS: ['saludo', 'agradecimiento', 'despedida', 'identidad', 'estado', 'reaccion']
};
