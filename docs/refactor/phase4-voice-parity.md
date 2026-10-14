# Paridad de voz — Fase 4

Estado: implementación local en revisión; voz sigue fuera del canario productivo. Este registro compara `voz`, `tts`, `voiceScript`, `elevenlabs` y `audioDuration` legacy con sus puertos v2. No acredita una entrega real.

Ya están representados y probados:

- Perfiles, alias regionales y efectos, nombres profesionales de ElevenLabs y fallback de síntesis. VoiceLab mantiene una caché acotada de diez minutos por runtime. La construcción del proveedor no hace llamadas HTTP.
- Texto literal de hasta 20,000 caracteres y duración solicitada de hasta 600 segundos. En modo literal se usa el texto explícito y, si falta, el citado; no se reescribe ni se consulta la IA para interpretar ese texto.
- Composición con historial, cita, nombre del usuario y contexto de imagen o documento. Las imágenes se validan y acotan a 12 MiB; el lector de documentos conserva su límite de 12 MiB y el contexto del guion se acota a 20,000 caracteres. El contenido es dato sin permisos. Video/audio sin contenido legible producen una aclaración.
- Estilo compartido de Botsky inyectado desde la composición, sin dependencias cruzadas entre adaptadores. Datos personalizados de persona y afinidad siguen pendientes de la unificación de Fase 5.
- Medición con ffprobe y ajuste moderado con FFmpeg. En composición, una diferencia mayor que un segundo o el 5% permite una sola revisión del guion; se conserva el audio más cercano. El texto literal no se revisa. Si persiste la diferencia se informa brevemente.
- Metadatos de transcripción y duración enviados a Messenger. Solo la confirmación del proveedor permite escribir la descripción de voz en historial y guardar la identidad reutilizable de media; no se guarda una ruta local como prueba de entrega.
- Limpieza del audio descartado y de resultados que fallan o se cancelan. El resultado seleccionado permanece disponible hasta que Composer termina la entrega. Los errores tipados conservan su categoría y no causan un reenvío.

Pruebas: `phase4-sticker-voice.test.js`, `voice.test.js`, `elevenLabs.test.js`, `voiceContextComposition.test.js`, `elevenLabsRuntimeComposition.test.js`, `media-memory.test.js`, `runtimeComposition.test.js` y casos TR-0726–0729. Son contratos/fakes y archivos sintéticos, sin proveedores ni destinatarios reales.

Falta preservar la entrega a otros chats: legacy permite chat actual, grupo principal o contacto, valida administración, resuelve ambigüedad y confirma el envío externo en el chat solicitante. V2 responde en el chat actual. Ese límite pertenece a una capa compartida de entrega y resolución de contactos, que también requiere la ola B; no debe introducirse en el adaptador de síntesis. El selector conserva esos recorridos en legacy hasta implementar y probar esa autorización y confirmación.

También faltan datos personalizados de persona/afinidad, la traza completa de los casos correspondientes y pruebas reales del recorrido permitido. Los contratos automáticos y el arranque del canario QR no cierran esos pendientes ni Gate 4 de voz.
