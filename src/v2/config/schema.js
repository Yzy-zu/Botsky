// @ts-check
'use strict';

/** @typedef {'string'|'list'|'boolean'|'integer'|'number'|'url'|'timezone'|'hex32'|'enum'} EnvType */
/** @typedef {string|number|boolean|readonly string[]|undefined} ConfigValue */
/** @typedef {{type:EnvType, default:ConfigValue, description:string, secret:boolean,
 * min?:number,max?:number,values?:readonly string[], aliasFor?:string,scope?:string}} EnvDefinition */

/** @type {Record<string, EnvDefinition>} */
const definitions = {};
/** @param {string} name @param {EnvType} type @param {ConfigValue} fallback
 * @param {string} description @param {Partial<EnvDefinition>} [extra] */
function define(name, type, fallback, description, extra = {}) {
    definitions[name] = Object.freeze({ type, default: Array.isArray(fallback) ? Object.freeze([...fallback]) : fallback,
        description, secret: false, ...extra });
}

define('TZ', 'timezone', 'America/Mexico_City', 'Zona IANA para horarios y calendarios.');
define('EVOLUTION_API_URL', 'url', 'http://localhost:8080', 'URL HTTP(S) de Evolution.');
define('EVOLUTION_API_KEY', 'string', '', 'Credencial de Evolution; requerida al conectar.', { secret: true });
define('EVOLUTION_INSTANCE', 'string', 'Botsky', 'Nombre de instancia Evolution.');
define('WEBHOOK_PORT', 'integer', 3000, 'Puerto de escucha webhook.', { min: 1, max: 65535 });
define('WEBHOOK_HOST', 'string', '0.0.0.0', 'Interfaz configurable del servidor webhook.');
define('WEBHOOK_URL', 'url', '', 'URL pública webhook; plantilla legacy, opcional.');
define('WEBHOOK_SECRET', 'string', '', 'Secreto del header webhook v2; configurar antes de activar verificación.', { secret: true });
define('WEBHOOK_BODY_LIMIT_MB', 'number', 50, 'Límite body; conserva 50 MB legacy hasta revisión operacional.', { min: 0.001 });
for (const name of ['ALLOWED_GROUPS_NORMAL', 'ALLOWED_NUMBERS_NORMAL', 'ALLOWED_GROUPS_ADMIN', 'ALLOWED_NUMBERS_ADMIN', 'ALLOWED_NUMBERS_TASKS']) {
    define(name, 'list', [], 'Allowlist de JIDs/números separados por coma; comparar igualdad normalizada.', { secret: true });
}
define('BOT_NUMBER', 'string', '', 'Número propio para normalizar identidad; sin teléfono hardcodeado.', { secret: true });
define('BOT_LID', 'string', '', 'Alias LID propio verificado para reconocer menciones y citas; nunca inferido del teléfono.', { secret: true });
for (const [name, fallback, description] of [
    ['TMP_DIR', '/tmp/whatsapp-bot', 'Directorio temporal multimedia.'],
    ['DATA_DIR', './data', 'Directorio durable de datos.'],
    ['FOTOS_DIR', './data/fotos', 'Biblioteca local packs/cooperacha; sustituye ruta de usuario legacy.'],
    ['RIKOLINO_DIR', './data/rikolino', 'Biblioteca local rikolino; configurar antes de portar feature.'],
    ['TV_SCRIPT_DIR', './scripts/tv', 'Scripts de TV; sustituye directorio del usuario legacy.'],
    ['BACKUPS', './backups', 'Directorio respaldos; variable de plantilla legacy.'],
    ['LEGACY_COMMAND_USAGE_DB', './data/command-usage.db', 'Sidecar SQLite telemetría separado del negocio.'],
    ['YOUTUBE_COOKIES_FILE', '', 'Cookies yt-dlp; archivo opcional.'],
    ['MINECRAFT_BASE_PATH', './data/minecraft', 'Directorio remoto Minecraft; configurar al activar adapter.'],
    ['BOTSKY_PRODUCTION_DIR', '.', 'Checkout operacional elegido explícitamente por operador.'],
    ['BOTSKY_BASELINE_IMAGE', 'node:20-bookworm', 'Imagen para runner aislado; operador puede fijar digest.'],
    ['BOTSKY_BASELINE_OUTPUT', '/tmp/botsky-v2-baseline.tap', 'Salida runner baseline aislado.']
]) define(name, 'string', fallback, description);
define('BOTSKY_LEGACY_VERIFICATION_IMAGE', 'string', 'botsky/legacy-verification:node20', 'Imagen de pruebas legacy con herramientas y fixtures aislados.', { scope: 'operator-only' });
define('BOTSKY_LEGACY_VERIFICATION_OUTPUT', 'string', '/tmp/botsky-legacy-verification.tap', 'Salida TAP del entorno legacy reproducible.', { scope: 'operator-only' });
define('BOTSKY_LEGACY_LIBRARY_SOURCE', 'string', '', 'Archivo productor Rikolino para preparar fixture externo; proporcionar ruta al construir la imagen.', { scope: 'operator-only' });
define('COOKIES_FILE', 'string', '', 'Alias legacy de cookies; prevalece YOUTUBE_COOKIES_FILE.', { aliasFor: 'YOUTUBE_COOKIES_FILE' });
define('LEGACY_COMMAND_USAGE_ENABLED', 'boolean', false, 'Telemetría v1 opcional; sin inicialización si está apagada.');
for (const [name, fallback, description] of [
    ['MAX_FILE_SIZE_MB', 64, 'Límite envío/descarga medios; default real legacy 64, plantilla anterior 100.'],
    ['MAX_DOCUMENT_SIZE_MB', 200, 'Límite documento; legacy aplica piso 200 aunque plantilla indicaba 50.'],
    ['WHATSAPP_MAX_MEDIA_MB', 50, 'Límite salida yt-dlp.'],
    ['WHATSAPP_MAX_MB', 50, 'Alias legacy de WHATSAPP_MAX_MEDIA_MB.']
]) define(String(name), 'number', Number(fallback), String(description), { min: 0.001 });
definitions.WHATSAPP_MAX_MB = Object.freeze({ ...definitions.WHATSAPP_MAX_MB, aliasFor: 'WHATSAPP_MAX_MEDIA_MB' });
for (const [name, fallback, description] of [
    ['MAX_QUEUE_PER_USER', 3, 'Límite compartido fallback por usuario.'],
    ['MAX_QUEUE_LIGHT', 5, 'Límite cola light; fallback a MAX_QUEUE_PER_USER si explícito.'],
    ['MAX_QUEUE_HEAVY', 3, 'Límite cola heavy; fallback a MAX_QUEUE_PER_USER si explícito.'],
    ['MAX_AI_CONCURRENCY', 3, 'Llamadas IA simultáneas.'],
    ['RAM_WARN_MB', 700, 'Umbral aviso memoria RSS.'],
    ['RAM_CRIT_MB', 900, 'Umbral crítico memoria RSS.'],
    ['GROUP_CONTEXT_MESSAGES', 10, 'Ventana de contexto; variable de plantilla legacy.'],
    ['GEMINI_TIMEOUT_MS', 12000, 'Timeout estándar Gemini; overrides por tarea en adapter.'],
    ['MINECRAFT_CMD_TIMEOUT', 15000, 'Timeout remoto Minecraft en ms.'],
    ['REFRACTOR_CAPTURE_LIMIT', 50, 'Tope envelopes de captura Fase 0.'],
    ['REFRACTOR_CAPTURE_DURATION', 900000, 'Duración máxima captura Fase 0 en ms.']
]) define(String(name), 'integer', Number(fallback), String(description), { min: 1 });
define('MESSAGE_DEBOUNCE_MS', 'integer', 1200, 'Espera coalescer en ms; 0 desactiva debounce.', { min: 0 });
define('WHISPER_MODEL', 'string', 'small', 'Modelo Whisper; variable de plantilla legacy.');
define('WHISPER_LANGUAGE', 'string', 'auto', 'Idioma Whisper; default real legacy auto, plantilla anterior es.');
define('WHISPER_DEVICE', 'string', 'cpu', 'Dispositivo faster-whisper del script Python (p. ej. cpu/cuda).');
define('WHISPER_COMPUTE_TYPE', 'string', 'int8', 'Precisión faster-whisper del script Python.');
define('YTDLP_DEFAULT_QUALITY', 'integer', 480, 'Altura video; default real legacy 480, plantilla anterior 720.', { min: 1 });
define('YTDLP_DEFAULT_AUDIO_QUALITY', 'integer', 192, 'Bitrate audio kbps.', { min: 1 });
define('SPOTIFY_CLIENT_ID', 'string', '', 'Cliente Spotify; variable de plantilla legacy.', { secret: true });
define('SPOTIFY_CLIENT_SECRET', 'string', '', 'Secreto Spotify; variable de plantilla legacy.', { secret: true });
define('DRIVE_FOLDER_ID', 'string', '', 'Carpeta destino Drive; requerido por su feature.', { secret: true });
define('MASTER_KEY', 'hex32', '', 'Clave hexadecimal de 32 bytes para tokens OAuth2.', { secret: true });
define('ELEVENLABS_API_KEY', 'string', '', 'Credencial ElevenLabs opcional.', { secret: true });
for (const name of ['GEMINI_API_KEY', 'GEMINI_API_KEY_2', 'GEMINI_API_KEY_3', 'GEMINI_API_KEYS']) {
    define(name, 'list', [], 'Claves Gemini separadas por coma; orden principal, numeradas, lista múltiple.', { secret: true });
}
define('GEMINI_MODEL', 'string', 'gemini-3.5-flash-lite', 'Modelo Gemini configurable; no valida disponibilidad externa.');
define('GROQ_API_KEY', 'string', '', 'Credencial Groq opcional.', { secret: true });
define('GROQ_MODEL', 'string', 'openai/gpt-oss-20b', 'Modelo Groq chat; legacy Whisper tiene override propio.');
define('MINECRAFT_SSH_HOST', 'string', '', 'Destino SSH Minecraft; requerido al conectar, sin host personal default.');
define('MINECRAFT_CONTAINER', 'string', 'mc-bedrock', 'Contenedor remoto Bedrock.');
define('MINECRAFT_HOST', 'string', '127.0.0.1', 'Host Bedrock; variable de plantilla legacy.');
define('MINECRAFT_PORT', 'integer', 19132, 'Puerto Bedrock; variable de plantilla legacy.', { min: 1, max: 65535 });
define('DOCKER_HOST', 'string', '', 'Endpoint Docker; no asumir que nombre contenedor es endpoint.');
define('USE_TOOL_REGISTRY', 'boolean', true, 'Variable muerta legacy conservada en inventario; pendiente DROP del cliente.', { scope: 'legacy-only' });
define('REFRACTOR_CAPTURE_ENABLED', 'boolean', false, 'Captura operacional sanitizada; ortografía legacy REFRACTOR preservada.');
define('REFRACTOR_CAPTURE_DIR', 'string', '', 'Destino captura operacional temporal.');
define('REFRACTOR_CAPTURE_BOT_JID', 'string', '', 'JID propio para clasificar cita del bot durante captura.', { secret: true });
define('REFRACTOR_CAPTURE_BOT_ALIASES', 'list', [], 'Identidades alternativas propias durante captura.', { secret: true });
define('REFRACTOR_CAPTURE_DEDUPE', 'boolean', false, 'Deduplicación de envelopes capturados.');
define('PIPELINE_MODE', 'enum', 'legacy', 'Dueño del pipeline; sombra nunca ejecuta efectos.', { values: Object.freeze(['legacy', 'shadow', 'canary', 'v2']) });
define('V2_CANARY_CHAT_IDS', 'list', [], 'Chats explícitos del canario; primer escalón solo privado del cliente.', { secret: true, scope: 'operator-only' });
define('V2_CANARY_FEATURES', 'list', ['qr','help','system-info'], 'Features habilitadas en el canario; ampliar únicamente tras sus pruebas de migración.', { scope: 'operator-only' });
define('BOTSKY_SHADOW_OUTPUT', 'string', '', 'Archivo exclusivo por ejecución para diffs de sombra sin datos personales.', { scope: 'operator-only' });
define('SESSION_GROUP_RELAXED', 'boolean', false, 'Relajar selección de sesión solo por configuración aprobada.');
define('FEATURE_ADMIN_TERMINAL', 'boolean', false, 'Terminal v2 desactivable; revisar cambio de producto antes de activar.');
define('FEATURE_ADULT_MEDIA', 'boolean', false, 'Preparación flag v2; disponibilidad final requiere decisión de producto.');
define('PROACTIVE_ENABLED', 'boolean', false, 'Kill-switch global; además requiere opt-in por chat.');
define('PROACTIVE_PRIVATE_REVENGE', 'boolean', false, 'Seguimiento privado proactivo desactivado por defecto.');
define('PROACTIVE_MAX_PER_DAY', 'integer', 3, 'Cuota diaria proactividad por chat.', { min: 0 });
define('PROACTIVE_MIN_INTERVAL_MS', 'integer', 2700000, 'Separación mínima proactividad 45 minutos.', { min: 0 });
define('PROACTIVE_QUIET_START', 'string', '23:00', 'Inicio silencio diario HH:mm.');
define('PROACTIVE_QUIET_END', 'string', '08:00', 'Fin silencio diario HH:mm.');
for (const [name, fallback, description] of [
    ['RESPONSE_PRIVATE_MAX_CHARS', 600, 'Presupuesto chat privado.'],
    ['RESPONSE_GROUP_MAX_CHARS', 350, 'Presupuesto chat grupal.'],
    ['LLM_CHAT_MAX_OUTPUT_TOKENS', 300, 'Tokens salida chat.'],
    ['LLM_ROUTE_MAX_OUTPUT_TOKENS', 120, 'Tokens salida routing.'],
    ['LLM_AGENT_MAX_OUTPUT_TOKENS', 600, 'Tokens salida agent.'],
    ['LLM_VISION_MAX_OUTPUT_TOKENS', 1500, 'Tokens salida lectura/vision.']
]) define(String(name), 'integer', Number(fallback), String(description), { min: 1 });

const ENV_SCHEMA = Object.freeze(definitions);
const DYNAMIC_ENV_PATTERNS = Object.freeze([Object.freeze({ pattern: /^GEMINI_API_KEY_[1-9]\d*$/,
    type: 'list', secret: true, description: 'Claves Gemini numeradas adicionales, orden numérico; valores CSV.' })]);
// Passed to child processes by the system adapter, not interpreted as bot settings.
const INFRASTRUCTURE_ENV = Object.freeze(['HOME', 'PATH', 'USER', 'SHELL', 'NODE_ENV', 'NODE_OPTIONS', 'DATABASE_URL',
    'npm_config_cache', 'npm_config_nodedir', 'npm_config_build_from_source', 'PM2_HOME', 'KMP_DUPLICATE_LIB_OK']);

module.exports = { ENV_SCHEMA, DYNAMIC_ENV_PATTERNS, INFRASTRUCTURE_ENV };
