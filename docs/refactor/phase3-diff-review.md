# Revisión parcial de diferencias de sombra — Fase 3

Revisión read-only del 2026-10-13T10:06:30.813Z. Evidencia: estado privado usado sólo para localizar el JSONL sanitizado y checkpoint; no se copian estado, ruta privada del sink, flags, PID, IDs, textos, argumentos, usuarios ni credenciales al repositorio. Se consultó `report-phase3-shadow.cjs` sin `--write`; sólo este documento cambia en la revisión.

El reporte verificó proceso activo en el mismo PID de la activación, modo shadow y heartbeat fresco con SystemClock. Checkpoint: inicio 2026-10-13T03:02:40.938Z, observado hasta 2026-10-13T10:05:41.167Z; elapsed 25380229 ms (**7 h 03 min 00.229 s**). No son 24 h. Primer instante teórico de 24 h: 2026-10-14T03:02:40.938Z, si se mantiene el mismo proceso y evidencia continua. Tiempo transcurrido por sí solo no cierra Gate 3.

## Snapshot agregado

| Campo | Valor |
|---|---:|
| Entradas admitidas por observer / procesadas | 4 / 4 |
| Filas de diff persistidas | 4 |
| unknown | 3 |
| changed | 1 |
| same / v2-more / v2-less | 0 / 0 / 0 |
| Excepciones del observer / sinkErrors | 0 / 0 |
| dropped / bridgeDropped / v1TimedOut | 0 / 0 / 0 |
| pending / awaitingV1 / workerBusy | 0 / 0 / false |
| clipped / echoSeeds | 0 / 0 |
| unmatchedRecords | 268 |

Se revisaron las cuatro filas, no una muestra aleatoria de mayor población. El reporte inicial ya tenía esas cuatro y el actual no agrega pares nuevos: siete horas de heartbeat no equivalen a siete horas de tráfico variado comparable. Campos del JSONL limitados a decisiones sanitizadas, categoría y timestamp; decisiones contienen únicamente kind/respond/via/feature/reason. No hay evidencia de respuestas extra o suprimidas en estas cuatro filas, pero tres no tienen decisión v2 comparable y la muestra es insuficiente para concluir equivalencia general.

## Las cuatro filas, sin datos de mensajes

| Fila | Categoría real | v1 sanitizado | v2 sanitizado | Conclusión |
|---|---|---|---|---|
| 1 | unknown | reply; respond=true; reason=unknown | unknown; respond=true; reason=recorded-plan-unavailable | Se observó envío v1, pero no plan suficiente para replay. No inferir resultado funcional ni silencio v2. |
| 2 | changed | command; help; via=llm; respond=true; reason=unknown | intent; help; via=llm; respond=true; reason=wake-word | Ambas seleccionan help y responden. Diferencia de representación command→intent y metadata de addressing; compatible con el cambio de contrato. No compara contenido de respuesta ni ejecuta handler v2. |
| 3 | unknown | reply; respond=true; reason=unknown | unknown; respond=true; reason=recorded-plan-unavailable | Misma limitación de replay de la fila 1; no es excepción ni comparación exitosa. |
| 4 | unknown | reply; respond=true; reason=unknown | unknown; respond=true; reason=recorded-plan-unavailable | Misma limitación de replay de la fila 1; no permite concluir una acción distinta. |

El clasificador (`src/v2/platform/shadow.js`) marca unknown si cualquiera de los kinds es unknown. Si ambos son conocidos, primero evalúa respond para v2-less/v2-more y después compara el snapshot JSON completo. Por eso command/intent o reason distinto producen changed aun con feature y respond iguales. `reason=unknown` es un valor sanitizado/falta de razón registrada, no necesariamente un kind desconocido.

El bridge (`src/v2/shadowBridge.js`) usa sólo replay de planes v1 conocidos, o chat/ignore conocidos. Un envío capturado como reply no contiene por sí solo un plan de routing: cuando no puede reconstruirlo devuelve recorded-plan-unavailable y conserva metadata de addressing. El respond=true de esa fila no acredita que un handler v2 respondiera: únicamente decideOnly se ejecuta, sin Executor/Composer.

## Por qué unmatched 268 no se compara con observed 4

Son unidades distintas. `observed` cuenta entradas normalizadas admitidas a `createShadowObserver.observe`, que luego pueden producir diffs. `unmatchedRecords` es el mismo contador interno unknownRecords incrementado en tres sitios del bridge:

1. `observeWebhook`: normalize(raw) devuelve null. Incluye envelopes de eventos distintos de messages.upsert, además de payloads sin identidad/key válidas.
2. `recordV1Decision`: no existe pending para la combinación chat/messageID. Una decisión sin observación, correlación ausente o tardía puede caer aquí; el contador no diferencia esos motivos.
3. `recordV1Decision`: falla la clonación JSON del plan. Puede incrementar unmatched aunque una entrada se resuelva; no representa necesariamente otro webhook.

El hook de Express (`scripts/refactor/phase3-shadow-hooks.cjs`) observa req.body después del HTTP200. El server legacy (`src/core/server.js`) responde 200 antes de filtrar body.event: sólo messages.upsert continúa negocio. normalize de v2 rechaza otros event families. Por construcción, notificaciones de estados/conexión/outbound, entre otras no-upsert, pueden sumar unmatched sin convertirse en decisiones observadas. Un messages.upsert fromMe normalizable se trata separadamente como echoSeeds, no observed; echoSeeds=0 en este checkpoint no acredita cobertura de S13 productivo.

**No se puede atribuir los 268 a notificaciones con este contador agregado.** Tampoco son 268 decisiones fallidas, mensajes humanos perdidos, excepciones o diffs pendientes. No usar 4/(268+4) como tasa de éxito/cobertura: los incrementos no forman una partición uno-a-uno de webhooks. El contador pasó 25→268 desde el reporte inicial del repositorio mientras las cuatro filas permanecieron; su desglose causal no quedó capturado. Cero drops/timeouts y ninguna espera actual no evidencian congestión, aunque tampoco prueban que nunca haya existido una correlación ausente fuera de los cuatro pares admitidos.

## Diagnóstico acotado y límites

Sin reiniciar ni cambiar runtime ahora: tomar dos reportes sanitizados del mismo PID/checkpoint en una ventana de 5–15 min y comparar únicamente deltas observed/processed/unmatched/echoSeeds/timeouts/drops. Eso permite detectar si crecen rechazos de normalización/correlación sin comparaciones nuevas; no permite identificar la causa exacta ni justificar leer payloads, logs privados o DB. Esta revisión no ejecuta esa espera ni genera tráfico o acciones de negocio.

Si sigue siendo necesario distinguir causas, una próxima instrumentación autorizada puede separar contadores cerrados normalizeRejected / decisionWithoutPending / planCloneFailure; para rechazo de envelope sólo categorías de eventos predefinidas, sin event strings arbitrarios, IDs ni cuerpos. Esa recomendación no aplica parche, hook adicional, restart ni nuevo gate obligatorio en esta tarea.

Sombra parcial: no importa historial ni sesiones legacy; no demuestra contexto productivo por hilo, selección de sesión, rate/cooldown productivos ni escenarios S01–S18 completos. No consulta proveedores adicionales: replay es local y NullMessenger impide entrega sombra; `businessEffects:0` y `additionalProviderCalls:0` del reporte expresan esa construcción, no que v1 dejó de ejecutar negocio/proveedores. Los tests offline y la revisión arquitectónica no se sustituyen por cuatro filas ni siete horas sin excepciones. El changed revisado es explicable; los tres unknown siguen indeterminados para comparación funcional. **Gate 3 permanece abierto** y este informe no acredita 24 h, cutover, canario ni aprobación final del arquitecto.
