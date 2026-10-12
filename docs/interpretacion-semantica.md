# Interpretación semántica de Botsky

Gemini interpreta todas las peticiones naturales, sin prefijo obligatorio. El router recibe la petición completa, la cita, el historial, un catálogo acotado de adjuntos del mismo chat y solicitante, y las sesiones de contactos, Drive, videos, PDF y juegos. Los archivos aportan identificadores, tipo, nombre y leyenda; sus claves de descifrado y bytes nunca entran al clasificador.

El resultado es un plan: acción registrada, argumentos canónicos, destino, modo de leyenda, duración y modo de voz, ID del archivo, necesidad de aclaración, extensión de respuesta y uso de herramientas. La ejecución conserva ese plan. El normalizador, la agrupación de mensajes y los comandos no reinterpretan palabras para cambiarlo.

Se retiraron los intérpretes `contentIntent`, `voiceRequest` y `mediaDeliveryRequest`, los atajos naturales de juegos/notas/selecciones, los desvíos por palabras de herramientas, la descarga automática de enlaces y la caché de intenciones. También se retiró la detección lingüística de preguntas/actividades del ciclo proactivo: el modelo evalúa el historial.

La ejecución mantiene validaciones técnicas de JSON, fechas ISO, rangos numéricos, tipos de archivo, URL, teléfonos y permisos. Los comandos explícitos conservan su gramática técnica. Eso no clasifica lenguaje natural.

Una selección de archivo debe coincidir con un ID del catálogo autorizado. Una selección de contacto es un índice validado en una sesión del mismo solicitante. Los envíos comparten una frontera de autorización y destino. No se descarga ni sintetiza contenido para otro chat antes de verificar permisos. No se repite automáticamente un envío cuya entrega pudo ocurrir.

Si el modelo omite campos obligatorios de un envío, recibe una única solicitud de reparación de esquema. Si no hay un plan válido, se usa el respaldo semántico disponible o se pide reintentar. No hay respaldo basado en regex. Si la intención es ambigua, se pregunta; el encargo pendiente dura 90 segundos y los adjuntos 15 minutos.

Las expresiones humanas de fecha y páginas se normalizan por el modelo. Los ejecutores aceptan fecha ISO con zona horaria, minutos numéricos y rangos canónicos, sin inventar plazos. La voz distingue composición de lectura literal y su duración se mide sobre el audio sintetizado.

## Validación

231 pruebas aisladas del router, dispatcher, adjuntos, comandos, contactos, audio, lectores y formato de WhatsApp. Incluyen metadatos binarios reales de Evolution, autorización antes de descarga/TTS, citas de otro chat, ambigüedad, parámetros adversariales, reparación acotada y fallo de proveedores. Los fixtures anteriores que suponían interpretación con regex se migraron al contrato semántico.

10 casos evaluados con Gemini real, sin ejecutar herramientas ni enviar mensajes: petición de la captura, paráfrasis de envío, audio de medio minuto, lectura literal con un destinatario dentro del texto, referencia sin palabras clave, selección natural de contacto, negación, pregunta sobre nuclear, recordatorio de tres cuartos de hora y conversación grupal ajena. Los 10 cumplieron el contrato esperado. Esta muestra no garantiza comprender cualquier frase; las validaciones y aclaraciones siguen siendo necesarias.

Se revisó la sintaxis de los 77 archivos JavaScript de producción.
