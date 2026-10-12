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
| 0 Baseline y seguridad | Cerrada con excepción autorizada F0-E001 | Gate0 PASS; 21 fixtures reales / 14 categorías; poll diferido por cliente; baseline y trazabilidad completos |
| 1 Cimientos | Cerrada | Gate1 PASS: verify exit0; 42 tests; 100% líneas config/TTL/queue/scheduler; 90 env documentadas |
| 2 Adaptadores | Cerrada con excepción F2-E001 | verify:phase2 PASS; 123 tests verdes; legacy636/159, cero nuevos y28resueltos |
| 3 Pipeline y sombra | Lista para iniciar | Gate2 PASS con deudaF2-E001; 24h reales de sombra requeridas |
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
Gate0 y Gate1 PASS; F0-E001 difiere encuesta hasta antes de polls.
Fase2 entregada y Gate2PASS con F2-E001. Próximo: WOs pipeline/políticas/
featureshelp-system-info, revisión arquitectónica y sombra con cero efectos.
No comenzar sombra/canario antes de Gates2/3. Telemetría v1 continúa.

## Checkpoint operacional histórico previo a captura

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

## Checkpoint 2026-10-12 19:31 UTC — cierre Fase0 y arranque Fase1

- Usuario: “omite la encuesta por ahora. avancemos, que sigue?”. Excepción F0-E001 en phase0-exceptions.json; pendiente capturar encuesta/voto real antes de migrar polls en Fase4 olaB. No se afirma cobertura poll. Gate0 PASS conserva todos los otros requisitos y mínimo12 muestras/tipos reales.
- Captura desactivada vía operador; preload retirado, aliases privados borrados del cache/env, Node args originales. PM2 online PID2606310, health200, colas vacías. Telemetría continúa, evidence.startUtc actualizado al reinicio real 19:30:01.683Z. 11 invocaciones, 11 resultados desconocidos.
- Fase0 entregables en commit6c2440d; cierre/excepción en siguiente commit. No hay cambios de negocio ni migración de DB.
- Fase1 autorizada: WO013 contracts_review config/env; WO014 fixtures clock/TtlStore/queue/scheduler; WO015 traceability logger/metrics/crypto/maintenance/domain; WO016 maestro tooling, arquitectura, integración y gate. Trabajo SOLO worktree v2; no activar v2 en producción durante Fase1.
- Gate1 requiere verify verde, >=90% líneas config/TtlStore/queue/scheduler y .env.example generado con cobertura de env usadas. No avanzar Fase2 sin Gate1 completo.

## Cierre Fase1 — 2026-10-12 UTC

- Gate1 PASS después de npm ci --ignore-scripts limpio: npm run verify exit0, 42 tests pass/0 fail/0 skip. Typecheck strict/checkJs ES2022, ESLint, auditor AST y .env.example generado pasan.
- WO013 integrada: 90 env, aliases/patrón Gemini/infra explícitos, validación sin filtrar valores privados. Defaults v2 no cambian producción.
- WO014 integrada: Clock/FakeClock, TtlStore stats por namespace, cola light/heavy con backpressure y timeout conservando slots, scheduler explícito y sin solapamiento.
- WO015 integrada: logger JSON redacción/vocabularios cerrados, métricas bounded, crypto compatible3/4 segmentos, mantenimiento por puertos con ejecución compartida manual/ticker y dominio/error feedback natural.
- WO016 integrada: tsc/lint/auditor/CI/env-generador/cobertura. Node engine>=20.19 (host20.20.2); devdeps fijadas. Dependencias productivas no cambiaron en versión/integridad; audit10 riesgos legacy conservados.
- Cobertura crítica por archivo: config/schema100%, config/index100%, TTL100%, queue100%, scheduler100% líneas. Medidas de ramas en phase1-evidence.md.
- Trazabilidad: TR0738/0739 portados y comprobados en tests/unit/v2/crypto.test.js; resto conservado pendiente, no marcar por analogía.
- Última regresión legacy sigue795/608/187, cero nuevos; no fue repetida en Fase1 porque legacy/dependencias runtime no cambiaron. verify es gate v2 y no finge suite legacy verde.
- Producción continúa v1: contador activo, captura apagada, sin nuevos despliegues ni DB/config productivas modificadas en Fase1. CI preparada sin push/ejecución remota.
- Siguiente: Fase2 Evolution/store/AI; plan §12. F0-E001 vigente. No iniciada Fase2 ni activada v2 en producción.

## Publicación GitHub — 2026-10-12 UTC

- Instrucción persistente del cliente: subir los commits a GitHub; hacer push de los cierres de fase en la rama refactor/v2. No implica merge automático a main ni desplegar v2 antes de sus gates.
- Push atómico completado a origin (Yzy-zu/Botsky): rama refactor/v2 hasta f35dc40 y tag v1-legacy sobre eb993ef. Upstream origin/refactor/v2 configurado.
- Fases0/1, fixtures anónimos, PROGRESS y tooling publicados. Este checkpoint se publica en commit posterior; main no se modificó en remoto.

## Inicio Fase2 — 2026-10-12 UTC

- Cliente: “ok, prosigue a la fase 2.” Autorización continúa; push de entregas en refactor/v2. No se activa v2 ni se migra producción en esta fase.
- WO017 contracts_review: SQLite promise/transacciones, migración000 esquema completo, migraciones/backup/restore y reposusers/conversation.
- WO018 fixtures: Evolutionclient/outbound/media/groups/echoGuard/nativeTables, compat de firmas, fakeHTTP.
- WO019 traceability: IA providers/keyPool/circuitBreaker/config/failures/styles, fakeHTTP y FakeClock; sin llamadas pagadas.
- WO020 maestro: puertos core únicos, tooling contracttests/CI, revisión de APIs/schema, regresiónlegacy y Gate2. Driver SQLite se recompila SOLO worktree para contratos reales temporales.
- Gate2 literal exige contracttests3adapters, cero imports cruzados y suitelegacy verde. Baseline existente187fail no equivale a verde: se revisará la deuda/regresión y no se marcará cierre sin evidencia requerida.

## PAUSA solicitada por cliente — 2026-10-12 UTC

- Cliente agota tokens: pidió registrar avances y dejar pendientes hasta reinicio de su cuota. No avanzar Fase3 ni declarar Gate2 completo.
- WO017 store: 6 contratos reales verdes, SQLite3.52.0 en host, migración000 completa24tablas13indexes4ALTER, WALsnapshot/restore comprobados; driver recompilado solo worktree.
- WO018 Evolution:35 contratos verdes; todas18firmas+puertoMessenger, payload/media/echo/nativeTables y formatter. Nuevo CLI parcheo v2 preparado y probado en fixture temporal. Ningún parche/despliegue productivo ejecutado.
- WO019 AI:20 contratos verdes, Gemini/Groq/keyPool/breaker/failures/config/style; nestedrequestvalidation/deadlinecompartido/slotcleanup. Orquestación features/chat/router/lore/proactivo inventariada pendiente F3–5, no DROP.
- WO020 maestro: coreports únicos y structural typecheck, contratos en verify/CI, driver nativo en CI, CLI v2; falta cierre/audit Gate2. No existe aún check-phase2.cjs: se retiró el script package prematuro verify:phase2 que lo referenciaba.
- WO021 auditoría debtlegacy lista: E1/E2/E4 requieren env/harness externos; registra bugs/expectativas obsoletas sin cambiarlos.
- WO022:3 fakes explícitos añadidos, 28H1 arreglados sin alterar aserciones ni src; focalizados39/39 verdes.
- WO023: contrato v1API real/tempDB pasa individualmente, PERO falla bajo verify con cobertura conjunta; investigar subprocess antes de cerrar gate. No ocultarlo ni inferir regresión de negocio.
- Último npm run verify: typecheck/lint/architecture42módulos0violations/env90PASS; runner104pass/1fail, exit noverde. Log /tmp/botsky-phase2-verify.txt. Último fallo: storeCompatibility.test.js childexecFile en modo conjunto/cobertura.
- Regresión completa antes de arreglar H1:795tests/608pass/187fail, 108395.438258ms, mismo baseline rojo. Segunda corrida tras H1 fue detenida por pausa solicitada; /tmp/botsky-v2-phase2-legacy.tap está INCOMPLETO y NO acredita resultadosfinales. Reejecutar bash scripts/refactor/legacy-regression.sh (compila dentrocontainer y no toca bindinghost), no sustituir baseline original.
- Deuda legacy y decisión de excepción quedan pendientes para retomar; no declarar suiteverde ni Gate2PASS. Usuario pidió dejarlos pendientes más tarde.
- Formatting TSprinter se abortó ante comparación diferente ANTES de escribir archivo alguno; sources intactos. No hay formateo pendiente necesario para ejecutar.
- Producción permanece v1, contador activo/captura apagada, sin cambios/DBmigradas durante Fase2. Guardar checkpoint commit/push en refactor/v2, sin merge main.
- RETOMAR: leer PROGRESS/WO017–023, gitstatus/log; resolver fallo conjunto storeCompatibility; npm run verify; completar regresiónlegacy, auditar debt/decisiónGate2; actualizar trazabilidad/evidencia y cerrarfase solo con condiciones satisfechas.

## Reanudación Fase2 — 2026-10-12 UTC

- Cliente confirma reinicio de tokens y solicita proseguir; recuerda uso de subagentes. Mantener gate2 abierto hasta evidencia/excepción válida; la pausa previa NO aprobó la excepción de deuda legacy.
- WO023 agentefixtures investiga envsubprocess bajo cobertura; WO024 contracts_review prepara entorno reproducible legacy segúnWO021; WO025 traceability audita AIrequests/schema/fallback. Maestro revisa Evolution/tooling, integra y publica commits.
- Último checkpoint remoto a8db566. Limpieza whitespace Evolutionmedia y formatter sin cambio lógico; SQL000 conserva bytes originales por checksum de migración y evidencia esquema.

## Checkpoint reanudado — compatibilidad corregida

- WO023: fallo causado por NODE_V8_COVERAGE inyectado por Node; ruta temporal explícita/validada para instrumentation, envbusiness sigueallowlist3keys sincredentials. Contratos store con cobertura7/7 y verifyglobal105/0 pasan.
- Maestro: runner migraciones rechaza aplicar versionesolder después de historynewer antesdebackup/mutación; regressiontestreal verde (storeactual8/8 incluyendo nuevo).
- Regresiónlegacy comparable reactivada en containerread-onlysinred; recompila sólocopiatemporal, no modifica bindinghost. WO024 trabaja runner mejoradoaislado separado para resolver causasentorno, sin false-green.
- WO025 AI encontró cinco defects de validación/salida/deadline; tests inicialmente0/5, correccionesencurso. WO026 Evolutionrevisión contratosen curso. No ejecutarverifyglobal hasta sourcesestables.

## Checkpoint Fase2 — revisión final 2026-10-12 21:10 UTC

- Usuario delega decisión de deuda/excepción: “lo q tu creas mejor papu”. Maestro elige F2-E001 diferir159fallos legacy previos porfunción, contractsv2 yverifyverdes, ceroNEW frentehashbaseline. Reevalúarantescadamigración/cutover; no autoriza DROP ni fingesuitelegacyverde.
- Regresión completa comparable795/636pass/159fail/0skip, duración194727.92496ms, exit1; SHA81962656e27ed0297955cfef189c5551a5464d47e55d3fc08c7643fbbda7b12c. Comparación conbaselineSHA038ef53...:28resueltos,0nuevos. Debt159IDs BF yarchivo/clasificación enphase2-legacy-debt.json.
- Verify actual123pass/0fail, typecheck/lint/arquitectura43modulos0violations/env93settings/gatecoveragePASS. Contratos independientes Evolution41,store8,AI29, todos0fail/skip. Evidencia JSON+MD preparada y gatePhase2 con test negativo excepcion/newfails ylistaDebt.
- WO025 completada: nueve nuevaspruebas reproducen/evitan schemaoptional/malformed, JSONprofundo, thought/metadata leaks, parts inválidas, deadline exacto. WO026: base64canónico, deliveryACKboolean bloqueafallback/retry, sin ID/bodyprivado.
- WO024 runner aisladomejorado opcional: buildestáencurso; dependencia externa sólo códigoRikolino y sharp/cheerio fixtures. Primer intento fallo de provenance packageexports, importsharp5x5 había pasado; corregido leer metadata víaFS. No riesgo producción; verificar --check antesentregar comooperativo.
- Trazabilidad: nueve casos nativeTables TR0372–0380 portados atests/contract/evolutionNativeTables.test.js; otros no marcados sin correspondencia real.
- Healthproductivo200, PM2onlinePID2606310,telemetríatrue,capturafalse. Sin reinicios/DBconfig/sourcelegacy nuevas duranteFase2.
- Next: finalnpmrunverify:phase2, evidenciafinal/ADR/progress, commitpush; nofase3antescierre.

## Cierre Fase2 — 2026-10-12T21:14:49.850Z

- npm run verify:phase2 EXIT0:123pass/0fail; 43módulos sinviolaciones; 93envsettingsgeneradas; coreports estructuralmente compatibles. Gate0PASS (F0-E001); Gate1PASS; Gate2PASS con excepción autorizadaF2-E001.
- Contratos Evolution41,store8,AI29 todosgreen; artefactos/hashes+regresión enphase2-evidence.json yreportemd. Debt159filelistBF enphase2-legacy-debt.json, clasificaciones106entorno/10harness/33candidatas/10indeterminadas. No se presume159bugsdeproducción.
- APIv1real probada sobrebasetemporalmigrada y viceversa. BackupRestoreWALintegritySHA comprobado. La recuperación featureblackjack/cooperacha y rollbackoperacional permanecen pendientes antescanario (no fingirS18).
- Userdelegatedscope F2-E001 difiere únicamente fallosprevios ypreserva0nuevos/contractsgreen; reevalúa cadafeatureantesmigración y todoelledgerantescutover. F0-E001 pollnativo sigue pendienteantespollsolaB.
- Capturaoff/telemetríaon, health200/PM2onlinePID2606310. Noactivaciónv2/cambiosDB/env/sourceslegacy productivos enFase2.
- WORKNEXT Fase3: pipeline8etapas+políticas5 conFakeClock/puertos; escenariosS01–S09,S12–S16, coberturapipeline/policies>=90%, revisiónarquitectónica, sombra24hreales sinbusinessIO. Orquestación AI pendientesseintegran segúnWO019. No sombra activa hoy.
- Runnerdeuda mejoradoWO024 imagenaisladacompletando --check/subset; suenv distinto NO reemplazaTAP comparable delgate. Cierre se publica enGitHub trasentrega.

## Runner deuda legacy WO024 entregado

- Imagen aislada construida y --check REAL verde: UID/GID1002, SIGKILLgrupo, FFmpeg/gs/pdfinfo/procps/git, SQLite/sharp/cheerio. SETUID/SETGID/KILL sólo contenedor PIDaislado sinred/socket/VPSwrite. No despliegueproductivo.
- SmokeadminXP7/7 yRikolino7/7, recortarPDF1/2: total16tests15pass1fail0skip, exit1. Toolingahorapermite reproducirfailPDFcongsreal; registrarpendiente,no cambiar aserciones para aprobar. SHA43525dccd34481a7cebecfd404ad52133cda0808f38a8e07d0ed6cafdbcef636; TAP /tmp/botsky-legacy-enhanced-smoke.tap.
- Entornoenhanced distinto delbaseline, no prueba ausencia deregresiones porcomparaciónnumérica entreesosentornos. CierreGate2 usa sólo comparable795/636/159zeroNew+F2-E001. Enhancedfullsuite se reevalúa condeudafuncional enolas.
- Comandos: bash scripts/refactor/legacy-verification.sh --prepare / --check / --files test/nombre.test.js; defaultcorresuitecompletasin whitelist. No requerirproducción/serviciospagados.
