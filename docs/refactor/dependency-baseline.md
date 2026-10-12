# Dependencias — baseline de Fase 0

Fecha: 2026-10-12. Fuente: `npm audit --json` después de instalar el lockfile de `eb993ef` en el worktree. No se aplicaron actualizaciones ni se cambió producción.

Resultado: 10 vulnerabilidades: 3 moderadas, 6 altas y 1 crítica. El gate de cutover permanece pendiente hasta resolver o evaluar cada hallazgo; el plan exige cero severidad alta.

| Paquete | Severidad | Directa | Rango afectado |
| --- | --- | --- | --- |
| `axios` | high | sí | `1.0.0 - 1.19.0` |
| `body-parser` | moderate | no | `1.20.5 - 1.20.6` |
| `brace-expansion` | high | no | `2.0.0 - 2.1.6 || 4.0.0 - 5.0.11` |
| `braces` | high | no | `*` |
| `chokidar` | high | no | `2.0.0 - 3.6.0` |
| `express` | moderate | sí | `4.22.2` |
| `nodemon` | high | sí | `0.0.0-development || >=1.14.11` |
| `proxy-addr` | critical | no | `1.1.0 - 2.0.7` |
| `qs` | moderate | no | `2.2.5 - 6.15.3` |
| `undici` | high | no | `<=6.28.0` |

La sugerencia automática para nodemon propone un cambio mayor y no se aplicará con `--force`. Evaluar actualizaciones compatibles y repetir pruebas en una WO propia después del baseline. La salida completa se conserva temporalmente en `/tmp/botsky-v2-audit.json`; este resumen no necesita datos personales ni secretos.
