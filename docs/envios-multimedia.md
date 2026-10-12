# Audios y archivos destinados a otros chats

En los logs revisados, “Graba un audio y mandáselo al grupo también…” creó un audio, pero lo envió al privado que recibió la petición. La siguiente petición, “Mandalo el audio al grupo”, citaba ese audio y volvió a sintetizarlo en el privado. El envío de recados de texto sí resolvía correctamente el grupo.

Ahora se separan tres datos: la instrucción, el archivo o guion que se envía y el destinatario. La resolución de contactos y las aclaraciones usan el mismo servicio de recados. Los permisos se revisan antes de descargar o sintetizar contenido destinado a otros chats.

- “Graba un audio y mándaselo al grupo diciendo buenos días”: compone el guion con el contexto, genera la voz y entrega al grupo. Confirma en el chat de la petición.
- “Manda este audio al grupo”, citando el audio: descarga y envía el original, sin Gemini ni TTS.
- “Manda esta foto al grupo”, adjuntándola o citándola: conserva el archivo. La instrucción de envío no se publica como caption; un texto explícito entre comillas puede ser el caption.
- “Mándasela a Fer”: resuelve el adjunto y el contacto; si hay varios contactos, conserva el archivo o encargo hasta elegir.
- “Mándame esta foto aquí”: envía al chat actual.

El router, la normalización y las herramientas comparten la intención de reenvío. Las frases citadas o el contenido hablado no determinan otro destinatario. La metadata de un audio entregado permite referirse a él después, aunque se haya borrado el temporal de TTS. Se preservan el identificador, el chat original y la identidad de quién solicitó el envío.

“El grupo” conserva el grupo principal que ya usaban los recados. Un nombre de grupo desconocido no se sustituye silenciosamente por ese grupo. Si falta el archivo, expiró o no se confirma la entrega, Botsky lo dice sin informar un éxito ficticio. Los contactos ambiguos conservan el encargo durante 10 minutos; los adjuntos recientes, 15 minutos. La descarga para reenviar tiene un límite de 64 MiB y los temporales se borran al terminar.

Validación: 243 pruebas aisladas aprobadas, incluidas regresiones de audio contextual, adjuntos, formatos de WhatsApp y comandos naturales. IA, TTS y transporte de WhatsApp simulados; no se enviaron mensajes de prueba al grupo ni a contactos reales. FFmpeg y ffprobe se comprueban con audio sintético local.

Activado el 9 de octubre de 2026: se reinició únicamente `wasa` en PM2. Quedó `online`; el servicio respondió `status:ok` tras el arranque.


## Corrección comprobada con el archivo real

Los intentos de la captura fallaron antes del envío. Evolution registró `Cannot derive from empty media key`: la normalización conservaba las claves cuando eran cadenas, pero eliminaba las que llegaban como objetos numéricos, arrays o buffers serializados. No había evidencia de expiración; el archivo original seguía disponible.

La metadata ahora conserva las claves y hashes de 32 bytes, copia los valores binarios y admite los enteros largos de tamaño/fecha. Mantiene el descarte de miniaturas y contenido pesado. Una cita sin clave de descifrado usa la consulta por identificador para que Evolution recupere el original. Un error genérico HTTP 400 ya no se presenta como prueba de expiración.

“Envía esta foto al grupo y diles que…” separa el destinatario y el archivo del recado; redacta el recado con el mismo servicio de mensajes y lo coloca como caption. El contenido del recado no cambia el tipo del archivo ni su destinatario. Los textos explícitos entre comillas se conservan literalmente.

Validación de esta corrección: **251 pruebas aprobadas**. Se consultó en modo lectura la foto original del intento fallido y se recuperó con el normalizador corregido, usando claves con la representación binaria del webhook. También se comprobó una cita incompleta mediante consulta por identificador. Ambas descargas devolvieron los mismos 113 348 bytes, MIME `image/jpeg`; no se enviaron mensajes a grupos o contactos durante el diagnóstico. Los envíos, la generación de captions y TTS se probaron con simulaciones.
