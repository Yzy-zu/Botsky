# Fase 0 — integración y observación de producción

Código base: `eb993ef`. Preparación: `c6c992e`. Fecha: 2026-10-12 UTC.

## Verificación antes de desplegar

- Tests aislados actuales: 35 verdes (9 contador/sink, 12 captura HTTP,
  7 anonimizador, 3 integración y 4 evidencia). Antes del primer despliegue
  se verificaron los 22 tests de contador, captura e integración iniciales.
- Contrato SQLite real en contenedor aislado: dos filas, alias canónico,
  seis columnas, NULL para resultado desconocido y 1 para booleano explícito;
  flush/cierre completados.
- Suite legacy completa con flags apagados: 795 tests, 608 pass, 187 fail,
  cero skips y **cero títulos fallidos nuevos** frente al baseline.
  Duración 109625.624006 ms; TAP temporal
  `/tmp/botsky-v2-phase0-final-regression.tap`.
- La primera integración añadía una referencia a `process` en una VM legacy
  que no lo define. Se corrigió con guard de existencia, añadió regresión
  propia y repitió la suite completa; nunca se desplegó esa versión.
- Sintaxis de módulos/scripts y `git diff --check` verdes. Gate0 no exige
  reparar fallos previos; permanecen enumerados en baseline-failures.

## Despliegue realizado

La autorización del cliente permite una pausa y cambios en producción.
Se comprobó que los tres archivos productivos coincidían con `v1-legacy`,
se copiaron únicamente los cambios de observación y los dos módulos nuevos,
y se reinició `wasa` mediante PM2. No se copió .env, bot.db ni credenciales.
No se cambió configuración de Evolution. La identidad del bot se obtuvo
por API y pasó solo al entorno privado del preload; no queda en Git/logs.

Verificaciones reales: PM2 online, health HTTP200, tabla sidecar con las seis
columnas esperadas. También se consultó `/status` desde el contenedor Evolution:
el destino configurado del webhook responde y su uptime coincide con el host.
La resolución del alias Docker solo dentro del contenedor es esperada.

Artefactos operacionales privados:

- `data/command-usage.db` en producción, modo0600; información agregada,
  sin JIDs, texto, nombres, args o errores crudos. Contador activo.
- `/tmp/botsky-phase0-captures`, modo0700; cada archivo modo0600 se escribe
  después de anonimizar, nunca contiene el body original o headers.
- `/tmp/botsky-phase0-runtime-state.json`, modo0600; args/flags anteriores y
  hashes para rollback. No contiene snapshot completo del entorno PM2.

El preload se limita a 200 firmas de categorías, 30 minutos, 1MB por evento y
ocho requests simultáneas. Repetidos no consumen slots. El deadline/limit retira
el hook; quitar también args/env al cerrar la captura.

## Operar y retomar

Desde `/home/petrov/botsky-v2`:

```sh
node scripts/refactor/manage-phase0-runtime.cjs status
node scripts/refactor/manage-phase0-runtime.cjs resume-capture
node scripts/refactor/import-phase0-captures.cjs
node scripts/refactor/verify-phase0.cjs
```

`resume-capture` reinicia el proceso durante una nueva ventana de 30 minutos;
usarlo solo si la ventana anterior venció o faltan categorías. Conserva el
contador y datos ya anonimizados. No envía mensajes a WhatsApp.

Después de reunir evidencia suficiente:

```sh
node scripts/refactor/manage-phase0-runtime.cjs disable-capture
node scripts/refactor/manage-phase0-runtime.cjs status
node scripts/refactor/verify-phase0.cjs
```

Desactivar captura restaura los argumentos originales de Node y conserva
telemetría. Volver a comprobar health/PM2 y actualizar la evidencia temporal
de inicio de observación tras ese reinicio.

Si hay problemas: `node scripts/refactor/manage-phase0-runtime.cjs rollback`.
Restaura los tres archivos originales del tag, retira módulos añadidos y
restaura flags/args, pero se niega a sobrescribir cambios posteriores ajenos.
No borra sidecar ni capturas y no restaura bot.db. No se afirma que el rollback
de fases futuras haya sido ensayado por esta preparación.

## Gate pendiente

Telemetría activada y evidencia documentada. Se importaron 21 fixtures reales
con 14 categorías; falta una encuesta/voto nativo. Los sintéticos no cuentan
para ese gate. La categoría mention cubre estructura real de mención humana;
no afirma addressing al bot. El cliente pide interacción natural sin @ ni
prefijos. fromMe conserva el evento real send.message, no acredita S13.
No se generarán mensajes hacia terceros ni se publicará evidencia ficticia.
Fase1 permanece sin iniciar hasta `verify-phase0` PASS.
