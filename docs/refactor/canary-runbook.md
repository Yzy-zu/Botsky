# Canario de migración y rollback

La sesión autoriza implementar, desplegar y reiniciar el bot. F3 está cerrada con F3-E001: el observador fue cancelado y no se reactiva. La validación del canario forma parte de Gate4; no se exige cerrar ese gate antes de poder realizar su propia prueba.

El primer escalón usa `PIPELINE_MODE=canary`, un privado explícito en `V2_CANARY_CHAT_IDS` y `V2_CANARY_FEATURES=qr,help,system-info`. Solo creaciónQR/ayuda/estado pertenecen a v2. QR citado/lectura, archivos sin caption, grupos y otras capacidades conservan legacy. Jobs siguen exclusivamente en legacy; `PROACTIVE_ENABLED=false` es requisito de este despliegue. El modo completo `v2` se rechaza hasta terminar las olas pendientes.

Antes del reinicio: verificar fuente identificada, pruebas verdes, backup privado de fuentes/configuración PM2, colas vacías y health200. Construir/cerrar el graph real sin mensajes para comprobar SQLite/migraciones/limpieza. El sidecar `data/v2/canary.db` no sustituye ni modifica `bot.db`. Instalar fuentes preservando las correcciones previas de producción.

Tras activar: health200, configuración efectiva redactada, PID y contadores seguros en `/status.pipeline`. El cliente envía «Botsky qr hola», «Botsky ayuda» y «Botsky estado», sin @ ni prefijos. Registrar entrega real, una sola respuesta por evento, errores y alcance; no publicar texto/JIDs/secretos. Pruebas locales y arranque no sustituyen esta evidencia. La olaA sigue abierta hasta completar su paridad/traza y prueba privada y grupal.

Rollback: volver `PIPELINE_MODE=legacy` y reiniciar únicamente `wasa` con configuración guardada. Comprobar health200, `pipeline.enabled=false` y colas. No restaurar DB de legacy para este rollback: el nuevo runtime tiene sidecar propio. El graph v2 cierra admisiones, aborta trabajo, drena y libera recursos al recibir SIGINT/SIGTERM; PM2 debe darle una gracia compatible con los deadlines de proveedores.

Ante fallo de salud, propietario duplicado, respuesta inesperada o entrega fallida, detener expansión y volver a legacy; conservar evidencia redactada y corregir antes de reactivar. La excepción F3-E001 no elimina los gates de olas ni los escalones de cutover final de Fase6. No borrar capacidades: cada DROP requiere decisión explícita del cliente.
