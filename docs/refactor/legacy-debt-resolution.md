# Conciliación de deuda legacy F2-E001

Estado: **159 IDs resueltos y verificados en la suite global**, sin pendientes. La corrida `/tmp/botsky-debt-verified-resumed.tap` terminó con exit0: **814 tests / 814 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo; 1 suite**, duración 145743.384052 ms. Resumen TAP completo revisado; el maestro confirmó el exit del runner.

SHA-256 TAP: `13b845f7eaebfbd09e1fc04719a6bf7dfbfaf3da5d564e15e5bc30af4f200a11`. Snapshot fuente: `5e9bf8d0966311ecac8157a9e2e88494c9e4c874`. Runtime: Node.js v20.20.2, ARM64; sharp 0.35.3, cheerio 1.2.0, sqlite3 6.0.1; productor fixture SHA `a7e977b389963ac6844610a422224a21d7f6605c43f3f3b5a1601ec7f5f9dfef`.

La verificación usa staging Docker sin red, configuración sintética y SQLite/artefactos temporales por test. Proveedores y transportes externos son fakes explícitos. Acredita contratos y regresiones offline; no disponibilidad de producción ni comprensión semántica de un modelo remoto. Los 814 casos incluyen recuperaciones de carga y regresiones añadidas: no restar directamente este total del baseline de 795 ni declarar 159 bugs productivos.

Ledger histórico: `phase2-legacy-debt.json` (inmutable). Representación estructurada: `legacy-debt-resolution.json`;159 filas, 159 IDs únicos, ninguno omitido. Los intervalos ausentes de BF-001–187 no pertenecen al ledger pendiente de 159; no crear IDs para completar una secuencia.

## Criterio y límites

Las conclusiones distinguen entorno/harness, expectativas retiradas por el contrato semántico y defectos reproducidos. Un defecto asociado en una WO no convierte automáticamente todos sus BFIDs en fallas productivas. Las WOs registran sustituciones observables, casos preservados y pruebas adicionales; no hay eliminación/skip como resolución. Las dos filas de import fallido recuperan múltiples casos y no se equiparan a un único caso del runner actual.

Clasificación histórica se conserva por fila en JSON. Evidencia aquí apunta a WO-027–030; cada WO contiene comandos/TAP focalizados y sus límites. Wrappers/regresiones añadidos después del ledger siguen documentados en esas WOs y no amplían 159 IDs. Proveedores fake y puertos aislados no acreditan disponibilidad remota.

Las clasificaciones finales usan las etiquetas `environment`, `harness`, `obsolete-contract` y `confirmed-defect`, combinadas cuando la evidencia es mixta. `sourceConclusionClassification` conserva el término exacto de la WO en JSON.

## Control de conciliación

159 filas, 159 IDs únicos, igualdad exacta de pares ID/archivo con el ledger, cero omitidos y cero duplicados. SHA-256 del histórico conservado: `00ec1da89032bc5363ddcd453c93f38c241dd30efa9a3ea38ddf8840a7102784`.

| Clasificación combinada (excluyente) | IDs |
|---|---:|
| environment | 28 |
| environment+harness | 78 |
| obsolete-contract | 21 |
| harness+obsolete-contract | 8 |
| harness+obsolete-contract+confirmed-defect | 12 |
| confirmed-defect | 7 |
| environment+harness+confirmed-defect | 1 |
| obsolete-contract+confirmed-defect | 1 |
| harness+confirmed-defect | 1 |
| harness | 2 |
| Total | 159 |

Las etiquetas individuales son superpuestas: environment: 107, harness: 102, obsolete-contract: 42, confirmed-defect: 22. No sumar estas etiquetas como fallos independientes; los 22 IDs asociados a defectos no representan 22 defectos distintos ni 22 fallas productivas. Categorías históricas del ledger: E: 106, L: 33, H: 10, U: 10; no se modificaron.

## Casos

| BFID | Archivo:línea original | Clasificación final | Conclusión | Evidencia WO |
|---|---|---|---|---|
| BF-001 | `test/adminXp.test.js:58:1` | environment | Allowlist sintética derivada de literales de fixtures; auth y SQLite reales en contenedor. | [WO-030](wo/WO-030.md) |
| BF-002 | `test/adminXp.test.js:95:1` | environment | Allowlist sintética derivada de literales de fixtures; auth y SQLite reales en contenedor. | [WO-030](wo/WO-030.md) |
| BF-003 | `test/adminXp.test.js:129:1` | environment | Allowlist sintética derivada de literales de fixtures; auth y SQLite reales en contenedor. | [WO-030](wo/WO-030.md) |
| BF-004 | `test/adminXp.test.js:235:1` | environment | Allowlist sintética derivada de literales de fixtures; auth y SQLite reales en contenedor. | [WO-030](wo/WO-030.md) |
| BF-005 | `test/agent.test.js:19:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-006 | `test/agent.test.js:26:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-007 | `test/agent.test.js:32:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-008 | `test/agent.test.js:39:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-009 | `test/agent.test.js:45:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-010 | `test/agent.test.js:51:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-011 | `test/agent.test.js:57:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-012 | `test/agent.test.js:63:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-013 | `test/agent.test.js:70:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-014 | `test/agent.test.js:76:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-015 | `test/agent.test.js:84:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-016 | `test/agent.test.js:91:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-017 | `test/agent.test.js:97:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-018 | `test/agent.test.js:111:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-019 | `test/agent.test.js:118:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-020 | `test/agent.test.js:125:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-021 | `test/agent.test.js:134:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-022 | `test/agent.test.js:146:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-023 | `test/agent.test.js:405:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-024 | `test/agent.test.js:418:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-025 | `test/agent.test.js:498:1` | environment+harness | Shell/loop reales; BF023 proveedor HTTP fixture + uptime real | [WO-027](wo/WO-027.md) |
| BF-026 | `test/agentEngine.test.js:36:1` | environment | Drive registry real + getQuota fake; quota fields preserved | [WO-028](wo/WO-028.md) |
| BF-027 | `test/agentEngine.test.js:43:1` | environment | Minecraft registry real + telemetry backends fake; structured status preserved | [WO-028](wo/WO-028.md) |
| BF-028 | `test/agentEngine.test.js:69:1` | environment | Agent real + fake planner/composer; casual chat performs zero tools | [WO-028](wo/WO-028.md) |
| BF-029 | `test/agentEngine.test.js:82:1` | environment | Agent real + fake provider/telemetry; one tool and functionResponse before synthesis | [WO-028](wo/WO-028.md) |
| BF-030 | `test/ai.test.js:26:1` | environment | Router real + fake HTTP structured decision; registered command preserved | [WO-028](wo/WO-028.md) |
| BF-031 | `test/ai.test.js:34:1` | environment | Router real preserves format/ss/to/speed from provider args | [WO-028](wo/WO-028.md) |
| BF-032 | `test/ai.test.js:73:1` | environment | Router real forwards audio attachment metadata and preserves efecto plan | [WO-028](wo/WO-028.md) |
| BF-033 | `test/anti_repetition.test.js:1:1` | environment+harness | Dependencias reales + aislar precedencia FOTOS_DIR | [WO-027](wo/WO-027.md) |
| BF-041 | `test/audit_fixes.test.js:58:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-042 | `test/audit_fixes.test.js:66:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-043 | `test/audit_fixes.test.js:76:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-044 | `test/audit_fixes.test.js:87:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-045 | `test/audit_fixes.test.js:95:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-046 | `test/audit_fixes.test.js:385:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-047 | `test/audit_fixes.test.js:392:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-048 | `test/audit_fixes.test.js:399:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-049 | `test/audit_fixes.test.js:412:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-050 | `test/audit_fixes.test.js:429:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-051 | `test/audit_fixes.test.js:447:1` | environment+harness | Shell/env reales; Docker CLI fixture y UX proveedor fixture | [WO-027](wo/WO-027.md) |
| BF-052 | `test/blackjack.test.js:97:1` | obsolete-contract | Normalizador conserva texto sin prefijo y aporta blackjackLobby/blackjackHand; comportamiento de apuesta, turnos y reembolso preservado. | [WO-030](wo/WO-030.md) |
| BF-053 | `test/blackjack.test.js:307:1` | obsolete-contract | Normalizador conserva texto sin prefijo y aporta blackjackLobby/blackjackHand; comportamiento de apuesta, turnos y reembolso preservado. | [WO-030](wo/WO-030.md) |
| BF-054 | `test/comprehensive_audit_fixes.test.js:15:1` | environment | Runner aporta UID1002 y capabilities dentro namespace aislado; conserva assertions originales. | [WO-030](wo/WO-030.md) |
| BF-055 | `test/comprehensive_audit_fixes.test.js:51:1` | environment | Runner aporta UID1002 y capabilities dentro namespace aislado; conserva assertions originales. | [WO-030](wo/WO-030.md) |
| BF-056 | `test/convertir_documentos.test.js:27:1` | obsolete-contract | Falta de adjunto rechaza con userMessage que explica archivo/enlace/formato, sin stack; conversión real permanece. | [WO-030](wo/WO-030.md) |
| BF-057 | `test/cooperacha.test.js:158:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-058 | `test/cooperacha.test.js:177:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-059 | `test/cooperacha.test.js:221:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-060 | `test/cooperacha.test.js:285:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-061 | `test/cooperacha.test.js:352:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-062 | `test/cooperacha.test.js:399:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-063 | `test/cooperacha.test.js:448:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-064 | `test/cooperacha.test.js:483:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-065 | `test/cooperacha.test.js:560:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-066 | `test/cooperacha.test.js:618:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-067 | `test/cooperacha.test.js:634:1` | environment | Fixtures de identidad/configuración y SQLite aislado, sin modificación de assertions. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-068 | `test/daily.test.js:21:1` | obsolete-contract | Mensajes actuales y resultado estructurado de premio/giro; SQLite valida XP y cooldown. | [WO-030](wo/WO-030.md) |
| BF-069 | `test/daily.test.js:43:1` | obsolete-contract | Mensajes actuales y resultado estructurado de premio/giro; SQLite valida XP y cooldown. | [WO-030](wo/WO-030.md) |
| BF-070 | `test/daily.test.js:104:1` | obsolete-contract | Mensajes actuales y resultado estructurado de premio/giro; SQLite valida XP y cooldown. | [WO-030](wo/WO-030.md) |
| BF-071 | `test/descargar.test.js:438:1` | environment | Runner carga fixtures de admin, tools y DB; assertions originales preservadas. | [WO-030](wo/WO-030.md) |
| BF-072 | `test/dispatcher.test.js:209:1` | harness+obsolete-contract | Plan de grupo incluye addressed_to_bot y compositor fake separado; router decide ignore/chat, manteniendo silencio, rechazo JID y permisos. No restaurar heurística lingüística. | [WO-027](wo/WO-027.md) |
| BF-073 | `test/dispatcher.test.js:264:1` | harness+obsolete-contract | Plan de grupo incluye addressed_to_bot y compositor fake separado; router decide ignore/chat, manteniendo silencio, rechazo JID y permisos. No restaurar heurística lingüística. | [WO-027](wo/WO-027.md) |
| BF-074 | `test/dispatcher.test.js:460:1` | harness+obsolete-contract | Plan de grupo incluye addressed_to_bot y compositor fake separado; router decide ignore/chat, manteniendo silencio, rechazo JID y permisos. No restaurar heurística lingüística. | [WO-027](wo/WO-027.md) |
| BF-075 | `test/dispatcher.test.js:507:1` | harness+obsolete-contract | Plan de grupo incluye addressed_to_bot y compositor fake separado; router decide ignore/chat, manteniendo silencio, rechazo JID y permisos. No restaurar heurística lingüística. | [WO-027](wo/WO-027.md) |
| BF-076 | `test/dispatcher.test.js:550:1` | harness+obsolete-contract | Plan de grupo incluye addressed_to_bot y compositor fake separado; router decide ignore/chat, manteniendo silencio, rechazo JID y permisos. No restaurar heurística lingüística. | [WO-027](wo/WO-027.md) |
| BF-077 | `test/dispatcher.test.js:597:1` | harness+obsolete-contract | Plan de grupo incluye addressed_to_bot y compositor fake separado; router decide ignore/chat, manteniendo silencio, rechazo JID y permisos. No restaurar heurística lingüística. | [WO-027](wo/WO-027.md) |
| BF-078 | `test/dispatcher.test.js:644:1` | harness+obsolete-contract | Plan de grupo incluye addressed_to_bot y compositor fake separado; router decide ignore/chat, manteniendo silencio, rechazo JID y permisos. No restaurar heurística lingüística. | [WO-027](wo/WO-027.md) |
| BF-079 | `test/e2e_requirements.test.js:140:1` | harness+obsolete-contract+confirmed-defect | Router fake explícito y allowlist sintética. Dispatcher real por VM con executor inyectable: prueba error userMessage, secretos, errores técnicos y null. Se descubre/fija secreto que test anterior no ejecutaba. | [WO-030](wo/WO-030.md) |
| BF-080 | `test/e2e_requirements.test.js:177:1` | harness+obsolete-contract+confirmed-defect | Router fake explícito y allowlist sintética. Dispatcher real por VM con executor inyectable: prueba error userMessage, secretos, errores técnicos y null. Se descubre/fija secreto que test anterior no ejecutaba. | [WO-030](wo/WO-030.md) |
| BF-081 | `test/e2e_requirements.test.js:316:1` | harness+obsolete-contract+confirmed-defect | Router fake explícito y allowlist sintética. Dispatcher real por VM con executor inyectable: prueba error userMessage, secretos, errores técnicos y null. Se descubre/fija secreto que test anterior no ejecutaba. | [WO-030](wo/WO-030.md) |
| BF-082 | `test/e2e_requirements.test.js:333:1` | harness+obsolete-contract+confirmed-defect | Router fake explícito y allowlist sintética. Dispatcher real por VM con executor inyectable: prueba error userMessage, secretos, errores técnicos y null. Se descubre/fija secreto que test anterior no ejecutaba. | [WO-030](wo/WO-030.md) |
| BF-083 | `test/maicra_command.test.js:36:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-084 | `test/maicra_command.test.js:47:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-085 | `test/maicra_command.test.js:56:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-086 | `test/maicra_command.test.js:64:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-087 | `test/maicra_command.test.js:72:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-088 | `test/maicra_command.test.js:80:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-089 | `test/maicra_command.test.js:86:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-090 | `test/maicra_command.test.js:92:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-109 | `test/mensaje.test.js:9:1` | environment+harness | Contactos/configuración ausentes: VM con afinidades/groupInfo sintéticos y auth real bajo env ficticio; conserva exacto/ausente e IDs. | [WO-029](wo/WO-029.md) |
| BF-110 | `test/mensaje.test.js:22:1` | confirmed-defect | Permiso se verificaba después de aclaración/redacción IA: autorización por remitente real al inicio, sin IA ni envío externo cuando se rechaza. | [WO-029](wo/WO-029.md) |
| BF-111 | `test/mensaje.test.js:42:1` | environment+harness+confirmed-defect | Fixture autenticada y args legacy explícitos traducidos a contacto+recado; modelo fake; destinatario/texto/confirmación preservados. | [WO-029](wo/WO-029.md) |
| BF-112 | `test/mensaje.test.js:76:1` | obsolete-contract+confirmed-defect | Claims isAdmin/senderJid no conceden privilegios: metadata confiable y auth real; regresión forged rechaza sin envío. | [WO-029](wo/WO-029.md) |
| BF-113 | `test/mensaje.test.js:104:1` | confirmed-defect | Aliases cerrados del grupo principal restaurados; nombres desconocidos siguen aclaración sin sustitución. | [WO-029](wo/WO-029.md) |
| BF-114 | `test/mensaje.test.js:116:1` | environment+harness | Modelo/router fake semántico permite comprobar anonimato/redacción/entrega al grupo principal sin contactos ni modelo productivos. | [WO-029](wo/WO-029.md) |
| BF-115 | `test/mensaje.test.js:147:1` | environment+harness | Modelo/router fake semántico permite comprobar anonimato/redacción/entrega al grupo principal sin contactos ni modelo productivos. | [WO-029](wo/WO-029.md) |
| BF-116 | `test/milestone1_stress.test.js:58:1` | confirmed-defect | Malformed context/args/serialización escapaban try: snapshot JSON sin getters y from requerido retornan false/error. | [WO-029](wo/WO-029.md) |
| BF-117 | `test/milestone1_stress.test.js:129:1` | confirmed-defect | BigInt/circular/getters rechazados antes de herramienta; getter no se evalúa y contrato no arroja excepción. | [WO-029](wo/WO-029.md) |
| BF-118 | `test/milestone1_stress.test.js:139:1` | confirmed-defect | BigInt/circular/getters rechazados antes de herramienta; getter no se evalúa y contrato no arroja excepción. | [WO-029](wo/WO-029.md) |
| BF-119 | `test/milestone1_stress.test.js:152:1` | confirmed-defect | BigInt/circular/getters rechazados antes de herramienta; getter no se evalúa y contrato no arroja excepción. | [WO-029](wo/WO-029.md) |
| BF-120 | `test/milestone1_stress.test.js:224:1` | harness+confirmed-defect | Guardas tipo/shape de handlers y clasificación estricta de errores de negocio Progress; regresión shutdown; mantiene rechazo de excepciones técnicas. | [WO-029](wo/WO-029.md) |
| BF-121 | `test/milestone1_stress.test.js:304:1` | confirmed-defect | Registry valida name/context/from/parsed/args/flags antes de acceso; malformed retorna null, campos opcionales normalizados. | [WO-029](wo/WO-029.md) |
| BF-122 | `test/minecraftRemote.test.js:93:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-123 | `test/minecraftRemote.test.js:105:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-124 | `test/minecraftRemote.test.js:115:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-125 | `test/minecraftRemote.test.js:126:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-126 | `test/minecraftRemote.test.js:135:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-127 | `test/minecraftRemote.test.js:142:1` | environment+harness | Adapter real en VM con SSH fake verifica binario, BatchMode, script y parsing; comando recibe subcomando canónico del modelo. Sin SSH productivo. | [WO-027](wo/WO-027.md) |
| BF-131 | `test/notas.test.js:58:1` | obsolete-contract | Guardar/listar/buscar/borrar con texto vigente y comprobación SQLite tras eliminación. | [WO-030](wo/WO-030.md) |
| BF-132 | `test/observations_minor.test.js:12:1` | obsolete-contract | Intention cache removed by semantic docs; two identical requests with distinct context produce distinct fake-backed decisions | [WO-028](wo/WO-028.md) |
| BF-133 | `test/observations_minor.test.js:58:1` | obsolete-contract | isImageTaskRequest removed; attachment metadata and analysis/transform plan are preserved without local keyword classification | [WO-028](wo/WO-028.md) |
| BF-134 | `test/observations_minor.test.js:74:1` | harness | Fake HTTP replaces ineffective exported-function monkeypatch; actual proactive cooldown/bypass tested | [WO-028](wo/WO-028.md) |
| BF-135 | `test/observations_minor.test.js:107:1` | harness+obsolete-contract | No blind image fallback plus reference feedback tested; obsolete log text/user identity expectation replaced with no-user logging | [WO-028](wo/WO-028.md) |
| BF-136 | `test/optimizations.test.js:7:1` | obsolete-contract | Breaker contract typed rejection replaces null expectation; no transport during cooldown | [WO-028](wo/WO-028.md) |
| BF-137 | `test/optimizations.test.js:31:1` | obsolete-contract | Arbitrary weight/5minute limits retired; actual search keeps long result/default480 then buildArgs has no arbitrary cutoff | [WO-028](wo/WO-028.md) |
| BF-138 | `test/optimizations.test.js:129:1` | obsolete-contract | Source regex replaced with actual fake HTTP model/token/3000text/35000media timeout and 413breaker | [WO-028](wo/WO-028.md) |
| BF-139 | `test/pack.test.js:456:1` | environment+harness | Pack conserva compra SQLite y medios sintéticos; Pack10 aporta parsed.flags/raw válidos; XP150, imágenes y delegación canónica verificados. | [WO-027](wo/WO-027.md) |
| BF-140 | `test/pack.test.js:666:1` | environment+harness | Pack conserva compra SQLite y medios sintéticos; Pack10 aporta parsed.flags/raw válidos; XP150, imágenes y delegación canónica verificados. | [WO-027](wo/WO-027.md) |
| BF-141 | `test/pack.test.js:750:1` | environment+harness | Pack conserva compra SQLite y medios sintéticos; Pack10 aporta parsed.flags/raw válidos; XP150, imágenes y delegación canónica verificados. | [WO-027](wo/WO-027.md) |
| BF-142 | `test/pack.test.js:804:1` | environment+harness | Pack conserva compra SQLite y medios sintéticos; Pack10 aporta parsed.flags/raw válidos; XP150, imágenes y delegación canónica verificados. | [WO-027](wo/WO-027.md) |
| BF-143 | `test/personality.test.js:38:1` | obsolete-contract | Mode comes from explicit semantic response_mode, not phrase keywords; budgets and recent assistant-style window retained | [WO-028](wo/WO-028.md) |
| BF-144 | `test/personality.test.js:50:1` | environment | Fake HTTP classifies sentiment ofensa while route text remains empty; no paid inference | [WO-028](wo/WO-028.md) |
| BF-145 | `test/personality.test.js:65:1` | obsolete-contract | Existing affinity hierarchy DB assertions retained; actual route payload separates tone from authorization, replaces deleted prompt phrase regex | [WO-028](wo/WO-028.md) |
| BF-146 | `test/proactive.test.js:74:1` | environment | Proactive decision structure tested using actual evaluator with fake JSON provider | [WO-028](wo/WO-028.md) |
| BF-147 | `test/proactive.test.js:152:1` | obsolete-contract | Question heuristic removed; actual proactive cycle submits recent history in contextual mode, old history stays idle | [WO-028](wo/WO-028.md) |
| BF-148 | `test/proactive.test.js:168:1` | obsolete-contract | Activity heuristic removed; actual cycle follows semantic decision and remains silent on model abstention | [WO-028](wo/WO-028.md) |
| BF-149 | `test/recordatorios.test.js:12:1` | obsolete-contract | Executor acepta minutos y duración canónica; rechaza lenguaje natural que debe interpretar el modelo. | [WO-030](wo/WO-030.md) |
| BF-150 | `test/recortarPdf.test.js:19:1` | environment+harness | GS/pdfinfo reales; plan canónico y validaciones técnicas | [WO-027](wo/WO-027.md) |
| BF-151 | `test/rikolinoLibrary.test.js:1:1` | environment | Helper externo de código + sharp/cheerio y carpeta de imágenes sintéticas; importa los siete casos antes bloqueados. | [WO-027](wo/WO-027.md), [WO-030](wo/WO-030.md) |
| BF-152 | `test/ruleta.test.js:20:1` | obsolete-contract | Texto intacto y session rouletteLobby; comprobación de saldo, ventana y reembolso preservada. | [WO-030](wo/WO-030.md) |
| BF-153 | `test/school.test.js:22:1` | harness+obsolete-contract+confirmed-defect | Proveedor explícito offline entrega materia/título/fecha ISO; persistencia/digest/imagen reales. Cancelación usa executor de plan, limpia adjunto y protege rutas externas/usuarios no autorizados. | [WO-030](wo/WO-030.md) |
| BF-154 | `test/school.test.js:97:1` | harness+obsolete-contract+confirmed-defect | Proveedor explícito offline entrega materia/título/fecha ISO; persistencia/digest/imagen reales. Cancelación usa executor de plan, limpia adjunto y protege rutas externas/usuarios no autorizados. | [WO-030](wo/WO-030.md) |
| BF-155 | `test/school.test.js:109:1` | harness+obsolete-contract+confirmed-defect | Proveedor explícito offline entrega materia/título/fecha ISO; persistencia/digest/imagen reales. Cancelación usa executor de plan, limpia adjunto y protege rutas externas/usuarios no autorizados. | [WO-030](wo/WO-030.md) |
| BF-156 | `test/school.test.js:133:1` | harness+obsolete-contract+confirmed-defect | Proveedor explícito offline entrega materia/título/fecha ISO; persistencia/digest/imagen reales. Cancelación usa executor de plan, limpia adjunto y protege rutas externas/usuarios no autorizados. | [WO-030](wo/WO-030.md) |
| BF-157 | `test/school.test.js:226:1` | harness+obsolete-contract+confirmed-defect | Proveedor explícito offline entrega materia/título/fecha ISO; persistencia/digest/imagen reales. Cancelación usa executor de plan, limpia adjunto y protege rutas externas/usuarios no autorizados. | [WO-030](wo/WO-030.md) |
| BF-158 | `test/school.test.js:245:1` | harness+obsolete-contract+confirmed-defect | Proveedor explícito offline entrega materia/título/fecha ISO; persistencia/digest/imagen reales. Cancelación usa executor de plan, limpia adjunto y protege rutas externas/usuarios no autorizados. | [WO-030](wo/WO-030.md) |
| BF-159 | `test/school.test.js:469:1` | harness+obsolete-contract+confirmed-defect | Proveedor explícito offline entrega materia/título/fecha ISO; persistencia/digest/imagen reales. Cancelación usa executor de plan, limpia adjunto y protege rutas externas/usuarios no autorizados. | [WO-030](wo/WO-030.md) |
| BF-160 | `test/school.test.js:530:1` | harness+obsolete-contract+confirmed-defect | Proveedor explícito offline entrega materia/título/fecha ISO; persistencia/digest/imagen reales. Cancelación usa executor de plan, limpia adjunto y protege rutas externas/usuarios no autorizados. | [WO-030](wo/WO-030.md) |
| BF-161 | `test/semanticHandlers.test.js:19:1` | harness | Auth fake completa métodos usados por handler;500 XP canon y ausencia de monto siguen exactos. | [WO-028](wo/WO-028.md) |
| BF-162 | `test/terminal.test.js:20:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-163 | `test/terminal.test.js:30:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-164 | `test/terminal.test.js:37:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-165 | `test/terminal.test.js:43:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-166 | `test/terminal.test.js:50:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-167 | `test/terminal.test.js:56:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-168 | `test/terminal.test.js:62:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-169 | `test/terminal.test.js:68:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-170 | `test/terminal.test.js:76:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-171 | `test/terminal.test.js:83:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-172 | `test/terminal.test.js:97:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-173 | `test/terminal.test.js:109:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-174 | `test/terminal.test.js:122:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-175 | `test/terminal.test.js:133:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-176 | `test/terminal.test.js:161:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-177 | `test/terminal.test.js:173:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-178 | `test/terminal.test.js:203:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-179 | `test/terminal.test.js:226:1` | environment+harness | Shell real; BF169 backend Docker CLI fixture | [WO-027](wo/WO-027.md) |
| BF-180 | `test/thumbnailCollage.test.js:23:5` | environment+harness | JPEG+collage FFmpeg real; fetch fixture | [WO-027](wo/WO-027.md) |
| BF-181 | `test/thumbnailCollage.test.js:43:5` | environment+harness | JPEG+collage FFmpeg real; fetch fixture | [WO-027](wo/WO-027.md) |
| BF-182 | `test/tts.test.js:28:1` | environment+harness | Fallback provider fixture + MP3/ffprobe/cleanup reales | [WO-027](wo/WO-027.md) |
| BF-183 | `test/unification_json_cli.test.js:23:1` | obsolete-contract | Fechas canónicas ISO reemplazan frases cuyo parsing fue retirado;crear/listar/cancelar JSON/CLI y datos siguen validados. | [WO-028](wo/WO-028.md) |
| BF-184 | `test/unification_json_cli.test.js:217:1` | obsolete-contract | Confirmación actual más texto y fila SQLite;recordatorio preserva15min y contenido. | [WO-028](wo/WO-028.md) |
| BF-185 | `test/unification_json_cli.test.js:255:1` | obsolete-contract | Modo verbatim/destino explícitos conservan texto literal/voz y comando terminal;sin modelo ni recording real. | [WO-028](wo/WO-028.md) |
| BF-186 | `test/voiceUx.test.js:309:1` | environment+harness | FFmpeg/ffprobe reales; auth mock y JSON-copy tool contextual | [WO-027](wo/WO-027.md) |
| BF-187 | `test/whisper.test.js:25:1` | environment+harness | FFmpeg produce audio real temporal; HTTP fixture verifica multipart/headers/endpoint y resumen fake recibe transcripción íntegra. Sin early-return por fixture ausente ni proveedor live. | [WO-027](wo/WO-027.md) |
