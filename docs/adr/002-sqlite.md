# ADR-002 — Conservar sqlite3 detrás de repositorios

Fecha: 2026-10-12. Estado: implementado en Fase 2; decisión reversible del maestro dentro de §7.4.

## Contexto

`package.json` ya declara `sqlite3`. `src/services/db.js` abre `DATA_DIR/bot.db` y crea tablas al importar; configura WAL, `synchronous=NORMAL` y `busy_timeout=5000`. Su función `checkpointWal()` resuelve `true` incluso si SQLite devuelve error: ese resultado no acredita un respaldo válido.

## Decisión

Conservar el driver `sqlite3`; no añadir `better-sqlite3`. El adaptador v2 expondrá una API promesa con transacciones y errores propagados, apertura/cierre explícitos desde el composition root, y repositorios por feature. Las features no reciben conexiones concretas ni acceso indiscriminado a otras tablas.

Migración 000 reproduce el esquema existente. El runner registra versiones en `schema_migrations`, verifica precondiciones y aplica cada migración una sola vez bajo control transaccional. No importa `db.js` para descubrir el esquema porque su importación escribe datos. Hasta terminar el periodo de rollback, los cambios son aditivos: tablas/columnas nuevas, sin DROP, renombrados destructivos ni formatos que v1 no pueda leer.

## Respaldo y restauración

Antes de migrar debe existir un respaldo consistente y un restore probado en ruta aislada. En WAL, copiar solo `bot.db` mientras hay escrituras no satisface este requisito.

- Ruta preferida para el primer cutover: pausar ingestión y todos los escritores/jobs, drenar trabajo, efectuar checkpoint verificando su resultado y cerrar todas las conexiones; copiar la base ya cerrada y comprobar que no quedan escritores ni WAL pendiente. Si no se demuestra esa condición, usar un mecanismo de snapshot SQLite consistente, verificado durante Fase 2.
- Si se necesita respaldo en vivo, evaluar el mecanismo de backup SQLite disponible en el driver real y demostrar consistencia con escrituras concurrentes. No asumir una API ni copiar `.db`/`-wal` secuencialmente como sustituto de un snapshot.
- Restaurar primero en almacenamiento temporal: `integrity_check`, versión de esquema y comprobación de filas/valores representativos para users, recordatorios y sesiones durables. Conservar evidencia y manifest de versión, fecha, checksum y resultado; no incluir datos personales ni archivos de base en Git.
- Un restore operacional exige detener escritores, apartar base y sidecars actuales, restaurar el respaldo compatible y reabrir un único dueño. Restaurar un snapshot antiguo pierde escrituras posteriores; no es el rollback normal por flag.

## Rollback y consecuencias

El rollback habitual cambia el propietario de ejecución a v1 y reinicia únicamente cuando las escrituras realizadas por v2 siguen siendo compatibles con v1. El gate requiere probar que v1 lee y opera sobre una base de prueba modificada por v2. Si una migración rompe esa compatibilidad, su activación queda bloqueada hasta preparar y validar una estrategia explícita.

Contract, consolidación de tablas y borrado de esquema quedan para después de la ventana operacional y la autorización requerida para DROP. Conservar el driver reduce variación y deja una futura sustitución localizada detrás del puerto; no modifica las capas del plano.

Evidencia: `src/services/db.js:3`, `:9`, `:20`, `:1513`; `package.json`; `plan.md` §§7, 12, 16.

Implementación comprobada en bases temporales: sqlite3@6.0.1 (SQLite3.52.0),
transacciones serializadas, migración000 completo, snapshot VACUUM INTO con
escrituras WAL concurrentes/integrity/checksum y restore a destino nuevo.
Se verificó lectura/escritura de API v1 real sobre el esquema migrado, sin
importar v1 en producción ni copiar datos reales. Manifest y contratos en
[phase2-evidence](../refactor/phase2-evidence.md).

VACUUM INTO es una instantánea coherente según la
[documentación SQLite](https://www.sqlite.org/lang_vacuum.html); se ejecuta
fuera de transacción, se valida el resultado y se sincroniza el archivo.
El restore probado de fixture no sustituye la coordinación de escritores
ni el ensayo de rollback de cada feature antes de su canario.
