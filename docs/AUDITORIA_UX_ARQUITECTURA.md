# AUDITORÍA DE EXPERIENCIA DE USUARIO (UX), ACTIVACIÓN Y DISEÑO DE ARQUITECTURA MODULAR LIMPIA — BOTSKY

**Documento Técnico Oficial:** Auditoría Integral de Arquitectura, Experiencia de Usuario y Especificación de Sistema Objetivo  
**Autor:** Equipo de Arquitectura de Software y Liderazgo de Documentación Técnica (`worker_doc_1`)  
**Fecha:** 2026-10-12  
**Proyecto:** Botsky (Bot de WhatsApp sobre Evolution API / Node.js)  
**Directorio Base:** `/home/petrov/botsky`  
**Modo de Integridad:** Zero Code Modification (Auditoría Técnica, Diagnóstico Formal y Diseño Arquitectónico)  

---

## 1. Resumen Ejecutivo y Diagnóstico Global

### 1.1. Contexto y Evolución del Sistema
Botsky es un bot interactivo de mensajería para WhatsApp desplegado en un servidor VPS, integrado mediante Evolution API y potenciado con modelos de lenguaje masivos (LLMs: Google Gemini y Groq/Llama), herramientas de automatización multimedia (FFmpeg, yt-dlp, Tesseract OCR), administración remota de servidores de juegos (Minecraft Bedrock) y dinámicas comunitarias de gamificación económica (puntos de experiencia XP, Cooperacha grupal, Mercado Negro de packs y Hora Feliz con AirDrop Express).

El sistema ha experimentado sucesivos ciclos de expansión acelerada. Cada requerimiento funcional fue resuelto mediante la inserción de **parches heurísticos ad-hoc** directamente sobre el despachador central (`src/core/dispatcher.js`), el servidor Express (`src/core/server.js`) y el normalizador de mensajes (`src/core/message_normalizer.js`). 

### 1.2. Diagnóstico Sistémico: Acumulación Crítica de Deuda Técnica
La acumulación de soluciones de corto plazo ("quick fixes") ha derivado en una crisis estructural caracterizada por cuatro patologías dominantes:

1. **Activación Involuntaria e Inundación de Spam (Falla R1):**  
   El bot interviene continuamente en conversaciones casuales entre humanos dentro de grupos de WhatsApp. La condición de filtrado perimetral en el webhook (`norm.shouldDispatch`) es una falacia lógica que evalúa como verdadera para cualquier mensaje con texto. Para compensar esto, se delegó el criterio de intervención en heurísticas frágiles (búsqueda de la palabra *"bot"* en cualquier contexto o coincidencia de 30 caracteres en réplicas) y en un clasificador semántico basado en LLM. Cuando el LLM decide ignorar el mensaje, un mecanismo secundario de "ráfaga" dispara intervenciones no solicitadas para emitir chistes forzados. Asimismo, múltiples temporizadores autónomos (`setInterval`) publican multimedia pesada periódicamente (cada 4 minutos durante la Hora Feliz) y envían mensajes de acoso por chat privado.

2. **Verbosidad Extrema, Fricción y Fatiga de Lectura (Falla R2):**  
   Las respuestas de texto violan sistemáticamente los estándares de ergonomía móvil y micro-copy de WhatsApp. El sistema tiene configurados techos de generación de 1,200 tokens para respuestas normales y hasta 8,192 tokens ante archivos o enlaces, acompañado de instrucciones de prompting que prohíben explícitamente resumir o recortar información. Una consulta elemental sobre el estado de un servidor provoca un volcado monolítico de 20 variables técnicas de telemetría. Además, el manejo de errores abusa de callejones sin salida enlatados (*"Intenta de nuevo en un momento"*) y prefijos crípticos de terminal UNIX (`[!] error al ejecutar: ...`, `> ❌ ...`), mientras que el intento de frenar muletillas mediante *negative prompting* acentúa la repetición o genera un tono robótico desfigurado.

3. **Incapacidad y Ruptura ante Multimedia Ambigua (Falla R3):**  
   Frente al caso de uso cotidiano en el que un usuario envía una imagen solitaria sin texto de acompañamiento, el sistema colapsa de forma asimétrica: en grupos de WhatsApp se descarta en silencio total sin feedback ni reacción; en chats privados, el parser inyecta artificialmente la cadena `"adjunto recibido"`, anula el identificador del adjunto activo (`activeId = null`), consulta al LLM a ciegas y termina respondiendo con cinismo: *"No tengo identificado ese archivo. Cítalo o adjúntalo para usar el correcto"*, o exige comandos de consola rígidos (`/@ sticker`, responder con `leer`).

4. **Monolito Ingobernable y Estado Fragmentado (Falla Estructural):**  
   El archivo `src/core/dispatcher.js` sobrepasa las 1,073 líneas de código, aglomerando autenticación, parsing, regexes dispersas, enrutamiento semántico, lógica de negocio económica, doxeos ficticios y manejo de excepciones en un único bloque de control desbordado. El estado conversacional se halla disperso en múltiples `Map` volátiles en memoria sin sincronización ni TTL formal.

### 1.3. Alcance y Compromiso de Integridad
La presente auditoría se rige bajo la restricción estricta de **Zero Code Modification**: ningún archivo ejecutable en `src/` o `test/` ha sido modificado. Este documento constituye el análisis forense exhaustivo con citas directas de código, la matriz comparativa de compensación de ingeniería y la propuesta formal de la nueva **Arquitectura Modular Limpia (Clean Modular Architecture)** de 4 capas desacopladas, diseñada bajo el principio: *"Arquitectura Sí, Parches No"*.

---

## 2. Diagnóstico R1: Auditoría Técnica de Activación y Control de Spam (Con Evidencias en Código)

### 2.1. La Falacia Perimetral de `norm.shouldDispatch`
El punto de entrada del bot es el webhook HTTP expuesto en `src/core/server.js:77`, el cual recibe eventos de Baileys a través de Evolution API. La arquitectura pretendía que los mensajes no dirigidos al bot fueran filtrados en la capa del servidor antes de entrar a la cola y al despachador. Sin embargo, el código contiene una contradicción lógica insalvable:

- **Ubicación:** `src/core/message_normalizer.js:282`
```javascript
282: const shouldDispatch = Boolean(text.trim() || (!isGroup && MEDIA_TYPES.includes(messageType)));
```

- **Ubicación de Ingesta:** `src/core/server.js:147-152`
```javascript
147: // Si no califica como comando (ej: plática informal en grupo)
148: if (!norm.shouldDispatch) {
149:     if (norm.isGroup && norm.text) {
150:         history.addMessage(from, 'user', norm.text, norm.pushName);
151:     }
152:     return;
153: }
```

**Análisis Forense:**  
El comentario en `server.js:147` afirma que allí se descarta la *"plática informal en grupo"*. No obstante, la condición en `message_normalizer.js:282` evalúa `shouldDispatch = Boolean(text.trim() || ...)`. Si un mensaje enviado a un grupo de 100 personas contiene una sola letra o emoji de texto, `text.trim()` evalúa a un valor *truthy*, haciendo que `shouldDispatch` sea incondicionalmente `true`.  
Como consecuencia directa, **el 100% de los mensajes de texto enviados en cualquier grupo atraviesan el filtro del servidor sin oposición**, son encolados en el coalescer (`src/core/coalescer.js:102`) y alcanzan el despachador central (`src/core/dispatcher.js:456`).

---

### 2.2. Aislamiento Contextual Defectuoso entre Grupos y Chats 1:1

#### A. Colisión Heurística en Detección de Respuestas a Botsky (`isQuotingBotsky`)
- **Ubicación:** `src/core/dispatcher.js:538-544`
```javascript
538: const isQuotingBotsky = Boolean(
539:     (quotedParticipant && botNumber && quotedParticipant.includes(botNumber)) ||
540:     (quotedText && chatHistory.some(m => m.role === 'assistant' && (
541:         (m.content && m.content.includes(quotedText.slice(0, 30))) ||
542:         (quotedText && quotedText.includes((m.content || '').slice(0, 30)))
543:     )))
544: );
```
**Mecanismo de Falso Positivo:**  
Para determinar si un usuario está respondiendo a un mensaje emitido por el bot, el sistema no verifica de forma estricta el identificador del mensaje citado (`stanzaId` o `quotedParticipant === BOT_JID`). En su lugar, recurre a una comprobación de subcadenas de **apenas 30 caracteres** contra las últimas intervenciones del asistente almacenadas en `chatHistory`.  
Si un usuario humano cita a otro compañero del grupo que compartió un enlace web, un saludo convencional, un aviso corto o una frase que coincida en 30 caracteres con cualquier respuesta previa del bot (o si el bot emitió previamente un mensaje genérico corto), `isQuotingBotsky` evalúa a `true`. Esto fuerza la bandera `isDirectlyAddressedInGroup = true` y prefija en el prompt del LLM la frase: `"(respondiendo directamente a un mensaje previo de Botsky: ...)"`, engañando al modelo para que responda a una interacción entre terceros.

#### B. Detección Naive por Palabra Clave (`isDirectlyAddressedInGroup`)
- **Ubicación:** `src/core/dispatcher.js:587-591` (específicamente línea 590)
```javascript
587: const isDirectlyAddressedInGroup = isMentioned ||
588:     isQuotingBotsky ||
589:     hasExplicitPrefix ||
590:     /\b(?:botsky|bot|botsito)\b/i.test(parsed.raw || '') ||
591:     Boolean(activeSession && matchSelection(parsed.raw));
```
**Impacto en Conversaciones Humanas:**  
1. **Línea 590:** La expresión regular `/\b(?:botsky|bot|botsito)\b/i` captura la palabra genérica `"bot"`. Cualquier interacción entre usuarios sobre tecnología, videojuegos o plataformas (ejemplo: *"ese bot de música no reproduce nada"*, *"juegas como bot"*, *"odio los bots de spam"*) activa inmediatamente la atención del sistema como si hubiera sido llamado de manera explícita.
2. **Línea 591:** Si un usuario inició una búsqueda interactiva de videos o música (`activeSession`) en los 15 minutos previos, cualquier mensaje posterior de ese usuario en el grupo que contenga un número simple (ej: `"1"`, `"el 2"`, `"#3"`) coincide con `matchSelection(parsed.raw)` y el bot descarga y publica el video automáticamente, asumiendo que el usuario continuaba la selección.

#### C. Mezcla Indiscriminada del Historial de Mensajes en Grupos
- **Ubicación:** `src/services/history.js:59-106`
En los grupos de WhatsApp (`@g.us`), el historial conversacional se almacena en una estructura plana indexada exclusivamente por el `chatId` global del grupo:
```javascript
59: function addMessage(chatId, role, content, name) { ... }
```
El búfer retiene únicamente los últimos 12 mensajes intercambiados en el grupo. Cuando 5 o 6 miembros conversan en paralelo sobre tópicos distintos, sus intervenciones se intercalan cronológicamente. Al inyectar este bloque indiferenciado en el contexto del LLM, el modelo pierde la coherencia de los hilos de conversación y responde a un usuario citando fragmentos de otro interlocutor.

---

### 2.3. Vulneración de Filtros de Grupo por Bypass de Prefijos (`!hasExplicitPrefix`)

Para ofrecer una interacción "más fluida", se introdujeron excepciones en forma de *fast-paths* antes del LLM. Sin embargo, estas excepciones omitieron la comprobación de si el mensaje estaba realmente dirigido a Botsky:

#### A. Fast-Path de Mercado Negro / Packs de XP
- **Ubicación:** `src/core/dispatcher.js:620-625`
```javascript
620: } else if (
621:     // Fast-Path para Mercado Negro / Packs de fotos por XP (R1)
622:     (parsed.raw || '').trim().match(/^(?:(?:oye\s+)?@?(?:botsky|bot|botsito)[,\s]*)?(?:(?:me\s+)?v[eé]nde(?:me|nos|s|r)?|(?:te\s+)?compr(?:ar?|o)|quiero(?:\s+comprar)?|(?:me\s+)?p[aá]sa(?:me|s)?|(?:me\s+)?m[aá]nda(?:me|s)?|(?:me\s+)?r[oó]la(?:me|s)?|dame|(?:me\s+)?das|saca|tira|tienes)\s+(?:(?:un|el|los|unos)\s+)?packs?\b(?:[,\s]+(?:de\s+)?([^.!?\r\n]+?))?[.!?\s]*$/i) ||
623:     (!isGroup && /^(?:(?:(?:un|el|los|unos)\s+)?packs?)\b(?:[,\s]+(?:de\s+)?([^.!?\r\n]+?))?[.!?\s]*$/i.test((parsed.raw || '').trim()))
624: ) {
```
**Falla:** La mención al bot `(?:(?:oye\s+)?@?(?:botsky|bot|botsito)[,\s]*)?` es completamente opcional (cuantificador `?`). Además, no se condiciona a `isDirectlyAddressedInGroup`.  
Si en un grupo de estudiantes un usuario le pide a un compañero: *"oye Juan, ¿me pasas un pack de exámenes?"*, el regex captura la frase, deduce 150 XP de la cuenta de quien habló, despacha de 3 a 5 imágenes eróticas en modo View Once a su chat privado y publica en el grupo:  
`"Sobres @usuario, ya te cayó la mercancía al privado..."`.

#### B. Fast-Path de Hora Feliz: Anulación de Frontera Grupal
- **Ubicación:** `src/core/dispatcher.js:633-648` (específicamente línea 647)
```javascript
647: ) && (isDirectlyAddressedInGroup || !hasExplicitPrefix || !isGroup)
```
**Falla Crítica de Lógica Booleana:**  
Dado que ningún mensaje en lenguaje natural contiene prefijos de comando (`!`, `/`, `#`), la subexpresión `!hasExplicitPrefix` es idénticamente `true` para la totalidad de las frases casuales. Por las leyes del álgebra de Boole:
`(isDirectlyAddressedInGroup || true || !isGroup) === true`.  
La variable `isDirectlyAddressedInGroup` queda completamente inutilizada. En consecuencia, preguntas informales entre miembros como *"¿a qué hora es la hora feliz?"* o *"¿cuándo sueltan el airdrop?"* activan la respuesta ejecutoria del bot.

#### C. Fast-Path de Cooperacha de XP
- **Ubicación:** `src/core/dispatcher.js:597-619` (específicamente línea 611)
```javascript
611: else if (coopStartMatch && (isDirectlyAddressedInGroup || !hasExplicitPrefix)) {
```
Nuevamente, la disyunción `|| !hasExplicitPrefix` anula el requisito de haber mencionado a Botsky, permitiendo que comentarios espontáneos sobre hacer una "vaquita" o "cooperacha" para una fiesta inicien un reto económico formal en el grupo.

---

### 2.4. Enrutador Semántico Probabilístico como Filtro Inadecuado y Alucinaciones
- **Ubicación:** `src/core/dispatcher.js:724-730`
```javascript
724: const routingOutcome = await aiLimiter.run(() => routeWithAIOutcome(parsed.raw || '', userName, isGroup, chatHistory, mediaContext, affinityContext, senderJid, from, routingContext));
725: const aiDecision = routingOutcome.ok ? routingOutcome.decision : null;
726: 
727: if (aiDecision) {
728:     const action = aiDecision.action;
729:     isDirectlyAddressed = aiDecision.addressed_to_bot === true || !isGroup;
730:     if (isGroup && !isDirectlyAddressed) return;
```
**Análisis:**  
Al haber superado el filtro de `norm.shouldDispatch` en el servidor y no coincidir con los fast-paths, **cada mensaje de texto grupal es remitido a la API externa de Gemini o Groq**.  
El prompt de enrutamiento (`src/services/semanticRouting.js:67`) instruye: *"En grupos, addressed_to_bot:true si se dirige a Botsky por sentido/contexto... Si conversan entre personas sin pedirle nada, action:'ignore'"*.  
Debido a la naturaleza probabilística de los LLMs, cuando un usuario plantea una duda al grupo (ej: *"¿alguien sabe a qué hora sale el camión?"* o *"¿dónde dejaron los apuntes?"*), el modelo alucina frecuentemente clasificando `action: "chat"` y `addressed_to_bot: true`. En la línea 729, esto sobreescribe `isDirectlyAddressed = true`, evitando el `return` de la línea 730 y provocando que el bot responda públicamente a un asunto ajeno (`dispatcher.js:832-840`).

---

### 2.5. Disparo Proactivo tras Decisión de Silencio ("Burst Intervention")
- **Ubicación:** `src/core/dispatcher.js:821-830` (específicamente línea 827)
```javascript
821: // Silencio en grupo: Si la IA determina que es una conversación entre usuarios ajena al bot
822: if (['ignore', 'ignorar', 'silencio', 'none', 'skip'].includes(action)) {
823:     logger.info(`[AI-ROUTER] Mensaje ignorado en grupo (charla ajena entre usuarios): "${parsed.raw.slice(0, 60)}"`);
824:     if (mediaContext) mediaContext.base64 = null;
825:     // Si es grupo, evaluar de forma asíncrona si la conversación genera un momentum propicio para remate proactivo
826:     if (isGroup) {
827:         maybeTriggerBurstIntervention(from).catch(() => {});
828:     }
829:     return;
830: }
```
- **Consecuencia en:** `src/services/proactive.js:116-169` (específicamente línea 135)
```javascript
135: const decision = await evaluateProactiveAction({ groupHistory: history, idleMinutes: 0, mode: 'burst' });
```
**Mecanismo de Invasión Conversacional:**  
Esta es una de las anomalías de diseño más graves: **incluso cuando el enrutador determina con acierto que el mensaje es ajeno al bot y debe ser ignorado (`action: 'ignore'`), el sistema no guarda silencio**.  
Por el contrario, la línea 827 invoca inmediatamente `maybeTriggerBurstIntervention(from)`. En `proactive.js:135`, si dos personas han intercambiado al menos 4 mensajes en los últimos 7 minutos, el bot realiza una **segunda consulta al LLM** solicitando:  
`"ESTADO: El grupo está VIVO y cotorreando activamente... TU META: Evaluar si el último intercambio da pie para un REMATE CÓMICO O CARRILLA PESADA 10/10"`.  
Si la IA genera un comentario sarcástico, Botsky simula estado de digitación durante 1.8 segundos y publica un mensaje no solicitado, interrumpiendo abruptamente el diálogo de los usuarios.

---

### 2.6. Inundación de Spam por Temporizadores Periódicos Autónomos

El bot mantiene múltiples bucles de ejecución en segundo plano (`setInterval`) sin mecanismos de silencio ni autorización previa del grupo:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│               INVENTARIO DE TEMPORIZADORES PERIÓDICOS AUTÓNOMOS EN BOTSKY              │
├────────────────────────┬─────────────────────┬───────────────────┬─────────────────────┤
│ Proceso / Módulo       │ Ubicación en Código │ Frecuencia / Loop │ Impacto en UX /     │
│                        │                     │                   │ Comportamiento      │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ Lluvia Periódica       │ src/services/       │ Cada 4 minutos    │ Envía forzadamente  │
│ de Hora Feliz          │ happyHour.js:188    │ fijos             │ 1-2 fotos/videos    │
│                        │                     │ (setInterval)     │ al chat grupal.     │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ Lluvia por Ráfaga      │ src/services/       │ Cada 5 mensajes   │ Despacha multimedia │
│ de Mensajes            │ happyHour.js:342    │ (mínimo 90s)      │ si el chat tiene    │
│                        │                     │                   │ actividad humana.   │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ AirDrop Express        │ src/services/       │ Intervalo aleat.  │ Lanza reto sorpresa;│
│ y Hook Servidor        │ happyHour.js:201    │ Intercepta "yoo"  │ monopoliza mensajes │
│                        │ server.js:126       │ en server.js      │ en server.js.       │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ Heartbeat Proactivo:   │ src/services/       │ Cada 25 minutos   │ Lanza retos de XP   │
│ Reto de Cooperacha     │ proactive.js:326    │ (registerTask)    │ de 48h con fotos    │
│                        │ cooperacha.js:687   │                   │ censuradas al azar. │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ Heartbeat Proactivo:   │ src/services/       │ Cada 25 minutos   │ Si no hay actividad │
│ Intervención por Silencio proactive.js:248   │ (ventana 75-240m) │ diurna, habla solo  │
│                        │                     │                   │ en el grupo.        │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ Acoso en DM Privado    │ src/services/       │ Cada 25 minutos   │ Envía mensajes de   │
│ ("Grudge" / Rencores)  │ proactive.js:285    │ Condición:        │ hostigamiento a DMs │
│                        │                     │ score <= -40      │ de usuarios.        │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ Venganza Inmediata     │ src/core/           │ Inmediato ante    │ Envía IP ficticia   │
│ con Doxeo Ficticio     │ dispatcher.js:781   │ ofensa grupal     │ por privado y aviso │
│                        │                     │ (score <= -50)    │ público amenazante. │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ Tareas Escolares       │ src/services/       │ Cada 10 segundos  │ Digests masivos en  │
│ (School Publisher)     │ school.js:508       │ (ventanas de      │ ventanas fijas de   │
│                        │                     │ 15:00 y 18:00)    │ 15 minutos.         │
├────────────────────────┼─────────────────────┼───────────────────┼─────────────────────┤
│ Notificación de Fallos │ src/core/           │ Ante error de IA  │ Publica en el grupo │
│ Públicos de IA         │ dispatcher.js:942   │ (si hubo palabra  │ "El servicio de IA  │
│                        │                     │ 'bot' en el texto)│ no pudo procesar..."│
└────────────────────────┴─────────────────────┴───────────────────┴─────────────────────┘
```

---

## 3. Diagnóstico R2: Auditoría Técnica de Tono, Verbosidad y Fricción en Respuestas

### 3.1. Presupuestos Desmedidos de Tokens Desalineados de la Experiencia Móvil
La experiencia en WhatsApp exige brevedad y legibilidad instantánea. Sin embargo, la configuración de generación de Botsky asigna techos de longitud propios de la redacción de informes académicos:

- **Modos Conversacionales en:** `src/services/conversationStyle.js:11-19`
```javascript
11: function getResponseMode(userMessage = '', requestedMode = null) {
12:     const modes = {
13:         brief: { name: 'brief', maxOutputTokens: 350, instruction: 'Da lo esencial que pidió, sin omitir datos necesarios.' },
14:         social: { name: 'social', maxOutputTokens: 250, instruction: 'Responde al intercambio social con la extensión que merezca.' },
15:         explanation: { name: 'explanation', maxOutputTokens: 1200, instruction: 'Desarrolla la explicación solicitada y termina cuando quede resuelta.' }
16:     };
17:     return modes[requestedMode] || { name: 'normal', maxOutputTokens: 1200,
18:         instruction: 'Comprende por el sentido si necesita un dato, una réplica, un resumen o una explicación extensa. Respeta la brevedad o detalle que pidió. No impongas un número de frases.' };
19: }
```
- **Explosión de Tokens Multimodal en:** `src/services/ai.js:708-709`
```javascript
708: const profile = hasReadableContent ? 'content' : 'conversation';
709: const tokenBudget = hasReadableContent && mode.name !== 'brief' ? 8192 : mode.maxOutputTokens;
```

**Impacto:**  
1. **Modo Normal:** Asigna por defecto `maxOutputTokens: 1200` (~900 palabras en español).  
2. **Contenido Visual / Documental:** Si el mensaje incluye un archivo o URL analizable (`hasReadableContent === true`), el presupuesto se expande a **8,192 tokens** (~6,000 palabras). El bot asume el comportamiento de un transcriptor exhaustivo en lugar de un asistente móvil conciso.

---

### 3.2. Directivas de Prompting que Penalizan la Concisión
En lugar de instruir síntesis adaptada al formato de chat, las instrucciones del sistema incentivan la longitud desmedida:

- **En:** `src/services/conversationStyle.js:60-61`
```javascript
60: LONGITUD SEGÚN LA PETICIÓN: ${mode.instruction}
61: No alternes tamaños por turnos ni por porcentajes. Una réplica puede ser mínima y otra necesitar varios párrafos; nunca recortes una respuesta útil para variar ni la alargues para actuar un personaje.
```
- **En:** `src/services/ai.js:693`
```javascript
693: Da la solución con el desarrollo necesario. No acortes una tarea completa para cumplir la longitud de una charla. Si el alcance no cabe en una entrega, identifica lo resuelto y lo pendiente sin afirmar que terminaste.
```
**Análisis:**  
Las directivas *"nunca recortes una respuesta útil"*, *"una réplica puede necesitar varios párrafos"* y *"no acortes una tarea completa"* son interpretadas por el LLM como una penalización estricta ante el resumen. El modelo asume que omitir cualquier detalle periférico constituye un error de entrega.

---

### 3.3. Volcados Masivos de Telemetría sin Filtrado de Usuario
- **Ubicación:** `src/services/ai.js:641-678` (específicamente líneas 656-675)
```javascript
656: minecraftLiveContext = `\n--- TELEMETRÍA TOTAL Y EN VIVO DE MINECRAFT BEDROCK (VPS redspi) ---
657: Estado: ${status.online ? 'ENCENDIDO / ONLINE' : 'APAGADO (' + status.containerStatus + ')'}
658: Uptime (tiempo sin reiniciarse): ${status.uptime} (iniciado el ${status.startedAt ? new Date(status.startedAt).toLocaleString('es-MX') : 'Desconocido'})
659: Latencia / Ping SSH a VPS: ~${status.latencyMs} ms (vía Tailscale)
660: Salud / Lag: ${status.lag}
661: CPU Contenedor: ${status.cpu}
662: RAM Contenedor: ${status.memory}
663: Espacio en disco del VPS: ${status.disk}
664: Mundo activo: ${status.activeWorld}
665: Modo de juego: ${modeName} (gamemode=${status.gamemode})
666: Dificultad: ${status.difficulty}
667: Trucos / Cheats: ${cheatsStr} (allow-cheats=${status.allowCheats})
668: Puerto: ${status.serverPort || '19132'} (Bedrock UDP / NetherNet)
669: Xbox Live / Online Mode: ${status.onlineMode ? 'Activado' : 'Desactivado'}
670: Propiedades del servidor: ${JSON.stringify(status.allProps || {})}
671: Jugadores (${players.count}/${players.max}): ${players.players.length > 0 ? players.players.join(', ') : 'Nadie conectado'}
672: Behavior Packs activos: ${bpNames || 'Ninguno'}
673: Resource Packs activos: ${rpNames || 'Ninguno'}
674: Addons en almacén global: ${globalNames || 'Ninguno'}
675: INSTRUCCIÓN OBLIGATORIA: Tienes acceso total a esta telemetría en tiempo real. Cuando el usuario te pregunte CUALQUIER COSA sobre el servidor (uptime, tiempo sin reiniciarse, lag, latencia/ping, specs, disco, trucos, mods, dificultad, jugadores, cómo entrar, propiedades, etc.), respóndele DIRECTAMENTE con los datos exactos de esta telemetría y con tu personalidad mexicana de barrio auténtica. NUNCA inventes datos si están aquí.
```
**Fricción de Usuario:**  
Si un usuario pregunta casualmente en el chat: *"¿está prendido el maicra?"*, la instrucción imperativa de la línea 675 fuerza al modelo a vomitar una sábana técnica de 18 líneas que incluye uso de CPU de contenedores Docker, latencias Tailscale por SSH y cadenas JSON crudas de propiedades (`allProps`), colapsando la interfaz del chat.

---

### 3.4. Fragmentación Excesiva de Texto (Chunking Desproporcionado)
- **Ubicación:** `src/utils/whatsappText.js:165`
```javascript
165: function splitWhatsAppText(value, { maxLength = 3500 } = {}) {
```
**Falla:**  
El divisor de mensajes fija `maxLength = 3500` caracteres (cercano al límite duro de 4,096 de WhatsApp). Un solo bloque de 3,500 caracteres ocupa más de **cinco pantallas completas de scroll** en un teléfono móvil estándar, desplazando cualquier conversación previa.

---

### 3.5. Patologías del Lenguaje: Negative Prompting y Máscaras Contradictorias
- **Negative Prompting en:** `src/services/conversationStyle.js:21-32, 63-64`
```javascript
24: const phrases = ['compa', 'carnal', 'cabrón', 'güey', 'qué onda', 'qué transa', 'va', 'listo', 'no mames', 'pinche'];
...
63: ${recent.repeated.length ? `Muletillas usadas repetidamente en este chat (déjalas descansar): ${JSON.stringify(recent.repeated)}.` : ''}
```
**Efecto Contraproducente:**  
Inyectar listas de palabras prohibidas con la instrucción *"déjalas descansar"* es un antipatrón comprobado en modelos Transformer. El mecanismo de atención asigna relevancia a dichos tokens, provocando que el modelo los use involuntariamente con mayor frecuencia o, en su esfuerzo por evitarlos, recurra a sustitutos artificiales y rígidos (*"camarada"*, *"estimado amigo"*), distorsionando su estilo natural.

- **Conflicto Tripartito de Personalidades:**  
Coexisten tres máscaras divergentes:
1. `conversationStyle.js:54-57`: Coloquial con criterio, sobrio cuando encaje, sin insultos gratuitos.
2. `src/services/ai.js:994-996`: Tono norteño/callejero, sarcástico, con pocas pulgas y humor pesado.
3. `src/services/agentEngine.js:140`: Personalidad de barrio popular.  
La falta de una identidad unificada genera oscilaciones desconcertantes: en un turno emite un insulto callejero forzado y en el siguiente una disculpa corporativa.

---

### 3.6. Fricción por Bucles Enlatados de Disculpa y Argot de Terminal
- **Respuestas Enlatadas sin Salida en:** `src/services/operationFeedback.js:5-23`
```javascript
5: function aiRoutingFailureMessage(failure = {}) {
6:     switch (failure.kind) {
7:         case 'blocked': return 'El servicio de IA no pudo procesar esta solicitud. No ejecuté nada.';
13:         case 'rate_limit': return 'La IA llegó a su límite de solicitudes. Intenta de nuevo en un rato.';
16:         case 'empty_response': return 'La IA no devolvió una instrucción válida. No ejecuté nada; intenta de nuevo en un momento.';
21:         default: return 'No pude interpretar tu petición ahorita. Intenta de nuevo en un momento.';
22:     }
23: }
```
La fórmula *"Intenta de nuevo en un momento"* se repite en más de 25 manejadores del bot. No explica la razón concreta del fallo, no sugiere alternativas accionables (ej. enviar el enlace directo o acortar el audio) ni aporta un tiempo estimado de recuperación.

- **Prefijos Crípticos de Terminal en:** `src/core/dispatcher.js:1057-1068`
```javascript
1059: await sendText(from, `> ❌ ${err.userMessage}`);
1064: await sendText(from, `> ⚠️ ${err.message}`);
1067: await sendText(from, `[!] error al ejecutar: ${cmdToSwitch}`);
```
El usuario final recibe caracteres de consola Linux (`[!]`, `> ❌`), transmitiendo la percepción de una herramienta rota o en fase de depuración.

---

### 3.7. Contraste Riguroso con Estándares de Micro-Copy y Ergonomía Móvil

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                      MATRIZ DE ERGONOMÍA MÓVIL: ESTADO ACTUAL VS ESTÁNDAR WHATSAPP               │
├──────────────────────────┬─────────────────────────────────────┬────────────────────────────────┤
│ Dimensión de Diseño UX   │ Estado Actual en Botsky             │ Estándar Requerido (Micro-Copy)│
├──────────────────────────┼─────────────────────────────────────┼────────────────────────────────┤
│ Viewport Móvil           │ Respuestas de 600 a 1,200 tokens    │ Máximo 60-120 palabras por     │
│ (360 - 400 px ancho)     │ (ocupan de 4 a 8 pantallas de       │ globo (~300-600 caracteres).   │
│                          │ scroll continuo).                   │ Visibles sin requerir scroll.  │
├──────────────────────────┼─────────────────────────────────────┼────────────────────────────────┤
│ Fatiga de Scroll         │ Formato tipo ensayo denso;          │ Estructura de Pirámide         │
│ (Scroll Fatigue)         │ el usuario abandona la lectura      │ Invertida: conclusión en       │
│                          │ antes de llegar al dato útil.       │ línea 1, detalles bajo demanda.│
├──────────────────────────┼─────────────────────────────────────┼────────────────────────────────┤
│ Capacidad de Procesamiento│ Volcados de hasta 20 parámetros de  │ Respuestas operativas de       │
│ Cognitivo                │ telemetría sin filtrar.             │ 1 a 3 líneas concisas.         │
├──────────────────────────┼─────────────────────────────────────┼────────────────────────────────┤
│ Presentación de Datos    │ Conversión de tablas a listas       │ Tablas compactas nativas       │
│ Estructurados            │ verticales repetitivas              │ (WhatsApp Native Table) o      │
│                          │ (`- Columna X: Valor`).             │ bullets con máximo 3 métricas. │
├──────────────────────────┼─────────────────────────────────────┼────────────────────────────────┤
│ Recuperación de Errores  │ Mensajes sin salida:                │ Micro-copy accionable:         │
│                          │ *"Intenta de nuevo en un momento"*. │ Qué ocurrió + Cómo resolverlo. │
├──────────────────────────┼─────────────────────────────────────┼────────────────────────────────┤
│ Consistencia de Tono     │ Caricatura bipolar: insultos        │ Coloquial mexicano natural,    │
│                          │ agresivos o disculpas robóticas.    │ ingenioso, sobrio y servicial. │
└──────────────────────────┴─────────────────────────────────────┴────────────────────────────────┘
```

---

## 4. Diagnóstico R3: Auditoría Técnica de Manejo Contextual de Herramientas y Multimedia Ambigua

### 4.1. Trazabilidad Técnica Paso a Paso: "Usuario envía imagen sin texto de acompañamiento"

A continuación se detalla la traza determinista del código cuando un usuario envía una imagen sin texto ni pie de foto:

```
[Usuario envía imagen limpia (sin caption)]
                    │
                    ▼
[Paso 1: message_normalizer.js:114-128]
  - extractText(message) retorna text = ""
  - detectMessageType(message) retorna 'imageMessage'
  - Registra attachment con source = 'current' (L348)
                    │
                    ▼
[Paso 2: attachmentContext.js:109-135]
  - Almacena descriptor en memoria
  - LÍNEA CRÍTICA 128: if (source === 'current') context.activeId = null;
  - ¡El archivo recién llegado NO queda como activo!
                    │
                    ▼
[Paso 3: dispatcher.js:520 y parser.js:63-114]
  - LÍNEA CRÍTICA 520: parse(text || "adjunto recibido")
  - Inyecta string artificial "adjunto recibido"
  - parser.js interpreta: command = "adjunto", args = ["recibido"]
  - L521 sobreescribe parsed.raw = "", pero cmdToSwitch queda como "adjunto"
  - L573 inserta mensaje vacío "" en el historial conversacional
                    │
                    ▼
[Paso 4: ai.js:724 - routeWithAIOutcome]
  - Envía al LLM: peticion: "", contexto: { adjunto_activo: null }
                    │
                    ▼
[Paso 5: Bifurcación Crítica según Tipo de Chat]
         ├─── ¿Es Grupo de WhatsApp? (isGroup === true)
         │          │
         │          ▼
         │    [ai.js:916 y dispatcher.js:730]
         │    - LLM evalúa addressed_to_bot = false
         │    - L730: if (isGroup && !isDirectlyAddressed) return;
         │    - RESULTADO: FALLO SILENCIOSO TOTAL.
         │      El bot descarta el evento sin responder, reaccionar ni dar feedback.
         │
         └─── ¿Es Chat Privado? (isGroup === false)
                    │
                    ├─► Subcaso 2.1: Router clasifica needs_clarification / awaiting_attachment
                    │   - dispatcher.js:740: Envía pregunta genérica y estéril:
                    │     "Me falta un dato para hacerlo. ¿Me aclaras qué necesitas?"
                    │
                    ├─► Subcaso 2.2: Router infiere herramienta (ej. "sticker", "ocr")
                    │   - dispatcher.js:748-755: selected = resolveAttachment(attachment_id)
                    │   - Como activeId era null (L128), si el LLM omitió el UUID, selected = null
                    │   - L753: Responde absurdamente:
                    │     "No tengo identificado ese archivo. Cítalo o adjúntalo para usar el correcto."
                    │   - L764-768: Destruye mediaContext = null y convierte el mensaje a texto vacío.
                    │
                    └─► Subcaso 2.3: Router clasifica action = "chat"
                        - Descarga base64 y Gemini emite pregunta redundante o descripción
                          visual no solicitada ("¿Qué onda compa, qué le hacemos a esta foto?").
```

---

### 4.2. Rigidez Extrema en Handlers de Comandos Directos
Si el usuario intenta ejecutar comandos sobre medios interactivos, los manejadores imponen exigencias de sintaxis incompatibles con la usabilidad móvil:

1. **Stickers (`src/commands/sticker.js:234-238`):**
```javascript
234: } else {
235:     return sendText(from,
236:         '> no se encontro imagen\nenvia una imagen con `/@ sticker`\no pasa una url: `/@ sticker [url]`'
237:     );
238: }
```
Exige prefijos arcaicos de terminal (`/@ sticker`) y rechaza el archivo si no se acompañó de dicha orden exacta.

2. **OCR / Lectura de Texto (`src/commands/ocr.js:18-20`):**
```javascript
18: if (!messageData?.messageType?.includes('image') && !messageData?.messageType?.includes('document')) {
19:     return sendText(from, 'Responde a la imagen con `leer` y saco el texto.');
20: }
```
Exige que el usuario cite manualmente el mensaje escribiendo textualmente la palabra `"leer"`.

3. **Conversión y Descargas (`src/commands/convertir.js:225`, `src/commands/descargar.js:359`):**
Utilizan `p.fail()`, arrojando excepciones capturadas en `dispatcher.js:1059` que generan mensajes ásperos precedidos por `> ❌`.

---

### 4.3. Contraste con el Flujo Ideal de Inferencia Inteligente y Confirmación Mínima

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FLUJO ACTUAL (CON PARCHES)                                      │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Usuario envía imagen sin texto.                                                              │
│ 2. parser.js inventa "adjunto recibido", command = "adjunto".                                    │
│ 3. attachmentContext.js setea activeId = null.                                                  │
│ 4. En grupos: FALLO SILENCIOSO TOTAL.                                                           │
│ 5. En privados: "No tengo identificado ese archivo" o "¿Qué le hacemos a la foto?".             │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
                                                ▲
                                                │ VS
                                                ▼
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 FLUJO IDEAL ARQUITECTÓNICO                                      │
├─────────────────────────────────────────────────────────────────────────────────────────────────┤
│ 1. Ingesta: El sistema detecta el medio y vincula deterministamente su ID como adjunto activo.  │
│ 2. Inferencia Probabilística:                                                                   │
│    En WhatsApp, el ~85% de las imágenes solitarias se envían para generar stickers.            │
│ 3. En Privado (Cero Fricción):                                                                  │
│    - Reacciona con emoji 🎨 inmediatamente (confirmación visual no invasiva).                   │
│    - Genera el sticker de forma predeterminada + micro-copy accionable al pie:                  │
│      "Listo tu sticker compa. Si querías que leyera el texto o lo pasara a PDF, dímelo."       │
│ 4. En Grupos:                                                                                   │
│    - Si el mensaje no mencionó a Botsky ni citó un mensaje suyo: SILENCIO ESTRICTO (No spam).   │
│    - Si el usuario citó a Botsky o lo mencionó: Micro-menú interactivo de 1 línea:              │
│      "¿Qué armamos con la foto? 1️⃣ Sticker | 2️⃣ Extraer texto (OCR) | 3️⃣ Guardar"             │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 5. Propuesta R4: Arquitectura Modular Limpia ("Arquitectura Sí, Parches No")

### 5.1. Principios de Arquitectura
La solución definitiva para Botsky se fundamenta en los principios de **Clean Architecture**, alta cohesión y bajo acoplamiento:
1. **Frontera Determinista de Ingress:** Ningún mensaje grupal llega a la lógica de negocio ni al LLM a menos que haya sido inequívocamente dirigido al bot.
2. **Jerarquía Escalonada de Enrutamiento (Tiered Routing):** Los comandos rápidos deben ejecutarse en `< 5ms` a costo cero de tokens; el LLM se reserva exclusivamente para lenguaje natural no estructurado.
3. **Máquina de Estados Finitos (FSM) por Ámbito:** El estado conversacional se gobierna mediante transiciones formales con Time-To-Live (TTL) estricto bajo la clave `(ChatJID, UserJID, Domain)`.
4. **Formateo Mobile-First:** Toda respuesta saliente pasa por un motor de micro-copy optimizado para el viewport de WhatsApp en pantallas móviles.

---

### 5.2. Detalle Técnico de las 4 Capas Desacopladas

```
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                            CAPA 1: INGRESO Y FILTRADO CONTEXTUAL                               │
│  • Deduplicación LRU (60s)                                                                     │
│  • Normalización Canónica de Identidades y Contenido (521 -> 52, @lid, sufijos :0)             │
│  • Group Boundary Gate (Mención / Réplica a Bot / Prefijo / Sesión FSM)                        │
│  • Token Bucket Rate Limiter (2 req / 3s por usuario; límite grupal; desalojo LRU)             │
│  • Búfer Coalescente Adaptativo / Debouncer (1,000ms por [ChatJID, UserJID])                   │
└───────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                │ Evento Consolidado y Autorizado
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                         CAPA 2: CLASIFICADOR DE INTENTS NIVELADO                               │
│  • Tier 1: Fast-Path Comandos Declarativos (< 5ms, 0 tokens LLM)                               │
│  • Tier 2: FSM Session Router (Continúa diálogo o selección activa)                            │
│  • Tier 3: Multimodal Heuristics (Adjuntos sin texto -> Manejador de Ambigüedad)                │
│  • Tier 4: Semantic AI Router (Groq / Gemini con JSON Schema estricto)                         │
│  • Tier 5: Circuit Breaker Fallback, Rescate Local y Degradación Grácil Conversacional         │
└───────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                │ Intención Resuelta + Parámetros Tipados
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                 CAPA 3: GESTOR DE ESTADOS Y SESIONES CONVERSACIONALES (FSM)                    │
│  • Aislamiento Canónico: (ChatJID, UserJID, Domain)                                            │
│  • Temporizadores TTL: Ambigüedad (90s), Selección (180s), Juegos (10m)                        │
│  • Manejador de Ambigüedad Multimedia (Re-entrancia de álbumes, preempción !, fallback a chat) │
└───────────────────────────────────────────────┬────────────────────────────────────────────────┘
                                                │ Acción Resuelta o Solicitud Breve
                                                ▼
┌────────────────────────────────────────────────────────────────────────────────────────────────┐
│                        CAPA 4: FORMATEADOR CONCISO DE RESPUESTAS                               │
│  • Micro-Copy Engine (Confirmaciones: 1-2 líneas; Errores: Causa + Alternativa)                │
│  • Sanitizador Markdown WhatsApp (*bold*, _italic_, tablas nativas, code blocks)               │
│  • Intelligent Chunking (máximo 800-1200 caracteres por fragmento)                             │
│  • Outbound Throttling (espaciado de 500ms para proteger transporte)                           │
└────────────────────────────────────────────────────────────────────────────────────────────────┘
```

#### Capa 1: Ingreso y Filtrado Contextual
1. **Deduplicación LRU:** Cache en memoria con retención de 60 segundos por `messageId` para absorber reintentos duplicados del webhook de Evolution API y descartar mensajes emitidos por el propio bot (`fromMe`).
2. **Normalización Canónica de Identidades y Contenido (Ejecución Inmediata Post-Deduplicación):**  
   Se ejecuta estrictamente de forma previa a la compuerta grupal y al limitador de tasa. Sanea prefijos internacionales mexicanos (`521` a `52`), remueve sufijos de dispositivo vinculado (`:0`, `:12`) y mapea identidades privadas encriptadas `@lid` hacia JIDs canónicos `@s.whatsapp.net`. Este ordenamiento garantiza que las comparaciones deterministas posteriores (`quotedParticipant === BOT_JID`, evaluación de administradores y cómputo de cuotas) operen sobre identidades idénticas y normalizadas, evitando el descarte erróneo del 100% de las respuestas directas de usuarios móviles y web.
3. **Filtro Estricto de Frontera Grupal (Group Boundary Gate):**  
   En grupos (`@g.us`), el mensaje ya normalizado **se descarta de inmediato** a menos que cumpla con al menos una de las siguientes condiciones deterministas evaluadas sobre identidades canónicas:
   - Mención explícita `@Botsky` en `mentionedJid`.
   - Respuesta directa (Quote/Reply) donde `quotedParticipant === BOT_JID` (validando además que el mensaje no contenga menciones explícitas a terceros en `mentionedJid` que invaliden el direccionamiento al bot).
   - Prefijo de comando explícito (`!`, `/`).
   - Existencia de una sesión interactiva activa registrada en la FSM para ese usuario en ese grupo.  
   Si no cumple ninguna condición, el mensaje se registra pasivamente en el almacén de actividad y se termina el procesamiento con `200 OK`.
4. **Token Bucket Rate Limiter con Protección de Ráfagas Grupales y Desalojo LRU:**  
   Regula ráfagas abusivas a nivel de usuario (2 peticiones cada 3 segundos por remitente canónico; administradores exentos) y a nivel de grupo (tope global de 6 peticiones cada 5 segundos por `ChatJID` para salvaguardar cuotas de proveedores LLM como Groq 30 RPM ante dinámicas multitudinarias). El registro de cubos implementa política de desalojo LRU (capacidad máxima de 2,000 claves con TTL de inactividad de 15 minutos) evitando fugas de memoria en Node.js. El tráfico excedente se descarta silenciosamente sin generar spam de advertencia.
5. **Búfer Coalescente Adaptativo / Debouncer (1,000ms por clave `[ChatJID, UserJID]`):**  
   Absorbe y consolida la fragmentación habitual de escritura en WhatsApp (*multi-part typing*, donde un usuario envía varias líneas sucesivas en menos de 1 segundo: *t=0.0s "oye botsky"*, *t=0.4s "ayúdame con una duda"*, *t=0.9s "cuánto es 2 + 2?"*). Sin este búfer previo al despacho, los mensajes posteriores saturan el Token Bucket (provocando descarte de argumentos esenciales) o se disparan múltiples promesas asíncronas en paralelo hacia los proveedores LLM que compiten en carrera, provocando respuestas desordenadas o duplicadas. El debouncer retiene el mensaje durante una ventana de 1,000ms; la recepción de un fragmento subsecuente del mismo usuario en el mismo chat reinicia el temporizador y concatena el texto de forma secuencial. Al vencer la ventana de 1,000ms de inactividad, se despacha un único mensaje consolidado hacia la Capa 2, garantizando contexto íntegro y serialización de promesas asíncronas.

#### Capa 2: Clasificador de Intents Nivelado (Tiered Classifier)
- **Tier 1 (Comandos Explícitos):** Catálogo declarativo en `CommandRegistry`. Si el mensaje inicia con prefijo o alias registrado (`!descargar`, `!pack`, `!horafeliz status`), despacha al ejecutor en `< 5ms` sin tocar la IA.
- **Tier 2 (Enrutamiento FSM):** Si el remitente se encuentra en un estado conversacional pendiente (ej. eligiendo la opción `"2"` de una lista de descargas), el mensaje se transfiere directamente al manejador de la FSM.
- **Tier 3 (Heurística Multimodal):** Si el mensaje contiene un archivo multimedia sin texto, no se inventan cadenas falsas ni se llama al LLM; se transfiere al **Manejador de Ambigüedad** de la Capa 3.
- **Tier 4 (Router Semántico LLM):** Exclusivo para lenguaje natural no estructurado. Consulta a Groq (Llama 3.3) o Gemini Flash bajo `response_format: { type: "json_object" }` con esquemas estrictos de intención y argumentos.
- **Tier 5 (Circuit Breaker, Rescate Local y Degradación Grácil Conversacional):**  
  Conmutación en caliente entre proveedores de IA (primario Google Gemini Flash y secundario Groq Llama 3.3). Ante bloqueos de seguridad (`blocked`), agotamiento de cuota (HTTP 429) o fallas de red:
  - *Rescate Heurístico Local:* Si el mensaje coincide con patrones deterministas (URLs de descarga reconocidas por `yt-dlp`, solicitudes de stickers o comandos estándar), rescata la intención localmente y la deriva al ejecutor de herramientas (`CmdExec`) a costo cero.
  - *Ruta de Degradación Grácil Conversacional:* Si ambos proveedores de IA fallan en una consulta conversacional general o de lenguaje natural puro (donde no existe ninguna herramienta local ejecutable), Tier 5 **no produce una caída silenciosa ni delega un comando nulo a `CmdExec`**. En su lugar, transfiere la ejecución directamente a la **Capa 4 (Micro-Copy Formatter)** para emitir de inmediato un aviso conciso, empático y alineado con la personalidad del bot:  
    `"[!] Mis neuronas de IA están en mantenimiento compa, pero los comandos con ! siguen jalando al 100."`  
    Esto erradica al 100% los fallos silenciosos y mantiene la percepción de resiliencia del sistema.

#### Capa 3: Gestor de Estados y Sesiones Conversacionales (FSM)
- **Clave Canónica de Sesión:** `SessionKey = (ChatJID, UserJID, Domain)`. Aísla el estado para evitar interferencias cruzadas entre participantes del grupo.
- **Temporizadores Automáticos de Expiración (TTL):**
  - Diálogos de ambigüedad multimedia: **90 segundos**.
  - Listas de selección interactiva: **180 segundos**.
  - Sesiones económicas y juegos: **10 minutos**.  
  Al expirar el tiempo, el estado retorna a `IDLE` de forma limpia y silenciosa (`EXPIRED_CLEANUP`).
- **Manejador de Ambigüedad Multimedia con FSM Completa y Resiliente:**  
  Gobierna el estado `AWAITING_ATTACHMENT_ACTION` cuando se recibe un archivo multimedia sin texto (Tier 3). Presenta un micro-menú interactivo de 1 toque (`1️⃣ Sticker | 2️⃣ Extraer texto (OCR) | 3️⃣ Guardar`) y garantiza robustez ante cualquier escenario adverso mediante un ciclo formal de transiciones:
  1. *Selección de Opción Válida (`"1"`, `"2"`, `"3"`):* Transiciona inmediatamente a `EXECUTING_TOOL`, procesa el medio identificado por `activeId` y retorna a `IDLE`.
  2. *Re-entrancia por Adjunto Adicional o Álbum de Fotos:* Si el usuario envía una nueva imagen (o una ráfaga de imágenes correspondientes a un álbum multimedia de WhatsApp) mientras la FSM espera opción, el estado permanece en `AWAITING_ATTACHMENT_ACTION`, actualiza deterministamente el puntero `activeId` al medio más reciente y **reinicia el temporizador TTL a 90 segundos**. Esto evita que el bot quede desfasado operando sobre archivos obsoletos o descarte fotos de álbumes.
  3. *Preempción por Comando Explícito (`!comando`):* Si el usuario escribe una orden declarativa (ej. `!maicra`, `!descargar <url>`, `!horafeliz`), la FSM aborta inmediatamente la espera de ambigüedad (`preemptive abort`), libera el estado a `IDLE` y transiciona de inmediato a `EXECUTING_TOOL` para procesar el comando con prioridad absoluta.
  4. *Fallback ante Texto Divergente / Conversación General:* Si el usuario envía un mensaje de texto no numérico o divergente (ej. *"oye olvídalo, qué hora es?"*, *"jajaja hola"*), la FSM no lo retiene bloqueado durante 90 segundos; libera el estado devolviéndolo a `IDLE` y canaliza el texto hacia el clasificador estándar de Capa 2 para su procesamiento normal.
  5. *Cancelación y Timeout:* Responder `"cancelar"` limpia el estado devolviendo a `IDLE` con confirmación mínima de 1 línea; alcanzar el límite de 90 segundos ejecuta `EXPIRED_CLEANUP` silenciosamente.

#### Capa 4: Formateador Conciso de Respuestas (Mobile-First Formatter)
- **Micro-Copy Engine:** Aplica límites estrictos de longitud adaptados a WhatsApp móvil:
  - Notificaciones operativas: **1 a 2 líneas**.
  - Notificaciones de error: **Explicación clara del motivo + 1 opción de solución**.
  - Mensajes informativos: **Máximo 150 a 250 palabras** estructurados en pirámide invertida.
- **Sanitizador Markdown:** Adapta encabezados y estilos a la sintaxis nativa de WhatsApp (`*negrita*`, `_cursiva_`, monospace) y renderiza tablas nativas compactas.
- **Intelligent Chunking:** Fragmenta mensajes que superen los 1,200 caracteres respetando párrafos y bloques de código.
- **Outbound Throttling:** Introduce un retardo de 500ms entre envíos consecutivos para proteger el transporte de Evolution API.

---

### 5.3. Diagramas Arquitectónicos Mermaid

#### Diagrama 1: Flujo de Eventos de Mensajes / Multimedia (End-to-End Pipeline)

```mermaid
flowchart TD
    A["Evolution API Webhook: messages.upsert"] --> B["Webhook Ingestor & Deduplicator LRU (60s)"]
    B -->|Duplicado / Echo fromMe| C["Descarte Silencioso 200 OK"]
    B -->|Mensaje Nuevo| NormId["Normalizador Canónico de Identidades (521->52, @lid, :0)"]
    
    NormId --> D{"¿Es Chat Grupal?"}
    
    D -->|Sí| E{"Filtro de Activación Grupal: Mención, Quote, Prefijo o Sesión"}
    E -->|No dirigido al bot| F["Registro Pasivo en Historial y Fin"]
    E -->|Dirigido al bot| G["Token Bucket Rate Limiter (Usuario & Grupo)"]
    
    D -->|"No (Privado)"| G
    
    G -->|Tasa Excedida| H["Drop Silencioso Anti-Spam"]
    G -->|Permitido| Coalescer["Búfer Coalescente Adaptativo / Debouncer (1,000ms por ChatJID, UserJID)"]
    
    Coalescer -->|Mensaje Consolidado| J{"Clasificador de Intents Nivelado"}
    
    J -->|Tier 1: Prefijo ! / Comando Explícito| K["Command Registry Fast-Path"]
    J -->|Tier 2: Sesión FSM Activa| L["FSM Transition Engine"]
    J -->|Tier 3: Adjunto sin Texto| M["Manejador de Ambigüedad"]
    J -->|Tier 4: Lenguaje Natural Complejo| N["Router Semántico LLM Groq / Gemini"]
    
    K --> O["Ejecutor de Herramientas & Sandbox"]
    L --> O
    M --> P["Prompt de Opciones Contextuales Conciso"]
    N -->|Acción Resuelta| O
    N -->|Fallo / Bloqueo| Q["Fallback & Rescate Heurístico Local"]
    Q -->|Herramienta Rescatada| O
    Q -->|"Fallo Dual IA (Sin Herramienta)"| U["Aviso Conciso de Degradación Grácil IA"]
    
    O --> R["Formateador Conciso de Salida WhatsApp"]
    P --> R
    U --> R
    R --> S["Sanitizador Markdown & Chunking"]
    S --> T["Evolution API sendText / sendMedia"]
```

---

#### Diagrama 2: Arquitectura de Componentes Modulares y Capas

```mermaid
flowchart LR
    subgraph CAPA1 ["Capa 1: Ingreso y Filtrado Contextual"]
        WIn["Webhook Ingestor"]
        Dedup["LRU Deduplicator"]
        NormId["Identity Normalizer"]
        GroupGate["Group Boundary Gate"]
        Limiter["TokenBucket RateLimiter"]
        Coalescer["Adaptive Coalescer / Debouncer"]
    end

    subgraph CAPA2 ["Capa 2: Clasificación de Intents"]
        CmdFast["Command Registry Fast-Path"]
        FsmRouter["FSM Session Router"]
        MediaDet["Multimodal Detector"]
        AiRouter["Semantic AI Router"]
        CktBreaker["Circuit Breaker Fallback"]
    end

    subgraph CAPA3 ["Capa 3: Gestor de Estados FSM"]
        FsmEngine["FSM State Machine"]
        SessionStore["Scoped Session Store"]
        TTLWorker["TTL & Cleanup Worker"]
        Ambiguity["Ambiguity Resolver"]
    end

    subgraph CAPA4 ["Capa 4: Ejecución y Formateo"]
        CmdExec["Command Executors"]
        ToolSand["Tool Sandbox"]
        MicroCopy["Micro-Copy Formatter"]
        MdSanitizer["WhatsApp Markdown Sanitizer"]
        Chunker["Chunker & Delivery Queue"]
    end

    WIn --> Dedup --> NormId --> GroupGate --> Limiter --> Coalescer
    Coalescer --> CmdFast
    Coalescer --> FsmRouter
    Coalescer --> MediaDet
    Coalescer --> AiRouter
    AiRouter -.-> CktBreaker

    FsmRouter <--> FsmEngine
    MediaDet --> Ambiguity
    Ambiguity <--> FsmEngine
    FsmEngine <--> SessionStore
    TTLWorker -.-> SessionStore

    CmdFast --> CmdExec
    FsmEngine --> CmdExec
    CktBreaker -->|Rescate Heurístico| CmdExec
    CktBreaker -->|Degradación Grácil| MicroCopy
    CmdExec --> ToolSand
    ToolSand --> MicroCopy
    Ambiguity --> MicroCopy
    MicroCopy --> MdSanitizer --> Chunker
```

---

#### Diagrama 3: Máquina de Estados Finitos para Manejo de Ambigüedad y Confirmación Contextual

```mermaid
stateDiagram-v2
    [*] --> IDLE

    IDLE --> AWAITING_ATTACHMENT_ACTION : Adjunto Recibido sin Texto (Tier 3)
    note right of AWAITING_ATTACHMENT_ACTION
        Micro-menú interactivo:
        1: Sticker | 2: OCR | 3: Guardar
        TTL = 90 segundos
        activeId = UUID del medio
    end note

    AWAITING_ATTACHMENT_ACTION --> AWAITING_ATTACHMENT_ACTION : Nuevo Adjunto / Álbum (actualiza activeId y reinicia TTL 90s)
    AWAITING_ATTACHMENT_ACTION --> EXECUTING_TOOL : Selección de opción ("1", "2", "3")
    AWAITING_ATTACHMENT_ACTION --> EXECUTING_TOOL : Comando Explícito !comando (Preempción Inmediata)
    AWAITING_ATTACHMENT_ACTION --> IDLE : Texto Divergente / No Numérico (Libera Estado a Clasificador)
    AWAITING_ATTACHMENT_ACTION --> IDLE : Usuario cancela ("cancelar")
    AWAITING_ATTACHMENT_ACTION --> EXPIRED_CLEANUP : Timeout TTL (90s sin respuesta)

    IDLE --> AWAITING_CONFIRMATION : Confirmación Crítica Requerida
    note right of AWAITING_CONFIRMATION
        Confirmación atómica:
        "¿Confirmas debitar XP? (Sí/No)"
        TTL = 60 segundos
    end note

    AWAITING_CONFIRMATION --> EXECUTING_TOOL : Usuario confirma ("sí", "va")
    AWAITING_CONFIRMATION --> CONFIRMATION_REJECTED : Usuario rechaza ("no")
    AWAITING_CONFIRMATION --> EXPIRED_CLEANUP : Timeout TTL (60s sin respuesta)

    IDLE --> INTERACTIVE_LIST_SELECTION : Lista de Búsqueda Activa
    note right of INTERACTIVE_LIST_SELECTION
        Lista de videos / archivos
        TTL = 180 segundos
    end note

    INTERACTIVE_LIST_SELECTION --> EXECUTING_TOOL : Selección válida ("el 2")
    INTERACTIVE_LIST_SELECTION --> EXPIRED_CLEANUP : Timeout TTL (180s)

    EXECUTING_TOOL --> FORMATTING_RESPONSE : Ejecución exitosa de herramienta
    CONFIRMATION_REJECTED --> IDLE : Mensaje conciso de cancelación
    EXPIRED_CLEANUP --> IDLE : Limpieza de memoria silenciosa

    FORMATTING_RESPONSE --> IDLE : Despacho de mensaje formateado
```

---

## 6. Matriz Comparativa Explícita R5

### Tabla Comparativa Integral: Enfoque Actual con Parches vs Enfoque Arquitectónico Propuesto

| Criterio de Evaluación | Enfoque Actual con Parches Ad-Hoc | Enfoque Arquitectónico Modular Propuesto | Impacto y Ganancia Técnica |
| :--- | :--- | :--- | :--- |
| **Mantenibilidad del Código y Deuda Técnica** | • `dispatcher.js` de 1,073 líneas actúa como monolito desbordado ("God Object").<br>• Mapeo manual de 310 líneas en `applyAiArgsToParsed`.<br>• Agregar un nuevo comando requiere modificar 4 archivos distintos con regexes frágiles. | • Desacoplamiento estricto en 4 capas autónomas con contratos tipados.<br>• `CommandRegistry` declarativo basado en esquemas.<br>• Principio Open/Closed: la adición de funciones no altera el pipeline central. | **Reducción de Deuda (~70%)**: Mantenimiento simplificado; cero efectos secundarios entre módulos independientes. |
| **Consumo de Contexto y Tokens LLM** | • El LLM es invocado indiscriminadamente para comandos deterministas y conversaciones humanas grupales.<br>• Prompts desmedidos de hasta 4,000 tokens que incluyen telemetría completa no solicitada.<br>• Consultas proactivas de fondo cada 4 mensajes en grupos. | • Fast-path Tier 1 resuelve comandos directos con **cero consumo de tokens**.<br>• Prompts de clasificación ultraligeros en formato JSON estricto.<br>• Supresión total de consultas espontáneas invasivas en grupos. | **Ahorro Operativo (~65%)**: Drástica disminución en costos de API y en cuota mensual de Gemini y Groq. |
| **Latencia y Desempeño Operativo** | • Latencia típica de 1,500ms a 3,500ms por consulta al LLM incluso para tareas elementales.<br>• Evaluación secuencial de cadenas de regex e interpolaciones pesadas en el bucle principal. | • Comandos directos y transiciones de estado resueltos en **< 15 ms**.<br>• El LLM se reserva exclusivamente para lenguaje natural no estructurado. | **Inmediatez en Tiempo Real**: Sensación de respuesta instantánea en WhatsApp para operaciones cotidianas. |
| **Resiliencia, Tolerancia a Fallos y Aislamiento de Errores** | • Fallos de red o errores de seguridad (`kind: blocked`) provocan respuestas crípticas o caídas.<br>• Estado en memoria volátil vulnerable a reinicios por el monitor de RAM a 1GB. | • Circuit Breaker con conmutación en caliente entre proveedores de IA.<br>• Fallback local automático.<br>• Degradación grácil encapsulada por capa sin caídas del proceso. | **Disponibilidad 99.9%**: Eliminación de caídas y de mensajes de error de sistema expuestos al usuario. |
| **Experiencia de Usuario (UX) y Ergonomía Móvil en WhatsApp** | • Respuestas enciclopédicas de hasta 1,200 tokens que saturan la pantalla del teléfono.<br>• Imágenes solitarias en grupos son descartadas en silencio.<br>• Mensajes repetitivos con muletillas forzadas y fórmulas enlatadas sin salida. | • Micro-copy adaptado al viewport móvil (1 a 3 líneas operativas).<br>• Manejo estructurado de adjuntos mediante micro-menús contextuales de 1 toque.<br>• Personalidad irreverente y fluida sin muletillas mecánicas. | **Satisfacción y Retención**: Eliminación del spam grupal, respuesta predecible ante medios y óptima legibilidad móvil. |

---

## 7. Plan de Transición / Hoja de Ruta de Implementación

Para transicionar de la arquitectura actual a la propuesta modular sin interrumpir la operación ni provocar regresiones en las funcionalidades existentes, se define una hoja de ruta estructurada en **4 fases progresivas y desacopladas**:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│                        HOJA DE RUTA DE TRANSICIÓN ARQUITECTÓNICA                       │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ FASE 1: Extracción del Pipeline de Ingreso y Filtrado Contextual (Capa 1)               │
│ - Extraer deduplicador LRU y normalizador de JIDs a `src/core/pipeline/`.              │
│ - Implementar el `Group Boundary Gate` estricto en el servidor.                        │
│ - Resultado: Descarte inmediato del 100% de conversaciones ajenas en grupos de WhatsApp│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ FASE 2: Implementación de la FSM y Manejador de Ambigüedad Multimedia (Capa 3)         │
│ - Crear motor de Máquina de Estados Finitos en `src/core/fsm/` con TTL automático.     │
│ - Unificar sesiones dispersas (`descargar`, `blackjack`, `ruleta`, `cooperacha`).       │
│ - Implementar el micro-menú contextual para imágenes solitarias en grupos y privados.  │
│ - Resultado: Cero fallos silenciosos ante medios sin caption y resolución determinista. │
├────────────────────────────────────────────────────────────────────────────────────────┤
│ FASE 3: Desacoplamiento del Clasificador de Intents Nivelado (Capa 2)                  │
│ - Implementar el enrutador escalonado de 5 niveles en `src/core/router/`.              │
│ - Migrar los fast-paths dispersos de `dispatcher.js` hacia esquemas declarativos.      │
│ - Reducir `src/core/dispatcher.js` de 1,073 líneas a un orquestador menor a 150 líneas. │
│ - Resultado: Ejecución de comandos en < 5ms a costo cero de tokens y sin regexes rotas.│
├────────────────────────────────────────────────────────────────────────────────────────┤
│ FASE 4: Estandarización del Formateador de Salida y Micro-Copy Móvil (Capa 4)          │
│ - Centralizar el despacho saliente en `src/services/outbound/` con límites de tokens.  │
│ - Integrar el sanitizador nativo de Markdown y formateador de tablas para WhatsApp.    │
│ - Ejecutar suite de pruebas sintéticas E2E para verificar concisión y ergonomía móvil. │
│ - Resultado: Respuestas de 1-3 líneas, micro-copy accionable y cero volcado de terminal│
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 7.1. Detalle de Fases de Migración

#### Fase 1: Extracción del Pipeline de Ingreso y Filtrado Contextual (Capa 1)
- **Objetivo:** Frenar el spam grupal, normalizar identidades canónicas de forma previa al filtrado y absorber ráfagas de escritura rápida (multi-part typing).
- **Acciones:**
  1. Crear `src/core/pipeline/deduplicator.js` implementando una caché LRU en memoria con TTL de 60 segundos por `messageId`.
  2. Crear `src/core/pipeline/identityNormalizer.js` ejecutado inmediatamente tras el deduplicador y antes de cualquier compuerta o limitador, saneando números mexicanos (`521` a `52`), descartando sufijos de dispositivo vinculado (`:0`, `:12`) y mapeando identidades `@lid` hacia JIDs canónicos `@s.whatsapp.net`.
  3. Crear `src/core/pipeline/groupBoundaryGate.js` para aplicar la validación determinista de activación en grupos sobre identidades canónicas: mención real en `mentionedJid`, cita directa de mensaje de Botsky (`quotedParticipant === BOT_JID`), prefijo explícito (`!`, `/`) o sesión activa.
  4. Crear `src/core/pipeline/rateLimiter.js` implementando Token Bucket por remitente (2 req / 3s) y límite global por grupo (6 req / 5s) con política de desalojo LRU (máx 2,000 entradas, TTL 15 min).
  5. Crear `src/core/pipeline/coalescer.js` con búfer adaptativo/debounce de 1,000ms por clave `(ChatJID, UserJID)` para consolidar ráfagas de mensajes fragmentados antes de despachar a la Capa 2.
  6. En `src/core/server.js`, descartar silenciosamente cualquier mensaje grupal que no supere el gatekeeper antes de entrar a la cola.
- **Criterio de Aceptación:** Las charlas informales entre humanos en grupos de WhatsApp no generan consumo de CPU, encolamiento ni llamadas al LLM; las respuestas de usuarios con formato `521`, `@lid` o `:0` son reconocidas con precisión y las ráfagas consecutivas se unifican en un único prompt serializado.

#### Fase 2: Implementación de la FSM y Manejo de Ambigüedad (Capa 3)
- **Objetivo:** Resolver el caso de uso crítico de imágenes solitarias y consolidar la gestión de estados con un ciclo formal y resiliente de transiciones.
- **Acciones:**
  1. Crear `src/core/fsm/sessionStore.js` con soporte para claves canónicas `(ChatJID, UserJID, Domain)` y temporizadores TTL automáticos.
  2. Implementar `src/core/fsm/ambiguityHandler.js`: cuando un usuario envíe una imagen sin texto en privado, generar el sticker por defecto o presentar el micro-menú de 1 toque (Sticker, OCR, Guardar). En grupos, si fue directamente llamado, emitir el micro-menú interactivo.
  3. Dotar al estado `AWAITING_ATTACHMENT_ACTION` de transiciones completas:
     - Re-entrancia por nuevo adjunto o álbum (actualiza `activeId` y reinicia TTL a 90s).
     - Preempción inmediata ante comandos declarativos con prefijo (`!comando`).
     - Liberación a `IDLE` y re-enrutamiento al clasificador ante texto no numérico o divergente.
     - Limpieza silenciosa por expiración de TTL (`EXPIRED_CLEANUP`).
  4. Migrar las variables dispersas de sesión (`activeSession` en `descargar.js`, rondas de `blackjack.js`, sesiones de `cooperacha.js`) hacia el repositorio central de la FSM.
- **Criterio de Aceptación:** Se elimina la respuesta *"No tengo identificado ese archivo"* y el fallo silencioso ante multimedia en grupos; el envío de fotos de álbumes actualiza el adjunto activo sin bloquear al usuario en menús obsoletos.

#### Fase 3: Modularización del Clasificador de Intents (Capa 2)
- **Objetivo:** Desmantelar el monolito de `dispatcher.js`, optimizar latencia y costos, y dotar al sistema de degradación grácil ante caídas de IA.
- **Acciones:**
  1. Crear `src/core/router/tieredClassifier.js` con la estructura de 5 niveles (Tier 1 a Tier 5).
  2. Migrar los fast-paths de Mercado Negro, Hora Feliz, Cooperacha y Adultos a definiciones declarativas en `CommandRegistry`, eliminando los regexes permisivos con prefijos opcionales.
  3. Configurar el Tier 4 con salida estructurada JSON Schema para Groq y Gemini.
  4. Implementar el Circuit Breaker del Tier 5 con rescate heurístico local de descargas/stickers y ruta directa de degradación grácil hacia Capa 4, despachando el aviso micro-copy amigable `"[!] Mis neuronas de IA están en mantenimiento compa, pero los comandos con ! siguen jalando al 100."` ante fallos simultáneos de Gemini y Groq en consultas conversacionales.
- **Criterio de Aceptación:** Los comandos directos se resuelven en menos de 15 milisegundos, `dispatcher.js` se transforma en una fachada ligera y la indisponibilidad de proveedores de IA despacha avisos amigables sin caídas ni silencios inexplicables.

#### Fase 4: Estandarización del Formateador de Salida (Capa 4)
- **Objetivo:** Garantizar la ergonomía de lectura y la concisión móvil en WhatsApp.
- **Acciones:**
  1. Configurar techos máximos de salida de 300 tokens para respuestas estándar en los prompts del sistema.
  2. Implementar `src/services/outbound/microCopyFormatter.js` para asegurar que las confirmaciones se limiten a 1-2 líneas y los errores ofrezcan una solución accionable.
  3. Sustituir los volcados monolíticos de telemetría de Minecraft por resúmenes ejecutivos de 3 métricas esenciales.
  4. Activar el sanitizador de Markdown para WhatsApp y el throttling de 500ms entre mensajes consecutivos.
- **Criterio de Aceptación:** El 100% de las respuestas operativas se visualiza confortablemente en la pantalla de un teléfono móvil sin requerir scroll.

---

## 8. Conclusiones y Dictamen de Auditoría

1. **La causa raíz del mal funcionamiento no reside en la lógica de las herramientas individuales, sino en la ausencia de una arquitectura de entrada y control de estado formal.** La acumulación de parches para interpretar lenguaje natural derribó los límites de aislamiento perimetral del bot.
2. **El uso de modelos LLM como compuertas de filtrado de mensajes es un antipatrón en mensajería instantánea:** introduce latencia inaceptable, costos elevados, alucinaciones de direccionamiento y respuestas no deseadas.
3. **La experiencia móvil en WhatsApp exige concisión determinista:** los volcados enciclopédicos y los errores crípticos de consola degradan severamente la percepción de calidad del producto.
4. **La adopción de la Arquitectura Modular Limpia de 4 Capas resolverá de manera definitiva y sostenible todas las patologías detectadas**, garantizando alta mantenibilidad, ahorro del 65% en tokens de IA, respuesta sub-15ms en operaciones frecuentes y una experiencia conversacional fluida, respetuosa y libre de spam.

---
*Fin del Documento de Auditoría y Especificación Arquitectónica.*
