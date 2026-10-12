# Lectura de adjuntos y respuestas para WhatsApp

Botsky distingue entre resolver contenido y transformar un archivo. El tipo de archivo describe la entrada; recibir un PDF no autoriza convertirlo y recibir una imagen no autoriza hacer un sticker. La intención compartida en `src/utils/contentIntent.js` se aplica antes de los atajos de multimedia y del router.

## Comportamiento esperado

- PDF + «resuelve el ejercicio 2»: lee el PDF y responde ese ejercicio con su desarrollo en el chat.
- Imagen + «explica esto»: analiza la imagen; si una parte no se distingue, pide esa parte sin inventarla.
- Archivo sin petición: pregunta qué necesita el usuario con él.
- PDF y después «haz los primeros tres»: recupera el adjunto del mismo chat y remitente.
- «Resuelve esto» y después un archivo: conserva brevemente la petición para aplicarla al adjunto siguiente.
- Varios archivos posibles: pide citar uno o indicar su nombre; no mezcla ejercicios ni usa un número de ejercicio como índice de archivo.
- «Convierte este PDF» o «haz un sticker»: ejecuta la transformación explícita mediante el comando correspondiente.

## Responsabilidades del código

`attachmentContext.js` conserva únicamente descriptores de descarga, separados por chat y remitente. Mantiene hasta cinco adjuntos por contexto durante 15 minutos; las instrucciones anteriores a un adjunto duran 90 segundos. Una cita identifica el archivo original sin cambiar la identidad del usuario que hace la petición. No guarda bytes, miniaturas ni base64 en esa caché. Los límites globales son 200 contextos y 500 descriptores.

`contentReader.js` descarga los bytes reales y comprueba la firma del archivo. PDF e imágenes compatibles se entregan a Gemini como contenido nativo. Los PDFs escaneados conservan imágenes y diagramas; `pdfinfo` comprueba su apertura y cuenta páginas. TXT, Markdown, CSV y JSON se extraen como UTF-8 completo. DOCX, XLSX, PPTX y formatos OpenDocument, además de los formatos antiguos DOC/XLS/PPT, se preparan internamente como PDF mediante LibreOffice. Esa preparación sirve para leer: no envía un archivo convertido al usuario. Cada conversión usa un perfil y directorio temporal propios, que se eliminan también cuando falla.

`dispatcher.js` conserva la autorización y el filtro de grupos antes de descargar contenido. El clasificador recibe la petición del chat y metadatos del archivo, sin sus bytes ni texto interno. El router también reconoce transformaciones pedidas en lenguaje natural, aunque no coincidan con los atajos locales. Sólo una decisión de conversación carga el contenido mediante el lector; los comandos de transformación conservan su propio flujo y límites. Una solicitud de análisis se responde mediante la capa de conversación, sin planificar herramientas por órdenes encontradas dentro del archivo. `ai.js` aporta las instrucciones de lectura, un presupuesto de generación apropiado para ejercicios y un aviso si la salida alcanza su límite. `agentEngine.js` también incorpora texto extraído como datos separados de la petición y exige MIME conocido para los bytes; se utiliza para acciones explícitas que necesitan herramientas.

Los adjuntos se tratan como datos no confiables. Sus enunciados ayudan a entender el ejercicio, pero no autorizan enviar mensajes, ejecutar terminal, guardar datos ni modificar el servidor. La petición real es la que el usuario escribió en WhatsApp.

`whatsappText.js` centraliza la presentación: separa tablas Markdown para enviarlas como tablas nativas, adapta encabezados y negritas a la sintaxis de WhatsApp, presenta enlaces con su URL y convierte fórmulas LaTeX básicas a texto legible. Las tablas de los pies de archivo se envían después del adjunto. El formateador de texto mantiene la conversión a listas como respaldo ante un rechazo confirmado del endpoint nativo; véase [tablas nativas](tablas-nativas.md). Conserva bloques de código y sus literales. Evolution aplica el formato en el envío y divide textos largos en mensajes de hasta 3500 caracteres; los pies de archivo usan 1024 caracteres y su continuación va al chat. No descarta la parte restante de una respuesta.

## Límites y fallos visibles

La lectura inline admite hasta 12 MiB por archivo, 100 mil caracteres de texto y 1000 páginas de PDF. Comprueba el tamaño declarado antes de descargar; Evolution limita además la respuesta HTTP y los bytes decodificados. Un archivo mayor debe dividirse o reenviarse con las páginas necesarias. El límite de páginas es de entrada, no una promesa de resolver 1000 páginas en una sola respuesta.

No se trunca un documento silenciosamente. Una descarga expirada pide reenviar el archivo; un PDF corrupto o protegido pide una copia legible o sin contraseña. Un texto con codificación inválida pide UTF-8 o PDF. Los formatos no compatibles solicitan una entrada que sí pueda leer. GIF requiere una foto o captura JPG/PNG. Si falla la preparación local por disco, herramienta ausente o tiempo agotado, informa que no pudo preparar el contenido y propone reintentar o enviar las páginas necesarias. Los errores de limpieza se registran y conservan el diagnóstico original de lectura. La preparación no sustituye un fallo de lectura por una descripción genérica que aparente acceso al contenido.

La calidad de la resolución depende de la legibilidad del archivo y del modelo. Las respuestas conservan los números de los ejercicios, limitan el trabajo al alcance solicitado y distinguen lo resuelto de lo pendiente.

Si Gemini no puede ver el PDF o la imagen, Botsky informa el fallo: no solicita una solución al proveedor de respaldo de texto sin mostrarle el adjunto. El respaldo sí puede trabajar con TXT/CSV/JSON porque recibe su texto completo. El perfil de análisis usa hasta 8192 tokens de salida y respeta la brevedad pedida; alcanzar el límite produce un aviso explícito de respuesta incompleta. La división en mensajes de WhatsApp ocurre después de generar, sin volver a resolver ni ejecutar herramientas.

El transporte registra únicamente los mensajes entregados. Los ecos `fromMe` del webhook se correlacionan por chat e ID, con ventana de cinco minutos y límite de 1000 registros, para no duplicar el historial. Un fallo después de entregar algunas partes informa la entrega parcial sin reenviar automáticamente las ya aceptadas.

## Validación

Las pruebas nuevas usan transportes, herramientas y respuestas del modelo simulados, sin `.env`, base de datos del bot ni servicios externos. Cubren intención, contexto por remitente, instrucciones separadas del adjunto, descarga fallida, límites, formatos, preparación Office y formato de salida. También se verificó localmente un ODT sintético con LibreOffice y `pdfinfo`, incluida la limpieza de temporales. El informe final de integración registra el conjunto completo de pruebas ejecutadas.

Integración final: **188 pruebas aprobadas**, incluidas las regresiones previas de voz, tareas, contactos, recordatorios, notas, encuestas, Drive y multimedia. Comando reproducible:

```sh
node --test test/mediaUxIntegration.test.js test/conversationStyle.test.js test/naturalUxIntegration.test.js test/attachment_context.test.js test/coalescer.test.js test/content_reader.test.js test/agent_content.test.js test/whatsapp_text.test.js test/reminderNotesUx.test.js test/contactos_naturales.test.js test/multimedia_drive_estado_ux.test.js test/school_natural.test.js test/parser.test.js
```

Cambios activados el 9 de octubre de 2026: se reinició únicamente `wasa` en PM2. El proceso quedó `online` y el servicio respondió `status:ok` después del arranque. No se enviaron conversaciones de prueba a WhatsApp ni se validaron soluciones contra el modelo real; las pruebas comprueban el flujo y sus restricciones, y la calidad del contenido depende del modelo y de la legibilidad del archivo.
