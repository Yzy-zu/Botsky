# Notas de ejecución de la refactorización

Fecha: 2026-10-12. Alcance: precisiones operativas del maestro, sin sustituir `plan.md` ni alterar sus capas o políticas. Producción continúa en `/home/petrov/botsky`; el trabajo aislado se realiza en `/home/petrov/botsky-v2`. El cliente autoriza una pausa operacional cuando sea útil y exige mantener PROGRESS actualizado.

## Decisiones reversibles dentro del plano

### Sombra sin efectos

`NullMessenger` cubre la salida de WhatsApp, pero no impide escrituras, XP, descarga de medios, Shell, herramientas o jobs. `decideOnly` llega hasta la decisión, sin Executor ni Composer con efectos, y recibe snapshots/repos de lectura y estado sombra independiente. No ejecuta listeners pasivos productivos ni consume sesiones reales. Solo permite trazas/diffs anonimizados en un destino dedicado.

Inicialmente usa LLM fake o resultados grabados. Antes de conectar un proveedor real, fija presupuesto de llamadas/tokens, límite de concurrencia y timeout; registra ese coste de forma separada. Modo sombra no registra jobs activos. Las pruebas deben medir cero escrituras de negocio, cero envíos/reacciones y cero herramientas, incluyendo entradas ignoradas y errores.

Evidencia: `src/core/server.js:28` inicia limpieza/proactividad al importar; `src/services/db.js:13` abre/escribe la base al importar. No cargar esos módulos para construir la sombra.

### Un dueño por mensaje y job

Un único punto de ingestión selecciona v1 o v2 por chat/feature antes de cualquier efecto. Canario no consiste en enviar el evento a ambos ejecutores. Dedupe, coalescer, XP e historial deben tener un propietario definido y no duplicarse durante la comparación.

Antes de cada ola se registra una matriz de dueño para mensajes, listeners pasivos y jobs. Los jobs no se vuelven canario por el flag del webhook: recordatorios, juegos, escuela y proactividad necesitan partición explícita o un dueño global único. El traspaso pausa al dueño anterior, drena ejecuciones y activa al siguiente; nunca inicia ambos schedulers sobre la misma responsabilidad. Un rollback revierte también esa matriz.

### Compatibilidad de rollback

Flags permiten revertir enrutamiento mientras contratos de datos/sesiones sigan siendo compatibles. Se ensaya lectura v1 sobre datos escritos por v2 y cambio de dueño con recordatorios/sesiones activos antes de un canario. Copias de producción y credenciales nunca entran en el checkout. Backup/restore y distinción entre rollback y recuperación de snapshot se especifican en [ADR-002](../adr/002-sqlite.md).

### Baseline y gates

El baseline guarda commit, runtime, comando, aislamiento, totales y cada fallo previo con test/causa y evidencia. Un error por dependencia faltante exige corregir el entorno y repetir la medición, no declararlo defecto heredado. Los tests usan datos y configuración temporales; ejecutar `npm test` sin aislamiento no constituye el baseline de esta obra.

Gates v2 y regresiones nuevas deben pasar. Un fallo legacy previo solo se conserva como excepción identificada, reproducible y sin agravamiento, nunca como éxito ni exclusión silenciosa. El informe muestra suite cruda y verificación de nuevas regresiones por separado. Si un gate del plano exige suite totalmente verde y sigue habiendo excepciones, se registra bloqueado; el maestro no reescribe el requisito para avanzar. En Fase 0 el gate pide baseline documentado, no reparar errores previos.

### Addressing antes de Context

La etapa ④ necesita metadatos de sesión/adjunto aunque ⑤ construye el contexto completo. Antes de invocar la política se prepara una vista mínima de solo lectura: chat+usuario, vigencia, messageId de resultados, adjunto propio citado y señal de seguimiento privado. La política recibe esa vista como entrada explícita y sigue siendo pura; no lee repos, no toca TTL y no carga historial ni descarga bytes. Context solo se construye después de la decisión, salvo registro mínimo de adjuntos y listeners pasivos permitidos por §6.

Las sesiones deben conservar el ID real de resultados; los adjuntos el ID/origen/propietario y TTL de 10 minutos de v2. Una selección numérica grupal sin cita/mención permanece ignorada (S07a), y cita/mención habilita la continuación vigente (S07b). `src/services/attachmentContext.js` usa chat+usuario pero TTL legacy de 15 minutos; ese valor no se porta como default v2. `src/utils/session.js` evidencia el aislamiento actual por chat+participante.

### Interacción natural y evidencia de mención en Fase 0

Clarificación del cliente del 2026-10-12: la interacción habitual debe ser natural, sin exigir `@` ni prefijos. Los handlers deben aceptar los argumentos estructurados del router para peticiones conversacionales. En privado §6.1 ya permite texto natural; en grupo permite dirigirse al bot por su nombre (`botsky`/`botsito`), una cita u otra señal prevista. Los comandos explícitos permanecen como capacidad compatible, no como requisito del flujo natural. Esta preferencia no acredita por sí sola que toda charla grupal deba activar al bot: S01/S02/S05/S06 mantienen la protección frente a intervenciones no dirigidas. Implementar una activación grupal más amplia requiere especificar esa política, en lugar de inferirla de la ausencia de prefijo.

Para el inventario de formatos de Fase 0, `mention` significa **mención estructural real**: un array `mentionedJid` no vacío en un contexto del envelope capturado. §11/§12 pide fixtures de mención como formato de webhook; no exige que cada formato de esa fase ya pruebe su escenario de producto. Una mención dirigida a una persona puede contar esa categoría de normalización y debe documentarse como genérica. No se rotula `mention-bot`, no demuestra que `mentions` incluya la identidad del bot (§6.1), y no acredita S03 ni un test de addressing portado. Un array vacío o un `@` dentro de texto sin metadata no cuentan como evidencia estructural.

Esta precisión separa el gate de formatos de Fase 0 de los escenarios de pipeline de Fase 3; no cambia el contrato de permisos, addressing ni los resultados de S01–S18. Las citas bot/humano siguen requiriendo prueba de identidad o ID saliente confiable, y `send.message` conserva su tipo de notificación saliente sin acreditar el eco entrante S13. Según el checkpoint informado por el maestro, la categoría nativa de encuesta (`poll`) aún carece de captura real: registrar esa brecha hasta recibirla, sin sustituirla por texto que diga “encuesta” ni por un fixture sintético.

### Rutas y alcance CI

- Trazabilidad canónica: `docs/refactor/test-traceability.md`, por test legacy; `tests/traceability.md` y referencias abreviadas del plano enlazan a esa fuente, sin tablas divergentes. Cada fila tiene destino o justificación explícita y estado de portado; `pendiente` no equivale a cobertura completada.
- Puertos definidos por el núcleo: `src/v2/domain/ports.js` junto a `types.js`/`events.js`. `adapters/ai/llm.port.js`, si resulta necesario como archivo de compatibilidad, referencia/reexporta el contrato del núcleo; no lo define por separado. Adapters implementan contratos, features los reciben por inyección.
- Verificación de capas, ciclos, Map/Set globales, tipos y lector único de env se aplica a `src/v2/**` mientras conviva legacy. No convertir infracciones conocidas de v1 en permiso para añadirlas a v2; la suite legacy sigue ejecutándose y se retira con trazabilidad.
- El límite de `new`/wiring se aplica a composición de servicios/adapters; estructuras locales necesarias para implementar plataforma no implican nuevos composition roots. Excepciones de constantes verdaderamente inmutables se revisan: `Object.freeze(new Map())` por sí solo no protege sus entradas de mutación.
- `Reply.parts` del plano contiene una elipsis: antes de Composer/adapters concretar cada variante discriminada y su payload como detalle de contrato, con validación y tests, conservando los tipos y la función del puerto. No aceptar un `object` arbitrario como contrato final.

## Decisiones pendientes del cliente antes de activación

§0/§6 limita cambios observables a §6/§11, pero §9 prescribe defaults/permisos adicionales. Preparar implementación desactivable y pruebas no requiere frenar cimientos; activar un cambio de producto fuera de la lista aprobada sí requiere resolverlo explícitamente.

| Tema | Preparación autorizada por el plano | Decisión antes de activarlo en producción |
|---|---|---|
| Terminal §9.2 | Perfiles, owner, timeout, auditoría, flag y confirmación en dos pasos | Consolidar en lista de cambios el default apagado y las restricciones nuevas |
| Adult-media §9.5 | Feature aislada y control por configuración | Cliente decide disponibilidad, grupos habilitados y default; no inferir aprobación por el refactor |
| Webhook §9.3 | Validación, configuración y pruebas | Coordinar credencial/configuración con Evolution antes de exigir cabecera y activar límites que alteren entrega |
| Permisos §9.1 | Igualdad exacta y escenarios S14/S16 | Preservar roles existentes salvo las correcciones aprobadas; cambios adicionales de roles se presentan al cliente |
| DROP §13/§15 | Inventario, telemetría y candidatos con evidencia | Aprobación por función/candidato antes de borrar; no interpretar autorización general de obra como aprobación de DROP |

Cambiar capas/puertos, DB o políticas §6 exige ADR y aprobación (§15). Ajustes técnicos simples y reversibles se documentan en la WO/ADR; no requieren preguntas rutinarias. Sombra de 24 h, canarios y soak de 72 h son evidencia operacional pendiente hasta ejecutarse, nunca reemplazada por tests locales.
