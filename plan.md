# PLAN ARQUITECTÓNICO — Refactor de Botsky a arquitectura modular v2

**De:** Arquitecto senior (Claude) · **Para:** Maestro de obra (GPT) · **Cliente:** Yzy-zu
**Repo:** https://github.com/Yzy-zu/Botsky (commit analizado: `eb993ef`, 2026-10-12)
**Idioma de código/commits:** inglés para identificadores, español para mensajes al usuario final.

> Este documento es **autocontenido**. El arquitecto NO estará disponible para consultas continuas
> (el cliente tiene presupuesto para ~1 revisión más). Por eso: lee la sección 0 y 15 con atención.
> Casi todas las decisiones ya están tomadas aquí. Decide por tu cuenta lo que esté en la tabla
> de "Derechos de decisión" (§15) y escala solo lo que pida escalamiento.

---

## 0. Roles y reglas de la obra

| Rol | Quién | Hace | NO hace |
|---|---|---|---|
| Cliente | Yzy-zu | Aprueba DROP de funciones, prueba en WhatsApp real, decide producto | Escribir código |
| Arquitecto | Claude | Este plano + 1 revisión final de fase crítica | Dirigir el día a día |
| Maestro de obra | GPT | Descompone en órdenes de trabajo (WO), delega a albañiles, integra, verifica gates, reporta | Cambiar la arquitectura (§4) sin ADR aprobado |
| Albañiles | sub-agentes | Ejecutan 1 WO acotada (§14) | Tocar archivos fuera de su WO |

**Reglas inviolables de la obra**
1. **Nunca romper producción.** El bot v1 sigue corriendo hasta el cutover (§12 Fase 6). Todo v2 convive detrás de flags.
2. **Ningún test legacy se borra sin mapearlo.** Cada test viejo → test nuevo equivalente en `docs/refactor/test-traceability.md`.
3. **Cada fase termina con gates verdes** (§12). Sin gates verdes no se empieza la siguiente.
4. **Cambios de comportamiento solo los listados en §6 y §11.** El resto es refactor puro (mismo comportamiento observable). Si un albañil "mejora" algo no listado, se revierte.
5. **Sin secretos en el repo.** `.env` jamás se commitea; rotar cualquier clave que haya aparecido en logs/diffs.
6. **Rama:** `refactor/v2`. Tag `v1-legacy` sobre el commit actual antes de empezar. Commits pequeños y atómicos.

---

## 1. Diagnóstico medido (hechos, no opiniones)

Medido sobre el repo: ~24.5k líneas en `src/`, ~17.8k en `test/` (390 tests), 187 archivos, **sin README**.

| Hallazgo | Evidencia | Impacto |
|---|---|---|
| **Cero módulos huérfanos** en `src/` (análisis de grafo `require`). Solo `auth-drive.js` (script CLI) e `integrations/evolutionNativeTables.js` (cargado por script de parcheo) no tienen importadores | grafo de dependencias | El "código obsoleto" **no son archivos muertos**: es **funcionalidad duplicada y capas superpuestas**. Por eso un borrado ciego no sirve; hace falta consolidar |
| **Tres capas superpuestas de tool-calling a LLM**: `services/agent.js` (314 l), `services/agentEngine.js` (269 l), `services/toolRegistry.js` (920 l) + `semanticRouting.js` | cabeceras de archivos; las tres declaran herramientas Gemini | Lógica duplicada, difícil saber cuál manda |
| `services/ai.js` 1118 l mezcla rotación de claves, chat, enrutamiento, diagnóstico | 18 funciones top-level | Imposible testear/cambiar un proveedor sin tocar todo |
| `services/db.js` **1808 l**, 24 tablas, API callback-style, lo importan 24 módulos | fan-in | Acoplamiento total a SQLite; cualquier feature toca cualquier tabla |
| **Tablas duplicadas**: `bot_personality_state` (id=1, global) y `bot_personality_states` (por chat) | `db.js:155`, `db.js:204`, usos en 1131 y 1150 | Dos fuentes de verdad de personalidad |
| `dispatcher.js` 1072 l: 1 función `dispatch()` de ~600 l, wrappers defensivos tipo `descargarCmd.getSearchSession ? … : null` | `dispatcher.js:12-25,57` | Síntoma de **dependencias circulares evitadas con parches** |
| **32 módulos con `Map/Set` global** como estado (sesiones, cooldowns, caches) sin TTL común ni persistencia | análisis estático | Estado perdido en cada restart de PM2, fugas de memoria (ya hay monitor de RAM) |
| 2 ciclos directos: `mensaje ↔ outboundDelivery`, `pack ↔ happyHour` | grafo | Orden de carga frágil |
| `USE_TOOL_REGISTRY=true` en `.env.example` **no se lee en ningún lado** de `src/` | grep | Env muerta |
| **21 variables de entorno usadas pero ausentes de `.env.example`** (`BOT_NUMBER`, `ELEVENLABS_API_KEY`, `MINECRAFT_*`, `RAM_*`, `MAX_QUEUE_*`, `FOTOS_DIR`, `RIKOLINO_DIR`, `TV_SCRIPT_DIR`, …) | grep de `process.env.*` | Despliegue no reproducible |
| Duplicados de nombre: `utils/cleanup.js` vs `services/cleanup.js`; `src/scripts/` vs `/scripts/` | árbol | Confusión |
| Rutas/usuario del servidor **hardcodeados**: `/home/petrov/botsky` (PM2), usuario `petrov` uid 1002 (`terminal.js`), `BACKUPS=/home/petrov/backups` | `ecosystem.config.js`, `terminal.js:11-13` | No portable |
| Control de acceso **por substring**: `getAllAllowed().some(id => from.includes(id) …)` en el gate de Minecraft (`dispatcher.js:~969`). Ya existe `isAuthorizedAdmin()` (bug #5 arreglado en otros sitios) | `dispatcher.js:949-985` | Misma clase de bug de seguridad aún presente; permisos dispersos en `if` por comando en vez de declarativos |
| Datos personales/escolares en código: `school_schedule_data.js` | árbol | Debe ser dato, no código |
| Fallas R1/R2/R3 ya documentadas en `docs/AUDITORIA_UX_ARQUITECTURA.md` (activación involuntaria, verbosidad, multimedia sin texto) | `shouldDispatch = Boolean(text.trim()…)` en `message_normalizer.js:282`; `|| !hasExplicitPrefix` en `dispatcher.js:611,647` | **Son el motivo de producto del refactor** |
| Positivo: `ecosystem.config.js`/Dockerfile razonables, `scheduler` central ya existe, `terminal` tool ya exige `isAdmin` y enmascara secretos | lectura | Se conservan como base |

> **Nota de baseline:** en el sandbox del arquitecto `npm install` falló parcialmente, así que los 107 tests que fallaron
> fueron todos `Cannot find module (dotenv|sqlite3|axios|googleapis)` — **no son fallos reales**. El baseline verdadero
> debe medirlo el maestro en su entorno en la Fase 0.

---

## 2. Estrategia: por qué NO "reescribir todo de cero"

El cliente pidió "refactorizar por completo a código nuevo". Opinión del arquitecto, con respeto pero sin ambigüedad:

- Una **reescritura big-bang** de 24k líneas con 17.8k líneas de tests que codifican comportamiento ganado a golpes (bugs #5, #25, stress tests, "challenger", "audit_fixes") **reintroduce bugs ya resueltos** y deja el bot sin servicio semanas.
- El dolor real está en el **núcleo** (dispatcher, router, IA, estado, DB), no en las ~40 hojas (comandos) que en su mayoría funcionan.

**Estrategia decidida: "Núcleo nuevo + migración estrangulada de hojas".**
1. Se **escribe de cero** el núcleo v2 (pipeline, ports, plataforma, registro de features) en `src/v2/`.
2. Las features se **reescriben/portan una por una** a la nueva forma (manifest + handler + repo), conservando su lógica probada, en olas de riesgo creciente.
3. v2 corre primero en **modo sombra** (decide pero no envía) comparando contra v1; luego **canario** en chats elegidos; luego cutover total; luego se borra v1.
4. "Código obsoleto" se decide con una **auditoría de obsolescencia** (§13) + telemetría, no a ojo. El cliente aprueba cada DROP.

Resultado: código 100% nuevo en estructura, sin big-bang y con rollback por flag en cada paso.

---

## 3. Principios de diseño

1. **Regla de dependencia:** `domain` ← `pipeline` ← `features`; los `adapters` implementan *ports* definidos por el núcleo. Las features **nunca** importan adapters concretos (reciben puertos inyectados).
2. **Composition root único:** solo `src/v2/main.js` hace `new`/wiring. Prohibido `require` de servicios con efectos al cargar un módulo (hoy `server.js` arranca crons al importar).
3. **Políticas como código puro:** *¿le hablan al bot?*, *¿cuánto debo escribir?*, *¿puedo intervenir solo?* son **funciones puras testeables**, no regex dispersas ni prompts.
4. **Una sola fuente de verdad por capacidad:** el *manifest* de cada feature genera a la vez: registro de comandos, declaraciones de tools para el LLM, texto de `/ayuda`, permisos y colas. Se acaban los 3 registros paralelos.
5. **Determinista primero, LLM después.** El LLM solo decide lo que reglas no pueden, con salida validada contra esquema y limitada a intents habilitados.
6. **Estado explícito:** nada de `Map` global. Todo estado efímero pasa por `TtlStore`; todo estado durable por repositorios.
7. **Fallar con elegancia:** toda falla se clasifica en una taxonomía y se traduce a un mensaje útil con siguiente paso.
8. **Observable por diseño:** cada evento entrante deja una *traza de decisión* ("respondí porque X / ignoré porque Y").
9. **Expand/contract en DB:** migraciones aditivas hasta el cutover; limpiar después.

**Decisión de lenguaje (ADR-001):** JavaScript (CommonJS→ESM opcional) con **JSDoc + `// @ts-check` + `tsc --noEmit` en CI**. Razón: cero paso de build, compatible con PM2/Docker actuales, ~80% del beneficio de TypeScript. Migrar a TS después es mecánico. `engines.node` → `>=20`.

---

## 4. Arquitectura objetivo

```
                       WhatsApp ⇄ Evolution API
                                  │  webhook
┌──────────────────────────────────▼────────────────────────────────────┐
│ ADAPTERS (entrada/salida)                                             │
│  evolution/webhook ─► InboundEvent        Messenger port ◄─ evolution │
└───────┬───────────────────────────────────────────────────────▲───────┘
        │                      PIPELINE (core)                  │
        ▼                                                       │
 ① Ingest/Dedupe → ② Normalize → ③ Gate(authz, rate, allowlist)  │
 → ④ Addressing (¿me hablan?)  → ⑤ Context (hist, adjunto, sesión)
 → ⑥ Router (explícito → sesión → reglas de feature → LLM)
 → ⑦ Executor (cola light/heavy, permisos, timeout)
 → ⑧ Composer (política de longitud/tono/errores) ─────────────┘
        │ (pasivos: XP, historial, métricas — nunca responden solos)
        ▼
 FEATURES (verticales): manifest + handler + service + repo + prompts + tests
        │ usan puertos:  Messenger · Store(Repos) · LLM · Scheduler · Shell · Clock
        ▼
 PLATFORM: config · logger · TtlStore · queue · scheduler · migrations · metrics
 ADAPTERS salida: sqlite · gemini/groq · elevenlabs · ffmpeg/yt-dlp · docker/ssh(minecraft)
```

### 4.1 Árbol de carpetas (destino; durante la obra vive en `src/v2/`)

```
src/
  main.js                       # ÚNICO composition root
  config/        schema.js index.js          # TODAS las env, validadas, con defaults y doc
  domain/        events.js types.js errors.js # InboundEvent, Decision, Reply, AppError (JSDoc)
  pipeline/      ingest.js normalize.js gate.js addressing.js context.js
                 router.js executor.js composer.js index.js
  policies/      addressing.policy.js response.policy.js proactive.policy.js
                 attachment.policy.js access.policy.js        # PURAS
  platform/      logger.js ttlStore.js queue.js scheduler.js metrics.js
                 maintenance.js crypto.js clock.js
  adapters/
    evolution/   webhook.js client.js outbound.js media.js groups.js
                 echoGuard.js nativeTables.js
    ai/          llm.port.js gemini.js groq.js keyPool.js failures.js promptKit.js
    store/       sqlite.js migrations/ repos/ (1 por feature)
    system/      shell.js docker.js sshMinecraft.js
  features/
    <feature>/   manifest.js handler.js service.js repo.js prompts.js README.md
tests/
  unit/  contract/  scenario/  fixtures/webhooks/  traceability.md
docs/  ARCHITECTURE.md  adr/  refactor/  runbook.md
```

### 4.2 Contratos clave (JSDoc; implementar tal cual)

```js
/** @typedef {{ id:string, chatId:string, isGroup:boolean, sender:{jid:string,number:string,name:string},
 *   text:string, kind:'text'|'image'|'video'|'audio'|'document'|'sticker'|'reaction'|'poll'|'unknown',
 *   media?:{ref:string,mime:string,size?:number}, quoted?:{messageId:string,senderJid:string,text?:string,isFromBot:boolean},
 *   mentions:string[], isFromMe:boolean, receivedAt:number, raw:object }} InboundEvent */

/** @typedef {{ respond:boolean, reason:string, addressedBy?:'mention'|'quote-bot'|'prefix'|'wake-word'|'session'|'private'|'attachment-followup' }} AddressingDecision */

/** @typedef {{ kind:'command'|'intent'|'chat'|'ignore', feature?:string, name?:string, args?:object, confidence:number, via:'explicit'|'session'|'rule'|'llm' }} Decision */

/** @typedef {{ parts:Array<{type:'text'|'image'|'audio'|'video'|'document'|'sticker'|'reaction'|'poll',...}>, replyTo?:string, ephemeralHint?:boolean }} Reply */

/** Manifest — fuente única de verdad por feature */
defineFeature({
  id: 'reminders',
  flags: { enabledByDefault: true },
  commands: [{
    name: 'recordar', aliases: ['recordatorio','alarma'],
    scope: ['private','group'],            // dónde existe
    access: 'member',                      // 'public'|'member'|'admin'|'owner'  (DECLARATIVO)
    tier: 'light',                         // cola: 'none'|'light'|'heavy'
    argsSchema: {...},                     // validación; sirve también como tool-schema del LLM
    help: { short:'...', examples:['...'] },
    handler: async (ctx, args) => Reply
  }],
  intents: [{ id:'reminder.create', description:'...', schema:{...}, handler }],  // lo que el LLM puede elegir
  sessions: [{ id:'download.search', ttlSec:900, continuation:{ numericPick:true, requireQuoteInGroup:true } }],
  passive: [{ on:'group.message', run }],  // listeners que NO pueden responder directo
  jobs:   [{ id:'reminders.tick', everySec:60, run }],
  migrations: ['001_reminders.sql'],
});

/** Ports (los define core/, los implementan adapters/) */
Messenger { sendText, sendMedia, sendVoice, sendSticker, react, typing, delete, edit, groupInfo, … }
LLM       { generate({task:'route'|'chat'|'agent'|'vision', messages, tools?, schema?, budget}) → {ok, data|failure} }
Repos     { <feature>Repo }   // cada feature solo ve su repo (+ repos "compartidos" explícitos: users, conversation)
Shell     { run(profile, cmd) }  // perfiles con allowlist
TtlStore  { get/set/delete/touch(namespace,key,ttl) }
Clock     { now() }              // inyectable para tests
```

---

## 5. Pipeline: contrato de cada etapa

| Etapa | Entrada → salida | Regla clave |
|---|---|---|
| ① Ingest | webhook → `RawEvent` | Responde 200 inmediato; **dedupe** por `messageId` (TTL 10 min); descarta eco propio vía `echoGuard` (lógica actual de `evolution.js` `consumeOutboundEcho`, extraída) |
| ② Normalize | → `InboundEvent` | Reutiliza la lógica de `message_normalizer.js` y `whatsappText.js` (tests existentes). Marca `quoted.isFromBot` comparando **`stanzaId` ∈ mensajes enviados por el bot** (cache TTL de últimos N ids enviados) o `participant === botJid`. **Prohibido** comparar por substring de texto |
| ③ Gate | → pass/deny | allowlists (grupos/números), rate-limit por chat/usuario, cooldown. Comparación de JID **exacta normalizada**, nunca `.includes` |
| ④ Addressing | → `AddressingDecision` | **Política pura** (§6.1). Si `respond=false`: solo corren listeners **pasivos** |
| ⑤ Context | → `Ctx` | Historial **por hilo** en grupos (últimos N del usuario + mensajes que lo citan, no plano global), adjunto activo (§6.4), sesiones activas del usuario |
| ⑥ Router | → `Decision` | Orden estricto: (1) comando explícito con prefijo; (2) continuación de sesión; (3) reglas de intents declaradas en manifests; (4) LLM restringido a intents habilitados con salida validada por esquema; (5) chat libre. Cada paso registra `via` |
| ⑦ Executor | → `Reply` | Autorización **declarativa** desde `manifest.access` (el LLM jamás decide permisos); colas `light/heavy` con límites por usuario; timeout; errores a taxonomía |
| ⑧ Composer | `Reply` → envío | Aplica política de respuesta (§6.2), chunking, tono, reacción/typing, registro en historial |

---

## 6. Políticas de producto (cambios de comportamiento APROBADOS)

Estas son las **únicas** diferencias observables intencionales respecto a v1. Cada una tiene test de escenario (§11).

### 6.1 `addressing.policy` — ¿le hablan a Botsky?
Chat **privado**: siempre sí (salvo comandos/estado que no apliquen).
Chat **grupo**: sí **solo si** se cumple alguno:
1. `mentions` incluye el JID del bot;
2. el mensaje **cita** un mensaje real del bot (`quoted.isFromBot === true`);
3. prefijo de comando explícito (`!`, `/`, `#`, `.`, el que defina el parser actual);
4. **wake-word** exacta: `botsky` o `botsito` (⛔ **se elimina** la palabra genérica `bot`);
5. **continuación de sesión**: el usuario tiene sesión activa (ej. resultados de búsqueda) **y** el mensaje es la selección (`1`, `el 2`, `#3`) **y** además cita el mensaje de resultados **o** menciona al bot. *(Decisión por defecto; el cliente puede relajarla a "mismo usuario dentro de 90 s" en config `SESSION_GROUP_RELAXED=true`.)*
6. seguimiento de adjunto: el usuario respondió (cita) a un adjunto suyo reciente con instrucción.

**Los fast-paths (packs, cooperacha, hora feliz, airdrop "yoo") pasan a ser intents normales**: solo se evalúan si `respond=true`, **excepto** `airdrop-claim` ("yoo"), que es un evento de juego explícito, activo solo mientras haya airdrop vigente en ese grupo (se mantiene fast-path pre-router, pero acotado a esa condición).

### 6.2 `response.policy` — cuánto y cómo escribir
- Presupuestos por defecto (config): chat privado ≤ 600 caracteres; grupo ≤ 350; `maxOutputTokens` por tarea: `chat:300`, `route:120`, `agent:600`, `vision/read:1500`. Contenido largo **solo** si el usuario lo pide ("detallado", "completo", "resume todo") o la feature lo declara (`allowLong:true`).
- Respuestas de estado/telemetría: máx. 6 líneas por defecto; detalle completo bajo `... detallado`.
- Prohibidos los prefijos de terminal (`[!] error…`, `> ❌`). Formato de error: **qué pasó + qué puede hacer el usuario** (taxonomía §8.3). Nada de "intenta en un momento" sin acción concreta.
- Anti-repetición: el composer compara con las últimas N respuestas del bot en ese chat y pide variación al LLM **una sola vez**; si persiste, usa plantilla corta (no entra en bucle de *negative prompting*).
- La personalidad "sarcástica" vive en `data/persona.json` (hoy `data/ai_config.json`), **aplicada solo cuando `respond=true`**. La regla "si no te llaman no contestes" **deja de ser un prompt** y es código (§6.1).

### 6.3 `proactive.policy` — intervenciones no solicitadas
- **Opt-in por grupo** (`proactive_enabled` en tabla de settings; default **false**).
- Cuota: máx. `PROACTIVE_MAX_PER_DAY` (def. 3) por chat; separación mínima 45 min; **horas de silencio** (def. 23:00–08:00 `America/Mexico_City`); kill-switch global y por chat.
- El mensaje privado "de venganza"/seguimiento queda **desactivado por defecto**; si el cliente lo quiere, se activa por flag y cuenta contra la misma cuota.
- Eventos de juego programados (Hora Feliz, airdrop) siguen existiendo pero **declarados en el manifest** de `community` con su propio calendario y cuota; no se disparan con `setInterval` sueltos (usar `scheduler`).

### 6.4 `attachment.policy` — multimedia sin texto
- Todo adjunto recibido entra a `AttachmentContext` (TtlStore, 10 min, por chat+usuario) con `id`, mime, origen.
- **Privado, imagen/video/audio/documento sin texto:** reacción 👀 inmediata + **una** respuesta corta con ≤3 acciones sugeridas según tipo (imagen → sticker / leer texto / guardar en Drive; audio → transcribir; PDF → resumir / extraer texto). El siguiente mensaje corto ("sticker", "léelo") resuelve contra ese adjunto **sin pedir que lo cite** (`attachment-followup`).
- **Grupo, adjunto sin texto y sin addressing:** silencio total, pero se guarda en `AttachmentContext` para que un seguimiento que cite/mencione funcione. ⛔ Se eliminan los textos "No tengo identificado ese archivo…" y la inyección de la cadena fantasma `"adjunto recibido"`.
- Subida a Drive por reacción 👍 se conserva (feature `drive`).

---

## 7. Datos y estado

1. **Migraciones versionadas** (`schema_migrations`), una carpeta por feature; runner idempotente; **backup automático del `.db` antes de migrar**.
2. **Repositorios por feature**; `db.js` se disuelve. Un repo solo toca sus tablas. Tablas compartidas (`users`, `chat_history`→`conversation`) con repo propio y API pequeña.
3. **Unificar** `bot_personality_state` + `bot_personality_states` → una sola tabla por chat (`persona_state`), con migración de datos y test. Revisar `bot_social_events` vs `proactive_logs` vs `lore_events` por solapamiento (decisión del maestro con evidencia; DROP requiere cliente).
4. Envolver `sqlite3` en un `Db` con API **promesa** (+ transacciones). *(ADR-002 opcional: evaluar `better-sqlite3`; no bloqueante. Por detrás del puerto, el cambio es local.)*
5. **`TtlStore`** reemplaza los 32 `Map/Set` globales: namespaces (`session:download`, `attachment`, `cooldown`, `coalesce`, …), TTL obligatorio, tope de tamaño, métricas de ocupación. Opcionalmente persistente (tabla `kv_ttl`) para sesiones largas (blackjack, cooperacha activa) que hoy mueren con un restart.
6. Regla lint/CI: **prohibido `new Map()` / `new Set()` a nivel de módulo** fuera de `platform/ttlStore.js` y constantes inmutables (`Object.freeze`).

---

## 8. Capa de IA

### 8.1 Un solo puerto `LLM`
`adapters/ai/`: `gemini.js`, `groq.js`, `keyPool.js` (rotación `GEMINI_API_KEY(S|_2|_3)` ya existente, con enfriamiento por clave y por 429), `failures.js` (extrae `aiFailure.js`), `promptKit.js` (construcción de prompts: persona, historial, adjuntos "no confiables").
Estrategia de proveedor: primario → respaldo con **circuit breaker** (N fallas → abrir 60 s) y presupuesto de latencia por tarea.

### 8.2 Un solo puente de herramientas
`pipeline/router` + `adapters/ai/toolBridge.js` **generan** las declaraciones de tools Gemini a partir de `manifest.intents/commands`. Se **eliminan** `agent.js`, `agentEngine.js` y la declaración manual de `toolRegistry.js`; su lógica útil (bucle de tool-turns `MAX_TOOL_TURNS`, lectura de adjuntos inline PDF/imagen, sanitización) se porta a `toolBridge` y a la feature correspondiente. El LLM **solo propone**; ejecutar pasa por Executor con `access` real del remitente.

### 8.3 Taxonomía de fallas → mensaje al usuario (extender `aiFailure.js`/`operationFeedback.js`)
`quota` · `auth_key` · `timeout` · `safety_block` · `bad_output` · `unsupported_media` · `too_large` · `network` · `unknown`.
Cada una mapea a `{mensaje_usuario, siguiente_paso, reintentable}`. Test de contrato: **ningún** error crudo/stack llega al usuario.

### 8.4 Presupuestos y contexto
Tokens por tarea (§6.2). Historial en prompt: ventana por **hilo** + resumen corto rodante opcional. Adjuntos y texto de usuario entran siempre marcados "no confiable" (ya existe el patrón `contenido_adjunto_no_confiable`; **generalizar** y añadir test de *prompt injection* simple).

---

## 9. Seguridad

1. **Autorización declarativa** (`manifest.access` + `policies/access.policy.js`): `public < member < admin < owner`. Se eliminan los `if (cmd === …)` dispersos del dispatcher y todo `.includes(id)` sobre JIDs; **normalizar y comparar igualdad exacta**. Test: JID de grupo que contiene el número del admin como subcadena **no** concede acceso.
2. **Shell:** `Shell.run(profile, cmd)` con perfiles. La tool `ejecutar_terminal` queda **desactivada por defecto** (`FEATURE_ADMIN_TERMINAL=false`); si se activa: solo `owner`, sin `sudo`, timeout duro, log de auditoría (quién/qué/cuándo/exit code), y **confirmación en dos pasos** para patrones destructivos (`rm`, `dd`, `mkfs`, `shutdown`, `reboot`, redirecciones a `/etc`…). Usuario/uid destino **configurable** (hoy hardcode `petrov:1002`).
3. **Webhook:** verificar secreto compartido/`apikey` de Evolution (header), bind a interfaz configurada, límite de body realista (hoy 50 MB globales), rate-limit por IP.
4. **Secretos:** `config/schema.js` es el único lector de `process.env`; el logger enmascara automáticamente valores de claves sensibles (portar `getSecretsToSanitize`).
5. **Contenido adulto / packs (`pack`, descargas adultas, `imageCensor`, Mercado Negro):** moverlos a una feature aislada `adult-media` con flag `FEATURE_ADULT_MEDIA` y **solo en grupos explícitamente habilitados** (`allow_adult` en settings). Motivo arquitectónico y de riesgo: cuentas de WhatsApp vía Evolution/Baileys se banean por contenido reportado, y en grupos puede haber menores. Decisión de producto final es del cliente; el plano solo exige que sea **desactivable sin tocar código**.
6. **Dependencias:** `npm audit` en CI (no bloqueante en fase 1, bloqueante antes del cutover para severidad alta).

---

## 10. Observabilidad y operación

- **Traza de decisión** por evento (`correlationId`): `{event, addressing:{respond,reason}, decision:{kind,feature,via}, latencyMs, outcome}` en logs JSON estructurados. Esto convierte "¿por qué contestó?" en un `grep`.
- Tabla `command_usage(feature, command, chat_type, ts, ok, latency_ms)` → **base objetiva para decidir DROP** (§13).
- `/status` ampliado: cola, ocupación de `TtlStore`, estado de proveedores IA (circuit breaker), RAM, versión (git sha), flags activos.
- `README.md` real + `docs/runbook.md` (despliegue PM2/Docker, rollback, rotación de claves — ya existe `docs/key_rotation.md`, conservar/enlazar, backup/restore de DB).
- `.env.example` **completo y generado/validado** desde `config/schema.js` (test que falla si una env usada no está documentada).
- Unificar despliegue: `ecosystem.config.js` sin rutas hardcodeadas (usar `cwd` relativo / `process.env`), Dockerfile con usuario no-root y `HEALTHCHECK`.

---

## 11. Estrategia de pruebas

Pirámide: **unit** (políticas puras, parser, composer) → **contract** (cada adapter cumple su port; fakes in-memory de `Messenger`/`LLM`/`Clock`) → **scenario** (webhook fixture entra → verifica mensajes salientes y efectos).

- Mantener `node --test`. Fixtures de webhooks reales **anonimizados** en `tests/fixtures/webhooks/` (capturarlos en Fase 0 desde logs del VPS: texto, mención, cita al bot, cita a humano, imagen sola, audio, PDF, reacción, poll, grupo vs privado).
- **Clock inyectable** y `Messenger` fake: prohibido `setTimeout` reales en tests.
- Cobertura mínima de `pipeline/` y `policies/`: **≥ 90 % líneas**; `features/`: ≥ 70 %.
- Test de arquitectura (dependency-cruiser o script propio): falla si `features/*` importa `adapters/*`, si hay ciclos, o si hay `Map` global.

### Escenarios obligatorios (nombre de archivo = ID)
| ID | Escenario | Resultado esperado |
|---|---|---|
| S01 | Grupo: charla humana sin mención | **Sin respuesta**; sí suma XP e historial |
| S02 | Grupo: "ese bot de música no sirve" | Sin respuesta (ya no dispara `bot` genérica) |
| S03 | Grupo: `@botsky dime la hora` | Responde |
| S04a | Grupo: cita un mensaje real del bot | Responde |
| S04b | Grupo: cita a un humano cuyo texto empieza igual que una respuesta previa del bot | **No** responde |
| S05 | Grupo: "oye Juan ¿me pasas un pack de exámenes?" | Sin flujo de packs, sin descuento de XP |
| S06 | Grupo: "¿a qué hora es la hora feliz?" sin dirigirse al bot | Sin respuesta |
| S07a | Grupo: tras búsqueda del bot, usuario escribe "2" sin citar | No dispara descarga |
| S07b | Igual pero citando el mensaje de resultados | Descarga la opción 2 |
| S08 | Privado: imagen sola | 👀 + sugerencia corta con ≤3 acciones; "sticker" posterior usa esa imagen |
| S09 | Grupo: imagen sola | Silencio; adjunto queda disponible 10 min para cita/mención |
| S10 | "estado del servidor" | ≤ 6 líneas; con "detallado" entrega completo |
| S11 | Cuota IA agotada | Mensaje con siguiente paso, sin stack ni prefijos de terminal |
| S12 | 3 mensajes en <2 s del mismo usuario | Un solo despacho (coalescer) |
| S13 | Eco de mensaje propio por webhook | No duplica historial |
| S14 | No-admin pide comando admin (directo y vía LLM tool) | Rechazo cortés; nada ejecutado |
| S15 | Proactivo: grupo sin opt-in / fuera de horario / sobre cuota | Nada se envía |
| S16 | JID de grupo que contiene número admin como substring | Sin privilegios |
| S17 | Texto con instrucción inyectada dentro de un adjunto | No altera permisos ni herramientas |
| S18 | Restart del proceso con sesión de blackjack/cooperacha activa | Estado recuperado (si feature marcada `persistent`) |

---

## 12. Plan de ejecución por fases

Cada fase: **entregables → gates (verificables por comando) → informe**. El maestro NO avanza sin gates verdes.

### Fase 0 — Línea base y red de seguridad *(sin tocar `src/` legacy)*
- `git tag v1-legacy`; rama `refactor/v2`.
- En el entorno del maestro: `npm ci && npm test` → registrar **baseline real** (pass/fail/skipped) en `docs/refactor/baseline.md`. Los fallos reales previos se listan, no se "arreglan" aquí.
- Capturar y anonimizar fixtures de webhook (§11).
- **Inventario de comportamiento:** por cada archivo en `test/` anotar qué comportamiento protege → `docs/refactor/test-traceability.md` (columna "destino v2").
- **Telemetría mínima en v1** (único cambio permitido en legacy): contador `command_usage` en `dispatch()` para decidir DROP con datos. Dejar correr lo que el cliente tolere (≥ 7 días ideal; si no, seguir con lo demás y decidir DROP en Fase 6).
- ADRs 001 (JSDoc/checkJs) y 002 (sqlite) en `docs/adr/`.
- **Gate 0:** baseline documentado; fixtures ≥ 12 tipos; traceability sin filas vacías.

### Fase 1 — Cimientos (`src/v2/config`, `platform`, `domain`)
- `config/schema.js`: **todas** las env (48 detectadas; las 21 faltantes de §1) con tipo, default, descripción; falla al arrancar con mensaje claro; genera `.env.example`.
- `platform/`: logger JSON + enmascarado, `TtlStore`, `queue` (portar `core/queue.js`: tiers light/heavy, `MAX_QUEUE_*`), `scheduler` (portar), `clock`, `metrics`, `crypto` (portar `utils/crypto.js` con compat de tokens previos), `maintenance` (fusiona `utils/cleanup.js` + `services/cleanup.js`).
- Tooling: `tsc --noEmit` (checkJs), eslint (regla de Map global), dependency-cruiser (capas), script `npm run verify` que corre todo.
- **Gate 1:** `npm run verify` verde; tests unit de TtlStore/queue/scheduler/config ≥ 90 %; `.env.example` generado == usado.

### Fase 2 — Puertos y adaptadores
- `adapters/evolution/`: dividir `evolution.js` (804 l) en `client`, `outbound` (+`echoGuard`), `media` (`downloadMedia`, base64, detectMediaType), `groups`, `nativeTables` (mover `integrations/` + script de parcheo con su test). Mantener firmas observables; añadir contract tests con servidor HTTP falso.
- `adapters/store/`: `Db` promesa + runner de migraciones + **migración 000 = esquema actual** (importar tal cual de `db.js`) + repos mínimos compartidos (`users`, `conversation`).
- `adapters/ai/`: dividir `ai.js`, `aiConfig.js`, `aiFailure.js`, `generationSettings.js`, `conversationStyle.js`; `keyPool` con tests de rotación/enfriamiento; circuit breaker.
- **Gate 2:** contract tests de los 3 adaptadores verdes con fakes; cero `require` cruzados entre adaptadores; legacy suite sigue verde.

### Fase 3 — Pipeline núcleo + políticas *(la fase crítica; REVISIÓN DEL ARQUITECTO aquí)*
- Implementar etapas ①–⑧ (§5) y las 5 políticas (§6) como funciones puras.
- `features/` mínimas para probar el pipeline: `help` (auto-generada), `system-info`.
- **Modo sombra:** el webhook v1 llama además a `pipelineV2.decideOnly(event)` con `NullMessenger`; guarda `{v1_decision, v2_decision}` en `shadow_diffs`. Flag `PIPELINE_MODE=legacy|shadow|canary|v2`.
- Escenarios S01–S09, S12–S16 verdes con fakes.
- **Gate 3:** cobertura `pipeline/`+`policies/` ≥ 90 %; escenarios listados verdes; **24 h de sombra** sin excepciones no capturadas; reporte de diffs (§15) resumido por categoría (v2 responde menos = esperado; v2 responde donde v1 no = revisar).

### Fase 4 — Migración de features por olas (paralelizable por albañil)
Para cada feature: crear `manifest` + `handler` + `repo`, **portar la lógica probada**, portar sus tests a `tests/`, marcar su fila en `traceability.md`, y activarla en v2 con su flag. Orden:

| Ola | Features (de `src/commands` y servicios asociados) | Riesgo |
|---|---|---|
| A | `help`, `system-info` (info/estado), `qr`, `ocr`, `sticker`+`efectos`+`imageCensor`+`thumbnailCollage`, `convertir`+`documentos`+`contentReader`, `transcripcion` (`transcribir`+`whisper`+`audioDuration`), `voice` (`voz`+`tts`+`elevenlabs`+`voiceScript`) | Bajo (casi sin estado) |
| B | `reminders`, `notes`, `tasks`+`school`(+datos a JSON), `polls`(`encuesta`), `drive`+`buscar`, `media-download` (`descargar`+`mediaSearch`; resolver ciclo de sesiones con `TtlStore`), `messaging` (`mensaje`+`enviarmedia`+`difusion`+`outboundDelivery`; romper ciclo) | Medio (estado, I/O externo) |
| C | `economy` (`niveles`, `daily`, XP), `games` (`ruleta`, `blackjack`, `nuclear`), `community` (`cooperacha`+`cooperachaImages`, `happyHour`+airdrop, `afinidad`, `lore`, `doxeo`, `rikolino*` — leer `docs/rikolino.md` antes), `adult-media` (`pack`+`packImages`; romper ciclo con happyHour vía evento), `proactive` (reescrito con §6.3) | Alto (economía, estado, juegos) |
| D | `minecraft` (`maicra`+`minecraftRemote` 1148 l: dividir en `client`/`telemetry`/`mods`/`lifecycle`), `admin-system` (`sistema`, `cambiarTV`, `terminal` con §9.2), `moderation` | Alto (infra, privilegios) |

- Cada ola termina con: tests portados verdes, **canario** en el chat privado del cliente, luego 1 grupo pequeño.
- **Gate 4 (por ola):** traceability de la ola completa; escenarios de la ola verdes; sin imports a `src/` legacy desde `src/v2/features/**` (excepto durante transición vía *adapter shims* listados y con fecha de retiro).

### Fase 5 — Unificación de IA y limpieza de duplicados
- Reemplazar `agent.js`/`agentEngine.js`/`toolRegistry.js` por `toolBridge` generado de manifests (§8.2). Portar sus tests (`agent*.test.js`, `toolRegistryRobustness.test.js`, `ai*.test.js`).
- Unificar tablas de persona (§7.3). Resolver `USE_TOOL_REGISTRY` (eliminar).
- **Gate 5:** una sola ruta de tool-calling; S11, S14, S17 verdes; `grep -r "services/agent"` vacío en v2.

### Fase 6 — Cutover, auditoría de obsolescencia y retiro de v1
- **Auditoría de obsolescencia** (`docs/refactor/obsolescence-report.md`): por cada feature/comando/archivo → `KEEP | PORTED | MERGED | DROP-CANDIDATE` con evidencia (`command_usage`, tests, referencias). **El cliente aprueba cada DROP** antes de borrar.
- `PIPELINE_MODE`: `canary`(todos los privados) → `canary`(grupos uno a uno) → `v2`. Soak de 72 h por escalón. Rollback = cambiar flag + reiniciar.
- Retirar v1: `git mv src/v2/* src/`, borrar legacy, actualizar `ecosystem.config.js`/Dockerfile/`package.json` (`name:"botsky"`, `engines>=20`, `main`).
- README, `docs/ARCHITECTURE.md` (este plano condensado y actualizado), runbook, `AUDITORIA_*` archivado en `docs/archive/`.
- **Gate 6 (Definition of Done §17).**

---

## 13. Mapa de migración (legacy → v2)

| Legacy | Destino v2 | Acción |
|---|---|---|
| `core/server.js` | `adapters/evolution/webhook.js` + `main.js` | Reescribir (sin efectos al importar) |
| `core/message_normalizer.js`, `utils/whatsappText.js`, `utils/messageText.js` | `pipeline/normalize.js` | Portar + tests |
| `core/coalescer.js` | `pipeline/ingest.js` (debounce con `TtlStore`+`Clock`) | Portar |
| `core/parser.js` | `pipeline/router.js` (paso explícito) | Portar |
| `core/auth.js` | `policies/access.policy.js` | Reescribir (igualdad exacta) |
| `core/queue.js`, `services/scheduler.js` | `platform/queue.js`, `platform/scheduler.js` | Portar |
| `core/commandRegistry.js` | generado desde manifests | **Eliminar** |
| `core/dispatcher.js` | `pipeline/*` + `policies/*` | **Reescribir**; extraer `applyAiArgsToParsed`, `isAdultIntent`, límites a features/router |
| `services/evolution.js` | `adapters/evolution/*` | Dividir |
| `services/ai.js`, `aiConfig`, `aiFailure`, `generationSettings`, `conversationStyle` | `adapters/ai/*`, `policies/response.policy.js` | Dividir/portar |
| `services/agent.js`, `agentEngine.js`, `toolRegistry.js`, `semanticRouting.js`, `attachmentContext.js` | `adapters/ai/toolBridge.js`, `pipeline/router.js`, `policies/attachment.policy.js` | **Fusionar** |
| `services/db.js` | `adapters/store/*` + repos por feature | **Disolver** |
| `services/history.js` | `features/conversation` + repo | Portar (historial por hilo) |
| `services/proactive.js` | `features/community` + `policies/proactive.policy.js` | Reescribir |
| `services/logger.js`, `utils/crypto.js`, `utils/cleanup.js`+`services/cleanup.js` | `platform/*` | Portar/fusionar |
| `services/terminal.js` | `adapters/system/shell.js` | Portar con perfiles |
| `services/minecraftRemote.js`, `commands/maicra.js` | `features/minecraft/*` | Dividir |
| `commands/*` (40) | `features/*` según Ola A–D | Portar |
| `data/ai_config.json` | `data/persona.json` + `config` | Separar persona de parámetros |
| `school_schedule_data.js` | `data/school_schedule.json` | Código → dato |
| `auth-drive.js`, `scripts/*`, `src/scripts/*` | `scripts/` único | Reubicar |
| `integrations/evolution-native-tables/`, `scripts/patch-evolution-native-tables.cjs` | `adapters/evolution/nativeTables` + `integrations/` | Conservar (1 test) |
| `docs/*.md` (9) | `docs/` (revisar vigencia por feature) | Conservar/actualizar; los de feature pasan a `features/<x>/README.md` |

**Candidatos a obsoletos ya detectados** (el cliente decide; no borrar sin su OK): env `USE_TOOL_REGISTRY`; tabla duplicada de persona; `descargar.js` "Legacy array API" y "legacy provider"; "legacy caption formatter" en `whatsappText.js`; wrappers defensivos del dispatcher; `agent.js` (si `agentEngine`+`toolBridge` cubren todo); `PUBLIC_ATTACHMENT`/rutas duplicadas de adjuntos tras la fusión.

---

## 14. Cómo delegar a los albañiles

**Plantilla de orden de trabajo (WO)** — una por albañil, archivo `docs/refactor/wo/WO-XXX.md`:
```
WO-ID / Fase / Feature:
Objetivo (1 frase):
Archivos que PUEDE crear/editar:      (lista cerrada)
Archivos que NO puede tocar:          (todo lo demás, en especial main.js y manifests ajenos)
Insumos (rutas legacy a portar, tests a portar, fixtures):
Contratos a respetar:                 (§4.2, §5, política §6.x aplicable)
Criterios de aceptación (comandos):   npm test -- <archivo>; npm run verify
Escenarios que deben pasar:           (IDs §11)
Entregable de salida:                 diff + resumen ≤10 líneas + filas de traceability actualizadas
```
**Reglas de paralelización:** WOs con **archivos disjuntos** corren en paralelo (p. ej. dentro de la Ola A cada feature es independiente). Los WOs que tocan `main.js`, `pipeline/index.js` o `config/schema.js` son **seriales** y solo los integra el maestro. Un albañil por feature; revisor distinto del autor para Olas C y D.
**Verificación del maestro por WO:** corre `npm run verify`, revisa que no haya imports prohibidos, que los tests portados cubren la fila de traceability, y prueba el flujo con fixtures. Rechaza WOs que "mejoren" fuera de alcance.

---

## 15. Reporte al arquitecto y derechos de decisión

El presupuesto de interacción del cliente con el arquitecto es mínimo. Diseño para **autonomía del maestro**:

| Decisión | Quién |
|---|---|
| Nombres de archivos/funciones, estructura interna de una feature, librerías de utilidades pequeñas, orden dentro de una ola | **Maestro** (documentar en commit) |
| Cambiar capas/puertos/reglas de §3-§5, añadir dependencia pesada, cambiar de DB, tocar políticas §6 | **ADR + aprobación del cliente** (arquitecto solo si el cliente lo pide) |
| DROP de cualquier función, cambio de producto (tono, cuotas, defaults de §6) | **Cliente** |
| Conflicto entre un test legacy y una política §6 | Prevalece §6; documentar en traceability como "cambio intencional" |
| Duda técnica no cubierta aquí | Decidir lo **más simple y reversible**, registrar ADR corto |

**Una única revisión del arquitecto (recomendada tras la Fase 3).** El cliente pegará **un solo mensaje** con este "paquete de revisión" (compacto, ≤ ~400 líneas en total; el maestro debe generarlo):
1. `docs/refactor/PROGRESS.md` (tabla de fases/gates, 1 línea por WO).
2. Salida de `npm run verify` y resumen de `npm test` (totales y fallos).
3. Salida del chequeo de capas (dependency-cruiser) y lista de shims transitorios con fecha de retiro.
4. Resumen de `shadow_diffs` por categoría (conteos + 5 ejemplos de cada categoría "v2 responde donde v1 no").
5. Árbol `src/v2/` (2 niveles) + `pipeline/index.js`, `policies/addressing.policy.js`, `policies/access.policy.js` completos.
6. Lista de decisiones tomadas por el maestro que se desvíen de este plano (ADRs).

**Formato de informe de fase (maestro → cliente):** `Fase N: estado · gates (✅/❌ con comando) · cambios de comportamiento vs plano · riesgos abiertos · siguiente paso · decisiones que necesita del cliente`.

---

## 16. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Regresión de bugs ya corregidos | Traceability obligatoria; legacy suite verde hasta el retiro; modo sombra |
| Fases largas con v1 intacto = divergencia | v1 en **congelación de features** durante la obra (solo hotfixes críticos, que se portan a v2 el mismo día) |
| Pérdida/corrupción de datos SQLite | Backup automático antes de migrar; migraciones aditivas; prueba de restore en Fase 2 |
| Baneo de la cuenta de WhatsApp (Baileys/Evolution) | Cuotas proactivas (§6.3), `adult-media` aislado y desactivable (§9.5), sin ráfagas de envío (`outbound` con jitter y límite por chat) |
| Reintroducir sobre-activación | Escenarios S01–S07 como gate permanente en CI |
| Sobre-ingeniería | Prohibido añadir capas/abstracciones no listadas; "una abstracción necesita ≥2 usos reales" |
| Costos de IA | Presupuestos por tarea (§6.2), caché de ruteo para comandos explícitos (cero llamadas LLM en el paso 1-3 del router) |
| Agente delegado se sale de alcance | WOs con lista cerrada de archivos (§14); verificación del maestro |

---

## 17. Definition of Done global

- [ ] `npm run verify` (tipos, lint, capas, tests) verde; `npm audit` sin severidad alta.
- [ ] Escenarios S01–S18 verdes en CI; cobertura `pipeline/`+`policies/` ≥ 90 %.
- [ ] `traceability.md` completo: **ningún** test legacy sin destino o justificación.
- [ ] 0 `Map/Set` globales fuera de `TtlStore`; 0 ciclos; 0 imports de features a adapters.
- [ ] Un solo registro de capacidades (manifests) alimenta comandos, tools de IA y `/ayuda`.
- [ ] Una sola ruta de tool-calling; terminal admin desactivada por defecto o endurecida (§9.2).
- [ ] `.env.example` completo y validado; sin rutas/usuarios hardcodeados.
- [ ] Traza de decisión en logs; `command_usage` poblada; `/status` ampliado.
- [ ] README + `ARCHITECTURE.md` + runbook; rollback documentado y **probado una vez**.
- [ ] Soak ≥ 72 h en v2 sin incidentes; cliente firma la aceptación; legacy eliminado y tag `v2.0.0`.

---

### Anexo A — Referencias exactas del análisis (para verificar)
- Activación: `src/core/message_normalizer.js:282`; `src/core/server.js:147-152`; `src/core/dispatcher.js:538-544` (cita por substring de 30 chars), `:587-591` (palabra `bot`), `:611` y `:647` (`|| !hasExplicitPrefix`), `:620-625` (pack con mención opcional).
- Permisos por substring: `src/core/dispatcher.js:~969-985` (gate Minecraft). Terminal ya gateada por `isAdmin` en `src/services/toolRegistry.js:332,480-492`.
- Persona duplicada: `src/services/db.js:155`, `:204`, `:1131`, `:1150`.
- Hardcodes: `ecosystem.config.js` (`cwd`, logs), `src/services/terminal.js:11-13`, `.env.example` (`BACKUPS`).
- Documentos fuente de requisitos de producto: `docs/AUDITORIA_UX_ARQUITECTURA.md` (R1/R2/R3), `docs/tono-botsky.md`, `docs/audio-contextual.md`, `docs/envios-multimedia.md`, `docs/tablas-nativas.md`.

### Anexo B — Checklist de arranque inmediato para el maestro
1. Leer este plano completo + `docs/AUDITORIA_UX_ARQUITECTURA.md`.
2. `git tag v1-legacy && git switch -c refactor/v2`.
3. Ejecutar Fase 0 completa y reportar baseline al cliente.
4. Crear `docs/refactor/PROGRESS.md` y empezar a llenarlo desde el día 1 (alimenta el paquete de revisión §15).
5. Lanzar WOs de Fase 1 (config, platform, tooling) en paralelo; integrar y pasar Gate 1.
