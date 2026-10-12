# Fase 0 — baseline legacy aislado

Fecha: 2026-10-12 UTC. Código medido: `eb993ef11885e17aacea5cdc65bcc9efa59186b4`.
No se modificó `src/`, `test/`, el lockfile ni el proceso de producción.

## Resultado bruto

| Métrica | Resultado |
| --- | ---: |
| Tests reportados por Node | 795 |
| Pass | 608 |
| Fail | 187 |
| Cancelled / skipped / todo | 0 / 0 / 0 |
| Suites | 1 |
| Duración del runner | 110067.876698 ms |
| Exit code | 1 |

**Suite no verde.** Este resultado no acredita 187 defectos de producción:
la suite mezcla tests con mocks, servicios live, herramientas del servidor,
configuración personal y lectura textual de código. Ver
[clasificación de fallos](baseline-failures.md) antes de atribuir causas.
Los fallos previos no se reparan en Fase 0 ni se excluyen silenciosamente.

El inventario estático identifica 804 casos nominales en 72 archivos. El total
del runner no es el inventario: algunos archivos no llegan a registrar todos
sus tests al fallar imports y Node también reporta fallos de archivo/suites.
Dos archivos no cargan por su dependencia absoluta de sharp en un proyecto
vecino: `anti_repetition` (4 casos) y `rikolinoLibrary` (7 casos). Los 11
casos no registrados se sustituyen por 2 fallos de archivo: 804 - 11 + 2 = 795.
Esta conciliación no declara ejecutados los casos de esos archivos.

## Reproducción e aislamiento

Runtime: Node v20.20.2, ARM64. Imagen Docker `node:20-bookworm` fijada en
`scripts/refactor-baseline.sh` por digest
`sha256:8f693eaa7e0a8e71560c9a82b55fd54c2ae920a2ba5d2cde28bac7d1c01c9ba5`.

```sh
cd /home/petrov/botsky-v2
npm ci --ignore-scripts
bash scripts/refactor-baseline.sh --prepare
bash scripts/refactor-baseline.sh
```

La preparación compila sqlite3 dentro de la imagen con headers locales y sin
red. No usar un binding compilado contra la GLIBC del host en esta imagen.
El runner comprueba que sqlite3 carga antes de iniciar la suite.

El contenedor tiene red desactivada, sin puertos publicados ni Docker/SSH
sockets del servidor; source de solo lectura y copia temporal de código,
tests y datos del worktree. No se copiaron `.env`, DB ni credenciales reales.
`env -i` elimina el entorno heredado. DATA_DIR/TMP_DIR/HOME son temporales.
Evolution apunta a loopback sin servicio real, con instancia y claves
ficticias; Gemini/Groq reciben claves sintéticas para permitir los mocks.
No se configura un administrador global real. Loopback permite HTTP fake
de tests. Límite: 1 CPU, 1 GiB, 256 procesos y deadline de 600 segundos.

Con todas las capabilities removidas, tests shell que intentan pasar de root
a UID 1002 fallan con `spawn EPERM`. Tampoco se montan herramientas, datos ni
dependencias absolutas de proyectos vecinos. Estos son límites explícitos del
baseline aislado; no se interpretan como regresiones. Las pruebas live no
pueden acceder a proveedores reales.

Salida TAP completa temporal: `/tmp/botsky-v2-baseline.tap`; el resumen y la
clasificación quedan versionados. La salida temporal puede perderse después
de un reinicio; el comando permite repetirla.

## Intentos de preparación descartados

- El primer inicio excedía CPUs disponibles: exit 125, sin suite ejecutada.
- Binding SQLite del host exigía GLIBC_2.38, no disponible en bookworm:
  resultados descartados; se recompiló dentro de la imagen.
- Un intento sin configuración ficticia completa de Evolution falló al
  importar módulos. Se corrigió el entorno y se repitió la suite completa.
- La primera medición completa omitía `scripts/` en la copia del runner:
  787 tests, 599 pass y 188 fail. Se añadió ese directorio y se repitió: los
  nueve tests de tablas nativas pasan, sustituyendo un fallo de carga de archivo.
  Snapshot anterior: `/tmp/botsky-v2-baseline-first.tap`.

Estos intentos no se suman al resultado bruto anterior. El baseline válido
usa binding compatible y configuración sintética completa; conserva las
limitaciones operativas descritas.

## Otros gates

- Trazabilidad: 804 IDs únicos y destinos propuestos; ningún test portado aún.
- Fixtures sintéticos: 16 validados; capturas reales anonimizadas pendientes.
- Tooling `npm run verify`: aún no existe; corresponde a Fase 1.
- Dependencias: 10 vulnerabilidades (6 altas, 1 crítica, 3 moderadas), ver
  [inventario de dependencias](dependency-baseline.md). No se aplicó force-fix.
- Telemetría v1: diseño documentado, implementación/activación pendientes.
- Gate 0 permanece abierto por evidencia de fixtures reales, salvo excepción
  explícita del cliente. No se ha comenzado Fase 1 ni desplegado v2.
