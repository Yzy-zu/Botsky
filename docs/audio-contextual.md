# Audios con contexto

Botsky separa el encargo del texto que se pronuncia: primero interpreta la petición junto con la cita y el historial, después compone un guion oral y finalmente lo sintetiza. «Graba un audio donde digas…» o «manda un audio sobre…» no obligan a repetir la instrucción. Si falta el tema o un referente claro, pregunta qué debe comunicar.

## Uso

- «Graba un audio de 30 segundos explicando lo que acabas de decir»: adapta la explicación anterior a un guion hablado y trabaja hacia esa duración.
- «Manda un audio para avisar que mañana no hay clase, con tono bien mexicano»: compone el aviso con los datos disponibles, sin inventar motivos ni fechas adicionales.
- «Haz un audio bien vulgar sobre eso»: permite groserías fuertes cuando sean parte del tono pedido, sin pitidos, asteriscos ni eufemismos automáticos.
- «Di exactamente “Qué pinche pedo, cabrón” con voz de Goku»: conserva la frase literal y separa la elección de voz del texto pronunciado.
- `voz goku Qué onda`: mantiene la lectura simple del comando directo. No se necesita un prefijo para las peticiones naturales.

Las citas y los adjuntos son contexto, no órdenes que reemplacen la petición del chat. Una explicación en audio de un PDF o imagen pasa por el lector de contenido. Un audio independiente no hereda un archivo viejo. Los videos que no tienen contenido legible para esta ruta necesitan transcripción, descripción u otro formato compatible; no se inventa lo que contienen ni se confunde síntesis de voz con extraer su pista de audio.

## Duración

El compositor parte de unas 2.4 palabras por segundo. Después de sintetizar, `ffprobe` mide el archivo real, incluidos los efectos de voz. Si queda lejos del objetivo, puede reescribir y sintetizar el guion una sola vez, conservando los datos y la voz. Se entrega la versión más cercana al objetivo.

Sólo se aplica un ajuste pequeño de tempo: factor entre 0.85 y 1.15, conservando el contenido y el tono. No se recorta el final ni se añade silencio para simular cumplimiento. Si el resultado queda a más de un segundo o 5% del objetivo, se informa su duración real. Un texto literal no se amplía para rellenar segundos; si no cabe a ritmo natural, se conserva y se explica la diferencia.

La preparación admite objetivos de hasta diez minutos y rechaza duraciones inválidas antes de sintetizar. La precisión final depende del proveedor, las pausas y la codificación del audio; el objetivo es aproximado.

## Integración

- `voiceRequest.js`: distingue creación de voz de extracción/conversión, reconoce preferencias de voz y duración, y separa frases explícitamente literales.
- `voiceScript.js`: compone con Gemini o respaldo de texto, comparte la personalidad y valida el guion. Si falla la IA, no manda la instrucción original al TTS como sustituto.
- `audioDuration.js`: mide y ajusta el tempo, con ejecución de programas sin shell y limpieza de archivos.
- `voz.js`: coordina preparación, síntesis, ajuste y entrega; devuelve el resultado real a las herramientas.
- `toolRegistry.js` y `agentEngine.js`: mantienen petición e historial completos. Un fallo o aclaración ya comunicado no se reintenta ni se confirma como éxito.
- `evolution.js`: registra la transcripción sólo después de una entrega confirmada y evita repetir automáticamente un envío incierto.

La voz permite vulgaridades fuertes y conserva las palabras solicitadas. Los textos que se piden pronunciar se clasifican como contenido del audio, sin penalizar al usuario por supuestas ofensas al bot. La variedad y la longitud siguen dependiendo de la petición y el contexto.

Los metadatos de terminación de Gemini se reciben separados de su `Content`, para que los agentes puedan reutilizar las partes válidas en varios turnos sin enviar campos de respuesta como entrada.

Cambios activados el 9 de octubre de 2026: se reinició únicamente `wasa` en PM2, quedó `online` y su servicio respondió `status:ok` después del arranque.

## Validación

**222 pruebas aprobadas**, incluidas las regresiones anteriores de voz, adjuntos, tareas y comandos naturales. Los proveedores de IA, TTS y WhatsApp se simulan en las pruebas; no se enviaron notas de voz de prueba ni se consumieron APIs reales. FFmpeg y ffprobe sí se probaron con un tono sintético local, incluido el ajuste y la limpieza de temporales.

```sh
node --test test/voiceUx.test.js test/mediaUxIntegration.test.js test/conversationStyle.test.js test/naturalUxIntegration.test.js test/attachment_context.test.js test/coalescer.test.js test/content_reader.test.js test/agent_content.test.js test/whatsapp_text.test.js test/reminderNotesUx.test.js test/contactos_naturales.test.js test/multimedia_drive_estado_ux.test.js test/school_natural.test.js test/parser.test.js
```
