# Refactor v2 — registro de continuidad

Actualizado: 2026-10-14 UTC. Maestro: Codex. Plano: `plan.md`.

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
| 3 Pipeline y políticas | Cerrada con excepción F3-E001 | verify314/314, hooks55/55, gate3PASS; sombra cancelada explícitamente por cliente |
| 4 Migración A–D | OlaA en preparación/integración local | Adaptadores y pruebas locales; paridad, traza y canario pendientes |
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

Fase3 cerrada con excepción F3-E001; cliente canceló la sombra, NO reactivarla.
Producción v1 online con guard determinista de grupos y proactividad apagada.
Retomar integración de olaA (src/v2/composition/media.js), revisar paridad pendiente,
portar filas de traceability y preparar canario real con único dueño por evento/job.
No declarar v2 productivo ni migración completa antes de sus gates.

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

## PAUSA — auditoría de los 159

- Fecha: 2026-10-12T21:23:03.018225+00:00. Usuario pide pausar por tokens y retomar exactamente aquí. No más correcciones o suites hasta que reanude.
- Rama/worktree: refactor/v2 en /home/petrov/botsky-v2; último cierre publicado399286e. Este checkpoint se publica por separado. Producción permanece v1, sin despliegues/fixes de esta auditoría aplicados.
- Trabajo autorizado: clasificación reproducible antes de Fase3, corregir mocks/defectos confirmados y conservar pruebas de comportamiento; no modificar aserciones solo para obtener verde.
- WO027 contracts_review: entorno/E2/E4, runner enhanced FULL inicial inmutable terminó804tests/708pass/96fail/0skip. TAP /tmp/botsky-debt-initial.tap. Este entorno difiere del comparable795/636/159 y recupera11casos antes bloqueados por imports: NO decir que se corrigieron63bugs por restar159-96.
- WO028 traceability: IA/proactivo/engine, transport mocks offline. Test aiOfflineHarness nuevo; ai/ai_pool/agentEngine/contactos_naturales cambios en curso. Esperar/revisar reporte WO028 antes de integración global.
- WO029 fixtures: mensaje/toolRegistry/commandRegistry, autenticación desde remitente real y argumentosJSONmalformados; cambios sin validación global final. Tests mensaje/toolRegistryRobustness cambiados. Reporte focalizado19pass/4fail; defecto confirmado pendiente en src/services/db.js:813: searchJids.find llama endsWith sobre null/undefined desde afinidad. No corregido aún. BF120 handlers variados pertenece al maestro.
- WO030 maestro: norma contractual previa docs/interpretacion-semantica.md: normalizador conserva texto y aporta sesiones; fechas/páginas naturales son normalizadas por modelo, executor usa datos canónicos. No restaurar heurísticas retiradas para aprobar tests.
- Root juegos: tests blackjack/daily/ruleta ahora preservan texto+sesión sinprefijo; validación de XP/estado/reembolso continúa. Daily confirmación española actual y resultadoestructurado comprobados; convertir missing-file conserva rechazo y siguiente paso sinstack. Subset20/20pass0fail0skip en /tmp/botsky-debt-games.tap.
- Subsetroot anterior237tests/189pass/48fail/0skip en /tmp/botsky-debt-root-initial.tap; no es suitefinalni incluye cambiosposteriores. Mantener como diagnóstico inicial.
- WO027 propuesta desde3 parser descartada tras leercontratoactual; testPDF usa p=3- provenienteplan canónico, conserva conteopáginas y rechazo desde3/0-/10-. NO source documentos.js modificado según última coordinación.
- Todos los contenedores de tests legacy aisladamente detenidos al pausar (los que terminaron antes se preservaron). Nada de detener Evolution/Postgres/Redis/productivo. No jobs v2/sombra activos.
- No se ejecutó verifyglobal después de estos cambios. Gate2 PASS corresponde al cierre399286e anterior, no certifica este checkpoint en curso. No avanzar Fase3 ni afirmar que159todosresueltos.
- RETOMAR: leer reportes WO027–029 + gitstatus; reparar db813/nullJid y VMmock authnuevo de toolRegistry; revisar semántica de testsobsoletos con docsantesassertchanges; correr subsets y enhancedFULL; ledger por BF con evidencia/reproducción/conclusión; verify:phase2 y nueva evidencia solo después de green adecuado; commit/push.

## Reanudación auditoría — 2026-10-13

- Usuario reanuda y solicita resumen legible en ~/; creado /home/petrov/BOTSKY-AVANCE.md antes de continuar. Sin credenciales/datos personales.
- WO030 maestro: getUserAffinity ahora rechaza JID/alias inválidos antes de SQLite y normaliza aliases; regresión añadida. El callback ya no cancela tests: stress7/6pass/1fail BF120, cero cancelaciones.
- Juegos20/20; escuelas/notas/recordatorios31/29pass/2fail con proveedores offline y fechas ISO canónicas. Dos fallos restantes cancelación escolar: tests llamaban extractor de creación en vez del executor; confirmar cleanup en ruta real antes cerrar.
- WO027 entrega128/128pass,0skip/cancel en /tmp/botsky-wo027-final.tap; WO029 entrega19/19pass y6/7stress (BF120 sigue). Son subsets, NO suite completa certificada.
- WO028 validación proactiva detectó string false convertido a true por Boolean; corrección de esquema y regresión en validación final. No restaurar heurísticas retiradas.
- Nuevas delegaciones: WO027 dispatcher/Minecraft/Whisper; WO029 BF120 guards handlers. Maestro cancelación escolar e integración. Fase3 permanece sin iniciar; producción intacta.

- WO030: cancelación escolar por executor canónico repara limpieza adjunto dentro school_media; nuevo test mantiene archivo externo y niega usuario no autorizado. Root integrado113/113pass en /tmp/botsky-debt-e2e-final.tap (e2e+school+affinity+notas+recordatorios), antesúltimo hardening de errores.
- Fallo real adicional reproducido: e2e mocking antiguo no inyectaba handler capturado por registry; composición VM lo ejecuta y detecta API_KEY sintética enviada al usuario. Dispatcher ahora expone sólo userMessage explícito y genérico para excepciones técnicas/null; queue marca rechazo de capacidad como userMessage. Revalidación pendiente tras última edición.
- verify:phase2 actual123/123 y telemetría/refactor35/35 verdes. Atestación Gate2 sigue histórica F2-E001; auditoría general en curso no certificada aún.

- Primera integración completa814/802pass/12fail, cero skip/cancel; /tmp/botsky-debt-integrated.tap. Fallos nuevos fueron fixtures: registry optionalfields/mutaciónMP3, servidor hijo DATA_DIR/instrumentación heredada y VMauth en wrappers. Corregidos por WOs, sin ocultar resultados.
- La segunda corrida /tmp/botsky-debt-final.tap se detuvo exclusivamente en contenedor de tests a299eadb36f7 (mount /tmp/botsky-legacy-harness.aiJQI2ZP), porque su snapshot precedía última expectativa NaN/Infinity; NO usar TAP incompleto como certificación. Ningún contenedor productivo afectado.
- Corrida final vigente /tmp/botsky-debt-verified.tap toma snapshot idéntico a src/test/scripts actuales (comparación SHA por archivo sin diferencias). No editar fuentes hasta conclusión. Runner fixes y fakes finales congelados.
- PM2 wasa onlinePID2606310 y /status HTTP200 comprobados de nuevo; sin reinicios/deploy/env/DB productivos.

## PAUSA solicitada — 2026-10-13T00:54:32.708363+00:00

- Usuario: “pausa, los tokens se van a acabar. guarda el progreso y dime donde nos quedamos”. Se detuvo SOLO contenedor de tests c6d9a63bf6d7, imagen legacy-verification, mounts /tmp/botsky-legacy-harness.mtcjFvqG; no producción. Todos los agentes terminaron y no hay nuevos trabajos autorizados mientras dure pausa.
- Estado: auditoría de159 implementada e integrada localmente, pruebas focalizadas verdes y revisión read-only sin nuevos defects confirmados. NO cierre global: /tmp/botsky-debt-verified.tap detenido aproximadamente tras caso719, sin resumen final válido. No tratar sus resultados parciales como suite verde. /tmp/botsky-debt-final.tap también fue detenido antes; primera integración completa /tmp/botsky-debt-integrated.tap814/802/12 documenta los fallos de fixtures ya corregidos.
- Verificación completa disponible del código actual v2: /tmp/botsky-audit-final-v2.log npm run verify:phase2 PASS123; telemetría/refactor /tmp/botsky-audit-final-refactor.tap35/35pass. Gate2 attestation F2-E001 corresponde a evidencia histórica, no certifica los cambios legacy de esta auditoría.
- WOs:027 entorno/providers128/128+expanded75/75+Challenger4/4;028 IA82/82+semántica/unificación14/14+wrappers27/27;029 permisos19/19, ampliaciónstress/mensaje27/27, regresióncomandos82/82, registry+stress13/13;030 root juegos20/20, e2e/escuela/afinidad/notas/reminders113/113 antesúltimoerrorhardening, e2e final73/73 después. Sin skips ni paid calls. Detalles y rutas exactas en WOs.
- Fixes confirmados: db affinity valida JID/alias antescallback; AI proactiva valida bool/canal/mensaje; toolRegistry auth desde remitente y JSON seguro, telemetrymemoización sin duplicate; handlers malformedinputs no TypeError; sistema invalidfrom no timer; cancelación escolar limpia sólo school_media; dispatcher no envía errores técnicos/secretos, queue marca userMessage de capacidad.
- Integración adicional: registry conserva parsed/flags mutación pública MP3 y defaults de argumentos opcionales; runner configura DATA_DIR por testworker y childserver conserva DB explícita sin NODE_TEST_CONTEXT/NODE_OPTIONS heredados. Tests usan planes canónicos y fakes proveedores; no heurísticas naturales restauradas.
- Resumen personal /home/petrov/BOTSKY-AVANCE.md actualizado. Checkpoint se guarda en commit/push refactor/v2 sin merge main, .env/DB/logs excluidos.
- RETOMAR EXACTO: gitstatus/log en /home/petrov/botsky-v2; leer WO027–030 y este checkpoint. Ejecutar BOTSKY_LEGACY_VERIFICATION_OUTPUT=/tmp/botsky-debt-verified-resumed.tap bash scripts/refactor/legacy-verification.sh (sin editar scripts/fuentes mientras esté corriendo). Exigir resumen completo, exit0, cero fallos/cancel/skip; si falla investigar antescerrar. Crear conciliación final por159BF y evidencia hashes separada (ledgerF2histórico intacto), actualizar reportes/PROGRESS y publicar. Sólo después planificar Fase3/pipeline y sombra24h; ninguna sombra activa hoy.

## Reanudación — 2026-10-13T02:26:51.413472+00:00

- Usuario confirma cuota y pide seguir. Rama limpia en5e9bf8d; suite integral reactivada en contenedor aislado /tmp/botsky-debt-verified-resumed.tap. No edición fuente/test/script hasta resultado.
- Traceability concilia159IDs en reporte separado; contracts_review prepara desglose Fase3 read-only. No cierre deuda ni avance gate antes resultado completo; no sombra ni cambios producción.

## Cierre auditoría159 — reanudación verificada

- Runner final EXIT0, /tmp/botsky-debt-verified-resumed.tap:814tests814pass0fail0cancel0skip0todo,145743.384052ms; SHA13b845f7eaebfbd09e1fc04719a6bf7dfbfaf3da5d564e15e5bc30af4f200a11. Snapshot5e9bf8d Node20.20.2ARM64.
- Conciliación legacy-debt-resolution.json/md159IDs exactos, todos global_verified, ledger histórico SHA00ec1da89032bc5363ddcd453c93f38c241dd30efa9a3ea38ddf8840a7102784 intacto. ExcepciónF2-E001 ya no tiene casos pendientes en entorno enhanced; evidenciaF2 histórica no reescrita. No afirmar159bugs reparados: incluye entorno/harness/contratos obsoletos y defectos confirmados.
- Producción siguev1 intacta. Suite aislada no acredita disponibilidad de proveedores remotos ni comprensión live. Resumen~/BOTSKY-AVANCE.md se actualiza.
- InicioFase3: WO031 fixtures5políticaspuras, WO032 contracts_review ingest/normalize/gate/context/coalescer; maestro sharedcontracts/router/executor/composer/orquestación +featuresmínimas. No activación/sombra todavía. Gate3 requiere90%pipelinepolicies+escenarios+revisiónarquitectónica+24h reales; no sustituirsoak portests.

## Fase3 implementación del núcleo

- WO031 cinco políticaspuras12tests,100%líneas; WO032 ingest/normalize/gate/context/coalescer26tests100%; WO033 features help/system-info y repo hilo aditivo15tests100%; WO034 observadorsombra6tests100%. No migración001 productiva ni writesbot.db.
- Maestro router/executor/composer/index/main y16escenarios requeridos. Primera integración pasó196tests tras extender gate cobertura; revisiones detectaron compatprefijos /! /@, selecciónprivada texto no-numérico, campos tokens incompatibles manifests, context.read errors y repetición tras historyerrors. Corregidos con regresiones y revisión continua; finalverify en curso, NO certificados por snapshotanterior.
- Gate3 nuevo verificador exige24hreales activasSystemClock, tráfico+sinbusinessIO/excepciones, checkpointreciente y diffs revisados. FakeClock/archivo viejo/cobertura insuficiente no cierran fase. WO035 prepara puenteproductivo OFFdefault con planesv1 grabados yunknown explícito cuando noexisteplan; cero proveedores live adicionales.

## Fase3 checkpoint local verificado

- verifyfinal219pass0fail;69módulos0violaciones,94settings; pipeline/policies100%líneas y16escenarios requeridos verdes. Refactor/telemetría/hooks52/52. Código fuente listo para sombra parcial; Gate3 OPEN (tiempo/diffs/revisión final pendientes).
- WO036 rateLimiter60por60s porchat+sender/cooldown3s sólotrasreply, config porinyección; rootmain conectado. Identidad domain/jid compartida preservac.us/device/521 y namespacesnumericexact; testsconIDsficticiosprovider-válidos corregidos trasstrictnormalización.
- Preparado manager sombra additive-only: no copiarfixeslegacy de esta auditoría aproducción ni DB/schema001; NODEpreload captura decisionesv1 reales, unknown explícito, HTTP200antesobservador. Cero llamadasproveedor extra. Guardatelemetríaon,Nodeargsarray,checkpointoperacional; rollbackautoinitfailure.
- Archivo phase3-evidence.json/md registraresultadoy límites. Activación siguiente trascommit/push; nofake24h niGatePASS.

## Activación operacional Fase3 — 2026-10-13T03:02:40.938Z

- Commitfuentes3c56f0a publicado enGitHub; auditdebt f928ef5 publicado. ManageractivateEXIT0 ycheckpointrealoperationalClock:true antesafirmararranque. PM2wasaonlinePID2916445; /statusHTTP200 despuésreinicio autorizado. Businessownerlegacy, contadorphase0on, capturaoff; fuentesbusinessv1 no reemplazadas ni bot.db/schema migrados.
- Nodepreloadagregado despuésdeargumentosoriginales; rollbackprivado /tmp/botsky-phase3-shadow-state.json0600. No copiarstate/env/JSONLprivado alGit. Diffs dedicados /home/petrov/botsky-shadow/run-1791860560562.jsonl0600, checkpointporheartbeat60s. Desactivar: node scripts/refactor/manage-phase3-shadow.cjs disable (restaura modo/nodeargsoriginales, no borrar módulos/cambios ajenos).
- Usuarioenvía saludoprivado y Botskyayuda engrupo traspregunta opcional. TráficoREAL comprobado:4diffs alprimerreporte, categoríasunknown3/changed1,0excepciones/0sinkErrors/0drops. Ayudacompara v1commandhelpLLM vs v2intenthelpLLM, respondtrue/wake-word: cambioestructural esperado, no una función diferente. Otrosreplysinplanactualgrabado quedanrecorded-plan-unavailableunknown; no se fabrican matches.
- Statuscontroller checkpoint.active expresa workerBUSY (falsecuandoidle), no estado deobservación. report-phase3-shadow.cjs calcula active por PM2online/mismoPID/modoshadow,operationalClock yheartbeatreciente; no confundiridle con stop. Reinicio cancela continuidad yrequiere nuevaejecución exclusiva.
- Reporte público sinPII phase3-shadow-status.json yphase3-evidence.json. Countersunmatched incluyennotificaciones/records no correlacionados; no son erroresni matches. Sombra inicialparcial, no importahistorial/sesioneslegacy, sinproveedoresadicionales ni herramientas/ejecuciónpasiva de v2; sóloIOdeobservación dedicado.
- Gate3OPEN confirmado: falta24h real, revisiónfinalarquitectónica yrevisióncategorías (unknown/v2-more). Earliest2026-10-14T03:02:40.938Z si continuidad yzeroerrors. No crearFase4duranteespera. Observación sigueactiva alfinal delturno, no tarea pausada ni fasecerrada.
- RETOMAR: leerestecheckpoint; node scripts/refactor/report-phase3-shadow.cjs --write; health ysourcehashes/privatePM2samepid. Si reiniciomodo/stale/error: no acreditartiempoanterior, investigarrecuperarantesnew24h. Agregarcategorías revisarv2-more/unknown, terminarrevisiónarquitectónica conformecontratos actualrate/hilo. npm run verify:phase3 requiereevidenciasfinales, nomanipularGate por unidadeslocales.

## Reanudación con agentes — 2026-10-13 10:15 UTC

- El usuario reanuda y pide desplegar agentes. WO037: revisión arquitectónica y correcciones; WO038: verificación y fixtures; traceability: revisión de diffs en phase3-diff-review.md. Entregables integrados.
- Sombra real: 7 h 12 min de las 24 necesarias, mismo PID 2916445, health 200, cuatro diffs (unknown 3, changed 1), cero excepciones/sinkErrors/drops/timeouts. Fecha mínima permanece 2026-10-14T03:02:40.938Z, condicionada a continuidad. Los 73 archivos instalados coinciden con sus SHA. No hubo reinicios ni cambios de env, Nodeargs, DB o fuentes productivas durante esta reanudación.
- Correcciones locales reproducidas: normalize rechaza identidades vacías tras canonicalizar, sender de grupo y namespace incoherente; recomputa confianza de cita con identidad válida o ID exacto. main.dispose devuelve Promise idempotente, bloquea admisiones y envíos al comenzar el cierre, y drena pipeline/queue antes de disponer TTL/limiter. Executor aborta señales; Composer comprueba cierre después de awaits y antes de cada parte/chunk. No se desplegaron esas correcciones a la sombra actual, que no ejecuta Executor/Composer.
- WO038 detectó nueve fallos por fixtures g@g.us/bot@s.whatsapp.net inválidos tras el endurecimiento de identidad. Sólo se cambian cinco líneas de IDs ficticios, sin debilitar aserciones: 43/52 inicialmente, 52/52 después. El resultado 52 anterior no había revalidado esa última canonicalización; WO038 conserva evidencia antes/después.
- Gate3 ahora rechaza observed ausente, NaN, Infinity o no entero. Nuevas regresiones verifican entrada normalizada inválida, cierre con handlers heavy/none, router/chat/replay pendientes, salida multipart y Promise idempotente.
- Integración final: npm run verify EXIT0, 229 pass/0 fail; 69 módulos sin violaciones, 94 settings y 100% líneas de pipeline/policies. Refactor/glue: 52/52, cero skips/cancelaciones. Logs temporales y hashes en phase3-evidence.json. Revisión funcional favorable WO037; Gate3 sigue abierto por tiempo y revisiones operacionales finales.
- unmatched=304 no significa 304 errores o pérdidas: mezcla notificaciones no normalizables, decisiones sin pending y errores de clonación de plan. Sin desglose no atribuir cantidades. Los tres unknown siguen indeterminados. El changed de ayuda conserva feature/via/respond; es diferencia estructural command→intent, no una acción extra.
- RETOMAR: después de la fecha mínima, ejecutar report-phase3-shadow.cjs --write y comprobar mismo PID, hashes, heartbeat reciente, errores y diffs completos. Distinguir versión instalada 3c56f0a del candidato local corregido. Si no hay 24 horas, mantener gate abierto. No acreditar historial/sesiones de producción desde estos tests. Publicar commit/push de esta integración.


## Reanudación e incidente — 2026-10-14 UTC

- Cliente pide proseguir y usar agentes económicos: se delega con gpt-6-luna; maestro mantiene su modelo actual.
- Incidente confirmado por logs retenidos de v1: 3 envíos proactivos al grupo, 9 privados y 2 intervenciones burst. Estos contadores abarcan el log retenido, no una ventana garantizada. También hay timeouts de proveedores y errores HTTP; no se atribuyen todos al mismo incidente.
- PM2 registra SIGKILL a 01:30:40 UTC; no hay evidencia de OOM en el journal consultado. El motivo del SIGKILL permanece indeterminado. La sombra llegó a 22h27m58s, NO a 24h; el preload falló al reutilizar archivo exclusivo después del reinicio.
- Maestro pausó exclusivamente wasa a 02:00:40 UTC para contener. Evolution/Postgres/Redis permanecieron activos. Backup privado de las dos fuentes tocadas: /tmp/botsky-incident-backup-1791943771 (0700, archivos0600).
- Usuario cancela explícitamente el observador: “ya olvida el observador, el chiste es q el bot quede ya listo”. F3-E001 autoriza retirar el requisito de sombra real; no afirma soak ni paridad completa. No se siguió desarrollando su recovery. Informe del tramo interrumpido conservado en phase3-interrupted-shadow.json.
- Corrección productiva MINIMA: proactive.js requiere PROACTIVE_ENABLED exactamente true para scheduler/ciclo/burst; default apagado y guardas antes de enviar. dispatcher.js corta conversación grupal ajena antes de fastpaths/IA; permite Botsky/botsito, mención propia, cita propia verificada, prefijo opcional y seguimiento de adjunto del mismo dueño. Citas autentican identidad exacta; texto/historial/substring no prueban autoría.
- Producción solo recibió los nuevos hunks del guard y proactive.js; NO el resto de correcciones legacy del worktree ni features v2. BOT_NUMBER configurado desde identidad real verificada, sin publicar su valor. PROACTIVE_ENABLED=false explícito PM2. Preload/flags sombra retirados y argumentos originales restaurados; PM2 save completado.
- Bot restaurado online PID3667357, modo legacy, health200, log confirma kill switch apagado. Esto acredita arranque/contención, no una conversación live end-to-end.
- Pruebas incidentales: VM kill switch3/3; Docker proactive+AIharness10/10; Docker guard/dispatcher/routingFailure49/49, con6 expectativas de conversación ajena actualizadas según política aprobada. Refactor hooks55/55. verify aún pendiente: primer intento detectó BOT_LID sin schema y se añadió/documentó (95settings); reintentar después de estabilizar preparativos de olaA.
- F3 adicionales locales: config central ya gobierna límites chars/tokens (incluye variación de repetición), S10/S11 verdes offline, runbook canario preparado. Gate3 requiere verify actual + revisión de núcleo + excepción explícita; sigue abierto hasta integrar evidencia.
- Preparación olaA en agentes: QR/OCR/transcripción, documentos/conversión, sticker/voz con puertos inyectados. NO activar ni declarar ola cerrada por tener manifests: faltan adaptadores reales, composición, tests portados/traza y canario por ola.
- Próximo: verify final y cerrar F3 con F3-E001, commit/push; integrar adaptadores/composición de olaA y sus pruebas. Fases4–6 aún no completas. Observador retirado por instrucción, no volver a activarlo sin nueva petición.


## Checkpoint de integración — F3 cerrada / olaA local

- Verify final314/314 y95settings; arquitectura91módulos0violaciones. Refactor55/55, legacy819/819,0skip/cancel; logs/hashes en phase3-evidence.json. Gate3 debe comprobarse tras escribir evidencia; F3-E001 elimina solo el requisito del observador real.
- OlaA preparada: QR/OCR/transcripción, documentos/conversión/colecciones PDF, sticker/efectos/censura/collage y voz mediante puertos; adaptadores nuevos sin imports legacy; composición concreta en src/v2/composition/media.js, registro rechaza doble dueño OCR/documentos.
- Deadlines por comando hasta15min para conversiones, cancelación enlazada hasta Evolution; salida QR/OCR/transcripción acotada con aviso, transcripción<=12partes. Composer libera refs en finally tras entrega/fallo/cierre; janitor TTL es respaldo para trabajos cancelados antes del composer.
- Descargas preservan providerKey original aparte de identidad canónica y verifican chat/id; quote desconocida nunca selecciona otro archivo reciente. URL downloader con DNS/IP públicos, conexión fijada, redirects limitados y bounds/cancelación, sin llamadas reales en sus contratos.
- Smoke REAL local con archivos sintéticos: QR encode/decode, conversión WAV→MP3 y recorte de la segunda página PDF pasan usando binarios instalados; no red/proveedores/mensajes reales. Archivo tests/smoke/media-local.cjs, evidencia /tmp/botsky-ola-a-local-smoke.log.
- BRECHAS olaA: extracción de webs/yt-dlp en nuevas URLs (solo archivos directos), destino/metadata completos de voz, implementación real de censura/collage, ZIP runtime ausente, paridad contentReader/multimodal, trazabilidad y canario. Estos preparativos NO cierranGate4A ni fueron activados en producción.
- PM2 conservóPID3667357, online/health200, PROACTIVE_ENABLED=false, modo legacy, sin preload sombra. Commit/push del checkpoint es el próximo paso; después continuar olaA sin volver a esperar24h.


## Checkpoint de runtime y canario privado — 2026-10-14 UTC

- Commit anterior6277898 publicado en origin/refactor/v2. Este checkpoint integra cambios posteriores; maestro continúa aun cuando agentes económicos agotaron su cuota. No se cambió su modelo por uno más costoso.
- Verificación actual353/353, refactor59/59, legacy820/820; cero fallos/skips/cancelaciones. Arquitectura96módulos,0violaciones;97settings. Gate3 PASS con F3-E001, sin reactivar observador. Evidencia y SHA en phase4-evidence.json.
- QR legacy y v2 usan terminador de opciones; payload no aparece en logs de QR. Fix legacy aplicado a producción; PID3710818 online, health200, colas vacías, proactivefalse y sin sombra al último chequeo.
- ZIP ya no depende del binario ausente: escritor acotado comprueba tamaño ANTES de leer. Censura/collage reales con FFmpeg y PDF escaneado con Poppler/Tesseract pasan con archivos sintéticos. Composición expone imageTools y fallback OCR para PDF sin texto.
- Voz conserva600segundos/20000caracteres y presupuesto de guion hasta4096tokens; no se reducen al límite conversacional. ElevenLabs candidato nuevo tiene6contratos offline verdes; su cableado real aún pendiente.
- Runtime explícito en composition/runtime.js: sidecar privado separado de bot.db, migraciones000/001, listas de acceso normal/admin/tareas para privados y grupos independientes, historial SOLO después de addressing, sin escrituras de sombra. Dispose drena aplicación y janitor; status distingue credenciales configuradas de salud real.
- Composer conserva referencia de media confirmada por proveedor ANTES de liberar archivo local: TTL por ID/chat, sin probar autoría por texto. Hook fallido no reenvía.
- Router entrega schemas de argumentos a IA y admite nombres de comando sin prefijo: «Botsky qr hola», «voz hola», «estado». Frases naturales que no cumplen sintaxis explícita pasan al router con schema. Pruebas cubren ambos recorridos.
- Bootstrap/server preparado para propietario único ANTES de normalización, XP, historial o despacho legacy; errores v2 no reejecutan legacy. Flags V2_CANARY_CHAT_IDS y V2_CANARY_FEATURES. Primer escalón: SOLO privado admin configurado, creaciónQR/ayuda/estado. LecturaQR, adjuntos sin caption, grupos y resto de capacidades siguen en legacy.
- Preparación no equivale a canario activo. Registrar despliegue/PID/health/evidencia posteriormente. Toda olaA permanece ABIERTA: continuidad de colecciones/adjuntos, contenido web/multimodal, paridad/traza de casos, ElevenLabs/destinos y prueba real privada+grupo. OlasB–D y Fases5–6 pendientes; no retirar v1.
- Retomar: completar instalación y canario privado mínimo con rollback verificado; pedir al cliente «Botsky qr hola» y «Botsky estado» cuando esté activo; comprobar counters/entrega real sin publicar JIDs/contenido. Después terminar brechas de olaA, no ampliar flags por tener solo wrappers/manifests.


## Canario privado mínimo ACTIVO — 2026-10-14 UTC

- Artefacto e8f15df publicado en GitHub; 97 fuentes v2 instaladas y verificadas contra ese commit, cero diferencias. Server recibió solo los hunks nuevos, preservando las modificaciones previas de producción. Backup privado: /tmp/botsky-canary-backup-1791972390875. Contiene fuentes anteriores y configuración PM2; nunca adjuntarlo a Git.
- Prueba real de composición productiva sin mensajes: graph construido, SQLite sidecar abierto/migrado y cerrado; cero mensajes externos. Ensayo del flag legacy en el bootstrap nuevo: PID 3906457, health 200, pipeline deshabilitado y colas vacías.
- Activado PIPELINE_MODE=canary con un privado (el único admin cliente configurado, diferente del bot), V2_CANARY_FEATURES=qr,help,system-info y PROACTIVE_ENABLED=false. PID 3906724, health 200, kill_timeout=45000 ms y PM2 save realizado. Ningún grupo pertenece a v2 y ningún job fue transferido.
- Lectura de QR/citas, multimedia y funciones restantes conservan legacy. Server selecciona propietario antes de normalización, XP e historial; una salida o error de v2 nunca reenvía por legacy.
- Validación humana pendiente: se pidió por herramienta asíncrona enviar «Botsky qr hola», «Botsky ayuda» y «Botsky estado», sin @ ni prefijos. No contar health ni contratos como entrega por WhatsApp. Los contadores seguros en /status.pipeline arrancaron en cero; consultar sin volcar logs personales.
- Trabajo local posterior separado del artefacto instalado: continuidad de colecciones, cableado de ElevenLabs y auditoría de paridad, delegados a agentes económicos si tienen cuota disponible. No reiniciar ni ampliar flags antes de validar el nuevo entregable. Fase 4 abierta; no afirmar que la migración completa terminó.

## Trabajo posterior al canario — checkpoint local en curso

- El cliente respondió «Los pruebo después». Se respeta esa decisión: la validación humana sigue pendiente y no se amplía el canario. Producción conserva e8f15df, un privado y QR/ayuda/estado; las pruebas locales no acreditan entregas reales.
- Ya están integrados localmente: continuación de colecciones por dueño/chat/TTL antes de sugerencias de adjuntos, con validación de scope/permisos/schema; lector único nativo de texto/HTML/PDF/Office con OCR de respaldo; límites de archivo/documento configurados, ZIP sin techo oculto de 20 MiB; proveedor ElevenLabs inyectado y sin llamadas al construir el runtime.
- Voz local: literal citado, alias, medición, una sola revisión de duración para composición, conservación del resultado más cercano, limpieza ante error/abort y metadatos de transcripción/duración. Composer solo escribe la descripción de voz y cachea identidad tras confirmación del proveedor; no reenvía si falla la observación.
- Primeros ocho casos legacy trazados individualmente: TR-0214/0215, TR-0726–0729 y TR-0803/0804. Nuevas pruebas con esos IDs pasan; inventario original conserva 804 casos, 796 aún sin correspondencia formal. No confundir esos casos con las 820 pruebas legacy actuales, que siguen verdes.
- La verificación intermedia detectó que una fixture de audio inventado dejó de ser válida al añadir ffprobe. Se corrigió por 332 bytes de MP3 sintético válido; el contrato de composición ElevenLabs vuelve a pasar, sin llamada de proveedor real. No se debilita la validación de duración.
- En curso: agente config_limits (económico) añade contexto de imagen/documento y estilo compartido de Botsky a la preparación de guion; solo código local. incident_review y scenario_preparation terminaron sus entregables recientes. El maestro integra y revalida antes de publicar el siguiente checkpoint.
- Pendientes de ola A: destinos/contactos y confirmación de voz, continuidad en el selector del canario (todavía excluye multimedia), URLs de sitios/yt-dlp, datos personalizados de persona (Fase 5), traza restante y pruebas reales privada/grupal. No activar voice/documents/transcription/sticker por tener interfaces solamente.


## Checkpoint de paridad local verificado — 2026-10-14 UTC

- Verify final: 390 pruebas, cero fallos; refactor 59/59; arquitectura 97 módulos y cero violaciones; 97 settings. Cobertura requerida PASS. Legacy conserva el último resultado completo 820/820 (no cambió fuente legacy en este checkpoint). Logs y SHA en phase4-evidence.json y phase3-evidence.json.
- Quedaron integrados contexto de imagen/documento para voz, estilo compartido, literal citado, revisión de duración acotada, metadatos confirmados e historial. Ocho casos TR tienen pruebas identificadas. ZIP respeta el límite configurado e incluye headers en su comprobación previa a lectura. El lector nativo único reemplaza la duplicación anterior.
- Literal de QR no puede cambiar el selector de feature/destino: «Botsky qr minecraft --to otro-chat» sigue siendo texto QR. Cambio local probado, no instalado aún.
- Producción mantiene el artefacto e8f15df, PM2 guardado y health 200. Contadores del canario seguían en cero al último chequeo. Validación humana aplazada por el cliente; no repetir la petición ni acreditar una entrega. Todo el checkpoint posterior es local, separado de la versión instalada.
- Los tres agentes económicos terminaron. Siguiente trabajo: capa autorizada de destino/contactos compartida para voz, URLs de sitios, portado de traza restante y elegibilidad de adjuntos; no ampliar flags antes de sus pruebas. Fase 4 sigue abierta. No avanzar al retiro de v1 ni volver a activar el observador.


## Entrega externa y lector web — 2026-10-14 UTC

- Tres agentes económicos reanudados. Cliente no repitió pruebas humanas; se conserva su decisión de probar después. No observador ni espera de 24 horas.
- Verify: 433 pruebas, cero fallos; refactor 59/59; 101 módulos sin violaciones, 98 settings y cobertura requerida PASS. Último legacy completo sigue 820/820, fuente legacy sin cambios en este tramo. Pruebas nuevas solo usan destinatarios ficticios, APIs falsas y media sintética.
- Voz: preflight autorizado antes de IA/media, admin/owner para externos, identidad esperada canónica obligatoria, segundo control antes de enviar, confirmación local y ninguna repetición automática del audio. Incertidumbre de red exige comprobar el destino antes de reintentar; no se inventan recibos ni historial de entrega. Contrato completo externalVoiceRuntime confirma historial/thread/cache/rehidratación en el destino y sin referencias a mensajes privados en el thread destino.
- Directorio de contactos lee sidecar y roster del grupo principal explícito; nombres exactos prioritarios, ambigüedad conservada, PN/LID estrictos, cuerpo/tiempo/participantes acotados, caché de cinco minutos. Roster de más de 2,000 falla cerrado. MAIN_GROUP_JID vacío pide aclaración; ningún dato legacy fue copiado.
- Lector web nuevo: HTML/XHTML y texto con transporte que conserva DNS/IP públicos, redirects, deadlines y límites; no ejecuta scripts ni carga recursos/links. Composición y leer URL conectados. No afirmar soporte de yt-dlp: extracción de audio/video de sitios continúa pendiente.
- Recorte PDF tiene mensajes seguros para páginas ausentes/incorrectas/fuera de rango; doc -f pdf 1,3 utiliza el recorte real. Seis casos TR adicionales portados: 14 implementados en el inventario original de 804, 790 pendientes.
- Hallazgo propio: checkpoint previo usaba module.require para cargar estilo legacy y escapaba al AST de auditoría. Se sustituyó por el módulo v2; checker ahora detecta propiedad/computada y aliases de require. No se ocultó con un shim ni se borró evidencia histórica. La ruta estaba fuera del canario instalado.
- Cierre del runtime robusto ante fallo de timer: primero cierra admisiones, guarda fallos, drena recursos y DB; rearm fallido se captura, callbacks viejos no hacen IO después de dispose.
- Artefacto nuevo listo para actualizar el canario mínimo tras commit/push y backup privado. Mantener exactamente un privado, QR/ayuda/estado, proactive apagado y jobs en legacy. No activar módulos adicionales ni cerrar Fase 4 por esta verificación. Registrar nuevo SHA/PID/health luego del despliegue.


## Canario actualizado y continuación — 2026-10-14 UTC

- Artefacto 2bba3de publicado e instalado: 102 fuentes v2 verificadas, cero diferencias. Backup privado /tmp/botsky-canary-refresh-1791977371520; configuración PM2 contiene secretos y no se publica.
- Composición con configuración productiva comprobada antes del reinicio: arranque, migraciones sidecar y dispose correctos, cero mensajes externos. Reinicio PM2: PID 3961074, online, health 200; kill_timeout 45000 y PM2 save.
- Alcance conservado: exactamente un privado y QR/ayuda/estado, proactive false, ningún grupo v2. Fuentes de voz/documentos/web instaladas pero esas features siguen en legacy. Contadores handled/replies/errors permanecían en cero al chequeo; entrega humana pendiente por decisión del cliente.
- Tres agentes económicos reanudan brechas independientes: elegibilidad/continuidad de adjuntos, trazabilidad de documentos/conversión y evaluación segura de extracción de medios de sitios. No ampliar flags ni cerrar Fase 4 por pruebas locales.


## Continuidad y reinicios — checkpoint verificado 2026-10-14 UTC

- Agentes económicos completaron código, auditoría y contratos offline. Verify final 446 pruebas, cero fallos; refactor 63/63; cobertura requerida PASS; 101 módulos y cero violaciones, 98 settings. Reportes /tmp/botsky-wave-a-ownership-final-verify.log y /tmp/botsky-wave-a-ownership-final-refactor.tap. Legacy fuente sin cambios conserva 820/820.
- Se eliminaron continuaciones de colección antes de addressing: uploads grupales pasivos no activan selector/IA/handler/salida. Privados y grupos dirigidos conservan continuación; prueba adicional cubre cita al bot sin @.
- Cache adjuntos best-effort y atómico: si no caben ambos índices no actualiza ninguno ni borra estado ajeno. Orden explícita usa media actual efímera, incluso si existe owner previo; cita conocida conserva fuente, cita desconocida no toma otra media. Fallos inesperados restauran keys con expiración restante y se propagan. TTL sigue en memoria; refs/colecciones no sobreviven reinicio.
- Lifecycle del canario impide inicializaciones simultáneas, espera startup durante cierre sin publicar owner tardío, ejecuta dispose del runtime mientras drena owner y conserva selección al cerrar (sin replay legacy). Revisión independiente no halló deadlock; contratos comprueban estas carreras y fallos de disposer.
- Firma PDF prevalece sobre filename/MIME Office y evita LibreOffice. Seis casos TR nuevos: 20/804 implementados, 784 pendientes entre todas las olas. Inventario original preservado, ningún DROP.
- Contrato E2E selector/aplicación/pipeline/composer: qr hola sin prefijo y Botsky qr minecraft --to otro-chat conservan literal y solo destino actual, cero IA. Chats no elegidos/grupos/fromMe quedan legacy. Pruebas falsas no sustituyen validación humana aplazada.
- Diseño de hosted media en docs/refactor/phase4-hosted-media-design.md: no portar yt-dlp con --proxy sin aislamiento de egreso. Texto web y archivo directo ya soportados; extracción de sitios pendiente. No añadir aprobación inventada ni eliminar esa capacidad legacy.
- Producción quedó actualizada anteriormente a 2bba3de, PID3961074, health200, exactamente un privado y QR/ayuda/estado. Registrar por separado cualquier despliegue de este checkpoint; mantener flags/proactivity/jobs. Fase4 abierta, canario humano pendiente por decisión del cliente.


## Despliegue del checkpoint de continuidad — 2026-10-14 UTC

- b5a4513 publicado en origin/refactor/v2 e instalado: 103 fuentes verificadas contra Git, cero diferencias. Backup privado /tmp/botsky-ownership-refresh-1791978206854; no publicar pm2.json.
- Startup productivo/SQLite/dispose probados antes del reinicio, cero mensajes externos. PID 3971001, online, health200 y PM2 save; proactivefalse, exactamente un privado con qr/help/system-info. Ningún grupo ni feature adicional activada. Contadores handled/replies/errors en cero; no acreditar entrega humana.
- Próximo punto para retomar: Fase4/OlaA sigue abierta. Hosted media extractor requiere implementar aislamiento de egreso del diseño, completar casos legacy por feature y elegibilidad de selector/adjuntos antes de ampliar canario. Validación real privada y grupo pendiente por decisión del cliente; no repetir petición ni cerrar gate usando fakes. Refs/colecciones TTL se pierden al reiniciar, documentado. OlasB–D/Fases5–6 pendientes. Observador cancelado, nunca reactivarlo.


## PAUSA solicitada por el cliente — checkpoint WIP 2026-10-14 UTC

- Instrucción: «ya se me acabaron los tokens». Agentes config_limits e incident_review interrumpidos; scenario_preparation ya había completado. No continuar implementación ni despliegue hasta nueva instrucción.
- Producción no se modificó en este tramo: último artefacto desplegado b5a4513, último PID3971001/health200; un privado y qr/help/system-info, proactivefalse, PM2 guardado. Estos datos son el último chequeo previo, no una nueva validación durante la pausa.
- Último snapshot global VERIFICADO sigue 446 v2/63 refactor/820 legacy. Nuevos cambios son WIP, NO tienen verify global y NO están instalados. No cerrar Fase4/OlaA ni acreditar entrega real; usuario probará canario después. Observador cancelado.
- WIP listo para revisar: contentReader preflight de tamaño (incl Long uint64), límites/copia legible/GIF/PDF con reasons seguros AppError y mensajes documents/handler; 13 casos TR-0167,0169,0170,0171–0174,0176–0178,0182–0184 en legacyContentReaderTrace2.test.js. Primer lote12 tuvo focales28verdes; feedback y límites adicionales se editaron posteriormente y su revisión/verificación final quedó interrumpida. Revisar bounds de decimal strings/high-low/signed.
- Voz: fallback ElevenLabs conserva presets legacy regional=Daniel, femenino/anime=Alice, demonio=Adam; pruebas voice.test y 12 casos TR-0741–0752 en legacyTrace0741-0752.test.js. TR0742 se reforzó con Gemini real/fake HTTP y metadata fuera de Content; TR0750 compara contexto Gemini→Groq. Focal12/typecheck/lint reportados verdes. Falta actualizar sus filas en matriz e integrar pruebas globales.
- Context root: originalMediaKey admite data directo y envelope.data, exige ID/chat y guarda solo clave original para lookup; 17 pruebas context/continuidad pasan. Dos pruebas TR0085/0088 nuevas pasan, pero filas aún pendientes en matriz. Nuevo lote voiceUx TR0753–0766 se pidió justo antes de pausa y el agente fue interrumpido; no existe legacyVoiceContinuationTrace.test.js al checkpoint. Retomar desde esos IDs tras integrar lo anterior.
- Auditor scripts/refactor/check-wave-a-trace.cjs + tests/unit/refactor/waveATrace.test.js: 6 focales verdes, lista curada92 casosA; cuenta dinámica cambia con la matriz. Detecta duplicados/fuentes fuera de selección y valida enlaces estáticos, no equivalencia ni PASS de tests. Boundaries adjuntos/mediaDelivery aparte; no afirmar92como toda migración. Corregir referencia §11→§12 para fase/ola.
- IMPORTANTE: resumen de matriz sigue20, pero agente actualizó filas contentReader; cifras están desfasadas. Al retomar integrar12voice+2attachment y reconciliar todos los implemented (esperado47 si13reader se confirman); conservar804 originales y no contar parciales como completados.
- Retomar orden: 1) revisar diff WIP/reasons/bounds y nuevos tests; 2) integrar matriz y auditor; 3) npm run verify + node --test tests/unit/refactor/*.test.js, gate3 y evidencia/hashes; 4) commit/push checkpoint verificado. Decidir actualización de fuentes productivas separadamente sin ampliar flags. Luego terminar casos restantes de voice/contentReader/olaA, selector multimedia y extractor de sitios con aislamiento de egreso. No retirar legacy.


## Reanudación y checkpoint integrado — 2026-10-14 UTC

- Cliente reanudó: «ahora si prosigue, ya hay tokens». Tres agentes económicos completaron revisión/ports independientes; sin cambios de modelo ni mensajes reales. WIP d03df68 ahora integrado y verificado.
- Verify final 498/498, cero fallos; refactor70/70, cero skips/fail/cancel; arquitectura101módulos0violaciones,98settings,cobertura requerida PASS. Logs /tmp/botsky-resume-final-verify.log y /tmp/botsky-resume-final-refactor.tap. Legacy fuente sin cambios conserva820/820.
- ContentReader tamaño: Long con low signed conserva bits; cadenas enormes no crean BigInt arbitrario; toNumber no seguro se ignora. Preflight sólo usa archivo actual o cita exacta, nunca tamaño de upload ajeno. Bytes reales siempre acotados. Feedback tipado para expiración/descarga/PDF/GIF/tamaño pide acción útil sin diagnósticos privados.
- Context conserva providerKey original desde data directo y envelope.data con ID/chat exactos; guarda sólo campos de lookup, no bytes/claves de descifrado. Pruebas cache/quote/fallback de saturación y dos ports adjuntos verdes.
- VoiceUx:12 ports0741–0752 y13 ports0753–0766 (excepto0763). Fallback ElevenLabs regional/femenino/demonio conserva preset legacy. Duración/revisión/literal/cleanup/media contexto y proveedores fallbacks con puertos falsos;0766 usa FFmpeg sintético local. TR0763 parcial: feature recibe contexto, pero standalone sintetizar_voz pendiente enF5.
- Seis casos básicos QR/help/estado/crop identificados; auditor conserva804IDs originales y detecta ausentes/duplicados. Matriz reconciliada77portados/727restantes, incluyendo11ports tablas/crypto de fases previas que resumen histórico omitía. CasosA curados64/92,28pendientes; no es totalidad ni gateclosure.
- Último chequeo productivo al integrar: PID3971001 online/health200,canary1privado qr/help/system-info,proactivefalse,counters0. Artefacto instalado sigueb5a4513 mientras se publica este nuevo código. No acreditar entrega humana; usuario la aplazó. Registrar refresh aparte si se instala.
- Retomar brechas: lectorcontentReader9casosmenoslosyaresueltos según auditor; semanticVoice/collage/e2e/mediaUx y TR0763. URLsde sitios yt-dlp requieren aislamiento de egreso; archivosdirectos+textoweb ya disponibles. Elegibilidad multimedia/canario real privado+grupo siguenpendientes. F4 abierta, olasB–D/F5/F6 pendientes,observadorcancelado.


## Checkpoint reanudado instalado — 2026-10-14 UTC

- Código142b6e0 publicado e instalado;103fuentes verificadas contraGit,cero diferencias. Backupprivado /tmp/botsky-parity-refresh-1791988898705 contiene configuración sensible; nunca publicarlo.
- Startupreal configproductiva/SQLite/dispose correcto,cero mensajes externos. ReinicioPID4057528,online,health200,kill_timeout45000,PM2save. Alcanceigual:1privado,qr/help/system-info,proactivefalse,grupos/jobs/restofuncioneslegacy. Counters0alchequeo,noentregahumana acreditada.
- Próximo trabajo concreto:28casos pendientes en selección curadaA según /tmp/botsky-resume-wave-a-trace.txt:contentReader9,semanticVoice9,collage4,e2e/mediaUx5,voiceUx1parcialTR0763. Completar restantes y cobertura OCR sin inventario histórico directo; implementar extracción alojada con egresoaislado, preparar selector multimedia sin dobleowner y validarcanario privado/grupo cuandoelcliente pruebe. Fase4abierta,noavanzarBni cerrarfaseporcantidadtests. Observadorcancelado.


## Preparación de ampliación multimedia — 2026-10-14 UTC

- Cliente pide acelerar despliegue; tres agentes económicos completaron22ports adicionales. No se interpreta urgencia como cierre falso ni DROP. Verify528/528, refactor71/71,coberturaPASS,arquitectura101sinviolaciones,98settings. Fuentelegacy sin cambios conserva820/820. Logs /tmp/botsky-deploy-preparation-verify.log y /tmp/botsky-deploy-preparation-refactor.tap.
- Matriz99/804portados,705pendientes entre todas las olas. Selección curadaA86/92,6pendientes/parciales: TR0166/TR0437PDFnativo haciaLLM,TR0368reacciónprogresoheavy,TR0686vozsinprefijosemánticavsliteral,TR0688reenviararchivoexistenteOlaB,TR0763standalonetoolF5. Estosúltimosno se convierten en portadospor tener pruebas parciales.
- ContentReader distingue PDFcifrado/corrupto/reader timeout/ausente/tempfail conreasonscerradas,feedbackespañolseguro; si limpieza falla tras lectura correcta, impide publicartexto. Collage4ports conJPEGsintético/FFmpeg/release,fallominiaturatilefallback.
- Selectorcanario preparado: sólo cuando qr/documents/sticker/voice/transcription están habilitados juntos reclama uploads privados sincaption yQRcitado. Un setparcial conservaownerlegacy. ContratoE2E realselector/app/pipeline/composer/fakeports: primerimagenpdf+segundabare+pdfterminar entregaunPDF mismochat,0LLM/legacy/errores. Esto no activa flags ni acreditaWhatsAppreal.
- Context ahora hidrata citasmedia explícitas previas alcanario: exige mensaje/chatactual y stanza/participante exactos, devuelve opaqueID/providerKey,sinURLni bytes/mediaKey. Citasdesconocidas no sustituyenarchivo reciente. Revisiónindependiente sin ampliación nueva descope; citasgroupcachedsharedson comportamiento existente.
- Flagsproductivoscontinúan1privado qr/help/system-info,proactivefalse,jobs/restochatslegacy. Cliente aplazópruebareal; no reactivarobserver. Instalar checkpoint trascommit/push yregistrarSHA/PID/healthseparado.
- Para ampliar despliegue multimedia: cerrarPDFmultimodal ygrammar/messaging/toolscopependientes; resolver extractorhostedmedia conegresoaislado o mantenerlegacyowner explícito paraflujosnoportados; validar recorrido real privado y despuésgrupo como exigeplan. PreparaciónnoequivaleGate4A cerrado.


## Despliegue de preparación multimedia — 2026-10-14 UTC

- Artefacto `753b24a` publicado e instalado. Se comprobaron 103 fuentes contra Git: cero diferencias. Backup privado: `/tmp/botsky-media-preparation-1791989653754`; contiene configuración sensible y nunca debe publicarse.
- Composición con configuración productiva, SQLite y dispose comprobada antes del reinicio, sin mensajes externos. PM2 online con PID 4066967, health 200, timeout de cierre 45 segundos y configuración guardada.
- Alcance activo conservado: un privado con QR, ayuda y estado. Proactividad apagada; otros chats, jobs y funciones siguen en legacy. El selector multimedia nuevo está instalado pero sus flags no están activos. Contadores del canario en cero al chequeo; validación humana aplazada por el cliente.
- Última verificación: 528 pruebas v2 y 71 de refactor, cero fallos. Matriz original: 99 portados de 804; selección curada de ola A: 86 de 92. El informe de seis brechas parciales está en `phase4-evidence.json`. Falta además extracción alojada con egreso aislado y canario real privado/grupo. Fase 4 sigue abierta; no retirar v1 ni reactivar el observador.
- Siguiente trabajo para acelerar el despliegue amplio: PDF nativo hacia el modelo (TR-0166/TR-0437), progreso durante trabajos pesados (TR-0368), resolver la gramática semántica/literal sin prefijo (TR-0686), y conectar reenvío de media/herramienta de voz en sus fases (TR-0688/TR-0763). La urgencia no elimina esos comportamientos legacy.


## Incidente de fotos repetidas y publicación solicitada — 2026-10-14 UTC

- El cliente reportó que Hora Feliz repite fotos y autorizó publicar todas las disponibles y las nuevas por defecto. Biblioteca productiva: 246 registros activos; antes del cambio sólo 160 asociados a álbumes publicados, todos accesibles. No se mostraron fotos ni contenidos privados.
- Hotfix legacy: recuerda IDs enviados durante cada evento, los excluye en Rikolino/fallback y usa randomize. Evita rellenos vistos en el último lote parcial, deduplica dentro del lote y sólo registra envíos que resuelven correctamente. Al agotar disponibles inicia otro ciclo. Nueva carga publicada aparece como no vista al siguiente snapshot. Historial se reinicia al iniciar otro evento o reiniciar proceso; no se promete persistencia entre reinicios.
- Lock de lluvia ligado a la generación del evento: dos triggers simultáneos no duplican lote; un envío viejo pendiente no bloquea un evento nuevo y no despacha el resto tras stop/start. Tres pruebas nuevas protegen cola, alta nueva, fallo y carrera.
- Suite legacy final 823/823, cero fail/skip/cancel, mediante harness Docker aislado. Reporte /tmp/botsky-happy-rain-verified.tap. Un mock incompleto en la prueba nueva se corrigió antes de esa corrida final; no se ocultó un fallo de producción. Focal adicional10/10 /tmp/botsky-rain-final-focus.tap.
- Petrovsky: coder económico implementó autoPublish default con álbum público agregado; inicialización transaccional publica sólo activos, nuevas imágenes/vídeos/importaciones y restore mantienen asociación. Papelera excluida y duplicado eliminado no se restaura. Álbumes explícitos/precios permanecen. Verificador independientePASS38/38; cambios previos ajenos en server/package/tests no se incluyen. Backup consistente privado /tmp/rikolino-publication-backup-1791990255 antes de migración. Activación productiva y commits todavía pendientes al registrar este checkpoint.
- GitHub para Botsky; Petrovsky respalda con commit local según AGENTS.md, sin push. Esta reparación no cierra Fase4; portar política anti-repetición a community/happyHour cuando se migre OlaC. Proactividad sigue false, no se disparan lluvias sintéticas reales.


## Hora Feliz y catálogo: reparación desplegada — 2026-10-14 UTC

- Botsky hotfix `0eb2765` publicado en origin/refactor/v2 y aplicado sólo a `src/services/happyHour.js`, tras comprobar que el archivo productivo seguía siendo el original revisado. Backup privado `/tmp/botsky-happy-rain-backup-1791990787373`. PID 4081372, online, health 200 y PM2 save; proactividad false y canario QR/ayuda/estado en un privado conservados. No se dispararon lluvias o envíos sintéticos en producción.
- Petrovsky commit LOCAL `a6f7aab`, según AGENTS.md: código y pruebas selectivos, sin incluir server/package ni ~1k líneas de tests ajenas. Backend miroslav PID4080831, catálogo HTTP200. Verificador independiente PASS38/38. Whitespace preexistente queda fuera del commit; cached diff-check PASS.
- Publicación aplicada y comprobada: 246 registros activos, 246 publicados y 246 originales accesibles a Botsky (antes160). Nuevas imágenes/vídeos/importaciones se asocian automáticamente al álbum público agregado; papelera no restaurada. Backup SQLite consistente `/tmp/rikolino-publication-backup-1791990255`. No se cambiaron álbumes explícitos ni precios existentes.
- Suite legacy823/823 y focal10/10 verdes. Tests de reader crean la biblioteca fixture con autoPublish:false para conservar el contrato de álbumes manuales; tests Petrovsky nuevos cubren el default real. Rikolino sigue consultando un snapshot nuevo en cada selección.
- Recordar para OlaC: portar esta política sin repetición hasta agotar disponibles, registro sólo tras envío exitoso y lock por generación del evento. Memoria de vistos por evento se reinicia al reiniciar proceso. Fase4 sigue abierta con sus brechas anteriores; este incidente autorizado quedó atendido.


## Revisión de logs solicitada por el cliente — 2026-10-14 UTC

- Chequeo read-only posterior a despliegue: wasa PID4081372 y miroslav PID4080831 online, ambos endpoints HTTP200. No reinicios posteriores observados. Stderr retenido de ambos servicios tiene modificación anterior a sus reinicios actuales; no tratar errores históricos como nuevos.
- Desde el último arranque de Botsky: 14 eventos AI-PROVIDER con503 y2 errores AI-ROUTER con503; rotación de claves no evitó el fallo en esas rutas legacy. Sin uncaught/UnhandledRejection nuevos; sin errores de HoraFeliz y un despacho de lluvia registrado. No inferir caída global de Gemini, sólo respuestas503 observadas en estas solicitudes.
- Petrovsky no registra errores nuevos desde su último arranque. Publicación246/246 fue comprobada en el checkpoint anterior. Canary v2 sigue counters0 y alcance mínimo; no atribuir estos errores a v2 ni al cambio de fotos.
- Pendiente concreto de estabilidad a revisar junto a migración IA: reducir intentos redundantes ante503/overload y verificar fallback disponible para el router legacy, manteniendo mismos permisos y sin reenviar comandos ya ejecutados. En este chequeo no se alteró configuración, código ni se enviaron mensajes.


## Despliegue urgente solicitado: Cooperacha y lluvia de 5 medios — 2026-10-14 UTC

- Cliente: «apresura, deja las pruebas para después» y «quiero q mande5fotosenminutos, entre más mande mejor». Se adopta frecuencia explícita de 5 medios por minuto durante Hora Feliz (arranque y recuperación); no se ejecuta nueva suite por su instrucción. Checks de sintaxis y scope del despliegue se conservan.
- Cooperacha: lock por grupo durante inicio evita dos búsquedas/avisos simultáneos; una categoría sin imágenes recibe aclaración específica sin mostrar texto privado. Reader añade imagesOnly para excluir vídeos antes de sort/count; pack y lluvia mantienen media mixta. Estos arreglos ya tuvieron24/24 focales antes de la orden de aplazar pruebas. La causa exacta del aviso de la captura no quedó demostrada; defaultprovider productivo sí tiene imagen disponible.
- HappyHour: lote5 y timer60s, mantiene historial por evento y protección de generación/repetición. Último lote de ciclo puede tener menos de5 para no repetir la cola pendiente; envío fallido tampoco se cuenta como éxito. No activar proactividad ni iniciar evento nuevo manualmente.
- PENDIENTE al retomar pruebas: actualizar expectativas happyHourRainRandomness del antiguo lote2 al lote5 y agregar frecuencia arranque/recovery; ejecutar suitelegacycompleta. No afirmar823como resultado de esta versión nueva: ese resultado corresponde al checkpoint anterior.
- Instalar4archivoslegacy trascommit con backup privado y PM2 health; registrar resultado luego. Canaryv2 sigue QR/ayuda/estado en1privado; publicación246activos defaultautoPublish intacta.


## Hotfix urgente ACTIVO — 2026-10-14 UTC

- Código `0bd6e53` publicado en GitHub e instalado en los cuatro archivos legacy autorizados, comprobados contra commit. Backup privado `/tmp/botsky-urgent-rain-1791991604434`. Botsky PID4088976 online, health200 y PM2 save. Canary QR/ayuda/estado en1privado y proactividad false conservados.
- Hora Feliz configurada a cinco medios cada60segundos, incluido timer de recuperación. Selección sin repetición por evento; último lote parcial/fallos pueden reducir entregas. No se disparó reto ni lluvia manual de prueba.
- Cooperacha lleva reserva por grupo, aclaración de categoría sin resultados y filtro de imágenes antes de selección. No se afirma que la concurrencia haya sido causa exacta de la captura; se corrigió un defecto reproducible.
- Suite NUEVA aplazada por instrucción explícita del cliente. Sólo checks de sintaxis/scope/health. Pruebas focales24/24 de Cooperacha existían antes de cambiar frecuencia. El resultado legacy823 pertenece al checkpoint anterior; no extenderlo a este artefacto.
- Retomar: ajustar tres pruebas de lluvia para lote5, verificar timer60s en start/recovery y ejecutar suite completa. Luego seguir brechas de Fase4 previamente guardadas. Biblioteca sigue con246imágenes activas publicadas y autoPublish por defecto.
