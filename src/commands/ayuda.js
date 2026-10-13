'use strict';

const { sendText } = require('../services/evolution');

const HELP_TEXT = `*¿Qué hacemos, compa?*
Puedes pedirme las cosas como las dirías en el chat.

*Videos y música*
“Botsky, baja este video” + enlace.
“Botsky, busca una canción de [artista]”.

*Fotos, audios y archivos*
“Botsky, haz un sticker con esta foto”.
“Botsky, transcribe este audio”.
“Botsky, lee el texto de esta imagen”.
También convierto archivos, comprimo PDFs y junto imágenes en un PDF.

*Notas y pendientes*
“Botsky, guarda esto: mañana no hay clases”.
“Botsky, recuérdame en 20 minutos sacar la ropa”.
“Botsky, ¿qué tareas tengo pendientes?”.

*En el grupo*
Encuestas, niveles y el lore de la banda.
Para jugar: “Botsky, mi daily”, “Botsky, 21 100” o “Botsky, ruleta 100”.

¿Quieres los pasos de algo? Dime “Botsky, ayuda con notas”, por ejemplo.
En grupos, llámame por mi nombre para que sepa que me hablas.`.trim();

const COMMAND_HELP = {
    descargar: `*descargar y auto-descarga de redes*
> descarga video o audio de redes sociales o por búsqueda
> *Auto-descarga:* Si compartes un enlace directo de TikTok, Instagram Reel, YouTube Shorts, Twitter/X o Facebook, Botsky lo descargará y enviará automáticamente.

\`descargar [url o nombre]\`
\`descargar -f mp3 [canción o enlace]\`
\`descargar -q alta [url o nombre]\``,

    recordar: `*Recordatorios*
Dime qué recordar y cuándo; te aviso en este chat.

\`recordar en 15m sacar la ropa\`
\`recordar -t "mañana a las 8am" --mensaje "tomar pastilla"\`
\`recordar lista\` para consultar recordatorios activos
\`recordar cancelar [id]\` para borrar uno

_O pídelo en lenguaje natural:_
"Botsky recuérdame en 20 minutos llamar a mamá"`,

    transcribir: `*transcribir*
> convierte audio a texto

\`transcribir\` con audio adjunto
\`transcribir [url]\``,

    sticker: `*sticker*
> crea stickers de fotos o videos

\`sticker\` con imagen adjunta
\`sticker -r\` recortado sin fondo
\`sticker -a\` animado`,

    convertir: `*convertir*
> cambia el formato de audios videos e imagenes

formatos: \`mp3\` \`mp4\` \`gif\` \`wav\` \`ogg\`
\`convertir -f mp3\` con adjunto
\`convertir -f mp4 -q alta\``,

    doc: `*documentos e imagenes a pdf*
> convierte archivos entre formatos o crea un PDF a partir de múltiples imágenes

*Convertir documento:*
\`doc -f pdf\` con adjunto (ej. Word a PDF)

*Crear PDF con múltiples imágenes:*
1. \`pdf\` (inicia la cola) o envía la primera imagen con \`pdf\`
2. Envía las demás imágenes de forma normal (se detectan solas)
3. \`pdf terminar\` para recibir tu PDF
4. \`pdf cancelar\` para cancelar la cola`,

    pdf2img: `*pdf2img*
> extrae imagenes de un pdf

\`pdf2img\` con pdf adjunto
\`pdf2img --zip\` en un zip`,

    recortar: `*recortar páginas de un pdf*
> extrae un rango o páginas específicas de un archivo PDF a un nuevo PDF

*ejemplos:*
\`recortar 1-5\` (páginas 1 a 5)
\`recortar 68-\` (desde la página 68 hasta el final)
\`recortar 2,4,6\` (páginas específicas)
\`recortar 10\` (solo la página 10)`,

    unir: `*unir pdfs*
> une varios pdf en uno

1. \`unir\` por cada pdf
2. \`unir terminar\` para finalizar`,

    lore: `*lore y canon (IA)*
> registra momentos canonicos y narra la historia epica con IA

\`canon @usuario [evento]\` registra un momento
\`lore @usuario\` ficha rapida de personaje
\`lore historia @usuario\` cronica epica redactada por IA
\`lores\` lista de personajes con lore`,

    nota: `*tablón de notas compartidas*
> guarda apuntes, recordatorios y notas visibles para todo el grupo

\`nota guardar [texto]\` guarda una nota
\`nota lista\` ver todas las notas del grupo
\`nota buscar [término]\` buscar notas por palabra
\`nota borrar [id]\` eliminar una nota

_O en lenguaje natural:_
"guarda esto: comprar las chelas"
"anota que mañana no hay clases"`,

    notas: `*tablón de notas compartidas*
> guarda apuntes, recordatorios y notas visibles para todo el grupo

\`nota guardar [texto]\` guarda una nota
\`nota lista\` ver todas las notas del grupo
\`nota buscar [término]\` buscar notas por palabra
\`nota borrar [id]\` eliminar una nota

_O en lenguaje natural:_
"guarda esto: comprar las chelas"
"anota que mañana no hay clases"`,

    ruleta: `*ruleta rusa multijugador*
> apuesta tu XP en una ruleta rusa contra otros miembros del grupo

\`ruleta [apuesta]\` inicia una partida (ej: ruleta 100)
> *Para unirte:* No necesitas comandos, solo escribe en el chat:
"yo juego", "yo le entro" o "yo también"
> *Reglas:*
• Tambor de 6 recámaras (1 bala).
• Si cae un usuario normal: expulsado 20 minutos (se le envía link privado).
• Si cae un admin: pierde su rango de administrador.
• Los sobrevivientes se reparten todo el bote acumulado de XP.`,

    nuclear: `*bomba nuclear kamikaze*
> purga masiva de miembros en el grupo a cambio de 5,000 XP

\`nuclear\` activa el protocolo de aniquilación
> *Reglas de Detonación:*
• Costo: 5,000 XP exactos.
• Botsky debe ser Administrador del grupo.
• Los demás administradores sobreviven en el búnker.
• El atacante también es expulsado (sacrificio kamikaze).
• Pausa de 4 segundos entre cada expulsión para proteger el bot contra baneos.`,

    daily: `*ruleta de la suerte diaria*
> gira la ruleta cada 24 horas para ganar recompensas de XP y acumular rachas consecutivas

\`daily\` tira la ruleta de hoy
> *Reglas:*
• Puedes tirar una vez cada 24 horas.
• Cada día de racha suma 20 XP de bono, hasta 100 XP extra si sale premio.
• Si dejas pasar más de 48 horas sin tirar, la racha se reinicia.
• Premios desde casillas menores hasta Jackpots legendarios de 1,000 XP.`,

    pack: `*mercado negro / packs por XP*
> compra un pack de 3 a 5 fotos con visualización única entregado directamente a tu chat privado

\`!pack [categoría opcional]\`
\`!comprar pack [categoría]\`
> *Reglas:*
• Costo estándar: 150 XP deducidos de tu cuenta.
• Entrega discreta en chat privado con modo View Once (una sola vista).
• Se puede pedir en grupos o en privado directo con Botsky.
• O en lenguaje natural: "Botsky véndeme un pack", "pásame un pack".`
};

async function handleAyuda(parsed = {}, from) {
    if (typeof from !== 'string' || !from.trim()) return;
    parsed = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? { ...parsed } : {};
    parsed.args = Array.isArray(parsed.args) ? parsed.args : [];
    parsed.flags = parsed.flags && typeof parsed.flags === 'object' && !Array.isArray(parsed.flags) ? parsed.flags : {};
    if (parsed.args.some(arg => typeof arg !== 'string' && typeof arg !== 'number')) return;
    parsed.args = parsed.args.map(arg => typeof arg === 'number' ? String(arg) : arg);
    if (!from) return;
    const safeParsed = parsed || {};
    const args = Array.isArray(safeParsed.args) ? safeParsed.args : [];
    const topic = args[0]?.toLowerCase();

    if (topic && COMMAND_HELP[topic]) {
        await sendText(from, COMMAND_HELP[topic]);
    } else if (topic) {
        await sendText(from, `No tengo una guía para \`${topic}\`\nPuedes pedir ayuda con: \`descargar\` \`recordar\` \`nota\` \`ruleta\` \`daily\` \`pack\` \`nuclear\` \`transcribir\` \`sticker\` \`convertir\` \`doc\` \`recortar\` \`pdf2img\` \`unir\` \`lore\``);
    } else {
        await sendText(from, HELP_TEXT);
    }
}

module.exports = { handleAyuda };
