# ADR-001 — JavaScript, JSDoc y comprobación estática

Fecha: 2026-10-12. Estado: aceptado por el plano (§3), pendiente de implementación en Fase 1.

## Contexto

`package.json` y los módulos revisados usan CommonJS, arrancan directamente con Node y ejecutan `node:test`. El mínimo declarado actualmente es Node >=18. El plano exige Node >=20 y comprobación estática sin introducir un build de aplicación.

## Decisión

- Mantener JavaScript/CommonJS durante la migración. ESM es opcional en el plano, pero no se introduce en esta obra sin una necesidad concreta.
- Documentar contratos con JSDoc; usar `// @ts-check` y `tsc --noEmit` en v2. El chequeo CI incluirá los archivos v2 desde su incorporación, evitando convertir errores legacy previos en cambios de alcance.
- Declarar `engines.node >=20` al integrar el tooling y verificar la versión usada por CI, PM2 y Docker antes de activar v2.
- Mantener ejecución directa y `node:test`; ningún archivo generado es requisito del despliegue.

## Consecuencias y verificación

CommonJS evita mezclar dos sistemas de módulos mientras conviven v1/v2. Los tipos no reemplazan la validación de entrada en ejecución ni la autorización declarativa. Fase 1 debe entregar un comando reproducible de tipos dentro de `npm run verify`, con errores de v2 bloqueantes; la suite legacy continúa ejecutándose aparte y con baseline trazable.

No se cambia `package.json` en este ADR. La selección de dependencias de tooling pequeñas corresponde al maestro (§15); una dependencia pesada o un cambio de capas requiere ADR y aprobación del cliente.

Evidencia: `package.json`; `src/core/server.js`; `plan.md` §§3, 12, 15.
