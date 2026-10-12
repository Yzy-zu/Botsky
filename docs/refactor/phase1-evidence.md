# Fase 1 — cimientos y evidencia del gate

Fecha: 2026-10-12 UTC. Rama: refactor/v2. Fase0 cerrada con excepción
F0-E001 autorizada: captura nativa de encuesta diferida hasta antes de polls.

Entregados 13 módulos nuevos: config/schema+index; domain/events+types+errors;
platform/clock+ttlStore+queue+scheduler+logger+metrics+crypto+maintenance.
No arrancan integraciones, DB, timers ni jobs al importar.

| Comprobación | Resultado |
| --- | --- |
| npm ci --ignore-scripts | Instalación limpia completada desde lockfile |
| npm run verify | PASS, exit0 |
| tsc --noEmit, strict/checkJs | PASS, todos los módulos v2 |
| ESLint | PASS, código v2, tooling y tests |
| Auditor de arquitectura | 13 módulos, cero infracciones |
| .env.example generado vs schema | Igualdad exacta; 90 settings + patrón Gemini |
| Unit v2 + tooling | 42 pass, cero fail/skip |
| config/schema e index | 100% líneas; index96.39% ramas |
| TtlStore | 100% líneas/ramas |
| queue | 100% líneas; 98.28% ramas |
| scheduler | 100% líneas; 97.92% ramas |
| Gate0 con F0-E001 | PASS |
| git diff --check | PASS |

`npm run verify` ejecuta tipos→lint→arquitectura→env→tests/cobertura. El
umbral >=90% se impone por archivo crítico, no mediante un promedio que
oculte módulos ausentes. TAP/coverage temporales: `/tmp/botsky-phase1-verify.txt`.
Regresiones negativas prueban que el tooling rechaza ciclos, capas prohibidas,
escape a legacy, Map/Set global y ausencia de cobertura.

Semántica comprobada: expiración y aislamiento de namespaces, límites de
cola light/heavy y usuario, FIFO/prioridad, backpressure y parada; timeout
aborta/rechaza al caller pero mantiene el slot hasta fin real. Scheduler no
solapa jobs, incluso tras unregister; mantenimiento comparte una ejecución
entre inicio/manual/ticker. Logger conserva etiquetas cerradas y correlación
opaca, redacta secretos/texto/IDs y no expone errores crudos. Crypto mantiene
lectura de tokens legacy3 segmentos y compatibilidad bidireccional de4.

Producción continúa en v1 con contador activo y captura apagada. No se activó
v2, no se cambiaron .env/bot.db ni fuentes legacy durante Fase1. Las dependencias
productivas conservan versión/integridad; nuevos paquetes son dev-only. La
suite legacy aislada conserva como evidencia su última regresión:795 tests,
608 pass/187 fail, cero fallos nuevos frente al baseline. No se la declara
verde ni se portan automáticamente sus 804 filas por estas pruebas.

Límites pendientes: la persistencia opcional de TTL/repos se integra con store
en Fase2; wiring y dueño único de jobs deben fijarse antes de sombra/canario.
Logger exige vocabularios técnicos confiables de composición. El checkpoint
de mantenimiento no certifica backup consistente. Excepción poll no autoriza
retirar esa feature. CI está preparada, pendiente ejecución remota cuando
se publique la rama. No comenzó Fase2.

Tooling: [checkJs oficial](https://www.typescriptlang.org/tsconfig/checkJs.html)
y [configuración ESLint](https://eslint.org/docs/latest/use/configure/configuration-files).
