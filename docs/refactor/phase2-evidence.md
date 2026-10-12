# Fase 2 — puertos y adaptadores

Estado: Gate2 PASS **con excepción explícita F2-E001**. La suite legacy sigue
roja; no se presenta como verde. El cliente delegó la decisión al maestro:
“lo q tu creas mejor papu”, en respuesta a cerrar con deuda temporal o reparar
toda la suite antes de avanzar. Se eligió conservar la deuda y exigir cero
fallos nuevos. No autoriza borrar funciones/tests ni omitir futuras pruebas.

| Verificación | Resultado |
| --- | --- |
| npm run verify | PASS: 123 pruebas, cero fallos |
| Contratos Evolution | 41 pass / 0 fail / 0 skip |
| Contratos store | 8 pass / 0 fail / 0 skip |
| Contratos AI | 29 pass / 0 fail / 0 skip |
| CheckJs estricto y compatibilidad de puertos | PASS |
| Arquitectura | 43 módulos v2, cero infracciones |
| Configuración generada | 93 variables + patrón dinámico Gemini |
| Cobertura mínima de cimientos | >=90% por archivo crítico, PASS |
| Regresión legacy comparable | 795 tests: 636 pass / 159 fail / 0 skip |
| Comparación con baseline fijo | 28 fallos resueltos, cero fallos nuevos |
| Gate0 | PASS con excepción F0-E001, encuesta diferida |
| Gate2 | PASS con F2-E001 y deuda inventariada |

La regresión legacy usa la misma imagen fijada, configuración sintética,
ausencia de red/capabilities y copia desechable del baseline. El driver se
compila dentro del contenedor sin modificar bindings host. Duración
194727.92496ms; TAP SHA256
`81962656e27ed0297955cfef189c5551a5464d47e55d3fc08c7643fbbda7b12c`.
Mayor duración no se interpreta como cambio de rendimiento: compilación y
otras verificaciones coexistieron; no es un benchmark.

Los 28 fallos resueltos eran fakes cooperacha ausentes en tres harnesses; no
cambiaron aserciones ni fuentes legacy. Comparación por título y multiplicidad
contra TAP original fijado; agregadores suite excluidos como exige Node.
Los 159 restantes mantienen IDs BF y archivos en phase2-legacy-debt.json, con
clasificación detallada en baseline-failures.md. Antes de migrar cada función
se debe resolver su deuda; antes del cutover se revisa el inventario completo.
Las causas de entorno no se convierten automáticamente en defectos del bot.

Evidencia reproducible y hashes de contratos en phase2-evidence.json. Comandos:

```sh
npm run verify:phase2
bash scripts/refactor/legacy-regression.sh
node scripts/refactor/compare-legacy.cjs /tmp/botsky-v2-baseline.tap /tmp/botsky-v2-phase2-legacy.tap
```

Los informes TAP completos son temporales y no se publican: contienen datos
de fixtures y diagnósticos irrelevantes para el gate. El JSON publica métricas,
hashes y referencias BF; no credenciales, cuerpos de proveedor ni DB.

## Contratos y compatibilidad

Evolution conserva firmas legacy y aliases del puerto Messenger. Tests usan
HTTP localhost/fetch y Clock/IO/history inyectados. Incluyen envío, quotes,
grupos, límites reales/base64 canónico, errores sanitizados, entregas parciales,
echo temprano y tablas nativas. Un ACK bloquea reenvío/fallback; solo se conserva
un booleano técnico del error. EchoGuard requiere que quien lo llame filtre
eventos fromMe; no prueba todavía el pipeline S13. CLI native tables opera
solo por invocación explícita; nunca se parcheó el despliegue real en esta fase.

Store usa SQLite real, apertura/cierre explícitos, bloqueo serial y transacciones
sin intercalar operaciones externas. Migración000 reproduce24tablas13indexes
y4ALTER guardados. Migraciones/checksums/idempotencia/rollback comprobados;
versiones retroactivas se rechazan antes de escribir. VACUUM INTO produce el
snapshot coherente con WAL y escrituras concurrentes, validado mediante
integrity/checksum y restore nuevo. API v1 real lee y escribe la base temporal
migrada, y v2 lee sus escrituras. Eso no certifica recuperación de cada feature
ni un rollback de producción: se ensaya antes de su canario.

AI tiene Gemini/Groq, claves dinámicas/rotación/cooldown, circuit breakers
concurrencia/half-open y deadline compartido. Contrato público LLM permanece
en domain, sin importar otros adaptadores. Respuestas/esquemas/JSON acotados,
thoughts y metadata privada no salen del puerto. Tests de PDF/tools/safety,
fallback y formato estructurado usan transport fake, sin llamadas pagadas.
El transporte real debe respetar timeout. Prompts y orquestación de router,
chat, lore/proactivo/tool-execution se migran en sus fases; no se consideran
portados aquí ni se eliminó legacy.

## Operación y siguiente fase

Producción sigue v1, contador activo y captura apagada. No cambios de .env,
escritores/jobs, DB o despliegue v2 durante Fase2. Fuentes de plataforma/domain
y adaptadores no arrancan servicios al importar. Worktree permanece aislado.

Siguiente: Fase3 pipeline/políticas y revisión de addressing natural. Requiere
escenarios, >=90% cobertura y 24h reales de sombra sin efectos de negocio;
tests locales no sustituyen esa observación. No se inició sombra/canario.
F0-E001 (poll nativo) sigue pendiente antes de migrar polls en olaB.
