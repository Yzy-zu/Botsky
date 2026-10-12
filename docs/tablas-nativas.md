# Tablas nativas en WhatsApp

Botsky detecta las tablas Markdown de las respuestas y las envía con el formato C confirmado por el usuario en WhatsApp. No utiliza `unifiedResponse` ni los metadatos de dispositivo de la prueba D, que mostró una advertencia de seguridad.

Las instrucciones compartidas de conversación y de los agentes informan a Gemini que puede escribir tablas con encabezados y separadores Markdown fuera de bloques de código. Las respuestas simples siguen usando texto o listas. El transporte conserva el orden del texto y de las tablas, divide tablas grandes por filas repitiendo los encabezados y conserva celdas vacías y columnas adicionales. Los bloques de código y `raw: true` siguen siendo literales. Las tablas de los pies de archivo se envían después del archivo, ya que las captions no admiten este tipo de mensaje.

`planWhatsAppMessages` prepara el envío y `buildNativeTableMessage` construye `botForwardedMessage.message.richResponseMessage`, con `tableMetadata` y contexto de reenvío de IA. `extractNativeTableText` conserva los datos en el historial, permite leer tablas citadas y correlaciona el eco del webhook antes o después de la respuesta HTTP.

El endpoint nativo acepta únicamente `{number, table: {headers, rows, title}, delay, mentions}`. Valida tamaño y estructura antes del envío, usa los mismos guards que `sendText` y llama al servicio existente de Evolution para conservar resolución del destinatario, escritura en base de datos y webhooks. El cambio en el relay directo se limita al mensaje de tabla estructurado. Los demás endpoints y proveedores conservan su comportamiento.

Un endpoint ausente o un rechazo explícito previo al envío convierte las celdas analizadas a listas. Un timeout, un error genérico o un fallo tras el relay no provoca reintentos ni respaldo automático, porque el mensaje podría haberse entregado. Las partes confirmadas se conservan y un fallo posterior informa entrega parcial.

## Despliegue

La imagen `botsky/evolution-native-tables:2.3.7-c1` deriva de la imagen que ya estaba instalada, fijada por digest en `integrations/evolution-native-tables/compose.override.yml`. No instala ni actualiza dependencias. El Dockerfile y su archivo de exclusiones envían al build únicamente los archivos de esta integración, sin `.env`, datos ni credenciales.

El parche `scripts/patch-evolution-native-tables.cjs` verifica el bundle esperado y rechaza versiones diferentes o parches incompletos. Es idempotente. La ampliación queda dentro de la imagen y sobrevive a reinicios y recreaciones; no depende del debugger ni de una modificación temporal de memoria.

La copia activa del override está en `/home/petrov/docker/evolution/docker-compose.override.yml`. Se activó recreando únicamente `evolution-api` y reiniciando `wasa`; PostgreSQL, Redis y los demás procesos no se reiniciaron. Para reconstruir y aplicar cambios de esta integración:

```sh
cd /home/petrov/docker/evolution
docker compose -f docker-compose.yml -f docker-compose.override.yml build evolution-api
docker compose -f docker-compose.yml -f docker-compose.override.yml up -d --no-deps evolution-api
pm2 restart wasa --update-env
```

Para recuperar la imagen original, usar `docker compose -f docker-compose.yml up -d --no-deps evolution-api`. Ese comando excluye explícitamente el override; mover su copia activa antes de futuras recreaciones por defecto. Botsky enviará las tablas como listas mientras el endpoint nativo esté ausente.

## Verificación

Pasaron 204 pruebas de tablas y regresiones relacionadas, ejecutadas sin servicios ni credenciales reales:

```sh
node --test --test-timeout=20000 test/native_tables.test.js test/evolution_native_tables.test.js test/whatsapp_text.test.js test/mediaUxIntegration.test.js test/conversationStyle.test.js test/naturalUxIntegration.test.js test/attachment_context.test.js test/coalescer.test.js test/content_reader.test.js test/agent_content.test.js test/reminderNotesUx.test.js test/contactos_naturales.test.js test/multimedia_drive_estado_ux.test.js test/school_natural.test.js test/parser.test.js
```

La suite completa `npm test` también se intentó: mostró fallos en redacción de secretos de `agent.test.js`, cantidad de herramientas de `agentEngine.test.js` y respuesta de saludo de `ai.test.js`, y quedó bloqueada en `audit_fixes.test.js`. No se cambiaron esas funciones ni sus pruebas.

El endpoint activo rechazó un request inválido con `NATIVE_TABLE_INVALID` y un request sin clave con HTTP 401. La instancia recuperó el estado `open` y Botsky respondió `status:ok` tras activar la integración. La prueba final generó una tabla con Gemini y la envió al destinatario autorizado terminado en 0175 mediante `sendText`, sin herramientas de debugging. Evolution devolvió el ID del mensaje y `messageType: botForwardedMessage` con la tabla estructurada. La visualización de esta prueba final queda pendiente de confirmación del usuario; el formato C ya había sido confirmado en la prueba anterior.
