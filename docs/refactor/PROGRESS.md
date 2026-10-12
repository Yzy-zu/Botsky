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
- Tag de recuperación local: `v1-legacy` sobre `eb993ef`. No se hizo push ni se modificó el proceso de producción.
- Los DROP de capacidades y los cambios de arquitectura/producto fuera del plano requieren decisión del cliente según §15.

## Fases y gates

| Fase | Estado | Gate / evidencia |
| --- | --- | --- |
| 0 Baseline y seguridad | Gate abierto | Baseline documentado: 608 pass / 187 fail / 0 skip; trazabilidad completa; capturas reales pendientes |
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
- Pregunta pendiente del cliente: admitir fixtures sintéticos para Gate 0 y exigir capturas reales antes del canario, o capturar antes de cerrar la fase. No inferir respuesta por tiempo transcurrido.
- Baseline final: `bash scripts/refactor-baseline.sh` exit 1; Node v20.20.2 ARM64, 795 tests / 608 pass / 187 fail / 0 skipped, duración 110067.876698 ms. TAP temporal `/tmp/botsky-v2-baseline.tap`; informe versionado `baseline.md` y clasificación `baseline-failures.md`.
- Los fallos no equivalen a bugs de producción: claves/instancia ficticias, red bloqueada, capabilities removidas (`spawn EPERM`), herramientas ausentes y harnesses legacy incompletos. No se ha corregido ni retirado test alguno.
- Inventario estático 804 vs runner 795: unidades distintas y archivos que no registran tests por fallo de imports. Mantener trazabilidad nominal completa; no presentar el total runner como cobertura de esos 804 casos.

## Próximo paso concreto

Entregables WO001–007 revisados e integrados; se conservan en commit local.
Cerrar evidencia de capturas reales (o excepción explícita para arrancar con
sintéticos). Implementar telemetría
v1 con regresiones verificadas y activar observación antes de decidir DROP. No
avanzar a Fase 1 hasta cerrar Gate 0; no activar v2 ni reiniciar producción todavía.

## Último checkpoint operacional

- PM2 `wasa` confirmado `online` por consulta de solo lectura el 2026-10-12. No reinicios ni cambios de configuración operacional.
- Baseline final corregido incluye `scripts/`; tests de tablas nativas verdes. Primer snapshot (787 tests / 599 pass / 188 fail) conservado temporalmente solo como historia.
- Anonimizador offline: 6 pass / 0 fail; solo herramientas estándar Node, sin imports de aplicación. Captura real aún no activada.
