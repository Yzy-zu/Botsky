# Refactor v2 — registro de continuidad

Actualizado: 2026-10-12 UTC. Maestro: Codex. Plano: `plan.md`.

## Retomar el trabajo

1. Leer este documento, `plan.md`, `execution-notes.md` y los WO abiertos.
2. Trabajar en `/home/petrov/botsky-v2`, rama `refactor/v2`.
3. Consultar `git status`, revisar entregables y ejecutar gates antes de avanzar.
4. Actualizar este registro después de cada integración, prueba o decisión.

## Autorización y producción

- El cliente autoriza implementar la refactorización, desplegar agentes y pausar producción si resulta necesario; también autoriza trabajar en una copia y desplegarla cuando esté lista.
- Se eligió un worktree aislado. Producción sigue en `/home/petrov/botsky`, rama `main`, commit `eb993ef`. No se copian `.env`, credenciales, bases de datos ni archivos personales.
- Tag de recuperación local: `v1-legacy` sobre `eb993ef`. No se hizo push. En el cierre de Fase 0 se desplegó únicamente observación de v1, con un reinicio autorizado; ver checkpoint operacional abajo.
- Los DROP de capacidades y los cambios de arquitectura/producto fuera del plano requieren decisión del cliente según §15.

## Fases y gates

| Fase | Estado | Gate / evidencia |
| --- | --- | --- |
| 0 Baseline y seguridad | Gate abierto | Baseline documentado: 608 pass / 187 fail / 0 skip; trazabilidad completa; telemetría activa; capturas reales en curso |
| 1 Cimientos | No iniciada | Gate 0 pendiente |
| 2 Adaptadores | No iniciada | Gate 1 pendiente |
| 3 Pipeline y sombra | No iniciada | Gate 2 pendiente; 24 h reales de sombra requeridas |
| 4 Migración A–D | No iniciada | Gate 3 pendiente |
| 5 IA y duplicados | No iniciada | Gate 4 pendiente |
| 6 Cutover y retiro | No iniciada | Soaks, rollback probado y aceptación pendientes |

## Órdenes de trabajo

| WO | Responsable | Alcance | Estado |
| --- | --- | --- | --- |
| WO-001 | agente traceability | Inventario por caso de test legacy | Integrada: 804 filas únicas, 72 archivos; 790 pending y 14 intencional-pending |
| WO-002 | agente contracts_review | ADR001/002 y precisiones de ejecución | Integrada y revisada; implementación futura |
| WO-003 | agente fixtures | Fixtures sintéticos y brechas de evidencia real | Integrada: 16 fixtures; verificación aislada verde |
| WO-004 | maestro | Entorno aislado, baseline y coordinación | Integrada: runner reproducible y baseline documentado |
| WO-005 | agente contracts_review | Diseño telemetría v1 sin falsos éxitos | Integrada: diseño; implementación y activación pendientes |
| WO-006 | agente fixtures | Anonimizador offline y tests de secretos/identidades | Integrada: 6 tests verdes; aliases JID incluidos |
| WO-007 | agente traceability | Clasificación completa de los fallos del baseline | Integrada: 187 filas únicas; 106 entorno, 38 harness, 33 candidatas, 10 indeterminados |

## Hallazgos y decisiones

- Node disponible: v20.20.2; npm 10.8.2. Existe `package-lock.json`; aún no existe `npm run verify`.
- El plano coincide con HEAD y con los tamaños de dispatcher/db/ai.
- Algunos tests cargan `.env`, escriben SQLite y levantan servidores. El baseline se ejecutó exclusivamente sin credenciales reales, con datos temporales y aislamiento de servicios.
- Sombra debe impedir efectos de negocio además de envíos. Canario necesita un único dueño por evento y por job. Documentar implementación antes de activar.
- SQLite legacy usa WAL: respaldos y restauración requieren consistencia; no basta copiar el archivo principal activo.
- Fixtures sintéticos no se presentarán como capturas de producción. No se declarará Gate 0 verde sin cubrir la evidencia exigida o registrar una excepción aprobada.
- Dependencias instaladas en worktree con `npm ci --ignore-scripts`. `npm audit`: 10 vulnerabilidades (3 moderadas, 6 altas, 1 crítica). No se aplicó `audit fix --force`; conservar baseline antes de actualizar.
- Baseline: Docker `node:20-bookworm` fijado por digest, sin red ni sockets/servicios host, source read-only y copia de tests/datos escribible dentro del contenedor. Runtime host ARM64. Se corrige incompatibilidad GLIBC de sqlite3 compilando dentro de la imagen; el primer intento con binding host no es baseline válido.
- Validado inventario: 804 IDs TR únicos. Fixtures: `node tests/fixtures/webhooks/verify.cjs` verde. `bash -n scripts/refactor-baseline.sh` verde.
- El cliente pidió terminar Fase 0 completamente antes de avanzar: se requieren capturas reales; no se usa excepción por sintéticos. Se solicitó su ayuda opcional para generar tipos de tráfico faltantes en WhatsApp.
- Baseline final: `bash scripts/refactor-baseline.sh` exit 1; Node v20.20.2 ARM64, 795 tests / 608 pass / 187 fail / 0 skipped, duración 110067.876698 ms. TAP temporal `/tmp/botsky-v2-baseline.tap`; informe versionado `baseline.md` y clasificación `baseline-failures.md`.
- Los fallos no equivalen a bugs de producción: claves/instancia ficticias, red bloqueada, capabilities removidas (`spawn EPERM`), herramientas ausentes y harnesses legacy incompletos. No se ha corregido ni retirado test alguno.
- Inventario estático 804 vs runner 795: unidades distintas y archivos que no registran tests por fallo de imports. Mantener trazabilidad nominal completa; no presentar el total runner como cobertura de esos 804 casos.

## Próximo paso concreto

Entregables WO001–007 revisados e integrados; se conservan en commit local.
Completar capturas reales y su manifest, documentar evidencia de telemetría activa,
desactivar preload temporal y ejecutar verify-phase0. No avanzar Fase1 hasta
Gate0 PASS. La telemetría queda activa para observar uso, sin decidir DROP aún.

## Último checkpoint operacional

- PM2 `wasa` confirmado `online` por consulta de solo lectura el 2026-10-12. No reinicios ni cambios de configuración operacional.
- Baseline final corregido incluye `scripts/`; tests de tablas nativas verdes. Primer snapshot (787 tests / 599 pass / 188 fail) conservado temporalmente solo como historia.
- Anonimizador offline: 6 pass / 0 fail; solo herramientas estándar Node, sin imports de aplicación. Captura real aún no activada.

## Cierre de Fase 0 — operación activa (2026-10-12T18:42:54.987827Z)

- Autorización vigente: el cliente pide terminar Fase 0; permite pausar/migrar producción y agentes.
- WO008: módulo commandUsage + sink SQLite separado, 9 tests verdes; `ok=NULL` para resultado desconocido, no falsos éxitos.
- WO009: preload de captura, dedupe por categorías, 10 tests verdes. Preload reversible y sin modificar bytes/ack HTTP.
- WO010: verificador Gate0 `node scripts/refactor/verify-phase0.cjs`; actualmente abierto por capturas reales/evidencia por integrar.
- WO011 maestro: runtime/integración en dispatcher + tools + startup servidor; 3 tests integración verdes, contrato SQLite real verde.
- Regresión completa flags off: 795 tests / 608 pass / 187 fail, mismos títulos fallidos que baseline (0 nuevos), 109625.624006 ms. TAP `/tmp/botsky-v2-phase0-final-regression.tap`. Se detectó y corrigió una incompatibilidad de VM sin process antes de desplegar.
- Activación real: `2026-10-12T18:41:33.692Z`. PM2 `wasa` online, nuevo PID 2581994; health HTTP200 status ok.
- Producción `/home/petrov/botsky`: cambiados SOLO `src/core/server.js`, `src/core/dispatcher.js`, `src/services/toolRegistry.js`; nuevos `commandUsage.js`, `commandUsageRuntime.js`. Código de negocio igual; instrumento opt-in. Estos cambios están en el working tree productivo, no en un commit de main.
- Flags PM2: LEGACY_COMMAND_USAGE_ENABLED=true; sidecar `/home/petrov/botsky/data/command-usage.db`, tabla6cols verificada. No se migró ni copió bot.db, no se cambió .env ni configuración Evolution.
- Captura temporal: REFRACTOR_CAPTURE_ENABLED=true, directorio `/tmp/botsky-phase0-captures`, límite200 firmas/duración1800000ms/dedupe=true. Identidad real del bot obtenida por API en memoria y enviada SOLO al env privado de PM2; no impresa ni versionada.
- Node args: originales + `--require /home/petrov/botsky-v2/scripts/refactor/capture-preload.cjs`. Al vencer tiempo/límite se desengancha el observador; antes de cerrar fase ejecutar disable-capture para quitar también preload/env.
- Control: `node scripts/refactor/manage-phase0-runtime.cjs status`; desactivar captura: mismo comando `disable-capture` (mantiene contador). Rollback: `rollback` restaura fuentes del tag y args/flags previos, con guardas SHA contra cambios ajenos. Estado privado para rollback `/tmp/botsky-phase0-runtime-state.json` modo0600. No guardar PM2 env completo.
- Próximo paso inmediato: leer capturas YA ANONIMIZADAS, construir manifest real y evidencia telemetría, identificar tipos faltantes; no avanzar Fase1 hasta Gate0 PASS.

## Checkpoint 2026-10-12 19:22 UTC — pruebas del cliente

- Preferencia explícita del cliente: hablar naturalmente con Botsky, sin exigir @ ni prefijos. Registrar como requisito de producto para fases posteriores; Fase0 solo observa, no cambia routing.
- Evidencia real importada: 21 fixtures, 14 categorías; Gate0 tiene una única brecha: encuesta/voto nativo. Se solicitó crear encuesta desde adjuntar en WhatsApp; no exigir comando. No declarar cierre antes de recibirla.
- mention en Gate0 verifica estructura mentionedJid real (ya capturada con una mención humana), no afirma addressing al bot ni ejecución del escenario S03. Prueba dedicada verde.
- Identidad PN/LID del bot confirmada mediante mapeo de participantes Evolution de solo lectura; alias real SOLO en env privado y /tmp/botsky-phase0-bot-aliases.json modo0600. No inferir identidad LID a partir de PN sin prueba. Retirar cache privado al cerrar captura.
- Segunda ventana activada aproximadamente 19:07 UTC, PM2 PID2594806. Captura 30 minutos, dedupe200. A las 19:22 health200, ambas colas vacías, contador activo.
- fromMe observado en evento real send.message de Evolution; se conserva ese nombre. NO demuestra eco messages.upsert de S13. Quotes desconocidas originales conservan ese estado; nuevas quotes bot/humano están comprobadas por aliases por fixture.
- Tests aislados actuales: 35 pass / 0 fail (7 anonimizador, 12 captura, 9 contador, 3 integración, 4 evidencia). 16 fixtures sintéticos válidos; git diff --check verde. Regresión legacy ya realizada sin nuevos fallos; no repetir sin cambios de negocio.
- Sidecar SQL real a las 19:22: ayuda5, encuesta4, sticker1, transcribir1; total11, todos ok=NULL (resultado desconocido). No interpretar resolución HTTP como éxito de negocio.
- WO012: revisión de privacidad/provenance del agente traceability; distinción de mention estructural vs addressing en revisión.
- Próximo paso: importar encuesta nativa cuando llegue, Gate0, disable-capture, health, refrescar telemetry-evidence, documentación/commit. Fase1 sigue sin iniciar.
