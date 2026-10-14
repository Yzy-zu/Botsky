# Trazabilidad de tests legacy → v2

Inventario estático de `eb993ef11885e17aacea5cdc65bcc9efa59186b4`, creado el 2026-10-12 en `/home/petrov/botsky-v2`. **72 archivos, 793 declaraciones, 804 casos nominales** (790 `pending`, 14 `intencional-pending`). El número de 390 tests del plano no coincide con las declaraciones del árbol actual; el baseline ejecutado determinará pass/fail/skipped efectivos.

Cada fila identifica un caso por archivo + línea + título; los tres bucles que registran tests se expanden a sus valores concretos. Los bucles internos de aserciones permanecen dentro del caso que los contiene. Suites `describe` y hooks no cuentan como tests. No se importó ni ejecutó código legacy, no se cargó `.env` y no se accedió a DB o servicios.

**Las rutas de destino de filas pendientes son propuestas**, bajo `tests/{unit,contract,scenario}/legacy/` para mantener identificabilidad durante la migración; las etapas v2 indicadas son relativas a `src/v2/`. El ID `TR-xxxx` debe figurar en el nombre/comentario del nuevo caso. Las filas `ported` señalan equivalentes implementados; ninguna fila autoriza eliminar el original. Una WO posterior puede dividir o fusionar archivos, pero debe reemplazar cada propuesta con el archivo y nombre de test reales antes de marcar `ported`.

`pending`: conservar el efecto protegido y adaptar dependencias a puertos/fakes. `intencional-pending`: hay una expectativa legacy que cambia por §6; la nota define la expectativa v2. Cuando la fila siga pendiente, esa expectativa tampoco está implementada. Los escenarios anotados como “relación” solo conectan requisitos: no afirman que el legacy cubra todo Sxx. “No aplica directamente” es una justificación explícita, no una celda pendiente de completar. Checkpoint actual: 77 de 804 casos figuran portados con pruebas identificadas; los otros 727 siguen pendientes, parciales o intencional-pending. La cifra incluye 11 contratos de tablas nativas y crypto portados en fases anteriores cuyo resumen histórico no los contaba; sus IDs ahora están identificados en los nombres de las pruebas. Esto no cierra Ola A.

Limitaciones: los títulos son el comportamiento declarado por el autor; no se certifica que todas sus aserciones lo cubran. Se revisaron cuerpos de activación grupal, selecciones, multimedia, proactivo y límites contradictorios; durante cada portado se revisarán todas las aserciones del caso. Los tests live se deben convertir en contratos con fakes para verificación local. Tests acoplados a usuario/UID, fuentes de código, Maps o APIs legacy requieren adaptar la implementación protegida sin eliminar cobertura. No se presupone ningún DROP.

Conflictos abiertos: `optimizations.test.js:31` exige los límites que `descargar.test.js:145` prohíbe; el maestro debe relacionarlos con el baseline. §9 introduce restricciones de terminal además de §6/§11; este inventario marca adaptación pendiente y no aprueba nuevas diferencias de producto. `dispatcher.test.js:597` solo prueba `botsky` aunque el título incluye `bot`; hace falta S02 independiente. El caso audio `e2e_requirements.test.js:210` no verifica el enrutamiento mencionado por su título.

## Resumen por archivo

| Archivo legacy | Declaraciones | Casos |
|---|---:|---:|
| `test/adminXp.test.js` | 7 | 7 |
| `test/affinity.test.js` | 7 | 7 |
| `test/agent.test.js` | 24 | 24 |
| `test/agentEngine.test.js` | 9 | 9 |
| `test/agent_content.test.js` | 4 | 4 |
| `test/ai.test.js` | 6 | 6 |
| `test/aiDiagnostics.test.js` | 13 | 13 |
| `test/ai_pool.test.js` | 10 | 10 |
| `test/anti_repetition.test.js` | 4 | 4 |
| `test/attachment_context.test.js` | 7 | 7 |
| `test/audit_fixes.test.js` | 22 | 22 |
| `test/blackjack.test.js` | 9 | 9 |
| `test/challenger2_economy_admin.test.js` | 4 | 4 |
| `test/challenger_horafeliz_stress.test.js` | 10 | 10 |
| `test/coalescer.test.js` | 6 | 6 |
| `test/commandRegistry.test.js` | 5 | 5 |
| `test/comprehensive_audit_fixes.test.js` | 4 | 4 |
| `test/contactos_naturales.test.js` | 14 | 14 |
| `test/content_reader.test.js` | 28 | 28 |
| `test/conversationStyle.test.js` | 20 | 20 |
| `test/convertir_documentos.test.js` | 2 | 2 |
| `test/cooperacha.test.js` | 14 | 14 |
| `test/cooperachaRouting.test.js` | 4 | 11 |
| `test/daily.test.js` | 5 | 5 |
| `test/descargar.test.js` | 21 | 21 |
| `test/difusion.test.js` | 7 | 7 |
| `test/dispatcher.test.js` | 20 | 20 |
| `test/doxeo.test.js` | 4 | 4 |
| `test/drive.test.js` | 2 | 2 |
| `test/e2e_requirements.test.js` | 72 | 72 |
| `test/evolution_native_tables.test.js` | 9 | 9 |
| `test/happyHour.test.js` | 11 | 11 |
| `test/history_persistence.test.js` | 3 | 3 |
| `test/maicra_command.test.js` | 11 | 11 |
| `test/mediaDelivery.test.js` | 14 | 14 |
| `test/mediaSearch.test.js` | 13 | 13 |
| `test/mediaSearchHandler.test.js` | 4 | 4 |
| `test/mediaUxIntegration.test.js` | 18 | 18 |
| `test/mensaje.test.js` | 7 | 7 |
| `test/milestone1_stress.test.js` | 7 | 7 |
| `test/minecraftRemote.test.js` | 10 | 10 |
| `test/multimedia_drive_estado_ux.test.js` | 9 | 9 |
| `test/native_tables.test.js` | 13 | 13 |
| `test/naturalUxIntegration.test.js` | 14 | 14 |
| `test/notas.test.js` | 4 | 4 |
| `test/nuclear.test.js` | 4 | 4 |
| `test/observations_minor.test.js` | 9 | 9 |
| `test/optimizations.test.js` | 5 | 5 |
| `test/pack.test.js` | 32 | 32 |
| `test/parser.test.js` | 4 | 4 |
| `test/perf_arq.test.js` | 3 | 3 |
| `test/personality.test.js` | 5 | 5 |
| `test/proactive.test.js` | 9 | 9 |
| `test/recordatorios.test.js` | 6 | 6 |
| `test/recortarPdf.test.js` | 2 | 2 |
| `test/reminderNotesUx.test.js` | 13 | 13 |
| `test/rikolinoLibrary.test.js` | 7 | 7 |
| `test/routingFailureIntegration.test.js` | 20 | 24 |
| `test/ruleta.test.js` | 4 | 4 |
| `test/school.test.js` | 21 | 21 |
| `test/school_natural.test.js` | 9 | 9 |
| `test/semanticHandlers.test.js` | 8 | 8 |
| `test/semanticVoice.test.js` | 9 | 9 |
| `test/terminal.test.js` | 21 | 21 |
| `test/thumbnailCollage.test.js` | 4 | 4 |
| `test/toolRegistryRobustness.test.js` | 8 | 8 |
| `test/tts.test.js` | 4 | 4 |
| `test/unification_json_cli.test.js` | 6 | 6 |
| `test/utils.test.js` | 5 | 5 |
| `test/voiceUx.test.js` | 26 | 26 |
| `test/whatsapp_text.test.js` | 36 | 36 |
| `test/whisper.test.js` | 2 | 2 |

## test/adminXp.test.js

Destino de tests propuesto: `tests/unit/legacy/adminXp.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0001 | 13 | AdminXP: aliases registrados correctamente en commandRegistry | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0002 | 23 | AdminXP: usuario no autorizado es rechazado con acceso denegado y no recibe XP | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0003 | 58 | AdminXP: administrador autorizado en grupo se otorga 1000 XP exitosamente | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0004 | 95 | AdminXP: extrae la cantidad solicitada si pide un número diferente (ej: 500) | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0005 | 129 | AdminXP: admin puede otorgar XP a un amigo mencionado con @ | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0006 | 186 | AdminXP: usuario no admin intentando dar XP a un amigo es bloqueado | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0007 | 235 | AdminXP: admin en grupo con LID puede otorgar XP a un amigo mencionado con LID (@231829483315369) | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/affinity.test.js

Destino de tests propuesto: `tests/unit/legacy/affinity.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0008 | 12 | Affinity 1: Usuario nuevo inicia por defecto en modo grosero y desconfiado (-20) | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0009 | 26 | Affinity 2: Insultos bajan score y activan modo rencoroso (<= -50) | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0010 | 43 | Affinity 3: Disculpas suben score y perdonan gradualmente el rencor | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0011 | 67 | Affinity 4: Clamping estricto entre -100 y +100 | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0012 | 78 | Affinity 5: renderBar dibuja barras proporcionales | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0013 | 85 | Affinity 6: handleAfinidad envía reporte visual con estado y consejos | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0014 | 115 | Affinity 7: handleAfinidad resuelve JID telefónico real en grupos con @lid | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/agent.test.js

Destino de tests propuesto: `tests/contract/legacy/agent.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0015 | 19 | Agent-Bash: comando simple y echo | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0016 | 26 | Agent-Bash: pwd devuelve directorio de trabajo | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0017 | 32 | Agent-Bash: id muestra que ejecuta siempre como petrov (UID 1002) | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0018 | 39 | Agent-Bash: printf formatea cadenas correctamente | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0019 | 45 | Agent-Bash: pipes (\|) funcionan con encadenamiento de utilidades | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0020 | 51 | Agent-Bash: operador && ejecuta condicionalmente el siguiente comando | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0021 | 57 | Agent-Bash: operador \|\| salta ante error y ejecuta el fallback | adapters/system/shell + features/admin-system | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0022 | 63 | Agent-Bash: redirección (> y <) a archivo temporal y lectura | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0023 | 70 | Agent-Bash: subshell (...) aísla contexto y variables | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0024 | 76 | Agent-Bash: comando inexistente devuelve resultado controlado con código de error | adapters/system/shell + features/admin-system | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0025 | 84 | Agent-Bash: exit code != 0 refleja el código exacto de salida | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0026 | 91 | Agent-Bash: proceso hijo en segundo plano | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0027 | 97 | Agent-Bash: timeout termina proceso y subprocesos hijos sin dejarlos huérfanos | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0028 | 111 | Agent-Bash: stdout grande es truncado de forma acotada (bounded) | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0029 | 118 | Agent-Bash: stderr grande es truncado de forma acotada (bounded) | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0030 | 125 | Agent-Bash: sanitización de secretos en salida de Bash | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0031 | 134 | Agent-Tool: handleTerminalTool valida parámetros y ejecuta comando | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0032 | 146 | Agent-Loop: Gemini recibe resultado de herramienta y responde (Mock Turn 1) | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0033 | 213 | Agent-Loop: Gemini puede realizar un segundo tool call (2 turnos) y responder | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0034 | 296 | Agent-Loop: un tercer tool call es rechazado obligatoriamente por el límite | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0035 | 343 | Agent-Loop: error de herramienta no causa crash y es comunicado al modelo | adapters/ai/toolBridge + pipeline/executor | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0036 | 405 | Agent-Live: Gemini ejecuta uptime en VPS mediante Function Calling real y responde | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0037 | 418 | Agent-Loop: múltiples function calls en el mismo turno ejecutan y reciben todas sus functionResponse | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0038 | 498 | Agent-Loop: error en callGemini tras ejecutar herramienta devuelve resultado controlado sin crash | adapters/ai | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |

## test/agentEngine.test.js

Destino de tests propuesto: `tests/unit/legacy/agentEngine.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0039 | 9 | Tool Registry: getToolDeclarations filtra herramientas de admin según privilegios | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0040 | 24 | Tool Registry: executeTool maneja herramientas desconocidas con mensaje de error | registro generado desde features/*/manifest | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0041 | 30 | Tool Registry: executeTool bloquea ejecutar_terminal para no administradores | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0042 | 36 | Tool Registry [Live]: executeTool google_drive espacio devuelve cuota válida | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0043 | 43 | Tool Registry [Live]: executeTool minecraft_control telemetria devuelve telemetría viva | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0044 | 51 | Tool Registry: executeTool notas_tablon ciclo completo guardar y borrar | features/notes | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0045 | 69 | Universal Agent [Live]: Conversación casual no ejecuta herramientas | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0046 | 82 | Universal Agent [Live]: Consulta de telemetría de Minecraft ejecuta tool y sintetiza respuesta | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0047 | 96 | Tool Registry: executeTool bloquea activar_mod y desactivar_mod para no administradores | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |

## test/agent_content.test.js

Destino de tests propuesto: `tests/contract/legacy/agent_content.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0048 | 41 | Agente recibe texto extraído separado de la petición y preserva contenido completo | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0049 | 56 | Agente envía PDF con MIME explícito y distingue preparación interna de archivo original | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0050 | 71 | Agente rechaza bytes con MIME ausente o incompatible antes de llamar modelo | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0051 | 80 | Agente sin adjunto mantiene su petición normal y no añade bytes inventados | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/ai.test.js

Destino de tests propuesto: `tests/contract/legacy/ai.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0052 | 11 | AI: chatWithBotsky responde con personalidad | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0053 | 18 | AI: chatWithBotsky responde con historial | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0054 | 26 | AI: routeWithAI devuelve JSON válido para comandos | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0055 | 34 | AI: routeWithAI extrae parámetros complejos (formato, corte, velocidad) | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0056 | 49 | AI: routeWithAI clasifica saludos y chatWithBotsky genera la respuesta | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0057 | 73 | AI: routeWithAI procesa contexto multimedia (audioMessage -> efecto) | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |

## test/aiDiagnostics.test.js

Destino de tests propuesto: `tests/contract/legacy/aiDiagnostics.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0058 | 31 | Empty Gemini result uses fallback and records empty_response instead of guessing a block | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0059 | 40 | Prompt block and candidate safety finish are explicit blocked outcomes without fallback | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0060 | 51 | Malformed/unexpected tool output is rejected before valid-looking partial text can execute | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0061 | 60 | Malformed model JSON is invalid_response and structured fallback can recover | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0062 | 67 | A truncated route is rejected even when partial output parses into valid JSON | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0063 | 79 | Semantic schema repair remains bounded and does not execute incomplete outbound plans | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0064 | 88 | Groq HTTP 400 diagnostics retain known code/parameter and omit raw body/messages/config | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0065 | 107 | HTTP configuration, network, rate-limit and unavailable faults remain distinct | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0066 | 115 | Unknown arbitrary provider codes/parameters/finish reasons cannot leak secrets | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0067 | 122 | Groq payload uses current token field, optional system message and supported OSS options | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0068 | 137 | Tool-content ABI is preserved, including valid function call without text | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0069 | 147 | Legacy route API still returns decision or null, typed outcome reports missing configuration | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0070 | 155 | Groq content filtering is blocked, genuine rate limits activate breaker | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/ai_pool.test.js

Destino de tests propuesto: `tests/contract/legacy/ai_pool.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0071 | 20 | AI-Pool: maskKey enmascara claves y nunca expone el secreto completo | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0072 | 32 | AI-Pool: getConfiguredApiKeys detecta hasta 3 claves configuradas | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0073 | 42 | AI-Pool: rotación Round-Robin cíclica entre 3 claves simuladas | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0074 | 61 | AI-Pool: comportamiento transparente cuando solamente existe 1 clave | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0075 | 70 | AI-Pool: cooldown automático tras error 429 y salto a clave disponible | adapters/ai | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0076 | 93 | AI-Pool: recuperación de una clave tras expirar su cooldown | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0077 | 113 | AI-Pool: isRateLimitError identifica códigos 429 y RESOURCE_EXHAUSTED | adapters/ai | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0078 | 126 | AI-Pool: getConfiguredApiKeys soporta 1, 2, 3 o ninguna clave de forma independiente | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0079 | 167 | AI-Pool: simulación HTTP de error 429 con Axios mock -> reintento con siguiente clave del pool, sin key en URL y con x-goog-api-key correcto | adapters/ai | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0080 | 266 | AI-Pool: backoff exponencial escala los cooldowns ante 429 repetidos (15s -> 30s -> 60s -> 120s) | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/anti_repetition.test.js

Destino de tests propuesto: `tests/scenario/legacy/anti_repetition.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0081 | 42 | Anti-Repetición 1: Persistencia SQLite (getDeliveredPhotoIds, recordDeliveredPhotos, clearDeliveredPhotoHistory) | adapters/store + features/conversation | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0082 | 82 | Anti-Repetición 2: RikolinoReader filtra fotos vistas y resetea mazo al completarse | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0083 | 115 | Anti-Repetición 3: Packs consecutivos del usuario no repiten fotos hasta agotar álbum | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0084 | 201 | Anti-Repetición 4: Cooperachas consecutivas en grupo no repiten la foto destapada | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/attachment_context.test.js

Destino de tests propuesto: `tests/unit/legacy/attachment_context.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0085 | 69 | El normalizador conserva texto y sesiones sin decidir una intención por regex | policies/attachment.policy + pipeline/context | `tests/unit/v2/pipeline-input/legacyAttachmentTrace.test.js` — caso identificado `TR-0085` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0086 | 76 | Adjuntos se seleccionan sólo por ID del catálogo de ese chat y solicitante | policies/attachment.policy + pipeline/context | S08 / S09 / S17 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0087 | 84 | Sólo una aclaración semántica guarda la instrucción anterior al archivo | policies/attachment.policy + pipeline/context | S08 / S09 / S17 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0088 | 90 | TTL, límites y metadatos mínimos no retienen bytes de archivo | policies/attachment.policy + pipeline/context | `tests/unit/v2/pipeline-input/legacyAttachmentTrace.test.js` — caso identificado `TR-0088` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0089 | 97 | Metadatos de descifrado admiten todas las formas binarias de Evolution y descartan contenido pesado | policies/attachment.policy + pipeline/context | S08 / S09 / S17 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0090 | 118 | Clave multimedia se conserva en archivo actual, cita y seguimiento reciente | policies/attachment.policy + pipeline/context | S08 / S09 / S17 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0091 | 138 | Metadatos binarios inválidos o enormes no se guardan como claves | policies/attachment.policy + pipeline/context | S08 / S09 / S17 (relación) | pending: Portar; equivalente aún no implementado. |

## test/audit_fixes.test.js

Destino de tests propuesto: `tests/scenario/legacy/audit_fixes.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0092 | 18 | Fix 1 (Terminal): getSanitizedEnv elimina secretos y credenciales pero preserva entorno base | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0093 | 58 | Fix 1 (Terminal): executeBash no hereda GEMINI_API_KEY del proceso en subshell Bash | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0094 | 66 | Fix 1b (Terminal Seguridad): executeBash no expone variables sensibles en texto ni base64 | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0095 | 76 | Fix 1c (Terminal Seguridad): executeBash tiene bloqueado el acceso a /home/petrov/botsky/.env en filesystem | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0096 | 87 | Fix 1d (Terminal Seguridad): executeCommand con options.env forzado pasa obligatoriamente por getSanitizedEnv | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0097 | 95 | Fix 1e (Terminal Seguridad): executeBash permite ejecutar comandos normales del agente (id, pwd, uptime, git status, docker ps) | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0098 | 117 | Fix 2 (LID): cleanJidNumber rechaza identificadores @lid devolviendo cadena vacía (Fail-Closed) | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0099 | 123 | Fix 2 (LID): getSenderJid extrae JID telefónico alternativo cuando participant es @lid | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0100 | 149 | Fix 2 (LID): isAuthorizedAdmin autoriza por JID alternativo y falla cerrado si solo hay LID | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0101 | 182 | Fix 2 (LID): normalizePhoneNumber unifica variantes móviles 521 vs 52 de México | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0102 | 200 | Fix 3 (Concurrencia): _aiLimiter limita llamadas concurrentes y procesa en cola | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0103 | 223 | Fix 4 (Gemini Pool): Error 400 NO hace failover a otras claves (no-retriable) | adapters/ai | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0104 | 253 | Fix 4 (Gemini Pool): Error 403 (Forbidden) hace failover a la siguiente clave del pool | adapters/ai | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0105 | 288 | Fix 4 (Gemini Pool): Error 503 (Model Overloaded) hace failover a la siguiente clave del pool | adapters/ai | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0106 | 325 | Fix 5 (Prefijos): Normalizador activa shouldDispatch con ! / # . y /@ en grupos | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0107 | 359 | Fix 6 (Recordatorios): sendText serializa options.mentions para mención nativa de WhatsApp | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0108 | 385 | UX 1: Petición VPS sin prefijo en privado ("cómo está el servidor?") enruta a agent (terminal) | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0109 | 392 | UX 2: Charla normal en privado ("hola qué haces?") enruta a chat sin invocar terminal | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0110 | 399 | UX 3: Comando explícito ("/@terminal uptime" o "!terminal uptime") enruta a agent | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0111 | 412 | UX 4: Petición VPS en grupo sin prefijo ("qué contenedores Docker están activos?") enruta a agent | adapters/ai/toolBridge + pipeline/executor | S01 | intencional-pending: §6.1: solicitud VPS grupal sin addressing deja de ejecutar herramientas; escenario conserva rechazo/silencio. |
| TR-0112 | 429 | UX 5: Charla normal en grupo sin prefijo ("hola gente cómo andan?") enruta a ignore o chat y no a terminal | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0113 | 447 | UX 6: Mensaje ambiguo con términos técnicos ("¿qué es Linux?") enruta a chat sin ejecutar terminal | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/blackjack.test.js

Destino de tests propuesto: `tests/unit/legacy/blackjack.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0114 | 26 | Blackjack 1: commandRegistry reconoce los aliases de blackjack | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0115 | 32 | Blackjack 2: createDeck genera 52 cartas completas con glifos y emojis | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0116 | 57 | Blackjack 3: calculateScore maneja Ases suaves, figuras y sumas compuestas | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0117 | 97 | Blackjack 4: message_normalizer detecta comandos naturales e interacciones de partida | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0118 | 153 | Blackjack 5: ciclo completo de juego (apuesta, pedir carta y plantarse) | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0119 | 214 | Blackjack 6: rechaza apuesta si el usuario no tiene fondos suficientes | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0120 | 243 | Blackjack 7: Mesa Multijugador: creación de lobby, unión y rechazo de duplicados | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0121 | 307 | Blackjack 8: Mesa Multijugador: message_normalizer detecta atajos de lobby | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0122 | 349 | Blackjack 9: Mesa Multijugador: ciclo completo de juego y showdown de Botsky | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/challenger2_economy_admin.test.js

Destino de tests propuesto: `tests/unit/legacy/challenger2_economy_admin.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0123 | 83 | Challenger 2 — Tarea 1.1: server.js otorga exactamente 20 XP durante Hora Feliz y exactamente 1 XP antes/después | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0124 | 259 | Challenger 2 — Tarea 1.2: Costo de pack en pack.js descuenta 75 XP en HF, 150 XP normal y 0 XP si es gratis | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0125 | 387 | Challenger 2 — Tarea 1.3: Muestreo de 50 packs en Hora Feliz [4, 6] vs 50 packs en Normal [3, 5] | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0126 | 482 | Challenger 2 — Tarea 2: Solicitudes no autorizadas a !horafeliz on y !horafeliz off devuelven rechazo exacto | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/challenger_horafeliz_stress.test.js

Destino de tests propuesto: `tests/unit/legacy/challenger_horafeliz_stress.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0127 | 77 | CHALLENGE 1.1: 15 concurrent participants calling claimAirdrop simultaneously in exact same event loop tick | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0128 | 160 | CHALLENGE 1.2: 50 concurrent participants calling claimAirdrop with extreme load | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0129 | 202 | CHALLENGE 1.3: Asynchronous microtask/macrotask interleaving concurrency (queueMicrotask, setImmediate, setTimeout) | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0130 | 266 | CHALLENGE 1.4: Webhook fast-path pipeline simulation with 20 simultaneous "YOO" messages | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0131 | 326 | CHALLENGE 1.5: AirDrop group isolation - claims from non-active group are rejected | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0132 | 356 | CHALLENGE 2.1: Crash recovery of active unexpired session restores state and full economic benefits | features/community | S18 (relación; revisar persistent) | pending: Portar; equivalente aún no implementado. |
| TR-0133 | 415 | CHALLENGE 2.2: Crash recovery preserves active unexpired AirDrop and allows valid claim post-reboot | features/community | S18 (relación; revisar persistent) | pending: Portar; equivalente aún no implementado. |
| TR-0134 | 480 | CHALLENGE 2.3: Crash recovery when AirDrop was ALREADY claimed prevents duplicate claiming | features/community | S18 (relación; revisar persistent) | pending: Portar; equivalente aún no implementado. |
| TR-0135 | 523 | CHALLENGE 2.4: Reboot recovery after session expiration resets database and reverts economy to standard | features/community | S18 (relación; revisar persistent) | pending: Portar; equivalente aún no implementado. |
| TR-0136 | 576 | CHALLENGE 2.5: Multi-crash cycle stress test (Start -> Crash -> Recover -> Drop -> Crash -> Recover -> Claim -> Crash -> Recover -> Expire -> Recover) | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/coalescer.test.js

Destino de tests propuesto: `tests/unit/legacy/coalescer.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0137 | 7 | El debounce no interpreta longitud, palabras, número ni puntuación | pipeline/ingest | S12 / S13 (según efecto protegido) | pending: Portar; equivalente aún no implementado. |
| TR-0138 | 11 | Mensajes del mismo remitente se agrupan con saltos de línea sin perder el orden | pipeline/ingest | S12 / S13 (según efecto protegido) | pending: Portar; equivalente aún no implementado. |
| TR-0139 | 15 | Remitentes diferentes conservan buffers separados | pipeline/ingest | S12 / S13 (según efecto protegido) | pending: Portar; equivalente aún no implementado. |
| TR-0140 | 18 | Comando explícito vacía el buffer y se ejecuta después de la conversación pendiente | pipeline/ingest | S12 / S13 (según efecto protegido) | pending: Portar; equivalente aún no implementado. |
| TR-0141 | 21 | Texto y archivo adyacentes quedan juntos; Gemini decide si el texto usa el archivo | pipeline/ingest | S12 / S13 (según efecto protegido) | pending: Portar; equivalente aún no implementado. |
| TR-0142 | 26 | Archivos distintos mantienen sus identidades y no se sobrescriben al agrupar | pipeline/ingest | S12 / S13 (según efecto protegido) | pending: Portar; equivalente aún no implementado. |

## test/commandRegistry.test.js

Destino de tests propuesto: `tests/unit/legacy/commandRegistry.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0143 | 10 | Registry: reconoce comandos registrados y aliases | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0144 | 39 | Registry: getRegisteredCommands retorna lista no vacía | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0145 | 46 | Registry: asigna los tiers de cola correctamente | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0146 | 57 | Registry: musica asigna formato mp3 por defecto para descargas de audio | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0147 | 64 | Registry: reconoce recortarpdf y aliases con queueTier light | registro generado desde features/*/manifest | `tests/unit/v2/features/legacyWaveABasicsTrace.test.js` — caso identificado `TR-0147` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |

## test/comprehensive_audit_fixes.test.js

Destino de tests propuesto: `tests/scenario/legacy/comprehensive_audit_fixes.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0148 | 15 | Audit Fix 1 (Seguridad Auth): isAuthorizedAdmin rechaza miembros no-admin en grupos permitidos | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0149 | 40 | Audit Fix 2 (Resiliencia Normalizer): normalizeIncomingMessage maneja remoteJid inválido o no-string sin crash | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0150 | 51 | Audit Fix 3 (Lógica Niveles): handleDarXp otorga experiencia al usuario mencionado y no al admin | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0151 | 97 | Audit Fix 4 (Estabilidad TV): cambiarTele responde con mensaje informativo sin crashear si el script no existe | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/contactos_naturales.test.js

Destino de tests propuesto: `tests/unit/legacy/contactos_naturales.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0152 | 71 | Recado ambiguo pide opciones y no manda a ningún contacto | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0153 | 86 | Elección numérica conserva recado y anonimato sin pedir repetirlo | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0154 | 100 | Nombre completo selecciona el contacto correcto y API tool no duplica confirmación | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0155 | 112 | Número fuera de rango no pierde recado y comandos ajenos siguen su ruta | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0156 | 122 | Sesiones de recado se aíslan por chat y remitente, incluido JID alternativo | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0157 | 132 | Sesión vencida no envía el recado; cancelar también elimina selección | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0158 | 144 | Fallo de entrega devuelve error y conserva la selección para reintentar | features/messaging | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0159 | 155 | Confirmación fallida no declara que falló un recado ya entregado | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0160 | 164 | Dos respuestas simultáneas no envían el mismo recado dos veces | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0161 | 176 | No hay autorización ni coincidencia parcial: jamás se manda un recado | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0162 | 186 | Comando acepta campos nativos de Gemini y anonimato sin prefijo | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0163 | 193 | Selección natural y prioridad del normalizador usan la misma sesión y caducidad | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0164 | 205 | Aclaración de contactos publica contrato compartido sin perder pregunta española | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0165 | 223 | Tool de recados conserva contrato de aclaración y completa la entrega al elegir | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/content_reader.test.js

Destino de tests propuesto: `tests/unit/legacy/content_reader.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0166 | 31 | PDF conserva bytes nativos, páginas e identidad aunque metadata diga JPEG | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0167 | 40 | PNG se detecta por bytes sin suponer JPEG | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0167: PNG content is detected from bytes and OCR receives the detected MIME` | implementado: la firma PNG decide el MIME de OCR aunque la extensión de descarga diga JPEG. |
| TR-0168 | 46 | Documento con caption y envoltorio efímero mantiene metadata | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0169 | 53 | Texto se extrae completo, no se disfraza de imagen | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0169: UTF-8 document text is returned complete and never as encoded image content` | implementado: conserva el texto UTF-8 completo como texto. |
| TR-0170 | 61 | Descarga fallida pide reenviar y nunca afirma haber leído contenido | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0170: expired and unknown media downloads ask for a re-send without exposing provider diagnostics` | implementado: descarga expirada y fallo genérico se distinguen por códigos cerrados; ambos piden reenvío sin exponer diagnóstico del proveedor. |
| TR-0171 | 70 | Límite declarado rechaza antes de descargar | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0171: declared file length above the inline limit is rejected before download` | implementado: el tamaño declarado en el envelope se comprueba antes de invocar el downloader. |
| TR-0172 | 79 | Límite real comprueba los bytes aunque metadata omita el tamaño | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0172: actual bytes are bounded when provider metadata omits the size` | implementado: los bytes devueltos que exceden el máximo se rechazan. |
| TR-0173 | 84 | Transporte recibe límite de bytes y un corte de tamaño se informa sin afirmar lectura | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0173: downloader receives the byte limit and oversized transport errors map to too_large` | implementado: el downloader recibe maxBytes y errores de límite se convierten en AppError too_large sin filtrar su diagnóstico. |
| TR-0174 | 94 | fileLength Long serializado no oculta un archivo enorme por overflow de low | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0174: serialized uint64 fileLength is compared without signed-low overflow` | implementado: el Long serializado se compara como uint64 antes de descargar. |
| TR-0175 | 101 | Firma PDF prevalece sobre una extensión Office equivocada | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace.test.js` — `TR-0175: PDF byte signature wins over Office filename and MIME` | implementado: bytes PDF se leen como PDF aunque nombre y MIME declaren DOCX; no se invoca LibreOffice. |
| TR-0176 | 108 | Archivo vacío y documento sin texto piden otra copia | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0176: empty and textless files never claim extracted text` | implementado: vacío y whitespace devuelven lectura vacía; el handler pide una copia legible y no afirma haber extraído contenido. |
| TR-0177 | 113 | Texto muy largo no se trunca silenciosamente | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0177: text above the declared character limit is rejected rather than truncated` | implementado: el texto sobre el máximo falla con tipo too_large y no devuelve fragmento truncado. |
| TR-0178 | 119 | Texto con UTF-8 inválido o contenido binario no se inventa | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0178: invalid UTF-8 and binary control bytes are rejected without invented text` | implementado: UTF-8 inválido y controles binarios fallan sin producir texto. |
| TR-0179 | 124 | PDF corrupto o encriptado produce preguntas específicas | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0180 | 131 | Lector PDF no disponible o timeout no se disfraza de contenido validado ni archivo corrupto | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0181 | 137 | PDF protegido que pdfinfo consigue abrir también pide copia sin contraseña | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0182 | 144 | PDF sin páginas o más de 1000 páginas pide una copia manejable | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0182: PDFs without pages or above the page cap fail with typed bounded outcomes` | implementado: la salida del handler explica que falta una página legible o que el documento supera el límite y pide solo las páginas necesarias. |
| TR-0183 | 150 | Formato desconocido o imagen falsa no usa fallback JPEG | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0183: unknown formats and fake image signatures never fall back to JPEG` | implementado: las firmas de imagen falsas y formatos desconocidos se rechazan como unsupported_media. |
| TR-0184 | 156 | GIF pide una foto legible en lugar de mandar MIME no soportado | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace2.test.js` — `TR-0184: GIF is rejected as unsupported image input` | implementado: el handler rechaza GIF animado con indicación de enviar una foto fija y legible. |
| TR-0185 | 162 | Conversión Office es interna, usa perfil único y limpia los temporales | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace.test.js` — `TR-0185: Office reading converts internally with unique profiles and removes temporary workspaces` | implementado: dos conversiones usan perfiles aislados y la lectura devuelve texto extraído; las áreas temporales quedan vacías. |
| TR-0186 | 190 | Conversión fallida y PDF corrupto limpian temporales incluso en error | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace.test.js` — `TR-0186: failed Office conversion and corrupt PDF clean their temporary workspaces` | implementado: fallan conversión y lector PDF con diagnósticos privados; ambos errores conservan tipo seguro y limpian workspace. |
| TR-0187 | 202 | Office con extensión falsificada no se abre con LibreOffice | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace.test.js` — `TR-0187: falsified Office extension is rejected before LibreOffice runs` | implementado: firma no ZIP rechaza DOCX y no ejecuta procesos. |
| TR-0188 | 209 | Cita conserva identidad del adjunto original | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0189 | 224 | Office con nombre bin/zip usa MIME y firma, con extensión de conversión allowlisted | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace.test.js` — `TR-0189: Office MIME plus ZIP signature assigns a safe allowlisted conversion extension` | implementado: MIME Office y firma ZIP producen entrada `input.docx`, aunque el nombre original termine en `.bin`. |
| TR-0190 | 241 | MIME Office falsificado no convierte texto ni un ZIP genérico sin tipo Office conocido | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/adapters/legacyContentReaderTrace.test.js` — `TR-0190: Office MIME mismatch and generic ZIP do not invoke LibreOffice` | implementado: firma de texto con MIME Office y ZIP genérico se rechazan sin iniciar LibreOffice. |
| TR-0191 | 247 | Fallo de disco creando o escribiendo temporales devuelve aclaración y no lanza excepción | features/convertir + features/documentos + features/contentReader | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0192 | 262 | Fallo de limpieza preserva el diagnóstico original en PDF protegido | features/convertir + features/documentos + features/contentReader | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0193 | 273 | Fallo de limpieza después de lectura correcta termina con aclaración, sin bytes publicados | features/convertir + features/documentos + features/contentReader | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |

## test/conversationStyle.test.js

Destino de tests propuesto: `tests/unit/legacy/conversationStyle.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0194 | 25 | La longitud viene de la decisión semántica, sin clasificar palabras del mensaje | policies/response.policy + pipeline/composer | S10 | intencional-pending: §6.2: política aplica presupuestos y petición explícita de detalle; modo semántico no puede invalidarlos. |
| TR-0195 | 31 | Detecta muletillas por respuestas y no usa mensajes del usuario ni otros chats | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0196 | 42 | Memoria de estilo sólo toma las últimas seis respuestas del chat | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0197 | 48 | Voz conserva relación y preferencias sin heredar órdenes antiguas de insultar | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0198 | 61 | Detección de duplicados distingue párrafos reciclados de datos cortos | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0199 | 68 | Clasificación y conversación no heredan la temperatura global | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0200 | 76 | Perfiles configurables respetan presupuestos pequeños y descartan valores inválidos | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0201 | 107 | Gemini recibe perfiles distintos y longitud contextual en peticiones reales simuladas | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0202 | 118 | Gemini y Groq usan la misma voz, preferencias y presupuesto | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0203 | 128 | Redacción recibe muletillas recientes sin contaminar la siguiente conversación | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0204 | 137 | Párrafo casual duplicado se reformula una sola vez y no queda en bucle | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0205 | 148 | Resultados comprobados no se reformulan como párrafo casual ni ejecutan servicios | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0206 | 158 | Router descarta texto conversacional legado y sólo devuelve clasificación | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0207 | 187 | Agente redacta con voz común y resultados reales, sin reutilizar texto del planificador | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0208 | 197 | Agente conserva error real al fallar planificación posterior y al agotar turnos | policies/response.policy + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0209 | 207 | Agente con planificación vacía pasa a voz común sin afirmar que ejecutó herramientas | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0210 | 215 | Agente no vuelve a confirmar lo ya enviado ni reescribe una aclaración | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0211 | 225 | Agente no reintenta una nota de voz fallida cuyo aviso ya se entregó ni duplica aclaraciones | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0212 | 265 | Dispatcher ignora redacción del clasificador: charla común sin invocar herramientas | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0213 | 272 | Dispatcher conserva orquestación y no responde dos veces si agente ya entregó resultado | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/convertir_documentos.test.js

Destino de tests propuesto: `tests/unit/legacy/convertir_documentos.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0214 | 10 | Convertir: Rechaza formato desconocido amigablemente | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/features/legacyTrace0214-0215.test.js` — `TR-0214: convertir rejects an unknown output format with user-facing guidance before processing` | implemented: respuesta de formato inválido y cero llamadas al puerto de proceso. |
| TR-0215 | 27 | Convertir: Rechaza si no se adjunta archivo ni url | features/convertir + features/documentos + features/contentReader | `tests/unit/v2/features/legacyTrace0214-0215.test.js` — `TR-0215: convertir without attachment or URL asks for a file/link and does not expose a stack` | implemented: solicita archivo/enlace, evita stack y no invoca el puerto. |

## test/cooperacha.test.js

Destino de tests propuesto: `tests/unit/legacy/cooperacha.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0216 | 113 | Cooperacha 1: aliases registrados correctamente en commandRegistry | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0217 | 124 | Cooperacha 2: rechazo estricto en chats privados y verificación de autorización de grupos | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0218 | 158 | Cooperacha 3: procesamiento no bloqueante de imagen censurada con FFmpeg | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0219 | 177 | Cooperacha 4: arranque de reto, creación de sesión, meta configurable y previsualización censurada | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0220 | 221 | Cooperacha 5: deducción atómica de XP y validaciones contra saldo insuficiente y datos inválidos | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0221 | 285 | Cooperacha 6: ciclo completo de expiración con retención del 20% y reembolso automático del 80% | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0222 | 352 | Cooperacha 7: ciclo completo de cumplimiento al 100% de la meta con destape de foto original | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0223 | 399 | Cooperacha 8: gestión híbrida de fuentes (carpeta local vs fallback web) | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0224 | 448 | Cooperacha 9: consulta de estado cuando la cooperacha está activa muestra progreso y tiempo | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0225 | 483 | Cooperacha 10: cancelación por administrador reembolsa 100% y rechaza a no administradores | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0226 | 536 | Cooperacha 11: concurrencia atómica de SQLite previene sobregiro en aportes paralelos | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0227 | 560 | Cooperacha 12: enrutamiento de lenguaje natural mediante dispatcher (le meto 100) | features/community | S01 | intencional-pending: §6.1: aporte natural requiere addressing/sesión autorizada; excepción solo airdrop vigente. |
| TR-0228 | 618 | Cooperacha 13: censura blindada genera archivo válido con pixelado y barra de censura | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0229 | 634 | Cooperacha 14: reto autónomo cada 48 horas opera independientemente de activaciones manuales | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/cooperachaRouting.test.js

Destino de tests propuesto: `tests/unit/legacy/cooperachaRouting.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0230 | 79 | Cooperacha natural: botsky échate una fotito censurada | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0231 | 79 | Cooperacha natural: botsky, arma una cooperación 300 | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0232 | 79 | Cooperacha natural: armar cooperacha 300 | features/community | S01 | intencional-pending: §6.1: frase grupal sin addressing no inicia reto ni gasta XP. |
| TR-0233 | 79 | Cooperacha natural: iniciar vaquita 300 | features/community | S01 | intencional-pending: §6.1: frase grupal sin addressing no inicia reto ni gasta XP. |
| TR-0234 | 79 | Cooperacha natural: reto de foto 300 | features/community | S01 | intencional-pending: §6.1: frase grupal sin addressing no inicia reto ni gasta XP. |
| TR-0235 | 79 | Cooperacha natural: Botsky, mándame una foto censurada para juntar 400 XP. | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0236 | 87 | Pedir otra censurada con reto activo muestra estado sin deducir una aportación | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0237 | 94 | Aportación con nombre del bot conserva la cantidad del participante | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0238 | 101 | No inicia cooperacha por mencionar una foto: botsky quiero comprar un pack | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0239 | 101 | No inicia cooperacha por mencionar una foto: botsky cómo funciona la foto censurada | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0240 | 101 | No inicia cooperacha por mencionar una foto: ayer mandaron una foto censurada | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/daily.test.js

Destino de tests propuesto: `tests/unit/legacy/daily.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0241 | 14 | Daily: commandRegistry reconoce los aliases de daily | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0242 | 21 | Daily: pickPrize mapea probabilidades correctamente con descripciones limpias | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0243 | 35 | Daily: formatCooldownRemaining calcula horas y minutos correctamente | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0244 | 43 | Daily: ciclo completo de primer reclamo, cooldown de 24h y racha consecutiva en SQLite | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0245 | 104 | Daily: message_normalizer detecta frases naturales para daily | features/economy | S01 | intencional-pending: §6.1/§5: preservar texto; daily natural grupal requiere addressing, interpretar en router. |

## test/descargar.test.js

Destino de tests propuesto: `tests/unit/legacy/descargar.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0246 | 10 | descargar: buildArgs genera flags estándar para YouTube | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0247 | 20 | descargar: buildArgs detecta Spotify y genera comando para spotdl | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0248 | 30 | descargar: matchSelection reconoce números, expresiones coloquiales, puntuación y formatos | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0249 | 69 | descargar: extractAdultUrl detecta dominios adultos sin protocolo y los normaliza | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0250 | 76 | descargar: handleDescargar ignora fotos de TikTok en silencio | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0251 | 87 | descargar: auto-subida a Google Drive cuando excede el límite de WhatsApp | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0252 | 140 | descargar: exporta getDownloadSessionKey e inProgressDownloads correctamente | features/media-download | No aplica directamente; regresión legacy. | pending: Preservar identidad de sesión/concurrencia; export Map no se porta literalmente: TtlStore (§7.5). |
| TR-0253 | 145 | descargar: buildArgs no incluye límites arbitrarios (--max-filesize, filesize<?10M, corte de 5min) | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0254 | 156 | descargar: peticiones con términos para adultos activan isAdult y consultan searchAdultList | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0255 | 197 | descargar: matchSelection funciona para seleccionar de la lista aunque exista semanticDecision | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0256 | 247 | descargar: URL de sitio adulto sin protocolo activa isAdult y se procesa directamente | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0257 | 283 | descargar: searchAdultList limpia preposiciones y términos adultos de la consulta | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0258 | 306 | descargar: matchSelection maneja menciones de bot y expresiones reflexivas mexicanas | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0259 | 315 | descargar: searchAdultList limpia verbos imperativos esdrújulos con acento | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0260 | 341 | descargar: selección explícita sin sesión activa informa amistosamente al usuario | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0261 | 361 | descargar: extractAdultUrl limpia puntuación final y admite espejos numéricos (xvideos2, xnxx2) | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0262 | 370 | descargar: matchSelection reconoce variantes reflexivas y verbos coloquiales mexicanos (échame el 1, échate la 2) | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0263 | 377 | descargar: searchAdultList limpia videos porno, clips, múltiples artículos y preserva categorías como pelirrojas | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0264 | 403 | descargar: búsqueda con acentos en términos adultos ("videos eróticos") activa isAdult | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0265 | 438 | descargar: búsqueda genera y envía collage de miniaturas con sendMedia | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0266 | 496 | descargar: searchAdultList extrae thumbnailUrl correctamente de data-src o src | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/difusion.test.js

Destino de tests propuesto: `tests/unit/legacy/difusion.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0267 | 18 | Difusion: parallelDispatch ejecuta 12 tareas en lotes concurrentes en menos de 1 segundo | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0268 | 41 | Difusion: getParticipantJid resuelve números y JIDs correctamente | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0269 | 49 | Difusion: isBotJid detecta el número del bot | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0270 | 56 | Difusion: Usuario no-admin con menos de 5000 XP es rechazado | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0271 | 83 | Difusion: Usuario no-admin con 5000 XP paga el costo y ejecuta la difusión | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0272 | 130 | Difusion: Administrador autorizado realiza difusión gratis (0 XP) | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0273 | 176 | Difusion: Con foto adjunta envía sendMedia a cada participante | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/dispatcher.test.js

Destino de tests propuesto: `tests/scenario/legacy/dispatcher.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0274 | 16 | Auth: cleanJidNumber normaliza números eliminando servidor y dispositivo | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0275 | 25 | Auth: getSenderJid extrae el participante en grupos y from en privados | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0276 | 41 | Auth: isAuthorizedAdmin valida JID contra ALLOWED_NUMBERS_ADMIN | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0277 | 63 | Auth: pushName o userName "Admin" NO confiere privilegios (Anti-Spoofing) | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0278 | 79 | Auth: fail-closed cuando no hay ALLOWED_NUMBERS_ADMIN configurado | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0279 | 96 | Dispatcher: Usuario autorizado invocando /@terminal ejecuta runAgentWithTerminal | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0280 | 157 | Dispatcher: Usuario NO autorizado invocando /@terminal recibe acceso denegado y NO ejecuta agente | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0281 | 209 | Dispatcher: Usuario no autorizado con pushName "Admin" o "Owner" es rechazado (Anti-Spoofing) | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0282 | 264 | Dispatcher: Usuario autorizado en grupo con pushName cualquiera es admitido por su JID | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0283 | 317 | Dispatcher: Comandos existentes (ej: ayuda) continúan funcionando intactos | pipeline/router + pipeline/executor + pipeline/composer | `tests/unit/v2/features/legacyWaveABasicsTrace.test.js` — caso identificado `TR-0283` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0284 | 356 | Dispatcher: Mensajes normales de chat siguen respondiendo con chatWithBotsky sin invocar terminal | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0285 | 411 | Dispatcher: action "ignore" descarta el mensaje y no envía nada a WhatsApp | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0286 | 460 | Dispatcher: Insultos y mentadas de madre en grupo activan bypass directo de Gatekeeper y responden con chat (Opción 1) | pipeline/router + pipeline/executor + pipeline/composer | S01 | intencional-pending: §6.1: insulto sin addressing deja de activar respuesta. |
| TR-0287 | 507 | Dispatcher: Mensajes de una palabra como jaja o ok siguen filtrados a costo cero sin llamar a la IA | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0288 | 550 | Dispatcher: Conversación grupal sin mención ni cita al bot es archivada en historial pero NO envía respuesta (anti-spam) | adapters/store + features/conversation | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0289 | 597 | Dispatcher: En grupo, responde cuando lo llaman por su nombre ("botsky", "bot", "botsito") con el contexto del chat | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: El título enumera bot genérica; el cuerpo solo prueba botsky. Conservar ese caso y añadir S02 para bot genérica (§6.1). |
| TR-0290 | 644 | Dispatcher: En grupo, responde cuando citan/responden directamente a un mensaje de Botsky | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0291 | 702 | Dispatcher: Petición en lenguaje natural para videos ("busca videos de perritos") enruta a descargar con query | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0292 | 741 | Dispatcher: Sinónimo "video" devuelto por IA es normalizado a "descargar" | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0293 | 779 | Dispatcher: Desambiguación de "buscar" redirige a "descargar" si la petición pide videos | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/doxeo.test.js

Destino de tests propuesto: `tests/unit/legacy/doxeo.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0294 | 13 | Doxeo 1: generateMockDoxeo genera reporte técnico serio sin DEVICE VENDOR ni bromas tontas | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0295 | 52 | Doxeo 2: Registro en commandRegistry reconoce aliases | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0296 | 59 | Doxeo 3: handleDoxeo extrae menciones o args correctamente | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0297 | 91 | Doxeo 4: Cooldown de venganza privada en db.js previene spam (24h) | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/drive.test.js

Destino de tests propuesto: `tests/unit/legacy/drive.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0298 | 5 | drive: searchFiles escapa comillas simples y backslashes en la consulta | features/drive | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0299 | 19 | drive: getQuota devuelve información de almacenamiento si está autenticado | features/drive | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/e2e_requirements.test.js

Destino de tests propuesto: `tests/scenario/legacy/e2e_requirements.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0300 | 89 | T1.1 F1 ToolRegistry: minecraft_control returns structured telemetry under mocked service | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0301 | 110 | T1.2 F1 ToolRegistry: notas_tablon listar resolves cleanly to structured notes list | features/notes | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0302 | 116 | T1.3 F1 ToolRegistry: recordatorios_alarmas listar returns active reminder list | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0303 | 122 | T1.4 F1 ToolRegistry: tareas_escolares listar resolves structured homework entries | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0304 | 128 | T1.5 F1 ToolRegistry: enviar_mensaje_contacto denies unauthorized access safely without throw | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0305 | 140 | T1.6 F2 Dispatch: /@ayuda fast-path routes successfully and delivers user guide | pipeline/router + pipeline/executor + pipeline/composer | `tests/unit/v2/features/legacyWaveABasicsTrace.test.js` — caso identificado `TR-0305` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0306 | 157 | T1.7 F2 Dispatch: unregistered command does not throw unhandled exception | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0307 | 177 | T1.8 F2 Dispatch: unauthorized user invoking /@terminal is blocked with friendly rejection | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0308 | 194 | T1.9 F2 Dispatch: message with minimal empty messageData executes defensively without TypeError | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0309 | 210 | T1.10 F2 Dispatch: audio message without text auto-routes to transcribir command | features/voice | No aplica directamente; regresión legacy. | pending: Solo assert.ok(true): prueba ausencia de excepción, no enrutamiento efectivo. Portar resiliencia; §6.4 necesita escenarios propios. |
| TR-0310 | 232 | T1.11 F3 UX: error with userMessage is delivered cleanly without stack traces | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0311 | 263 | T1.12 F3 UX: raw stack traces with "at Object" are suppressed from user output | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0312 | 290 | T1.13 F3 UX: shell errors starting with "Command failed" do not expose raw bash execution | adapters/system/shell + features/admin-system | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0313 | 316 | T1.14 F3 UX: permission rejection provides clear explanation with "acceso denegado" | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0314 | 333 | T1.15 F3 UX: help guide uses readable layout and proper formatting | pipeline/router + pipeline/executor + pipeline/composer | `tests/unit/v2/features/legacyWaveABasicsTrace.test.js` — caso identificado `TR-0314` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0315 | 353 | T1.16 F4 Progress: start() emits hourglass reaction ⏳ on message key | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0316 | 366 | T1.17 F4 Progress: done() emits checkmark reaction ✅ on completion | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0317 | 381 | T1.18 F4 Progress: fail() emits cross reaction ❌ and throws error with userMessage | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0318 | 404 | T1.19 F4 Progress: null messageKey operates safely as no-op without network errors | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0319 | 417 | T1.20 F4 Progress: tracks duration accurately across start and finish | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0320 | 430 | T1.21 F5 Stability: TieredQueue periodic cleanup interval can be unreferenced | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0321 | 446 | T1.22 F5 Stability: Queue add processes tasks and drains pending queue to 0 | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0322 | 456 | T1.23 F5 Stability: Queue rejects when exceeding maxPerUser rate limit without hanging | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0323 | 485 | T1.24 F5 Stability: spawnWithProgress terminates cleanly on timeout with SIGKILL | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0324 | 498 | T1.25 F5 Stability: master scheduler unref ticker operates without holding event loop | platform/scheduler | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0325 | 509 | T1.26 F6 Synthetic: ejecutar_terminal requires admin and executes safely | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0326 | 516 | T1.27 F6 Synthetic: afinidad_y_lore queries user affinity metrics cleanly | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0327 | 525 | T1.28 F6 Synthetic: google_drive espacio returns storage quota structure | features/drive | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0328 | 537 | T1.29 F6 Synthetic: juegos_y_economia with unknown game returns controlled error | features/economy | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0329 | 543 | T1.30 F6 Synthetic: unregistered tool name returns controlled error | adapters/ai/toolBridge + pipeline/executor | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0330 | 555 | T2.1 F1 Boundary: executeTool with args = null handles safely without TypeError | adapters/ai/toolBridge + pipeline/executor | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0331 | 561 | T2.2 F1 Boundary: executeTool with args = undefined handles safely | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0332 | 566 | T2.3 F1 Boundary: executeTool with primitive string as args handles defensively | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0333 | 571 | T2.4 F1 Boundary: missing mandatory required property returns controlled error | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0334 | 577 | T2.5 F1 Boundary: arguments with unicode emojis and special chars preserve integrity | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0335 | 587 | T2.6 F2 Boundary: dispatch(null) discards safely without throwing | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0336 | 592 | T2.7 F2 Boundary: dispatch({}) discards safely without throwing | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0337 | 597 | T2.8 F2 Boundary: dispatch with malformed empty from JID discards safely | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0338 | 610 | T2.9 F2 Boundary: extreme message text length (15,000 chars) handles without stack overflow | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0339 | 626 | T2.10 F2 Boundary: whitespace-only text discards cleanly | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0340 | 644 | T2.11 F3 Boundary: circular reference in error does not crash serialization | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0341 | 669 | T2.12 F3 Boundary: empty error message string new Error("") defaults safely | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0342 | 692 | T2.13 F3 Boundary: error with null stack does not crash dispatcher inspection | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0343 | 717 | T2.14 F3 Boundary: non-Error string throwable handled safely by error boundary | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0344 | 741 | T2.15 F3 Boundary: sensitive API keys in error message are sanitized or masked | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0345 | 769 | T2.16 F4 Boundary: network failure in sendReaction during start() does not throw | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0346 | 785 | T2.17 F4 Boundary: network failure in sendReaction during fail() still throws userMessage error | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0347 | 808 | T2.18 F4 Boundary: consecutive done() calls are idempotent | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0348 | 822 | T2.19 F4 Boundary: fail() after done() updates state without unhandled exception | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0349 | 836 | T2.20 F4 Boundary: sub-millisecond start and done lifecycle runs without race conditions | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0350 | 849 | T2.21 F5 Boundary: multiple TieredQueue instances can be constructed and cleared | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0351 | 862 | T2.22 F5 Boundary: queue with maxPerUser = 0 immediately rejects | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0352 | 877 | T2.23 F5 Boundary: burst of 15 sequential tasks drains queue completely | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0353 | 891 | T2.24 F5 Boundary: failing task inside queue does not block subsequent jobs | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0354 | 908 | T2.25 F5 Boundary: undefined user ID in queue defaults safely without crash | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0355 | 915 | T2.26 F6 Boundary: simulated service timeout returns controlled contingency | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0356 | 929 | T2.27 F6 Boundary: simulated corrupt JSON from external service does not throw SyntaxError | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0357 | 943 | T2.28 F6 Boundary: extreme and NaN numeric IDs handle safely | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0358 | 951 | T2.29 F6 Boundary: rapid sequential tool invocations execute without cross-talk | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0359 | 960 | T2.30 F6 Boundary: empty context {} defaults missing fields without crashing | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0360 | 969 | T3.1 Pairwise (F1+F3): Tool failure during dispatch formats to friendly message without stack trace | adapters/ai/toolBridge + pipeline/executor | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0361 | 997 | T3.2 Pairwise (F2+F4): Command dispatch with progress lifecycle triggers reactions ⏳ then ✅ | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0362 | 1017 | T3.3 Pairwise (F2+F3+F4): Command failure triggers ❌ reaction and user-facing error message | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0363 | 1036 | T3.4 Pairwise (F1+F6): Synthetic multi-tool sequential chain maintains context | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0364 | 1044 | T3.5 Pairwise (F2+F5): Multi-user burst across queue tiers drains completely with clean handles | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0365 | 1056 | T3.6 Pairwise (F1+F2+F4): Tool invocation coupled with async progress tracking | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0366 | 1070 | T3.7 Pairwise (F3+F5): Subprocess timeout killed cleanly without zombie handles, error masked | adapters/system/shell + features/admin-system | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0367 | 1089 | T4.1 Real-World: Multi-turn agent workflow executing tools under partial service failure | adapters/ai/toolBridge + pipeline/executor | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0368 | 1129 | T4.2 Real-World: Heavy async media / document request with progress reaction life cycle | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0369 | 1150 | T4.3 Real-World: Malformed user commands across command catalog with friendly fallback guidance | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0370 | 1178 | T4.4 Real-World: Automated test execution with active queue and timer teardown verification | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0371 | 1195 | T4.5 Real-World: Synthetic tool execution across all 12 tools under success and contingency conditions | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/evolution_native_tables.test.js

Destino de tests propuesto: `tests/contract/legacy/evolution_native_tables.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0372 | 14 | native-table validation accepts bounded tables and normalizes mentions | adapters/evolution | No aplica directamente; regresión legacy. | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |
| TR-0373 | 21 | native-table validation rejects malformed, arbitrary and excessive payloads | adapters/evolution | No aplica directamente; regresión legacy. | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |
| TR-0374 | 42 | handler rejects invalid requests before accessing any service | adapters/evolution | No aplica directamente; regresión legacy. | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |
| TR-0375 | 49 | handler reports absent and disconnected instances without transmission | adapters/evolution | No aplica directamente; regresión legacy. | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |
| TR-0376 | 61 | handler resolves only Evolution routerPath instanceName parameter | adapters/evolution | No aplica directamente; regresión legacy. | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |
| TR-0377 | 78 | handler builds only the table message and uses existing typing and persistence service | adapters/evolution | No aplica directamente; regresión legacy. | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |
| TR-0378 | 94 | handler passes send failures onward without a retry marker or second send | adapters/evolution | S11 (relación de errores; no reemplaza escenario) | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |
| TR-0379 | 109 | bundle patch preserves authenticated guards and original endpoints and is idempotent | adapters/evolution | No aplica directamente; regresión legacy. | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |
| TR-0380 | 118 | bundle patch fails closed on changed or partial integration | adapters/evolution | No aplica directamente; regresión legacy. | ported: tests/contract/evolutionNativeTables.test.js; mismo contrato, puertos aislados. |

## test/happyHour.test.js

Destino de tests propuesto: `tests/unit/legacy/happyHour.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0381 | 79 | R1: Registro de comandos y aliases en commandRegistry | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0382 | 85 | R1: Ciclo de vida básico en memoria y persistencia SQLite (start, status, stop) | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0383 | 129 | R1: Recuperación de estado activo tras reinicio del proceso (initHappyHourRecovery) | features/community | S18 (relación; revisar persistent) | pending: Portar; equivalente aún no implementado. |
| TR-0384 | 163 | R1: Evento expirado mientras el bot estaba apagado se restablece a inactivo | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0385 | 184 | R5: Comando !horafeliz - Control administrativo estricto y rechazo a no administradores | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0386 | 227 | R3: Economía de Experiencia - Multiplicador +20 XP durante Hora Feliz vs 1 XP estándar | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0387 | 254 | R3: Mercado Negro Packs - 50% de descuento (75 XP) y entrega ampliada (4-6 fotos) | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0388 | 295 | R2: Lluvia de Media Periódica - Despacho de 1-2 medios y protección contra inactividad | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0389 | 316 | R4: AirDrop Express - Candado síncrono en memoria elimina condiciones de carrera | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0390 | 372 | R5: AI Semantic Router & Fast-Path Pre-LLM para consultas en lenguaje natural | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0391 | 430 | R6: Aislamiento Estricto - 0 llamadas a números reales de WhatsApp | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/history_persistence.test.js

Destino de tests propuesto: `tests/contract/legacy/history_persistence.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0392 | 8 | SQLite: WAL mode y pragmas de rendimiento activos | adapters/store + features/conversation | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0393 | 16 | SQLite: chat_history guarda y recupera mensajes cronológicamente | adapters/store + features/conversation | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0394 | 35 | History: addMessage persiste a SQLite y clearHistory limpia ambos | adapters/store + features/conversation | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/maicra_command.test.js

Destino de tests propuesto: `tests/unit/legacy/maicra_command.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0395 | 36 | Maicra Command 1: Sin argumentos envía reporte en vivo unificado (cero encuestas/polls) | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0396 | 47 | Maicra Command 2: "mods" consulta y envía el resumen de addons | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0397 | 56 | Maicra Command 3: "jugadores" consulta jugadores activos en vivo | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0398 | 64 | Maicra Command 4: "estado" consulta estado del contenedor y recursos | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0399 | 72 | Maicra Command 5: "mundos" lista los mundos creados y el activo | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0400 | 80 | Maicra Command 6: Opción de encuesta WhatsApp "📦 Ver Mods y Addons" detecta intención | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0401 | 86 | Maicra Command 7: Frase natural "qué mods tiene el server" detecta mods | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0402 | 92 | Maicra Command 8: Frase natural "quién está jugando" detecta jugadores | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0403 | 98 | Maicra Command 9: Usuario no admin no puede encender el servidor | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0404 | 104 | Maicra Command 10: Usuario no admin no puede ejecutar comandos de consola | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0405 | 110 | Maicra Command 11: Usuario no admin no puede desactivar mods | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/mediaDelivery.test.js

Destino de tests propuesto: `tests/unit/legacy/mediaDelivery.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0406 | 85 | Audio nuevo conserva contexto y entrega al grupo elegido por Gemini | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0407 | 91 | Audio original citado no se recrea ni pasa por TTS; temporal se borra | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0408 | 97 | Foto conserva bytes y caption original sólo si el modelo lo pidió | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0409 | 102 | Caso de la captura: manda la foto con recado compuesto sin censurar vulgaridades | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0410 | 109 | Caption literal con órdenes y voz no altera destinatario, archivo ni contenido | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0411 | 114 | Permisos se verifican antes de descargar archivos o sintetizar un envío externo | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0412 | 120 | Chat local admite respuesta sin permisos de administrador y no exige otro destinatario | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0413 | 125 | Destino ausente o grupo desconocido no se sustituye por el grupo habitual | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0414 | 130 | Contacto ambiguo conserva archivo y sólo descarga tras elección tipada | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0415 | 136 | Contacto ambiguo conserva el encargo de audio y el historial hasta aclararlo | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0416 | 142 | Archivo equivocado o inexistente aclara antes de intentar una entrega | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0417 | 147 | Fallo de descarga, envío o generación de caption nunca confirma entrega ni reintenta | features/messaging | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0418 | 155 | Confirmación fallida no repite ni invalida una entrega confirmada | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0419 | 160 | Audio generado guarda referencia confirmada y conserva chat origen para reenvío | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/mediaSearch.test.js

Destino de tests propuesto: `tests/unit/legacy/mediaSearch.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0420 | 11 | Conserva resultados aunque toda la duración sea desconocida | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0421 | 20 | No interpreta palabras ni símbolos del título como transmisiones en vivo | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0422 | 26 | Filtra únicamente metadatos de directo activo o futuro, conserva grabaciones | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0423 | 38 | Resultados largos conservan el orden de relevancia y no desaparecen por duración | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0424 | 44 | Cero resultados reales es empty, no un fallo del proveedor | features/media-download | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0425 | 50 | Solo directos activos obtiene empty con causa diferenciada | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0426 | 56 | Error del proceso no se convierte en búsqueda vacía ni filtra mensajes sensibles | features/media-download | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0427 | 71 | Salida corrupta o registros inválidos se reportan como indisponibilidad | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0428 | 79 | NDJSON mantiene tabs y nuevas líneas del título sin romper el registro | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0429 | 85 | IDs duplicados se deduplican y el límite se aplica sin inventar URLs | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0430 | 92 | Valida el contrato antes del proceso | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0431 | 101 | Argumentos no usan shell, tienen límite de tiempo y salida, y no descargan medios | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0432 | 117 | Salida excesiva se rechaza también al usar un adaptador inyectado | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/mediaSearchHandler.test.js

Destino de tests propuesto: `tests/unit/legacy/mediaSearchHandler.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0433 | 35 | Handler mantiene consulta semántica, muestra duración desconocida y guarda opciones | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0434 | 47 | Handler distingue vacío, proveedor caído y solicitud inválida sin crear opciones | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0435 | 60 | Sin consulta pregunta en lenguaje natural sin imponer prefijo | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0436 | 68 | Wrapper de compatibilidad mantiene la lista para consumidores antiguos | features/media-download | No aplica directamente; regresión legacy. | pending: Wrapper de compatibilidad: no aprobar DROP aquí; sustituir API solo cuando sus consumidores estén portados. |

## test/mediaUxIntegration.test.js

Destino de tests propuesto: `tests/scenario/legacy/mediaUxIntegration.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0437 | 113 | PDF: Gemini clasifica antes de descargar; redactor recibe PDF nativo completo | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0438 | 124 | Cualquier paráfrasis llega al modelo una vez y su plan no se sustituye por palabras clave | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0439 | 134 | Seguimiento en grupo usa el ID elegido y conserva identidad del solicitante | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0440 | 140 | Archivos ambiguos preguntan; aclaración semántica conserva encargo y elige sólo un ID autorizado | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0441 | 149 | ID inventado o archivo de otro remitente se rechaza antes de descargar | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0442 | 155 | Petición pendiente sólo se guarda cuando Gemini declara que falta el adjunto | policies/attachment.policy + pipeline/context | S08 / S09 / S17 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0443 | 162 | Saludo, matemáticas y QR con texto no heredan un archivo aunque exista contexto reciente | pipeline/router + pipeline/executor + pipeline/composer | `tests/unit/v2/features/legacyWaveABasicsTrace.test.js` — caso identificado `TR-0443` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0444 | 169 | Subir un video o imagen sin encargo requiere aclaración y jamás conversión automática | features/media-download | S08 / S09 | intencional-pending: §6.4: adjunto solo privado => 👀 y ≤3 sugerencias; grupo no dirigido => silencio. |
| TR-0445 | 176 | Preguntas, negaciones y palabras de herramientas conservan chat si el modelo así decide | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0446 | 182 | La acción estructurada gana aunque la frase contenga audio, difusión, video o nuclear | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0447 | 188 | Fallo de los dos modelos no dispara descarga ni ejecuta el primer término como comando | features/media-download | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0448 | 193 | Grupo pasivo: el modelo decide ignorar y no prepara ni descarga contenido | features/media-download | S01 / S09 | intencional-pending: §6.1: decisión de silencio de grupo pasivo ocurre antes del LLM; preservar ausencia de descargas. |
| TR-0449 | 199 | Whitelist impide incluso clasificar una solicitud de un chat no autorizado | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0450 | 203 | La misma frase se interpreta de nuevo si cambian adjuntos e historial; no hay caché de intención | policies/attachment.policy + pipeline/context | S08 / S09 / S17 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0451 | 208 | Descarga fallida detiene lectura sin inventar respuesta, con una sola clasificación | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0452 | 212 | Respuesta incompleta avisa y mantiene formato de WhatsApp | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0453 | 217 | Conversión desde URL no exige un adjunto inexistente | policies/attachment.policy + pipeline/context | S08 / S09 / S17 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0454 | 223 | JSON de envío incompleto se repara una sola vez por Gemini; no se interpreta localmente | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/mensaje.test.js

Destino de tests propuesto: `tests/unit/legacy/mensaje.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0455 | 9 | Mensaje: findGroupContact resuelve contactos de Gente del señor chiqui | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0456 | 22 | Mensaje: handleMensaje rechaza no-administradores | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0457 | 42 | Mensaje: handleMensaje envía mensaje a contacto para admin | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0458 | 76 | Mensaje: executeTool en toolRegistry ejecuta enviar_mensaje_contacto | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0459 | 104 | Mensaje: findGroupContact resuelve el grupo Gente del señor chiqui | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0460 | 116 | Mensaje: mensaje cizañoso al grupo sale de Botsky y NO menciona al emisor | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0461 | 147 | Mensaje: mandales un mensaje al grupo y mientales la madre a Adrian se envía al grupo | features/messaging | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/milestone1_stress.test.js

Destino de tests propuesto: `tests/scenario/legacy/milestone1_stress.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0462 | 58 | Stress: executeTool never throws an unhandled rejection with primitive or bizarre arguments | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0463 | 129 | Stress: executeTool with BigInt in args (must not crash JSON serialization) | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0464 | 139 | Stress: executeTool with Circular references in args (must not crash JSON serialization) | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0465 | 152 | Stress: executeTool with Symbols and throwing getters in args | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0466 | 172 | Stress: All 12 tools handle malformed action parameters safely | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0467 | 224 | Stress: All exported command handlers tolerate null/undefined/malformed arguments without uncaught exceptions | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0468 | 304 | Stress: commandRegistry getCommandHandler handles null/empty parsed without crashing | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/minecraftRemote.test.js

Destino de tests propuesto: `tests/unit/legacy/minecraftRemote.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0469 | 22 | MinecraftRemote 1: formatStatusSummary genera texto offline cuando no está online | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0470 | 35 | MinecraftRemote 2: formatStatusSummary formatea métricas en vivo correctamente | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0471 | 62 | MinecraftRemote 3: formatModsSummary maneja addons activos y catálogo global | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0472 | 85 | MinecraftRemote 4: Invalidate manifest cache limpia caché en memoria | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0473 | 93 | MinecraftRemote 5 [Live]: getRemoteServerStatus consulta contenedor en redspi | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0474 | 105 | MinecraftRemote 6 [Live]: getOnlinePlayers obtiene jugadores y límite de slots | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0475 | 115 | MinecraftRemote 7 [Live]: getActiveModsAndPacks extrae addons y global_mods | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0476 | 126 | MinecraftRemote 8 [Live]: getWorldsList lista los mundos creados en redspi | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0477 | 135 | MinecraftRemote 9 [Live]: deactivateWorldPack maneja mod no existente con mensaje claro | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0478 | 142 | MinecraftRemote 10 [Live]: activateWorldPack maneja mod no existente con mensaje claro | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |

## test/multimedia_drive_estado_ux.test.js

Destino de tests propuesto: `tests/scenario/legacy/multimedia_drive_estado_ux.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0479 | 70 | URL también convierte a formato pedido y aplica velocidad/bitrate | features/documents + adapters/media/documents | `tests/unit/v2/features/legacyTrace0479-0482.test.js` — `TR-0479: converting a URL preserves requested format, speed and bitrate through the feature port`; corroborado por `tests/unit/v2/adapters/documents.test.js` | implemented: conserva URL, formato ogg, calidad, velocidad y bitrate convertido a 128000 en el puerto; adaptador URL ya tiene cobertura de descarga inyectada. |
| TR-0480 | 84 | video ajusta imagen y audio con la misma velocidad | features/documents + adapters/media/documents | `tests/unit/v2/features/legacyTrace0479-0482.test.js` — `TR-0480: video speed applies matching setpts and atempo filters with the requested video bitrate` | implemented: verifica `setpts`, `atempo=2,atempo=2` para 4x y bitrate de video. |
| TR-0481 | 94 | valida velocidad/bitrate y rechaza formatos sin soporte antes de descargar | features/documents + adapters/media/documents | `tests/unit/v2/features/legacyTrace0479-0482.test.js` — `TR-0481: invalid speed, bitrate and unsupported format combinations fail before download or process` | implemented: cubre los seis casos de velocidad/bitrate/formato y confirma cero descargas o procesos. |
| TR-0482 | 107 | no reporta conversión entregada si falla envío y limpia temporales | features/documents + pipeline/composer | `tests/unit/v2/features/legacyTrace0479-0482.test.js` — `TR-0482: conversion delivery failure releases the generated audio and does not mask the send error`; contrato general en `tests/unit/v2/pipeline-output/media-memory.test.js` | implemented: error de entrega se conserva y la salida de conversión se libera. |
| TR-0483 | 149 | Drive conserva sesión tras error y permite reintentar el número | features/drive | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0484 | 162 | Drive conserva sesión cuando falla entrega y rechaza selecciones parciales | features/drive | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0485 | 173 | Drive verifica vencimiento al descargar sin depender del scheduler | platform/scheduler | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0486 | 183 | Drive evita descarga duplicada y conserva búsquedas nuevas durante descarga | features/drive | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0487 | 198 | estado del bot usa proceso y cola sin pedir URL ni ejecutar yt-dlp | platform/queue | `tests/unit/v2/features/legacyWaveABasicsTrace.test.js` — caso identificado `TR-0487` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |

## test/native_tables.test.js

Destino de tests propuesto: `tests/contract/legacy/native_tables.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0488 | 7 | native tables preserve response order, Unicode, blank cells and surrounding formatting | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0489 | 18 | native table parser respects escaped pipes, inline code pipes and optional outer pipes | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0490 | 25 | code fences and invalid separators retain the exact legacy text behavior | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0491 | 38 | ragged native table rows retain all cells and receive complete headers | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0492 | 44 | header-only tables become readable text and following tables keep their structure | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0493 | 51 | native fallback preserves parsed escaped and inline-code pipe cells and extra columns | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0494 | 57 | native extraction reads working C envelopes with canonical escaped Markdown | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0495 | 67 | native extraction preserves mixed submessage order and ignores unrelated text envelopes | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0496 | 78 | large tables split by rows with repeated headers and bounded payloads | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0497 | 92 | oversized single cells fall back to split readable text without losing other rows | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0498 | 105 | native payload matches working C envelope and optional mentions without security metadata | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0499 | 124 | planner validates limits consistently for empty text and table responses | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0500 | 129 | native plans honor adapter column and row limits even with a generous length limit | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/naturalUxIntegration.test.js

Destino de tests propuesto: `tests/scenario/legacy/naturalUxIntegration.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0501 | 50 | Encuesta: Gemini conserva opción numérica hasta el voto real | features/polls | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0502 | 60 | Encuesta: acepta nombre con espacios y acentos sin perder datos estructurados | features/polls | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0503 | 68 | Encuesta: opción inválida pide aclaración sin registrar voto | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0504 | 75 | Conversión: mapper conserva ceros para que el comando valide valores inválidos | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0505 | 99 | Normalizador: tareas y archivos conservan intención para Gemini | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0506 | 109 | Normalizador: elección de contacto tiene prioridad sobre lista de Drive | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0507 | 115 | Normalizador: conserva caption citado al desempaquetar multimedia | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0508 | 146 | Daily: tool devuelve cooldown real sin inventar premio ni enviar duplicado | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0509 | 157 | Daily: éxito informa XP reales, saldo y racha; premio cero sigue siendo giro válido | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0510 | 170 | Daily: error real no se convierte en éxito por el wrapper | features/economy | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0511 | 178 | Daily: comando conserva su mensaje directo y retorna el mismo estado | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0512 | 186 | Agente: una aclaración detiene ejecución hasta nueva respuesta del usuario | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0513 | 211 | Estado: registry selecciona estado local y mantiene info de videos aparte | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0514 | 227 | Router: acepta estado local, alias y voto estructurado sin llamadas reales | features/polls | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/notas.test.js

Destino de tests propuesto: `tests/unit/legacy/notas.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0515 | 13 | Notas: formatNoteDate formatea fechas correctamente | features/notes | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0516 | 19 | Notas: ciclo de base de datos SQLite (guardar, listar, buscar, borrar) | features/notes | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0517 | 58 | Notas: handleNotas maneja guardar, listar, buscar y borrar en chat | features/notes | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0518 | 123 | Notas: commandRegistry reconoce los aliases de notas | features/notes | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/nuclear.test.js

Destino de tests propuesto: `tests/unit/legacy/nuclear.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0519 | 13 | Nuclear: commandRegistry reconoce los aliases de nuclear | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0520 | 20 | Nuclear: rechaza ejecución si no es un grupo | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0521 | 37 | Nuclear: rechaza ejecución si el usuario no tiene 5,000 XP | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0522 | 64 | Nuclear: ciclo completo de detonación kamikaze con deducción de XP y purga | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/observations_minor.test.js

Destino de tests propuesto: `tests/scenario/legacy/observations_minor.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0523 | 12 | Observación 1: Caché distingue por usuario (userId) en getCacheKey y routeWithAI | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0524 | 30 | Router: rechaza acciones desconocidas y argumentos no escalares | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0525 | 37 | Router: conserva sólo metadatos internos seguros para diagnóstico | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0526 | 49 | Router: permite opciones controladas sólo para encuestas | features/polls | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0527 | 58 | Router: reconoce tareas visuales con lenguaje libre y no confunde sticker explícito | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0528 | 66 | Proactivo: sólo permite destinatarios presentes en rencores activos | policies/proactive.policy + features/community | S15 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0529 | 74 | Observación 2: evaluateProactiveAction cuenta con rate-limit anti-spam | policies/proactive.policy + features/community | S15 (relación) | pending: Portar; equivalente aún no implementado. |
| TR-0530 | 107 | Observación 3: Groq fallback sin soporte de visión emite log de métrica [AI-METRICS] | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0531 | 140 | Problema A: handleTerminal preserva el verbo y texto completo en lenguaje natural | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/optimizations.test.js

Destino de tests propuesto: `tests/scenario/legacy/optimizations.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0532 | 7 | Groq Circuit Breaker: Manejo de cooldown ante errores de cuota | adapters/ai | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0533 | 31 | Descargar: Calidad por defecto 480p y selectores <=10MB | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Conflicto legacy: exige cortes 5 min y límites 10/15 MB; descargar.test.js:145 los prohíbe. Resolver con baseline; no cambiar producto por este inventario. |
| TR-0534 | 51 | Gatekeeper: Ingesta en historial y filtrado de ruido trivial en grupos | adapters/store + features/conversation | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0535 | 117 | Descargar: Enlace de foto de TikTok es ignorado en silencio sin lanzar error | features/media-download | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0536 | 129 | IA: Configuración Groq y timeout rápido de Gemini (3s) | adapters/ai | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/pack.test.js

Destino de tests propuesto: `tests/unit/legacy/pack.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0537 | 100 | Pack 1: Aliases y comandos registrados correctamente en commandRegistry | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0538 | 109 | Pack 2: Deducción atómica de 150 XP en SQLite con saldo suficiente | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0539 | 137 | Pack 3: Rechazo amigable por saldo insuficiente (<150 XP) sin cambios en saldo | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0540 | 167 | Pack 4: Despacho desde grupo: confirmación en grupo y fotos exclusivamente al privado | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0541 | 202 | Pack 5: Entrega incluye modo de visualización única (viewOnce: true) | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0542 | 227 | Pack 6: Normalización de destinatario: saneamiento de números mexicanos 521 vs 52 | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0543 | 252 | Pack: compra con XP del participante LID y entrega al teléfono alternativo | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0544 | 275 | Pack: muestra saldo LID insuficiente y permite usar saldo telefónico existente | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0545 | 290 | Pack 7: Fail-Closed si el remitente solo es @lid sin número telefónico | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0546 | 310 | Pack 8: Selección híbrida de contenido: prioridad local vs fallback web | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0547 | 330 | Pack 9: Reembolso automático e integridad si la obtención de fotos falla por completo | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0548 | 360 | Pack 10: Comando explícito !comprar pack forwardea correctamente a handlePack | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0549 | 390 | Pack 11: Detección en lenguaje natural mediante dispatcher (Botsky véndeme un pack) | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0550 | 424 | Pack 12: Throttling espacia envíos consecutivos de fotos | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0551 | 456 | Pack 13: Verificación de rechazo en grupo no autorizado | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0552 | 476 | Pack 14: Lenguaje natural "pásame un pack" en grupo sin prefijo ni mención a Botsky | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0553 | 509 | Pack 15: Lenguaje natural con categoría ("pásame un pack de monas chinas") extrae categoría | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0554 | 542 | Pack 16: Concurrencia atómica: 2 compras simultáneas con saldo para 1 sola (200 XP) | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0555 | 577 | Pack 17: Subcarpeta local por categoría e inventario incompleto (<3) reembolsa | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0556 | 616 | Pack 18: Compra en chat privado 1-a-1 sin prefijo ("un pack") | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0557 | 650 | Pack 19: Blindaje contra Path Traversal en categorías locales (../../etc) | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0558 | 666 | Pack 20: Lenguaje natural expandido ("quiero comprar un pack", "me vendes un pack", "saca el pack") | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0559 | 711 | Pack 21: Extracción y saneamiento de categoría con prefijo "de " (!pack de carros) | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0560 | 739 | Pack 22: Categoría inexistente localmente devuelve 0 locales y recurre a web fallback en vez de fotos irrelevantes | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0561 | 750 | Pack 23: Detección natural con signos de puntuación (!, ?), mención @Botsky y formas verbales expandidas | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0562 | 804 | Pack 24: Saneamiento de muletillas de cortesía ("porfa", "por favor") no las trata como categorías | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0563 | 838 | Pack 25: Búsqueda general (!pack) incluye fotos de subdirectorios locales de primer nivel | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0564 | 856 | Pack 26: getLocalPackImages reconoce archivos .mp4 y .webm con isVideo: true y mime adecuado | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0565 | 884 | Pack 27: handlePack despacha vídeos MP4 con mediatype video y viewOnce true en mensaje privado | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0566 | 917 | Pack 28: Detección y despacho de archivos WebM como mediatype video con View Once | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0567 | 950 | Pack 29: Entrega mixta de pack multimedia (fotos y vídeos) preserva tipos respectivos y View Once | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0568 | 988 | Pack 30: REGLA ABSOLUTA de aislamiento: 0 peticiones de red salientes a números reales de WhatsApp | features/adult-media | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/parser.test.js

Destino de tests propuesto: `tests/unit/legacy/parser.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0569 | 7 | Parser: detecta comandos simples | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0570 | 13 | Parser: extrae flags y argumentos | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0571 | 21 | Parser: flags booleanas | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0572 | 28 | Parser: extractUrl extrae URLs de diferentes dominios | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/perf_arq.test.js

Destino de tests propuesto: `tests/scenario/legacy/perf_arq.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0573 | 7 | Queue Arq #4: Tareas con priority: 1 se ordenan al frente de las pendientes | platform/queue | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0574 | 60 | History Perf #4: addMessage no revive historiales expirados | adapters/store + features/conversation | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0575 | 96 | Descargar Perf #3: inProgressDownloads Map registra y comparte descargas concurrentes | features/media-download | No aplica directamente; regresión legacy. | pending: Portar deduplicación/concurrencia; usar TtlStore en vez de Map global (§7.5). |

## test/personality.test.js

Destino de tests propuesto: `tests/unit/legacy/personality.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0576 | 10 | Personality 1: getUserAffinityContext incluye directivas golpeadas y 100% LATAM | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0577 | 27 | Personality 2: Voz mexicana compartida sin cuota de insultos ni saludos | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0578 | 38 | Personality 3: Ritmo contextual y memoria de expresiones recientes | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0579 | 50 | Personality 4: Inferencia en vivo clasifica ofensa sin redactar la conversación | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Integración real legacy: portar a fake contractual; ejecución real solo en entorno autorizado. |
| TR-0580 | 65 | Personality 5: Creador/Admin tiene jerarquía suprema y directiva estricta contra desobediencia de herramientas | policies/response.policy + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/proactive.test.js

Destino de tests propuesto: `tests/unit/legacy/proactive.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0581 | 12 | Universal Lore 1: Estado doxxed y auto-canon de lore en db.js | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0582 | 47 | Proactive 2: Presupuesto y cooldowns de mensajes espontáneos (canSendProactiveMessage) | features/community | S15 | intencional-pending: §6.3: sustituir cuota/cooldown legacy por opt-in, 3/día y 45 min configurables; privado apagado por defecto. |
| TR-0583 | 74 | Proactive 3: evaluateProactiveAction devuelve estructura válida de decisión | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0584 | 95 | Proactive 4: estado autónomo cambia según actividad y horario | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0585 | 106 | Proactive 5: estado de personalidad y eventos sociales sobreviven en SQLite | features/community | No aplica directamente; regresión legacy. | pending: Persistencia se conserva; API global/id=1 migra a persona_state por chat (§7.3). Equivalente aún no implementado. |
| TR-0586 | 121 | Proactive 5b: la personalidad queda aislada por grupo | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0587 | 134 | Proactive 5c: encuesta permite un voto por usuario y cierre | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0588 | 152 | Proactive 6: detecta una pregunta reciente que quedó sin respuesta | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0589 | 168 | Proactive 7: detecta oportunidad de proponer una actividad grupal | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/recordatorios.test.js

Destino de tests propuesto: `tests/unit/legacy/recordatorios.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0590 | 12 | Recordatorios: parseReminderTime parsea tiempos relativos correctamente | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0591 | 29 | Recordatorios: parseReminderTime prioriza minutesHint de Gemini | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0592 | 36 | Recordatorios: parseReminderTime devuelve null para expresiones inválidas | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0593 | 42 | Recordatorios: formatTimeDiff formatea lapsos de tiempo correctamente | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0594 | 49 | Recordatorios: ciclo completo en base de datos SQLite (crear, consultar, entregar, cancelar) | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0595 | 87 | Recordatorios: commandRegistry reconoce los aliases de recordatorio | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/recortarPdf.test.js

Destino de tests propuesto: `tests/unit/legacy/recortarPdf.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0596 | 19 | Recortar PDF: Flujo completo con Ghostscript real | features/documents + adapters/media/documents | `tests/unit/v2/adapters/legacyTrace0596-0597.test.js` — `TR-0596: real Ghostscript crop preserves requested page ranges and names/captions the PDF` | implementado: Ghostscript real confirma rangos 2-4, 3- y 1,3, conteo de páginas, caption, nombre, liberación, selección ausente/inválida/fuera de rango y el atajo `doc -f pdf 1,3` con salida de dos páginas. |
| TR-0597 | 143 | Recortar PDF: Registro y alias en commandRegistry | features/documents | `tests/unit/v2/adapters/legacyTrace0596-0597.test.js` — `TR-0597: the document manifest registers every legacy crop alias on recortarpdf` | implemented: manifiesto registra `recortar`, `cortar`, `cortarpdf` y `extraerpdf`. |

## test/reminderNotesUx.test.js

Destino de tests propuesto: `tests/scenario/legacy/reminderNotesUx.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0598 | 48 | Herramienta: falta/tiempo inválido pide aclaración y no escribe recordatorios | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0599 | 59 | Herramienta: minutos inválidos, vacíos o infinitos no crean recordatorios | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0600 | 68 | Herramienta y comando guardan el mismo texto citado sin repetirlo | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0601 | 78 | Herramienta y comando crean recordatorios usando la cita y el tiempo indicado | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0602 | 88 | Citas de imágenes, documentos, videos y mensajes envueltos funcionan | features/convertir + features/documentos + features/contentReader | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0603 | 99 | Referencia esto usa cita; contenido explícito conserva prioridad | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0604 | 106 | Sin contenido ni cita pide aclarar; no crea texto genérico | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0605 | 118 | Comando manual relativo y cita sin contenido permanecen válidos | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0606 | 126 | Comando: hora inválida no escribe BD aunque Gemini adjunte minutos | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0607 | 133 | Fecha ISO conserva fecha completa y gana a minutos inferidos | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0608 | 142 | Duraciones y minutos de Gemini válidos conservan plazo; no capturan números sueltos | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0609 | 153 | Horas inválidas se rechazan; hoy vencido no se mueve a mañana | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0610 | 162 | Aclaración incluye solo campos pendientes y no un plazo inventado | features/reminders | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/rikolinoLibrary.test.js

Destino de tests propuesto: `tests/unit/legacy/rikolinoLibrary.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0611 | 45 | lector integra factory real Petrovsky: publicación, nombres, papelera, asociaciones y cambios inmediatos | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0612 | 77 | selección aleatoria para juegos ignora orden del álbum y respeta fotos pendientes | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0613 | 106 | apertura solo lectura no crea DB, no cambia bytes y libera conexiones corruptas | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0614 | 121 | paths manipuladas, symlinks, archivos ausentes y directorios no escapan originales | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0615 | 140 | proveedor packImages usa Rikolino sin web, vacío sin fallback; customDir explícito preserva legado | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0616 | 161 | handler pack sin modificar conserva 150XP, cantidad caller, privado viewOnce y reembolso actual | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0617 | 184 | reader entrega vídeos MP4 y WebM con isVideo: true, mime correcto y soporte mixto | features/community | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/routingFailureIntegration.test.js

Destino de tests propuesto: `tests/scenario/legacy/routingFailureIntegration.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0618 | 98 | Routing blocked: feedback is sent without executing a guessed command or composing chat | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0619 | 98 | Routing configuration: feedback is sent without executing a guessed command or composing chat | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0620 | 98 | Routing invalid_request: feedback is sent without executing a guessed command or composing chat | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0621 | 98 | Routing rate_limit: feedback is sent without executing a guessed command or composing chat | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0622 | 98 | Routing empty_response: feedback is sent without executing a guessed command or composing chat | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0623 | 108 | Routing failure with an image never downloads or reads the attachment | features/media-download | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0624 | 116 | Routing failure in a passive group does not send unsolicited feedback | pipeline/router + pipeline/executor + pipeline/composer | S01 / S11 | intencional-pending: §6.1: grupo pasivo no llama LLM; conservar ausencia de feedback espontáneo. |
| TR-0625 | 124 | Routing failure on an explicit WhatsApp mention sends feedback locally | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0626 | 133 | Different routing failures expose different actionable feedback | pipeline/router + pipeline/executor + pipeline/composer | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0627 | 145 | Valid routing executes exactly the planned search once with its structured query | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0628 | 160 | R1 Fast-Path Pre-LLM para Adultos: intercepta peticiones para adultos antes de llamar al LLM | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0629 | 171 | R1 Fast-Path Pre-LLM para Sitios para Adultos: intercepta URL directa antes del LLM | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0630 | 182 | R2 Fallback de Rescate ante Bloqueos de Seguridad (blocked): rescata a descargar con términos de descarga o adultos | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0631 | 192 | R1 Fast-Path: URL adulta sin protocolo se normaliza con https:// antes del LLM | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0632 | 202 | R1 Fast-Path: mención de bot en grupo y formato natural se extraen correctamente | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0633 | 213 | R1 Fast-Path: selección de lista activa para adultos se procesa sin consultar al LLM | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0634 | 227 | R2 Fallback de Rescate: si LLM bloquea una selección con sesión activa, rescata a descargar | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0635 | 241 | R1 Fast-Path en grupo: selección de lista activa para adultos se procesa en grupos sin consultar al LLM | pipeline/router + pipeline/executor + pipeline/composer | S07a / S07b | intencional-pending: §6.1: selección grupal requiere cita de resultados o mención; sin ella no descarga. |
| TR-0636 | 255 | R2 Fallback en grupo: si LLM bloquea una selección en grupo con sesión activa, rescata a descargar | features/media-download | S07a / S07b | intencional-pending: §6.1: bloqueo LLM no habilita selección grupal sin cita ni mención. |
| TR-0637 | 269 | R1 Fast-Path: términos de video con porno/xxx ("video porno", "videos xxx") se interceptan antes del LLM | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0638 | 283 | R1 Fast-Path en grupo con mención de bot: "@bot porno de latinas" sin verbo se intercepta antes del LLM | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0639 | 293 | R1 Fast-Path: verbos imperativos esdrújulos con tilde ("búscame porno de latinas", "descárgame porno de morenas") se interceptan antes del LLM | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0640 | 313 | R1 Fast-Path: URL adulta con puntuación final o espejo numérico se intercepta y normaliza | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0641 | 329 | R1 Fast-Path: consultas con artículos ("un porno de latinas", "oye compa busca porno") se interceptan antes del LLM | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/ruleta.test.js

Destino de tests propuesto: `tests/unit/legacy/ruleta.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0642 | 14 | Ruleta: commandRegistry reconoce los aliases de ruleta | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0643 | 20 | Ruleta: ciclo completo de creación de sala, mensaje sin comandos y unión natural | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0644 | 152 | Ruleta: no se puede crear sala si el bot no es administrador del grupo | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0645 | 199 | Ruleta: exilio en SQLite y mensaje privado limpio a los 20 minutos | features/games | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/school.test.js

Destino de tests propuesto: `tests/unit/legacy/school.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0646 | 22 | School: parsea horas y fechas escolares en español | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0647 | 34 | School: guarda tareas, configuración y publicaciones sin duplicar | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0648 | 62 | School: localParts respeta una fecha estable | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0649 | 68 | School: Horario UTM TI-7B mapea materias y calcula próximas entregas | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0650 | 97 | School: extractSchoolTaskDetails extrae materia y descripción en lenguaje natural | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0651 | 109 | School: fallback local extrae limpiamente fecha y tarea sin borrar la descripción (Bug 4.1) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0652 | 133 | School: handleDirectTaskMessage procesa /! y registra tarea en lote del día | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0653 | 179 | School: publishDailySchoolDigest consolida tareas del día a las 15:00 y 18:00 | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0654 | 226 | School: parseDueDate soporta fechas explícitas en español (24 de octubre, en 1 mes) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0655 | 245 | School: handleDirectTaskMessage respeta fecha explícita especificada por el usuario | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0656 | 278 | School: publishDailySchoolDigest incluye sección de pendientes de días anteriores | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0657 | 332 | School: getSchoolSchedule devuelve horario UTM TI-7B si no hay datos guardados | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0658 | 340 | School: publishDueSchoolTasks a las 15:00 no genera duplicados individuales para tareas con lote (Bug 1.1) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0659 | 400 | School: rescata tareas en pending_group cuando se configura el grupo escolar (Bug 1.3) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0660 | 434 | School: getAllUpcomingSchoolTasks no incluye tareas expiradas de días pasados (Bug 1.4) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0661 | 469 | School: elimina archivo local al cancelar tarea con multimedia (Bug 2.1) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0662 | 512 | School: cleanSchoolMediaDirectory purga imágenes antiguas de más de 7 días (Bug 2.1) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0663 | 530 | School: descarga imagen correctamente cuando es un mensaje citado / quoted (Bug 2.2) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0664 | 590 | School: school_publications no tiene violaciones de claves foráneas con batch keys (Bug 3.1) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0665 | 603 | School: reintenta publicación si sendText falla temporalmente por red (Bug 3.2) | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0666 | 661 | School: usuario en ALLOWED_NUMBERS_TASKS puede registrar tareas escolares | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/school_natural.test.js

Destino de tests propuesto: `tests/unit/legacy/school_natural.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0667 | 57 | Tareas: frase natural llega a Gemini y se guarda sin barras ni prefijo | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0668 | 70 | Tareas: argumentos de una frase larga no se interpretan como columnas obligatorias | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0669 | 79 | Tareas: campos de Gemini sin fecha usan próxima clase conocida | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0670 | 88 | Tareas: materia o fecha desconocidas no obligan a inventar datos | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0671 | 97 | Tareas: fecha no interpretable se conserva pendiente, sin sustituir por próxima clase | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0672 | 104 | Tareas: instrucciones estructuradas anteriores siguen funcionando | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0673 | 112 | Tareas: petición vacía pide solo qué hacer y no guarda basura | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0674 | 119 | Herramienta IA: comparte grupo, autorización y fechas del comando sin enviar confirmación duplicada | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0675 | 129 | Herramienta IA: no guarda tareas de un remitente sin autorización | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/semanticHandlers.test.js

Destino de tests propuesto: `tests/scenario/legacy/semanticHandlers.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0676 | 7 | Minecraft toma la acción canónica aun si el raw contiene órdenes y nombres conflictivos | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0677 | 10 | Nombre de un mod no vuelve a interpretarse como otra herramienta | adapters/ai/toolBridge + pipeline/executor | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0678 | 13 | Minecraft sin acción válida pregunta, sin activar ni consultar otra cosa por raw | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0679 | 16 | Permisos críticos Minecraft se verifican sobre la acción canónica | policies/access.policy + pipeline/gate | S14 / S16 (relación; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0680 | 19 | XP usa la cantidad del modelo, no el primer número ni un valor inventado | features/economy | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0681 | 24 | Contrato semántico rechaza campos de selección, destinos y modos mal tipados | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0682 | 29 | Intérpretes heurísticos retirados no quedan disponibles como ruta de respaldo | pipeline/router + pipeline/executor + pipeline/composer | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0683 | 33 | La iniciativa del bot se evalúa por Gemini sin detectar preguntas o actividades con palabras clave | policies/proactive.policy + features/community | S15 (relación) | pending: Portar; equivalente aún no implementado. |

## test/semanticVoice.test.js

Destino de tests propuesto: `tests/unit/legacy/semanticVoice.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0684 | 57 | Structured voice, mode, destination and duration survive conflicting words in the request | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0685 | 72 | Natural literal plan preserves profanity and does not extract words or names from the raw request | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0686 | 83 | Unstructured requests invoke the semantic router, even if they start with voz | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0687 | 91 | Explicit terminal grammar keeps direct reading without natural-language classification | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0688 | 100 | Forward and clarification decisions never produce new audio | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0689 | 112 | Literal script is preserved without a model or duration regex | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0690 | 121 | Semantic writer result can infer a duration and literal mode without keyword patterns | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0691 | 129 | Explicit script duration wins over numbers in the request or writer result | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0692 | 137 | Missing literal words ask for clarification and malformed script mode is rejected | features/voice | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/terminal.test.js

Destino de tests propuesto: `tests/contract/legacy/terminal.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0693 | 20 | Terminal 1: echo hello ejecuta correctamente | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0694 | 30 | Terminal 2: printf formatea y devuelve salida limpia | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0695 | 37 | Terminal 3: pwd devuelve directorio válido | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0696 | 43 | Terminal 4: id muestra información del usuario petrov (UID 1002) | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: UID/usuario específicos: parametrizar mediante config §9.2; revisar alcance de producto con maestro. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0697 | 50 | Terminal 5: uptime devuelve estadísticas del servidor | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0698 | 56 | Terminal 6: df -h devuelve uso de disco montado | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0699 | 62 | Terminal 7: free -m devuelve memoria RAM del sistema | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0700 | 68 | Terminal 8: docker ps lista contenedores si Docker está disponible | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0701 | 76 | Terminal 9: comando con exit code distinto de 0 | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0702 | 83 | Terminal 10: comando que supera 25 segundos y debe terminar por timeout | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0703 | 97 | Terminal 11: stdout grande se trunca de forma segura sin consumir memoria | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0704 | 109 | Terminal 12: stderr grande se trunca de forma segura | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0705 | 122 | Terminal 13: salida que contenga una API key ficticia es sanitizada | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0706 | 133 | Terminal 14: salida que contenga múltiples secretos ficticios | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0707 | 151 | Terminal 15: sanitizeOutput maneja null, undefined y valores no-string con seguridad | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0708 | 161 | Terminal 16: verificar que el proceso ejecutado corresponde al usuario petrov | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Usuario fijo: parametrizar mediante config §9.2; revisar alcance de producto con maestro. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0709 | 173 | Terminal: prueba específica contra fugas en stdout y stderr con secretos múltiples | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0710 | 203 | Terminal: proceso terminado por timeout no deja procesos huérfanos | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0711 | 226 | Terminal: comando inexistente devuelve resultado estructurado sin crashear el proceso | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0712 | 235 | Terminal: comando vacío o inválido devuelve resultado controlado | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |
| TR-0713 | 245 | Terminal: parseCommandString separa correctamente comando y argumentos sin invocar shell | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. Puerto Shell con perfil §9.2; no habilitar terminal por portar este test. |

## test/thumbnailCollage.test.js

Destino de tests propuesto: `tests/unit/legacy/thumbnailCollage.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0714 | 11 | retorna null si la lista de items está vacía o es inválida | features/sticker | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0715 | 17 | downloadThumbnail retorna false si la URL es inválida o inexistente | features/sticker | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0716 | 23 | genera un collage JPEG válido con 4 miniaturas y limpia archivos temporales | features/sticker | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0717 | 43 | maneja items con miniaturas fallidas usando fondo de respaldo sin lanzar excepción | features/sticker | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/toolRegistryRobustness.test.js

Destino de tests propuesto: `tests/scenario/legacy/toolRegistryRobustness.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0718 | 22 | Tool Registry Robustness: executeTool maneja tool name nulo o no string | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0719 | 36 | Tool Registry Robustness: executeTool maneja herramienta desconocida con contrato { success: false, error } | registro generado desde features/*/manifest | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0720 | 43 | Tool Registry Robustness: control_tv ejecuta cambiarTele y exporta handleCambiarTV | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0721 | 68 | Tool Registry Robustness: juegos_y_economia despacha rank, top y valida handleNiveles | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0722 | 99 | Tool Registry Robustness: juegos_y_economia rechaza apuestas o montos inválidos/NaN | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0723 | 123 | Tool Registry Robustness: notas_tablon valida IDs y maneja args nulos sin excepción | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0724 | 148 | Tool Registry Robustness: recordatorios_alarmas valida IDs y opera con args nulos | pipeline/normalize | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0725 | 158 | Tool Registry Robustness: todos los command handlers toleran invocaciones vacías/nulas sin lanzar excepciones | registro generado desde features/*/manifest | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/tts.test.js

Destino de tests propuesto: `tests/unit/legacy/tts.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0726 | 8 | TTS: limpia emojis y markdown para síntesis de voz | features/voice | `tests/unit/v2/adapters/legacyTrace0726-0729.test.js` — `TR-0726: speech cleanup removes emoji, markdown, URL and keeps the spoken question` | implemented: misma transformación de limpieza antes de síntesis. |
| TR-0727 | 14 | TTS: resuelve perfiles regionales y de efectos correctamente | features/voice | `tests/unit/v2/adapters/legacyTrace0726-0729.test.js` — `TR-0727: regional and character voice requests resolve to their supported synthesis profiles` | implemented: perfiles regionales/personaje y efectos contrastados con voces/filtros del adaptador. |
| TR-0728 | 28 | TTS: genera archivo de audio mp3 con fallback resiliente y ejecuta cleanup | features/voice | `tests/unit/v2/adapters/legacyTrace0726-0729.test.js` — `TR-0728: failed primary TTS falls back to synthetic local gTTS output and release removes the measured MP3` | implemented: fallo primario, fallback, MP3 sintético medible, perfil Colombiano y borrado. |
| TR-0729 | 38 | TTS: genera archivo de audio con ElevenLabs cuando se solicita daniel | features/voice | `tests/unit/v2/adapters/legacyTrace0726-0729.test.js` — `TR-0729: the optional ElevenLabs contract receives daniel and its synthetic MP3 is released` | implemented: contrato ElevenLabs fixture recibe daniel/texto, genera MP3 medible y libera archivo; sin llamada a proveedor real. |

## test/unification_json_cli.test.js

Destino de tests propuesto: `tests/scenario/legacy/unification_json_cli.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0730 | 23 | Unificación: applyAiArgsToParsed y handleTareas soporta JSON nativo y CLI legacy | features/tasks + features/school | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0731 | 92 | Unificación: handleMaicra responde a JSON nativo y CLI legacy | features/minecraft | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0732 | 155 | Unificación: handleDrive y handleBuscar responden a JSON nativo | features/drive | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0733 | 198 | Unificación: parseCreation en encuesta soporta JSON nativo y CLI | features/polls | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0734 | 217 | Unificación: handleNotas y handleRecordar con JSON nativo | features/notes | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0735 | 255 | Unificación: handleVoz y handleTerminal con JSON nativo | adapters/system/shell + features/admin-system | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/utils.test.js

Destino de tests propuesto: `tests/scenario/legacy/utils.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0736 | 13 | Utils: cleanup elimina archivos y carpetas sin crashear | platform | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0737 | 25 | Utils: getSessionKey genera claves consistentes | platform | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0738 | 37 | Utils: crypto encripta y desencripta con random salt | platform/crypto | No aplica directamente; regresión legacy. | ported: tests/unit/v2/crypto.test.js; formato y lectura legacy comprobados. |
| TR-0739 | 49 | Utils: crypto soporta formato legado con salt fijo | platform/crypto | No aplica directamente; regresión legacy. | ported: tests/unit/v2/crypto.test.js; formato y lectura legacy comprobados. |
| TR-0740 | 66 | Utils & Descargar: exportan getDownloadSessionKey correctamente | features/media-download | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/voiceUx.test.js

Destino de tests propuesto: `tests/unit/legacy/voiceUx.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0741 | 51 | El proveedor TTS recibe las groserías completas después de limpiar el formato | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0741` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0742 | 61 | Metadata de terminación queda fuera del Content que los agentes reenvían a Gemini | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0742` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0743 | 72 | Guion usa petición, cita e historial, y no sintetiza la orden literal | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0743` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0744 | 86 | Guion para 30 segundos recibe objetivo oral de palabras, no cuota de chat | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0744` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0745 | 94 | Lectura explícita y comando directo preservan las groserías sin gastar llamadas de composición | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0745` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0746 | 102 | Pedir un tono vulgar permite palabras fuertes en el guion generado | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0746` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0747 | 109 | Sin tema, pregunta en vez de generar una grabación vacía o recitar el encargo | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0747` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0748 | 116 | Borradores inválidos o que repiten el encargo no se envían al sintetizador | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0748` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0749 | 124 | Duración inválida pide aclaración antes de usar proveedores | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0749` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0750 | 133 | Si falla Gemini, el respaldo recibe el mismo contexto de guion | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0750` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0751 | 141 | Proveedor caído o respuesta truncada no se sustituyen por lectura literal del encargo | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0751` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0752 | 149 | Adjunto para guion llega al modelo visual y no se analiza a ciegas con respaldo | features/voice | `tests/unit/v2/features/legacyTrace0741-0752.test.js` — caso identificado `TR-0752` | implemented: contrato offline de paridad con puertos falsos; verificado en el checkpoint de 498 pruebas v2. |
| TR-0753 | 156 | Revisión de longitud conserva el encargo y datos originales | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0753` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0754 | 187 | Comando entrega sólo guion compuesto y conserva la cita junto con el historial | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0754` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0755 | 200 | Duración compuesta se mide y reescribe una sola vez cuando no cabe a ritmo natural | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0755` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0756 | 213 | Lectura literal no rellena ni cambia palabras para cumplir segundos | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0756` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0757 | 221 | Si el segundo borrador empeora, conserva el audio más cercano al objetivo | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0757` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0758 | 229 | Error de guion o aclaración no generan audio y no informan éxito | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0758` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0759 | 237 | Síntesis o entrega fallida devuelven fallo y limpian el audio generado | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0759` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0760 | 247 | Comando directo de voz mantiene lectura simple y voz elegida | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0760` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0761 | 255 | Frase exacta entre comillas se extrae sin controles de voz ni duración en el texto hablado | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0761` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0762 | 263 | Cita de imagen se prepara para voz y no se confunde con video para convertir | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0762` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0763 | 270 | Herramienta de voz transmite petición e historial reales y devuelve el resultado confirmado | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — `TR-0763` | partial: petición/cita/historial llegan al puerto de guion; falta herramienta standalone sintetizar_voz (Fase5). |
| TR-0764 | 286 | Ajuste usa tempo acotado y preserva todo el audio, sin recortar ni añadir silencio | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0764` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0765 | 301 | Ajuste no acelera excesivamente una grabación incompatible con la duración | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0765` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |
| TR-0766 | 309 | FFmpeg y ffprobe reales ajustan un tono sintético y limpian temporales sin API de voz | features/voice | `tests/unit/v2/features/legacyVoiceContinuationTrace.test.js` — caso identificado `TR-0766` | implemented: contrato offline con implementación v2 real y dependencias inyectadas. |

## test/whatsapp_text.test.js

Destino de tests propuesto: `tests/contract/legacy/whatsapp_text.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0767 | 10 | WhatsApp instructions and Markdown typography become native syntax | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0768 | 16 | tables preserve every cell, empty headers and escaped pipes as readable entries | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0769 | 22 | links, URLs, algebra and Unicode remain readable without destructive replacements | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0770 | 27 | balanced mathematical expressions preserve nested numerator/denominator and units | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0771 | 33 | fenced and inline code are protected from typography, tables, links and math conversions | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0772 | 39 | formatter is idempotent across representative mixed responses | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0773 | 44 | long paragraphs split safely without losing textual content or Unicode | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0774 | 53 | long bold content closes and reopens native formatting without changing algebra | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0775 | 62 | long fenced code remains fenced in each chunk and preserves language | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0776 | 72 | small chunks do not create empty code messages and preserve nested formatting | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0777 | 108 | voice delivery records its actual transcript only after success and does not replay uncertain sends | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0778 | 120 | sendText formats once, sends chunks sequentially and records only successful chunks | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0779 | 134 | partial send failure reports delivered chunks without automatic replay or phantom history | adapters/evolution | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0780 | 146 | failed first send adds no history and raw mode preserves explicitly literal output | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0781 | 155 | media captions use the same formatter and long captions continue only after successful media send | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0782 | 165 | media failure never sends a detached caption or stores undelivered text | adapters/evolution | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0783 | 172 | media success followed by caption failure reports partial delivery without replaying media | adapters/evolution | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0784 | 183 | bounded media downloads constrain HTTP body and validate decoded bytes before returning | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0785 | 193 | oversized decoded downloads and HTTP 413 produce the same clear non-retried limit error | adapters/evolution | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0786 | 205 | data URI media yields MIME and magic extension; malformed Base64 is rejected | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0787 | 214 | late split-message echoes are consumed by exact chat/id while manual messages remain independent | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0788 | 227 | echo before HTTP acknowledgement is consumed but history waits for delivery evidence | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0789 | 242 | definitive failure removes pending text correlation and never records a phantom send | adapters/evolution | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0790 | 249 | confirmed webhook delivery is recorded once even if HTTP acknowledgement times out | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0791 | 262 | outbound echo registry expires and remains bounded without periodic background work | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0792 | 272 | Forwarded bot media downloads with the original chat, id and fromMe flag | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0793 | 282 | Partial quote without a media key asks Evolution for the original instead of posting broken metadata | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0794 | 290 | Generic HTTP 400 is a download failure and never fictitious proof of expiration | adapters/evolution | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0795 | 300 | native tables go through the table endpoint between prose, retaining history and mentions | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0796 | 312 | missing native endpoint falls back only after rejection, preserving parsed cells and extra columns | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0797 | 323 | only explicit pre-send native rejection permits text fallback | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0798 | 338 | native failure after delivered prose reports partial delivery without replay | adapters/evolution | S11 (relación de errores; no reemplaza escenario) | pending: Portar; equivalente aún no implementado. |
| TR-0799 | 346 | raw messages preserve literal tables without native dispatch | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0800 | 354 | media caption prose stays with the file while tables follow as native messages | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0801 | 366 | Gemini shared style permits native tables and quoted tables retain all data | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |
| TR-0802 | 380 | native webhook echo before HTTP acknowledgement correlates canonical cells without duplicate history or replay | adapters/evolution | No aplica directamente; regresión legacy. | pending: Portar; equivalente aún no implementado. |

## test/whisper.test.js

Destino de tests propuesto: `tests/unit/legacy/whisper.test.js`. Cada ID representa un caso independiente.

| ID | Línea legacy | Comportamiento protegido (título) | Etapa/feature v2 propuesta | Escenario | Estado y nota |
|---|---:|---|---|---|---|
| TR-0803 | 11 | Whisper: transcribeAudio transcribe archivo de audio con Groq | features/transcripcion | `tests/unit/v2/adapters/legacyTrace0803-0804.test.js` — `TR-0803: a synthetic OGG is multipart-submitted to the Groq transcription port and returns its transcript` | implemented: OGG sintético, formulario multipart Groq fixture, texto/duración/idioma, sin fallback y límite temporal; sin red externa. |
| TR-0804 | 25 | Whisper: summarizeTranscription genera resumen conciso para audios extensos | features/transcripcion | `tests/unit/v2/adapters/legacyTrace0803-0804.test.js` — `TR-0804: long-audio summary receives the complete transcript once and returns concise text` | implemented: transcript completo llega una vez al puerto de resumen y se devuelve texto conciso. |
