'use strict';

const { sendText } = require('../services/evolution');

const HELP_TEXT = `*comandos disponibles*
> usa /@ al inicio para invocar al bot

*descargar*
\`/@ descargar [url]\`
\`/@ bajar audio [url]\`

*transcribir*
\`/@ transcribir\` con audio adjunto

*sticker*
\`/@ sticker\` con imagen adjunta
\`/@ sticker -r\` recortado

*convertir*
\`/@ convertir -f mp3\` con adjunto

*spotify*
\`/@ spotify [url]\`

*documentos e imagenes a pdf*
\`/@ pdf\` para iniciar cola de imágenes
\`/@ pdf terminar\` para generar el PDF
\`/@ doc -f pdf\` con adjunto (ej. word)

*comprimir pdf*
\`/@ comprimir\` con pdf adjunto

*pdf a imagenes*
\`/@ pdf2img\` con pdf adjunto

*unir pdfs*
\`/@ unir\` por cada pdf
\`/@ unir terminar\` para finalizar

*efectos de voz*
\`/@ efecto ardilla\`
\`/@ efecto lento\`
\`/@ efecto grave\`

*codigo qr*
\`/@ qr [texto]\` para crear
\`/@ qr\` respondiendo imagen para leer

*leer imagen*
\`/@ leer\` con imagen adjunta

*moderacion*
\`/@ ban @usuario\`
\`/@ promote @usuario\`
\`/@ nivel\`

*lore y canon (IA)*
\`/@canon @usuario [evento]\` registra un momento
\`/@lore @usuario\` ficha del personaje
\`/@lore historia @usuario\` cronica por IA
\`/@lores\` lista de miembros con lore

> escribe \`/@ ayuda [tema]\` para mas info`.trim();

const COMMAND_HELP = {
    descargar: `*descargar*
> descarga video o audio de redes sociales o por búsqueda

\`/@ descargar [url o nombre]\`
\`/@ descargar -f mp3 [canción o enlace]\`
\`/@ descargar -q alta [url o nombre]\``,

    transcribir: `*transcribir*
> convierte audio a texto

\`/@ transcribir\` con audio adjunto
\`/@ transcribir [url]\``,

    sticker: `*sticker*
> crea stickers de fotos o videos

\`/@ sticker\` con imagen adjunta
\`/@ sticker -r\` recortado sin fondo
\`/@ sticker -a\` animado`,

    convertir: `*convertir*
> cambia el formato de audios videos e imagenes

formatos: \`mp3\` \`mp4\` \`gif\` \`wav\` \`ogg\`
\`/@ convertir -f mp3\` con adjunto
\`/@ convertir -f mp4 -q alta\``,

    doc: `*documentos e imagenes a pdf*
> convierte archivos entre formatos o crea un PDF a partir de múltiples imágenes

*Convertir documento:*
\`/@ doc -f pdf\` con adjunto (ej. Word a PDF)

*Crear PDF con múltiples imágenes:*
1. \`/@ pdf\` (inicia la cola) o envía la primera imagen con \`/@ pdf\`
2. Envía las demás imágenes de forma normal (se detectan solas)
3. \`/@ pdf terminar\` para recibir tu PDF
4. \`/@ pdf cancelar\` para cancelar la cola`,

    pdf2img: `*pdf2img*
> extrae imagenes de un pdf

\`/@ pdf2img\` con pdf adjunto
\`/@ pdf2img --zip\` en un zip`,

    unir: `*unir pdfs*
> une varios pdf en uno

1. \`/@ unir\` por cada pdf
2. \`/@ unir terminar\` para finalizar`,

    lore: `*lore y canon (IA)*
> registra momentos canonicos y narra la historia epica con IA

\`/@canon @usuario [evento]\` registra un momento
\`/@lore @usuario\` ficha rapida de personaje
\`/@lore historia @usuario\` cronica epica redactada por IA
\`/@lores\` lista de personajes con lore`
};

async function handleAyuda({ args }, from) {
    const topic = args[0]?.toLowerCase();

    if (topic && COMMAND_HELP[topic]) {
        await sendText(from, COMMAND_HELP[topic]);
    } else if (topic) {
        await sendText(from, `> no se encontro el tema \`${topic}\`\ntemas: \`descargar\` \`transcribir\` \`sticker\` \`convertir\` \`doc\` \`pdf2img\` \`unir\``);
    } else {
        await sendText(from, HELP_TEXT);
    }
}

module.exports = { handleAyuda };
