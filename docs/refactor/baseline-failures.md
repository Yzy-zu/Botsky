# Fallos del baseline aislado — Fase 0

Fuente: `/tmp/botsky-v2-baseline.tap`, ejecución terminada con exit code 1; Node.js v20.20.2, Linux ARM64. **795 tests: 608 pass, 187 fail, 0 skipped, 0 cancelled, 0 todo; 1 suite**. Duración registrada: 110067.876698 ms. SHA-256 del TAP: `038ef53fc12e924fe0e7a0baad551fca75c1b786f1f62929f7f3315974d0da83`.

Esta ejecución usa el código legacy del worktree en un contenedor aislado: sin `.env` real, claves sintéticas, Evolution en localhost y sin acceso a servicios de producción. `cap-drop ALL` impide el cambio de usuario root→UID 1002 que pide el shell legacy y provoca `spawn EPERM`. Los nombres/identificadores personales de algunos títulos se anonimizan; archivo, línea y número TAP permiten localizar el original. Los paths de ubicación del TAP corresponden al montaje del runner y aquí se expresan relativos al repositorio. No se publican stacks, cuerpos de proveedor ni valores personales.

**Este documento no declara fallos de producción.** Una clasificación señala la causa primaria que permite sostener la evidencia disponible, no certifica toda la cadena. Las candidatas legacy pueden ser tests obsoletos, diferencias del contrato actual o defectos previos: hay que reproducirlas con fakes completos y configuración explícita antes de corregir comportamiento. No se borraron tests ni se aplicaron fixes en esta WO.

## Conteo y unidades

El TAP contiene **188 líneas `not ok`**: 187 resultados de test y 1 agregador `type: suite` (`thumbnailCollage utility`) que informa los dos hijos fallidos y no suma otro test fallido. La tabla incluye los 187, incluidos esos dos hijos, y lista el agregador aparte. Dos resultados son fallos de carga de archivos completos (línea 1), no ejecuciones de cada caso de esos archivos.

El inventario estático contiene **804 casos nominales** (793 declaraciones, incluidos tres bucles parametrizados expandidos). En este snapshot final, `anti_repetition.test.js` (4 casos nominales) y `rikolinoLibrary.test.js` (7 casos nominales) fallan durante importación, antes de registrar sus casos; TAP los representa como dos fallos de archivo. El conteo se concilia como **804 − 4 − 7 + 2 = 795**. El agregador de suite no se suma a los tests; sus cuatro hijos sí. Los 11 casos de los archivos que no cargaron siguen pendientes en trazabilidad y no tienen pass/fail individual.

El runner final incluye el directorio `/source/scripts`: los **9 casos de `evolution_native_tables.test.js` pasan** y ya no existe su wrapper de fallo de carga. El snapshot anterior queda como historia en el baseline del maestro; esta lista describe únicamente el TAP final.

## Criterios de clasificación

- **E — entorno/configuración:** dependencia/configuración externa requerida por el test no existe o está bloqueada; evidencia `EPERM`, DNS/red, `ENOENT`, import externo o dependencia explícita de `.env`/contactos reales.
- **H — harness/mocks:** VM no contempla import o export requerido, o monkeypatch cubre la API antigua mientras la ruta actual alcanza un proveedor sin fake. No confundir “no pude ejecutar el caso” con incumplimiento del comportamiento.
- **L — candidata legacy:** aserción local, entrada malformada o API/fuente esperada difiere sin evidencia primaria de servicio externo. Revisar vigencia del test y efectos, respetando §6 del plano.
- **U — indeterminado:** varias causas (configuración, parser, mocks, I/O) pueden explicar el resultado; no se selecciona una sin reproducción acotada.

| Grupo | Fallos de test |
|---|---:|
| Entorno/configuración (E) | 106 |
| Harness/mocks (H) | 38 |
| Candidata legacy (L) | 33 |
| Indeterminado (U) | 10 |

| Criterio | Cantidad | Evidencia/criterio específico |
|---|---:|---|
| E1 | 13 | Configuración sintética sin administrador/allowlist/contactos de .env real. |
| E2 | 43 | Shell bloqueado: cap-drop ALL y cambio de UID producen EPERM. |
| E3 | 31 | IA o integración live sin red/proveedor real accesible. |
| E4 | 19 | Herramienta/dependencia/fixture externo ausente en aislamiento. |
| H1 | 28 | Import cooperacha no incluido en VM mock. |
| H2 | 1 | Export auth requerido omitido por mock. |
| H3 | 9 | Mock cubre superficie antigua/export público; revisar ruta interna actual. |
| L1 | 6 | Texto/prefijo literal esperado antiguo. |
| L2 | 12 | Parser, gate, normalizador u orden observable requiere revisar contrato. |
| L3 | 9 | API, prompt, fuente o resultado de excepción esperados desactualizados/candidatos. |
| L4 | 6 | Robustez de inputs malformados: excepción observada. |
| U1 | 10 | Causa primaria no aislada. |


## Lista completa de 187 resultados fallidos

Los números TAP anidados se representan como `705/3` y `705/4`. El campo motivo resume evidencia, sin reproducir stack ni datos del evento.

| ID | TAP | Archivo:línea:columna | Título (identificadores anonimizados) | Grupo | Motivo |
|---|---:|---|---|---|---|
| BF-001 | 3 | `test/adminXp.test.js:58:1` | AdminXP: administrador autorizado en grupo se otorga 1000 XP exitosamente | E/E1 | Test espera administrador fijo de .env; configuración sintética lo rechaza. |
| BF-002 | 4 | `test/adminXp.test.js:95:1` | AdminXP: extrae la cantidad solicitada si pide un número diferente (ej: 500) | E/E1 | Test espera administrador fijo de .env; configuración sintética lo rechaza. |
| BF-003 | 5 | `test/adminXp.test.js:129:1` | AdminXP: admin puede otorgar XP a un amigo mencionado con @ | E/E1 | Test espera administrador fijo de .env; configuración sintética lo rechaza. |
| BF-004 | 7 | `test/adminXp.test.js:235:1` | AdminXP: admin en grupo con LID puede otorgar XP a un amigo mencionado con LID (@[ID anonimizado]) | E/E1 | Test espera administrador fijo de .env; configuración sintética lo rechaza. |
| BF-005 | 15 | `test/agent.test.js:19:1` | Agent-Bash: comando simple y echo | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-006 | 16 | `test/agent.test.js:26:1` | Agent-Bash: pwd devuelve directorio de trabajo | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-007 | 17 | `test/agent.test.js:32:1` | Agent-Bash: id muestra que ejecuta siempre como usuario configurado | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-008 | 18 | `test/agent.test.js:39:1` | Agent-Bash: printf formatea cadenas correctamente | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-009 | 19 | `test/agent.test.js:45:1` | Agent-Bash: pipes (\|) funcionan con encadenamiento de utilidades | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-010 | 20 | `test/agent.test.js:51:1` | Agent-Bash: operador && ejecuta condicionalmente el siguiente comando | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-011 | 21 | `test/agent.test.js:57:1` | Agent-Bash: operador \|\| salta ante error y ejecuta el fallback | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-012 | 22 | `test/agent.test.js:63:1` | Agent-Bash: redirección (> y <) a archivo temporal y lectura | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-013 | 23 | `test/agent.test.js:70:1` | Agent-Bash: subshell (...) aísla contexto y variables | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-014 | 24 | `test/agent.test.js:76:1` | Agent-Bash: comando inexistente devuelve resultado controlado con código de error | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-015 | 25 | `test/agent.test.js:84:1` | Agent-Bash: exit code != 0 refleja el código exacto de salida | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-016 | 26 | `test/agent.test.js:91:1` | Agent-Bash: proceso hijo en segundo plano | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-017 | 27 | `test/agent.test.js:97:1` | Agent-Bash: timeout termina proceso y subprocesos hijos sin dejarlos huérfanos | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-018 | 28 | `test/agent.test.js:111:1` | Agent-Bash: stdout grande es truncado de forma acotada (bounded) | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-019 | 29 | `test/agent.test.js:118:1` | Agent-Bash: stderr grande es truncado de forma acotada (bounded) | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-020 | 30 | `test/agent.test.js:125:1` | Agent-Bash: sanitización de secretos en salida de Bash | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-021 | 31 | `test/agent.test.js:134:1` | Agent-Tool: handleTerminalTool valida parámetros y ejecuta comando | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-022 | 32 | `test/agent.test.js:146:1` | Agent-Loop: Gemini recibe resultado de herramienta y responde (Mock Turn 1) | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-023 | 36 | `test/agent.test.js:405:1` | Agent-Live: Gemini ejecuta uptime en VPS mediante Function Calling real y responde | E/E3 | Caso live: proveedor IA/red inaccesible; shell también restringido. |
| BF-024 | 37 | `test/agent.test.js:418:1` | Agent-Loop: múltiples function calls en el mismo turno ejecutan y reciben todas sus functionResponse | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-025 | 38 | `test/agent.test.js:498:1` | Agent-Loop: error en callGemini tras ejecutar herramienta devuelve resultado controlado sin crash | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-026 | 42 | `test/agentEngine.test.js:36:1` | Tool Registry [Live]: executeTool google_drive espacio devuelve cuota válida | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-027 | 43 | `test/agentEngine.test.js:43:1` | Tool Registry [Live]: executeTool minecraft_control telemetria devuelve telemetría viva | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-028 | 45 | `test/agentEngine.test.js:69:1` | Universal Agent [Live]: Conversación casual no ejecuta herramientas | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-029 | 46 | `test/agentEngine.test.js:82:1` | Universal Agent [Live]: Consulta de telemetría de Minecraft ejecuta tool y sintetiza respuesta | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-030 | 54 | `test/ai.test.js:26:1` | AI: routeWithAI devuelve JSON válido para comandos | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-031 | 55 | `test/ai.test.js:34:1` | AI: routeWithAI extrae parámetros complejos (formato, corte, velocidad) | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-032 | 57 | `test/ai.test.js:73:1` | AI: routeWithAI procesa contexto multimedia (audioMessage -> efecto) | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-033 | 9 | `test/anti_repetition.test.js:1:1` | test/anti_repetition.test.js | E/E4 | Fallo de carga: sharp requerido por ruta absoluta de proyecto vecino, no disponible en aislamiento. |
| BF-034 | 82 | `test/attachment_context.test.js:69:1` | El normalizador conserva texto y sesiones sin decidir una intención por regex | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-035 | 83 | `test/attachment_context.test.js:76:1` | Adjuntos se seleccionan sólo por ID del catálogo de ese chat y solicitante | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-036 | 84 | `test/attachment_context.test.js:84:1` | Sólo una aclaración semántica guarda la instrucción anterior al archivo | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-037 | 85 | `test/attachment_context.test.js:90:1` | TTL, límites y metadatos mínimos no retienen bytes de archivo | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-038 | 86 | `test/attachment_context.test.js:97:1` | Metadatos de descifrado admiten todas las formas binarias de Evolution y descartan contenido pesado | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-039 | 87 | `test/attachment_context.test.js:118:1` | Clave multimedia se conserva en archivo actual, cita y seguimiento reciente | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-040 | 88 | `test/attachment_context.test.js:138:1` | Metadatos binarios inválidos o enormes no se guardan como claves | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-041 | 90 | `test/audit_fixes.test.js:58:1` | Fix 1 (Terminal): executeBash no hereda GEMINI_API_KEY del proceso en subshell Bash | E/E2 | Shell bloqueado por capacidades; no evalúa el contrato de ejecución. |
| BF-042 | 91 | `test/audit_fixes.test.js:66:1` | Fix 1b (Terminal Seguridad): executeBash no expone variables sensibles en texto ni base64 | E/E2 | Shell bloqueado por capacidades; no evalúa el contrato de ejecución. |
| BF-043 | 92 | `test/audit_fixes.test.js:76:1` | Fix 1c (Terminal Seguridad): executeBash tiene bloqueado el acceso a <proyecto>/.env en filesystem | E/E2 | Shell bloqueado por capacidades; no evalúa el contrato de ejecución. |
| BF-044 | 93 | `test/audit_fixes.test.js:87:1` | Fix 1d (Terminal Seguridad): executeCommand con options.env forzado pasa obligatoriamente por getSanitizedEnv | E/E2 | Shell bloqueado por capacidades; no evalúa el contrato de ejecución. |
| BF-045 | 94 | `test/audit_fixes.test.js:95:1` | Fix 1e (Terminal Seguridad): executeBash permite ejecutar comandos normales del agente (id, pwd, uptime, git status, docker ps) | E/E2 | Shell bloqueado por capacidades; no evalúa el contrato de ejecución. |
| BF-046 | 105 | `test/audit_fixes.test.js:385:1` | UX 1: Petición VPS sin prefijo en privado ("cómo está el servidor?") enruta a agent (terminal) | E/E3 | Router usa IA real; DNS/red aislados y claves sintéticas producen null. |
| BF-047 | 106 | `test/audit_fixes.test.js:392:1` | UX 2: Charla normal en privado ("hola qué haces?") enruta a chat sin invocar terminal | E/E3 | Router usa IA real; DNS/red aislados y claves sintéticas producen null. |
| BF-048 | 107 | `test/audit_fixes.test.js:399:1` | UX 3: Comando explícito ("/@terminal uptime" o "!terminal uptime") enruta a agent | E/E3 | Router usa IA real; DNS/red aislados y claves sintéticas producen null. |
| BF-049 | 108 | `test/audit_fixes.test.js:412:1` | UX 4: Petición VPS en grupo sin prefijo ("qué contenedores Docker están activos?") enruta a agent | E/E3 | Router usa IA real; DNS/red aislados y claves sintéticas producen null. |
| BF-050 | 109 | `test/audit_fixes.test.js:429:1` | UX 5: Charla normal en grupo sin prefijo ("hola gente cómo andan?") enruta a ignore o chat y no a terminal | E/E3 | Router usa IA real; DNS/red aislados y claves sintéticas producen null. |
| BF-051 | 110 | `test/audit_fixes.test.js:447:1` | UX 6: Mensaje ambiguo con términos técnicos ("¿qué es Linux?") enruta a chat sin ejecutar terminal | E/E3 | Router usa IA real; DNS/red aislados y claves sintéticas producen null. |
| BF-052 | 114 | `test/blackjack.test.js:97:1` | Blackjack 4: message_normalizer detecta comandos naturales e interacciones de partida | L/L2 | Espera reescribir texto en normalizador; valor observado conserva frase original. |
| BF-053 | 118 | `test/blackjack.test.js:307:1` | Blackjack 8: Mesa Multijugador: message_normalizer detecta atajos de lobby | L/L2 | Espera reescribir texto en normalizador; valor observado conserva frase original. |
| BF-054 | 145 | `test/comprehensive_audit_fixes.test.js:15:1` | Audit Fix 1 (Seguridad Auth): isAuthorizedAdmin rechaza miembros no-admin en grupos permitidos | E/E1 | Test espera administrador fijo de .env; configuración sintética lo rechaza. |
| BF-055 | 147 | `test/comprehensive_audit_fixes.test.js:51:1` | Audit Fix 3 (Lógica Niveles): handleDarXp otorga experiencia al usuario mencionado y no al admin | E/E1 | Test espera administrador fijo de .env; configuración sintética lo rechaza. |
| BF-056 | 212 | `test/convertir_documentos.test.js:27:1` | Convertir: Rechaza si no se adjunta archivo ni url | L/L1 | Expectativa literal de mensaje difiere; separar texto de efecto persistente al revisar. |
| BF-057 | 215 | `test/cooperacha.test.js:158:1` | Cooperacha 3: procesamiento no bloqueante de imagen censurada con FFmpeg | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-058 | 216 | `test/cooperacha.test.js:177:1` | Cooperacha 4: arranque de reto, creación de sesión, meta configurable y previsualización censurada | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-059 | 217 | `test/cooperacha.test.js:221:1` | Cooperacha 5: deducción atómica de XP y validaciones contra saldo insuficiente y datos inválidos | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-060 | 218 | `test/cooperacha.test.js:285:1` | Cooperacha 6: ciclo completo de expiración con retención del 20% y reembolso automático del 80% | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-061 | 219 | `test/cooperacha.test.js:352:1` | Cooperacha 7: ciclo completo de cumplimiento al 100% de la meta con destape de foto original | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-062 | 220 | `test/cooperacha.test.js:399:1` | Cooperacha 8: gestión híbrida de fuentes (carpeta local vs fallback web) | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-063 | 221 | `test/cooperacha.test.js:448:1` | Cooperacha 9: consulta de estado cuando la cooperacha está activa muestra progreso y tiempo | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-064 | 222 | `test/cooperacha.test.js:483:1` | Cooperacha 10: cancelación por administrador reembolsa 100% y rechaza a no administradores | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-065 | 224 | `test/cooperacha.test.js:560:1` | Cooperacha 12: enrutamiento de lenguaje natural mediante dispatcher (le meto 100) | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-066 | 225 | `test/cooperacha.test.js:618:1` | Cooperacha 13: censura blindada genera archivo válido con pixelado y barra de censura | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-067 | 226 | `test/cooperacha.test.js:634:1` | Cooperacha 14: reto autónomo cada 48 horas opera independientemente de activaciones manuales | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-068 | 239 | `test/daily.test.js:21:1` | Daily: pickPrize mapea probabilidades correctamente con descripciones limpias | L/L1 | Expectativa literal de mensaje difiere; separar texto de efecto persistente al revisar. |
| BF-069 | 241 | `test/daily.test.js:43:1` | Daily: ciclo completo de primer reclamo, cooldown de 24h y racha consecutiva en SQLite | L/L1 | Expectativa literal de mensaje difiere; separar texto de efecto persistente al revisar. |
| BF-070 | 242 | `test/daily.test.js:104:1` | Daily: message_normalizer detecta frases naturales para daily | L/L2 | Espera reescribir texto en normalizador; valor observado conserva frase original. |
| BF-071 | 262 | `test/descargar.test.js:438:1` | descargar: búsqueda genera y envía collage de miniaturas con sendMedia | E/E4 | Test escribe fixture en directorio temporal fijo inexistente; ENOENT antes de ejecutar collage. |
| BF-072 | 278 | `test/dispatcher.test.js:209:1` | Dispatcher: Usuario no autorizado con pushName "Admin" o "Owner" es rechazado (Anti-Spoofing) | H/H3 | Mocks sobre routeWithAI/runAgentWithTerminal antiguos; revisar ruta typed/outcome antes de atribuir aserción a producción. |
| BF-073 | 279 | `test/dispatcher.test.js:264:1` | Dispatcher: Usuario autorizado en grupo con pushName cualquiera es admitido por su JID | H/H3 | Mocks sobre routeWithAI/runAgentWithTerminal antiguos; revisar ruta typed/outcome antes de atribuir aserción a producción. |
| BF-074 | 283 | `test/dispatcher.test.js:460:1` | Dispatcher: Insultos y mentadas de madre en grupo activan bypass directo de Gatekeeper y responden con chat (Opción 1) | H/H3 | Mocks sobre routeWithAI/runAgentWithTerminal antiguos; revisar ruta typed/outcome antes de atribuir aserción a producción. |
| BF-075 | 284 | `test/dispatcher.test.js:507:1` | Dispatcher: Mensajes de una palabra como jaja o ok siguen filtrados a costo cero sin llamar a la IA | L/L2 | Espera gate local sin llamada IA; contador muestra llamada. Revisar contrato/harness legacy. |
| BF-076 | 285 | `test/dispatcher.test.js:550:1` | Dispatcher: Conversación grupal sin mención ni cita al bot es archivada en historial pero NO envía respuesta (anti-spam) | L/L2 | Espera gate local sin llamada IA; contador muestra llamada. Revisar contrato/harness legacy. |
| BF-077 | 286 | `test/dispatcher.test.js:597:1` | Dispatcher: En grupo, responde cuando lo llaman por su nombre ("botsky", "bot", "botsito") con el contexto del chat | H/H3 | Mocks sobre routeWithAI/runAgentWithTerminal antiguos; revisar ruta typed/outcome antes de atribuir aserción a producción. |
| BF-078 | 287 | `test/dispatcher.test.js:644:1` | Dispatcher: En grupo, responde cuando citan/responden directamente a un mensaje de Botsky | H/H3 | Mocks sobre routeWithAI/runAgentWithTerminal antiguos; revisar ruta typed/outcome antes de atribuir aserción a producción. |
| BF-079 | 302 | `test/e2e_requirements.test.js:140:1` | T1.6 F2 Dispatch: /@ayuda fast-path routes successfully and delivers user guide | H/H3 | Aserción recibe aviso IA indisponible; harness deja clasificación fuera del mock esperado. |
| BF-080 | 304 | `test/e2e_requirements.test.js:177:1` | T1.8 F2 Dispatch: unauthorized user invoking /@terminal is blocked with friendly rejection | H/H3 | Aserción recibe aviso IA indisponible; harness deja clasificación fuera del mock esperado. |
| BF-081 | 310 | `test/e2e_requirements.test.js:316:1` | T1.14 F3 UX: permission rejection provides clear explanation with "acceso denegado" | H/H3 | Aserción recibe aviso IA indisponible; harness deja clasificación fuera del mock esperado. |
| BF-082 | 311 | `test/e2e_requirements.test.js:333:1` | T1.15 F3 UX: help guide uses readable layout and proper formatting | L/L1 | Expectativa de prefijo/formato de ayuda difiere; no certifica ausencia de ayuda. |
| BF-083 | 392 | `test/maicra_command.test.js:36:1` | Maicra Command 1: Sin argumentos envía reporte en vivo unificado (cero encuestas/polls) | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-084 | 393 | `test/maicra_command.test.js:47:1` | Maicra Command 2: "mods" consulta y envía el resumen de addons | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-085 | 394 | `test/maicra_command.test.js:56:1` | Maicra Command 3: "jugadores" consulta jugadores activos en vivo | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-086 | 395 | `test/maicra_command.test.js:64:1` | Maicra Command 4: "estado" consulta estado del contenedor y recursos | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-087 | 396 | `test/maicra_command.test.js:72:1` | Maicra Command 5: "mundos" lista los mundos creados y el activo | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-088 | 397 | `test/maicra_command.test.js:80:1` | Maicra Command 6: Opción de encuesta WhatsApp "📦 Ver Mods y Addons" detecta intención | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-089 | 398 | `test/maicra_command.test.js:86:1` | Maicra Command 7: Frase natural "qué mods tiene el server" detecta mods | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-090 | 399 | `test/maicra_command.test.js:92:1` | Maicra Command 8: Frase natural "quién está jugando" detecta jugadores | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-091 | 434 | `test/mediaUxIntegration.test.js:113:1` | PDF: Gemini clasifica antes de descargar; redactor recibe PDF nativo completo | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-092 | 435 | `test/mediaUxIntegration.test.js:124:1` | Cualquier paráfrasis llega al modelo una vez y su plan no se sustituye por palabras clave | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-093 | 436 | `test/mediaUxIntegration.test.js:134:1` | Seguimiento en grupo usa el ID elegido y conserva identidad del solicitante | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-094 | 437 | `test/mediaUxIntegration.test.js:140:1` | Archivos ambiguos preguntan; aclaración semántica conserva encargo y elige sólo un ID autorizado | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-095 | 438 | `test/mediaUxIntegration.test.js:149:1` | ID inventado o archivo de otro remitente se rechaza antes de descargar | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-096 | 439 | `test/mediaUxIntegration.test.js:155:1` | Petición pendiente sólo se guarda cuando Gemini declara que falta el adjunto | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-097 | 440 | `test/mediaUxIntegration.test.js:162:1` | Saludo, matemáticas y QR con texto no heredan un archivo aunque exista contexto reciente | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-098 | 441 | `test/mediaUxIntegration.test.js:169:1` | Subir un video o imagen sin encargo requiere aclaración y jamás conversión automática | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-099 | 442 | `test/mediaUxIntegration.test.js:176:1` | Preguntas, negaciones y palabras de herramientas conservan chat si el modelo así decide | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-100 | 443 | `test/mediaUxIntegration.test.js:182:1` | La acción estructurada gana aunque la frase contenga audio, difusión, video o nuclear | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-101 | 444 | `test/mediaUxIntegration.test.js:188:1` | Fallo de los dos modelos no dispara descarga ni ejecuta el primer término como comando | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-102 | 445 | `test/mediaUxIntegration.test.js:193:1` | Grupo pasivo: el modelo decide ignorar y no prepara ni descarga contenido | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-103 | 446 | `test/mediaUxIntegration.test.js:199:1` | Whitelist impide incluso clasificar una solicitud de un chat no autorizado | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-104 | 447 | `test/mediaUxIntegration.test.js:203:1` | La misma frase se interpreta de nuevo si cambian adjuntos e historial; no hay caché de intención | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-105 | 448 | `test/mediaUxIntegration.test.js:208:1` | Descarga fallida detiene lectura sin inventar respuesta, con una sola clasificación | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-106 | 449 | `test/mediaUxIntegration.test.js:212:1` | Respuesta incompleta avisa y mantiene formato de WhatsApp | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-107 | 450 | `test/mediaUxIntegration.test.js:217:1` | Conversión desde URL no exige un adjunto inexistente | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-108 | 451 | `test/mediaUxIntegration.test.js:223:1` | JSON de envío incompleto se repara una sola vez por Gemini; no se interpreta localmente | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-109 | 452 | `test/mensaje.test.js:9:1` | Mensaje: findGroupContact resuelve contactos de [grupo de prueba] | E/E1 | Depende de contactos/grupo/administrador reales ausentes de configuración sintética. |
| BF-110 | 453 | `test/mensaje.test.js:22:1` | Mensaje: handleMensaje rechaza no-administradores | L/L2 | Aclaración ocurre antes del rechazo esperado; revisar orden/contrato con permisos explícitos. |
| BF-111 | 454 | `test/mensaje.test.js:42:1` | Mensaje: handleMensaje envía mensaje a contacto para admin | E/E1 | Depende de contactos/grupo/administrador reales ausentes de configuración sintética. |
| BF-112 | 455 | `test/mensaje.test.js:76:1` | Mensaje: executeTool en toolRegistry ejecuta enviar_mensaje_contacto | E/E1 | Depende de contactos/grupo/administrador reales ausentes de configuración sintética. |
| BF-113 | 456 | `test/mensaje.test.js:104:1` | Mensaje: findGroupContact resuelve el grupo [grupo de prueba] | E/E1 | Depende de contactos/grupo/administrador reales ausentes de configuración sintética. |
| BF-114 | 457 | `test/mensaje.test.js:116:1` | Mensaje: mensaje cizañoso al grupo sale de Botsky y NO menciona al emisor | E/E1 | Depende de contactos/grupo/administrador reales ausentes de configuración sintética. |
| BF-115 | 458 | `test/mensaje.test.js:147:1` | Mensaje: mandales un mensaje al grupo y mientales la madre a [contacto de prueba] se envía al grupo | E/E1 | Depende de contactos/grupo/administrador reales ausentes de configuración sintética. |
| BF-116 | 459 | `test/milestone1_stress.test.js:58:1` | Stress: executeTool never throws an unhandled rejection with primitive or bizarre arguments | L/L4 | Entrada malformada produce excepción (null/undefined, BigInt, circular o getter); candidata de robustez legacy. |
| BF-117 | 460 | `test/milestone1_stress.test.js:129:1` | Stress: executeTool with BigInt in args (must not crash JSON serialization) | L/L4 | Entrada malformada produce excepción (null/undefined, BigInt, circular o getter); candidata de robustez legacy. |
| BF-118 | 461 | `test/milestone1_stress.test.js:139:1` | Stress: executeTool with Circular references in args (must not crash JSON serialization) | L/L4 | Entrada malformada produce excepción (null/undefined, BigInt, circular o getter); candidata de robustez legacy. |
| BF-119 | 462 | `test/milestone1_stress.test.js:152:1` | Stress: executeTool with Symbols and throwing getters in args | L/L4 | Entrada malformada produce excepción (null/undefined, BigInt, circular o getter); candidata de robustez legacy. |
| BF-120 | 464 | `test/milestone1_stress.test.js:224:1` | Stress: All exported command handlers tolerate null/undefined/malformed arguments without uncaught exceptions | L/L4 | Entrada malformada produce excepción (null/undefined, BigInt, circular o getter); candidata de robustez legacy. |
| BF-121 | 465 | `test/milestone1_stress.test.js:304:1` | Stress: commandRegistry getCommandHandler handles null/empty parsed without crashing | L/L4 | Entrada malformada produce excepción (null/undefined, BigInt, circular o getter); candidata de robustez legacy. |
| BF-122 | 470 | `test/minecraftRemote.test.js:93:1` | MinecraftRemote 5 [Live]: getRemoteServerStatus consulta contenedor en [servidor remoto] | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-123 | 471 | `test/minecraftRemote.test.js:105:1` | MinecraftRemote 6 [Live]: getOnlinePlayers obtiene jugadores y límite de slots | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-124 | 472 | `test/minecraftRemote.test.js:115:1` | MinecraftRemote 7 [Live]: getActiveModsAndPacks extrae addons y global_mods | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-125 | 473 | `test/minecraftRemote.test.js:126:1` | MinecraftRemote 8 [Live]: getWorldsList lista los mundos creados en [servidor remoto] | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-126 | 474 | `test/minecraftRemote.test.js:135:1` | MinecraftRemote 9 [Live]: deactivateWorldPack maneja mod no existente con mensaje claro | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-127 | 475 | `test/minecraftRemote.test.js:142:1` | MinecraftRemote 10 [Live]: activateWorldPack maneja mod no existente con mensaje claro | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |
| BF-128 | 502 | `test/naturalUxIntegration.test.js:99:1` | Normalizador: tareas y archivos conservan intención para Gemini | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-129 | 503 | `test/naturalUxIntegration.test.js:109:1` | Normalizador: elección de contacto tiene prioridad sobre lista de Drive | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-130 | 504 | `test/naturalUxIntegration.test.js:115:1` | Normalizador: conserva caption citado al desempaquetar multimedia | H/H1 | VM rechaza import cooperacha: dependencia sin mock antes de aserciones. |
| BF-131 | 514 | `test/notas.test.js:58:1` | Notas: handleNotas maneja guardar, listar, buscar y borrar en chat | L/L1 | Expectativa literal de mensaje difiere; separar texto de efecto persistente al revisar. |
| BF-132 | 520 | `test/observations_minor.test.js:12:1` | Observación 1: Caché distingue por usuario (userId) en getCacheKey y routeWithAI | L/L3 | Test invoca función legacy que no está exportada (API retirada o test desactualizado). |
| BF-133 | 524 | `test/observations_minor.test.js:58:1` | Router: reconoce tareas visuales con lenguaje libre y no confunde sticker explícito | L/L3 | Test invoca función legacy que no está exportada (API retirada o test desactualizado). |
| BF-134 | 526 | `test/observations_minor.test.js:74:1` | Observación 2: evaluateProactiveAction cuenta con rate-limit anti-spam | H/H3 | Monkeypatch de export callGemini no garantiza interceptar referencia interna; llega a proveedor aislado. |
| BF-135 | 527 | `test/observations_minor.test.js:107:1` | Observación 3: Groq fallback sin soporte de visión emite log de métrica [AI-METRICS] | U/U1 | Mock de export y fallback/red mezclados con texto exacto; causa primaria no aislada. |
| BF-136 | 529 | `test/optimizations.test.js:7:1` | Groq Circuit Breaker: Manejo de cooldown ante errores de cuota | L/L3 | Espera retorno null del breaker; implementación entrega excepción tipada provider_unavailable sin red. |
| BF-137 | 530 | `test/optimizations.test.js:31:1` | Descargar: Calidad por defecto 480p y selectores <=10MB | L/L3 | Aserción por regex sobre fuente antigua; límites/timeout ya no coinciden con estructura actual. |
| BF-138 | 533 | `test/optimizations.test.js:129:1` | IA: Configuración Groq y timeout rápido de Gemini (3s) | L/L3 | Aserción por regex sobre fuente antigua; límites/timeout ya no coinciden con estructura actual. |
| BF-139 | 548 | `test/pack.test.js:456:1` | Pack 13: Verificación de rechazo en grupo no autorizado | E/E1 | Grupo permitido/no permitido depende de allowlist .env ausente; entorno sintético. |
| BF-140 | 555 | `test/pack.test.js:666:1` | Pack 20: Lenguaje natural expandido ("quiero comprar un pack", "me vendes un pack", "saca el pack") | U/U1 | Saldo/categoría difieren bajo dispatch, allowlists y mocks mezclados; requiere escenario aislado. |
| BF-141 | 558 | `test/pack.test.js:750:1` | Pack 23: Detección natural con signos de puntuación (!, ?), mención @Botsky y formas verbales expandidas | U/U1 | Saldo/categoría difieren bajo dispatch, allowlists y mocks mezclados; requiere escenario aislado. |
| BF-142 | 559 | `test/pack.test.js:804:1` | Pack 24: Saneamiento de muletillas de cortesía ("porfa", "por favor") no las trata como categorías | U/U1 | Saldo/categoría difieren bajo dispatch, allowlists y mocks mezclados; requiere escenario aislado. |
| BF-143 | 575 | `test/personality.test.js:38:1` | Personality 3: Ritmo contextual y memoria de expresiones recientes | L/L3 | Expectativa de heurística/prompt/fuente difiere del contrato actual. |
| BF-144 | 576 | `test/personality.test.js:50:1` | Personality 4: Inferencia en vivo clasifica ofensa sin redactar la conversación | E/E3 | Inferencia live sin red real/claves válidas. |
| BF-145 | 577 | `test/personality.test.js:65:1` | Personality 5: Creador/Admin tiene jerarquía suprema y directiva estricta contra desobediencia de herramientas | L/L3 | Expectativa de heurística/prompt/fuente difiere del contrato actual. |
| BF-146 | 580 | `test/proactive.test.js:74:1` | Proactive 3: evaluateProactiveAction devuelve estructura válida de decisión | E/E3 | Decisión llama modelos reales; logs DNS/red fallan antes de estructura esperada. |
| BF-147 | 585 | `test/proactive.test.js:152:1` | Proactive 6: detecta una pregunta reciente que quedó sin respuesta | L/L3 | Función heurística legacy no exportada; revisar sustitución semántica y política §6.3. |
| BF-148 | 586 | `test/proactive.test.js:168:1` | Proactive 7: detecta oportunidad de proponer una actividad grupal | L/L3 | Función heurística legacy no exportada; revisar sustitución semántica y política §6.3. |
| BF-149 | 587 | `test/recordatorios.test.js:12:1` | Recordatorios: parseReminderTime parsea tiempos relativos correctamente | L/L2 | Parser relativo local devuelve vacío; revisar unidades/fecha fija y API actual. |
| BF-150 | 593 | `test/recortarPdf.test.js:19:1` | Recortar PDF: Flujo completo con Ghostscript real | E/E4 | gs ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-151 | 57 | `test/rikolinoLibrary.test.js:1:1` | test/rikolinoLibrary.test.js | E/E4 | Fallo de carga: sharp requerido por ruta absoluta de proyecto vecino, no disponible en aislamiento. |
| BF-152 | 634 | `test/ruleta.test.js:20:1` | Ruleta: ciclo completo de creación de sala, mensaje sin comandos y unión natural | L/L2 | Espera reescribir texto en normalizador; valor observado conserva frase original. |
| BF-153 | 637 | `test/school.test.js:22:1` | School: parsea horas y fechas escolares en español | L/L2 | Parser/extractor local difiere de expectativa legacy; revisar fecha/contexto fijo y contrato actual. |
| BF-154 | 641 | `test/school.test.js:97:1` | School: extractSchoolTaskDetails extrae materia y descripción en lenguaje natural | L/L2 | Parser/extractor local difiere de expectativa legacy; revisar fecha/contexto fijo y contrato actual. |
| BF-155 | 642 | `test/school.test.js:109:1` | School: fallback local extrae limpiamente fecha y tarea sin borrar la descripción (Bug 4.1) | L/L2 | Parser/extractor local difiere de expectativa legacy; revisar fecha/contexto fijo y contrato actual. |
| BF-156 | 643 | `test/school.test.js:133:1` | School: handleDirectTaskMessage procesa /! y registra tarea en lote del día | U/U1 | Tarea/multimedia/registro combina parser, configuración y almacenamiento; no se aisló causa primaria. |
| BF-157 | 645 | `test/school.test.js:226:1` | School: parseDueDate soporta fechas explícitas en español (24 de octubre, en 1 mes) | L/L2 | Parser/extractor local difiere de expectativa legacy; revisar fecha/contexto fijo y contrato actual. |
| BF-158 | 646 | `test/school.test.js:245:1` | School: handleDirectTaskMessage respeta fecha explícita especificada por el usuario | U/U1 | Tarea/multimedia/registro combina parser, configuración y almacenamiento; no se aisló causa primaria. |
| BF-159 | 652 | `test/school.test.js:469:1` | School: elimina archivo local al cancelar tarea con multimedia (Bug 2.1) | U/U1 | Tarea/multimedia/registro combina parser, configuración y almacenamiento; no se aisló causa primaria. |
| BF-160 | 654 | `test/school.test.js:530:1` | School: descarga imagen correctamente cuando es un mensaje citado / quoted (Bug 2.2) | U/U1 | Tarea/multimedia/registro combina parser, configuración y almacenamiento; no se aisló causa primaria. |
| BF-161 | 671 | `test/semanticHandlers.test.js:19:1` | XP usa la cantidad del modelo, no el primer número ni un valor inventado | H/H2 | Mock de auth omite cleanJidNumber utilizado por el handler. |
| BF-162 | 684 | `test/terminal.test.js:20:1` | Terminal 1: echo hello ejecuta correctamente | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-163 | 685 | `test/terminal.test.js:30:1` | Terminal 2: printf formatea y devuelve salida limpia | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-164 | 686 | `test/terminal.test.js:37:1` | Terminal 3: pwd devuelve directorio válido | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-165 | 687 | `test/terminal.test.js:43:1` | Terminal 4: id muestra información del usuario usuario configurado | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-166 | 688 | `test/terminal.test.js:50:1` | Terminal 5: uptime devuelve estadísticas del servidor | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-167 | 689 | `test/terminal.test.js:56:1` | Terminal 6: df -h devuelve uso de disco montado | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-168 | 690 | `test/terminal.test.js:62:1` | Terminal 7: free -m devuelve memoria RAM del sistema | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-169 | 691 | `test/terminal.test.js:68:1` | Terminal 8: docker ps lista contenedores si Docker está disponible | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-170 | 692 | `test/terminal.test.js:76:1` | Terminal 9: comando con exit code distinto de 0 | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-171 | 693 | `test/terminal.test.js:83:1` | Terminal 10: comando que supera 25 segundos y debe terminar por timeout | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-172 | 694 | `test/terminal.test.js:97:1` | Terminal 11: stdout grande se trunca de forma segura sin consumir memoria | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-173 | 695 | `test/terminal.test.js:109:1` | Terminal 12: stderr grande se trunca de forma segura | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-174 | 696 | `test/terminal.test.js:122:1` | Terminal 13: salida que contenga una API key ficticia es sanitizada | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-175 | 697 | `test/terminal.test.js:133:1` | Terminal 14: salida que contenga múltiples secretos ficticios | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-176 | 699 | `test/terminal.test.js:161:1` | Terminal 16: verificar que el proceso ejecutado corresponde al usuario configurado | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-177 | 700 | `test/terminal.test.js:173:1` | Terminal: prueba específica contra fugas en stdout y stderr con secretos múltiples | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-178 | 701 | `test/terminal.test.js:203:1` | Terminal: proceso terminado por timeout no deja procesos huérfanos | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-179 | 702 | `test/terminal.test.js:226:1` | Terminal: comando inexistente devuelve resultado estructurado sin crashear el proceso | E/E2 | Shell: cap-drop ALL impide cambio root→UID configurado; spawn EPERM. |
| BF-180 | 705/3 | `test/thumbnailCollage.test.js:23:5` | genera un collage JPEG válido con 4 miniaturas y limpia archivos temporales | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-181 | 705/4 | `test/thumbnailCollage.test.js:43:5` | maneja items con miniaturas fallidas usando fondo de respaldo sin lanzar excepción | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-182 | 716 | `test/tts.test.js:28:1` | TTS: genera archivo de audio mp3 con fallback resiliente y ejecuta cleanup | E/E4 | gtts-cli ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-183 | 718 | `test/unification_json_cli.test.js:23:1` | Unificación: applyAiArgsToParsed y handleTareas soporta JSON nativo y CLI legacy | U/U1 | Contrato JSON/CLI y mocks de servicios cambian; aserción sin causa primaria concluyente. |
| BF-184 | 722 | `test/unification_json_cli.test.js:217:1` | Unificación: handleNotas y handleRecordar con JSON nativo | L/L1 | Espera confirmación textual antigua de nota guardada. |
| BF-185 | 723 | `test/unification_json_cli.test.js:255:1` | Unificación: handleVoz y handleTerminal con JSON nativo | U/U1 | Contrato JSON/CLI y mocks de servicios cambian; aserción sin causa primaria concluyente. |
| BF-186 | 754 | `test/voiceUx.test.js:309:1` | FFmpeg y ffprobe reales ajustan un tono sintético y limpian temporales sin API de voz | E/E4 | ffmpeg ausente (ENOENT); evidencia directa en error/log contiguo. |
| BF-187 | 792 | `test/whisper.test.js:25:1` | Whisper: summarizeTranscription genera resumen conciso para audios extensos | E/E3 | Integración/proveedor real sin acceso o configuración de producción; no hay fake completo. |

## Agregador excluido de los 187

| TAP | Archivo:línea:columna | Título | Por qué no suma |
|---:|---|---|---|
| 705 | `test/thumbnailCollage.test.js:9:1` | thumbnailCollage utility | `type: suite`, `subtestsFailed`; resume los hijos 705/3 y 705/4 ya incluidos. |

## Siguiente verificación

El baseline queda rojo documentado. Para convertirlo en gates útiles: montar todos los artefactos requeridos, proveer fixtures/puertos falsos, parametrizar identidades y reloj, y ejecutar candidatos localmente con configuración explícita. No habilitar red real, credenciales o privilegios del shell solo para hacer verde el baseline. El maestro decide esas WOs y registra separación entre fallos previos y regresiones v2.
