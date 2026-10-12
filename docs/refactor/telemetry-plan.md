# Plan mínimo de telemetría v1: command_usage

Fecha: 2026-10-12. Estado: diseño revisable; **implementación y activación pendientes**. WO-005 no cambia legacy, no accede a producción ni captura logs. El baseline aislado está documentado en `baseline.md`; la telemetría se implementará en una WO posterior tras validar efectos, con su gate de regresión.

## Datos y semántica

Registro mínimo: `command_usage(feature, command, chat_type, ts, ok, latency_ms)`. `feature` y `command` provienen de un mapa cerrado de identificadores técnicos, no de texto/args del usuario ni de la decisión LLM sin validar. `chat_type` vale `private` o `group`; `ts` es epoch UTC en milisegundos de inicio; `ok` es 0/1 según resultado de la operación; `latency_ms` usa reloj monotónico desde inicio de ejecución hasta desenlace conocido. No guarda JIDs, teléfonos, nombres, IDs de mensajes/contactos/filas de negocio, texto, URLs, rutas, comandos shell, errores crudos o prompts. Ni hashes de esos datos.

Una fila representa una operación real iniciada, con resultado verificable, no un webhook, un intento de autorización o una ruta elegida. Colas: medir dentro del callback que efectivamente ejecuta el handler; rechazo de `queue.add` antes de iniciarlo no genera fila. La latencia excluye espera de cola/coalescer. No se modifica resultado, timeout, reintentos ni respuesta al usuario para medirlos.

Éxito requiere el hito definido para cada operación: p. ej. nota persistida, envío confirmado por adapter, descarga/consulta completada o transición de juego persistida. No equivale a `dispatch` resuelto, `handler` resuelto con `undefined`, `consumed:true`, HTTP 200 del webhook ni mensaje de error enviado correctamente. Una excepción durante operación iniciada es fallo; `success:false` debe clasificarse porque puede expresar rechazo/validación **previa** y no ejecución fallida. Una cancelación válida es su propia operación `*.cancel`, no un envío fallido.

Para resultados ambiguos o errores absorbidos, registrar contador agregado de cobertura incompleta fuera de la tabla (sin PII), no inventar `ok=1` ni `ok=0`. Activar el flag no promete cobertura completa: el informe debe listar comandos cubiertos y no cubiertos. Ausencia de filas no acredita desuso ni habilita DROP.

## Puntos de observación revisados

Referencias corresponden al checkout de baseline; usar el símbolo y rama indicados si las líneas cambian.

| Camino | Punto concreto futuro | Tratamiento |
|---|---|---|
| Guards de `dispatch` | `dispatcher.js:456–529`: shape/from, allowlist, entrada vacía, cooldown, parse | Sin filas: no hay operación iniciada |
| Fast-path cooperacha/pack/hora feliz/adulto | `dispatcher.js:582–706`, rescate adulto `:901–935` | Solo reescriben `parsed/cmdToSwitch`; medir una vez en handler final, no al reconocer regex |
| Routing/clarificación/adjunto no identificado | `dispatcher.js:724–769`, `applyAiArgsToParsed():443–448` | No atribuir uso ejecutado a la feature propuesta; ignore, await_attachment, selector inválido y fallo de routing sin herramienta quedan fuera |
| Guards de addressing/ignore | `dispatcher.js:730–736`, `:820–840`, `:899`, `:937–943` | Sin filas; llamadas LLM de routing son métricas de proveedor separadas |
| Permisos comandos sensibles | `dispatcher.js:951–1018` | Sin filas de ejecución al enviar rechazo; opcional contador de rechazo agregado separado |
| Command Registry | `dispatcher.js:1026` obtiene `{handler,queueTier}`; `:1052/:1054` ejecutan | Decorar el handler justo antes de pasarlo a cola o invocarlo; finalización antes del catch usuario `:1057`. Retener la excepción original incluso si falla telemetría |
| Registry con ejecución directa | `commandRegistry.js`, `canal`/`apagate` retornan `{handled:true}` tras informar argumento inválido | No es handler ejecutado; no contar éxito. Fallo al resolver registry tampoco es operación ejecutada |
| Chat AI directo | `dispatcher.js:841–879`: contenido preparado, chat/agent y `sendText` | Feature `conversation`, comando fijo `chat`; medir generación+envío, no texto como comando. `agentRes.silent` no cuenta respuesta chat, aunque sus tools sí pueden haber ejecutado |
| Chat fallback en cola | `dispatcher.js:1038–1045` | Mismo identificador `conversation/chat`, wrapper dentro del handler; no guardar `cmdToSwitch` porque puede contener entrada libre |
| Continuación de contacto | `dispatcher.js:744`; `mensaje.js:299` `handlePendingContactChoice` | Identificar inicio de envío dentro de la rama que llama a envío real; `consumed:false`, busy, selector inválido o aclaración no ejecutan envío; cancelación válida se mide aparte |
| Tools del agente activo | `agentEngine.js:227` → `toolRegistry.js:349` `executeTool` | Clasificar cada case/acción después de guard de permisos/validación y alrededor de la operación; no medir todo el switch como éxito por resolver. Preferir dueño aquí y evitar duplicar el handler llamado internamente |
| Agente terminal paralelo | `agent.js:51` `handleTerminalTool`, llamado en `:261` | Ruta distinta del agente importado por dispatcher; inventariarla con sus tests/importadores antes de declarar cobertura global; medir Shell real si se activa, no entrada propuesta |
| Drive por reacción | `server.js:111–126`: `handleDrive(...).then(...).catch(...)` | Fuera de dispatch: wrapper en llamada efectiva con media cacheada, `drive/upload-reaction`; ninguna fila para otra reacción o cache miss. Reacción ✅ es acuse separado, no prueba de subida exitosa |
| Reclamo de airdrop | `server.js:134–143` → `happyHour.js:482` `claimAirdrop` | `NOT_ACTIVE`/`ALREADY_CLAIMED` quedan fuera; dueño en operación de reclamo después del candado. El return `success:true` absorbe errores DB/XP y dispara envíos en segundo plano: resultado integral todavía ambiguo |
| Mensaje grupal pasivo | `server.js:132` `onIncomingGroupMessage`; `:148–153` addXp; historial y afinidad en dispatch | XP/historial/afinidad no son comandos. No sumar fila por mensaje. Si realmente dispara lluvia/intervención, observar la acción concreta como automática, según sección jobs |
| Escuelas | `tareas.js:148` y `toolRegistry.js:618` llaman `school.handleDirectTaskMessage` | No es ruta webhook adicional: conserva dueño exterior correspondiente; el booleano true no acredita tarea guardada, también hay retornos tempranos |
| Coalescer | `coalescer.js:48` `enqueueDispatch` y `flushSender` | No medir ingreso/enqueue; callbacks de operación reflejan una ejecución del texto combinado, no cada mensaje; aquí errores son absorbidos, medir antes |

## Canonización y dueño

La WO de implementación añadirá un mapa fijo para **cada** grupo del registry: help; system-info; media-download; reminders; transcription; voice; stickers/effects; conversion/documents; drive/search; moderation; economy; minecraft; community; admin-system; notes; polls; tasks; games; messaging; adult-media. Usar los IDs de features finales del plano, no variantes inventadas por el LLM. Acciones permitidas de tools también deben figurar explícitamente en el mapa: minecraft_control, ejecutar_terminal, notas_tablon, recordatorios_alarmas, tareas_escolares, google_drive, descargar_multimedia, enviar_archivo_contacto, sintetizar_voz, juegos_y_economia, afinidad_y_lore, control_tv y enviar_mensaje_contacto.

Aliases se consolidan al comando canónico. `comprar pack` se atribuye a `adult-media/pack`; `comprar` sin ese item ejecuta catálogo y usa un comando distinto fijo. Comandos con subacciones (crear/listar/cancelar, on/off/status) deben conservar identificadores cerrados para no mezclar ejecución privilegiada con consulta. El mapa no se redacta extrayendo texto dinámico.

Para una tool que llama un handler, un único dueño exterior mide la operación; el handler no vuelve a contabilizarla. Un agente que ejecuta varias tools sí produce una fila por operación efectiva, y puede producir además `conversation/chat` si envía respuesta final; informes no suman ambos como si fueran el mismo nivel. Mantener contexto de medición solo en memoria, con tokens opacos no persistidos si hace falta evitar duplicados. Retries internos no son otra ejecución de comando; intentos de entrega de un job se reportan separadamente de la creación del recordatorio.

## Jobs y trabajo diferido

No envolver `scheduler.tick()`/`task.fn()` de forma genérica: una resolución suele ser tick vacío y los workers capturan errores internamente. La tabla de command_usage inicial cubre operaciones de usuario; la actividad automática usa contadores/job traces aparte, sin atribuir demanda de comandos al tráfico programado. La primera WO no necesita añadir una tabla adicional. Para auditar obsolescencia, se presenta esa actividad junto al uso explícito, claramente separada.

| Productor | Límite observable futuro | No contar |
|---|---|---|
| `recordatorios.js:139` reminders-worker | Por recordatorio: inicio de `sendText` y resultado de `markReminderDelivered`; catch por recordatorio clasifica fallo/retry | Lista vacía, IDs ya en procesamiento, tick general; un fallo de marcar delivered después de envío se distingue de entrega fallida |
| `school.js:546` publisher, `publishDueSchoolTasks`, `publishDailySchoolDigest` | Después de claim/publicación elegible, alrededor de envíos y marca de publicación; resultado por publicación | Horario no elegible, claim ya adquirido, cero tareas; catches de medios pueden permitir éxito parcial |
| `proactive.js:326` heartbeat y `maybeTriggerBurstIntervention` | Solo intervención elegible que intenta envío real; éxito tras envío | Heartbeat y grupos descartados; pausas/IA sin envío no acreditan intervención |
| `ruleta.js:72` roulette-exiles-worker | Acción real de readmisión/aviso por expiración; juego desde `runRouletteGame` y timer de sala | Sondeo vacío; comando de abrir sala y desenlace automático son acciones distintas |
| `happyHour.js` recovery y timers expire/rain/airdrop | `stopHappyHour`, `triggerRainDrop`, `triggerAirDrop` después de comprobar elegibilidad, con confirmación de efectos | Timer armado, recovery leído, lluvia descartada, cada mensaje observado; callbacks absorben errores |
| `blackjack.js` timers de mesas/partidas, `cooperacha.js:411` expiración | Liquidación/cierre efectivo después de guard de estado; resultado DB/envíos según contrato | Timer registrado o expirado sin sesión activa |
| maintenance: scheduler RAM, history-cleanup, temp/school-media cleanup, sqlite checkpoint, documentos/buscar sessions, queue userCounts | Métricas de mantenimiento específicas | Ninguna fila command_usage, aunque la ejecución sea exitosa |
| Venganza/afinidad en `dispatcher.js:775–816` | Métrica automática en punto de DM realmente intentado | Cambios de afinidad sin envío; `.catch` absorbido no equivale a éxito |

`claimAirdrop` además devuelve `packPromise` con catch que oculta rechazo y no espera el anuncio grupal. No afirmar éxito de premio completo basándose en ese objeto. La implementación mínima puede medir operaciones específicas ya verificables o dejar cobertura pendiente; reunir los resultados de tareas hijas sin alterar timing requiere revisión de efectos y tests antes de tocar legacy.

## Integración futura y gates

1. Implementar bajo `LEGACY_COMMAND_USAGE_ENABLED=false` por defecto, documentado en configuración de v1. Con flag apagado: no abrir un sink ni crear/migrar tabla por telemetría, no agregar timers ni tráfico; evitar importar nuevo módulo que abra DB al cargar. Esta bandera es distinta de PIPELINE_MODE y captura de fixtures.
2. Usar un sink inyectable en tests y un almacenamiento operacional explícito para datos agregados; si usa SQLite de negocio, el cambio aditivo y backup consistente preceden creación de tabla. Escritura parametrizada, límites de búfer/flush, errores aislados, sin retries infinitos ni logs de payload. No bloquear respuesta por caída del sink. Pérdida/dropped counts declarados en el reporte.
3. Tests aislados de resultado/PII: handler ejecutado ok/fallo, throw absorbido luego por dispatcher, cola llena sin fila, aliases, fast-path único, ignore/denied/clarificación cero, chat fijo, Drive reacción y airdrop ambiguo, tool que llama handler sin duplicar, workers vacíos cero. Comparar mensajes y efectos originales con flag apagado/encendido.
4. Revisar mapa completo, clasificaciones de errores absorbidos y cobertura por camino antes de activar. Suite legacy comparada con baseline y cero regresiones nuevas. Activación v1 en producción pendiente de esta implementación, verificación e integración por el maestro; no se declara realizada en Fase 0 por el documento.
5. Registrar en PROGRESS tiempo efectivo de observación, flag, cobertura y pérdidas. Ideal ≥7 días (§12), sin bloquear trabajo independiente; candidatos DROP requieren pruebas y aprobación individual del cliente aun si tienen cero filas.

## Captura de fixtures reales: tarea independiente

El plano y la autorización del cliente cubren la captura necesaria para la refactorización. Antes de activarla, definir técnicamente los chats/tipos, una duración acotada y el responsable; persistir únicamente datos ya anonimizados. No usar logs existentes en esta WO. Flag de captura por defecto apagado y separado de command_usage; no guardar headers/apikey, raw completo, medios/base64, nombres, texto personal, teléfonos, rutas ni URLs firmadas.

Sanitización por allowlist **antes** de persistir: conservar estructura y campos estrictamente necesarios, sustituir texto por sintético y JIDs/IDs por identidades sintéticas coherentes dentro de la fixture para preservar menciones/citas/eco. Metadatos de medio mínimos y referencia falsa; bytes excluidos. Revisar manualmente y con detector de secretos/PII antes de Git. Registrar procedencia `real-anonymized` y tipos cubiertos; fixtures sintéticas son útiles, pero se etiquetan `synthetic` y no cumplen por sí mismas la captura operacional requerida por Gate 0. Activación/captura y retirada del flag se asignan a otra WO.
