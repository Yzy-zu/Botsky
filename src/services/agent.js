'use strict';

const { executeBash, sanitizeOutput } = require('./terminal');
const { callGemini, formatHistoryForPrompt } = require('./ai');
const { getAiConfig } = require('./aiConfig');
const logger = require('./logger');

// Declaración de herramienta para Google Gemini API v1beta Function Calling
const TERMINAL_TOOL_DECLARATION = {
    functionDeclarations: [
        {
            name: 'ejecutar_terminal',
            description: 'Ejecuta comandos libres en la terminal Bash del servidor Linux (VPS) como el usuario petrov. Permite comandos completos del sistema, pipes (|), redirecciones (> o <), subshells (..), encadenamiento (&& o ||) y scripts. Devuelve stdout, stderr, código de salida y estado de timeout.',
            parameters: {
                type: 'OBJECT',
                properties: {
                    comando: {
                        type: 'STRING',
                        description: 'El comando o script Bash a ejecutar (ej: "uptime", "free -m", "docker ps", "cat /etc/os-release | grep VERSION", "df -h && ls -la", etc.)'
                    }
                },
                required: ['comando']
            }
        }
    ]
};

const MAX_TOOL_TURNS = 3;

/**
 * Trunca strings largas de salida de herramientas para optimizar tokens en la API de Gemini.
 * @param {string} str
 * @param {number} maxChars
 * @returns {string}
 */
function truncateForAgent(str, maxChars = 4000) {
    if (!str || typeof str !== 'string') return str || '';
    if (str.length <= maxChars) return str;
    const omitted = str.length - maxChars;
    return str.slice(0, maxChars) + `\n... [Salida truncada: ${omitted} caracteres omitidos para optimizar contexto Gemini]`;
}


/**
 * Ejecuta la herramienta de terminal solicitada por Gemini.
 * Gemini NO controla UID/GID (siempre petrov), ni timeout (fijo a 25s), ni límites de salida.
 *
 * @param {object} args - Argumentos enviados por Gemini { comando: string }
 * @returns {Promise<{ stdout: string, stderr: string, exitCode: number|null, success: boolean, timedOut: boolean, durationMs: number }>}
 */
async function handleTerminalTool(args) {
    const comando = args?.comando;
    if (!comando || typeof comando !== 'string') {
        return {
            stdout: '',
            stderr: 'Error: El parámetro "comando" es obligatorio y debe ser un string.',
            exitCode: 1,
            success: false,
            timedOut: false,
            durationMs: 0
        };
    }

    logger.info(`[AGENT-TERMINAL] Ejecutando comando Bash: "${comando.length > 80 ? comando.slice(0, 80) + '...' : comando}"`);
    return await executeBash(comando);
}

/**
 * Orquesta la interacción entre Gemini y la terminal Bash vía Function Calling.
 * Implementa el límite estricto de 2 tool turns:
 * Turn 1: Gemini -> tool_call(s) -> executeBash -> tool_result(s) -> Gemini
 * Turn 2: Gemini -> opcional tool_call(s) -> executeBash -> tool_result(s) -> Gemini
 * Final:  Gemini genera la respuesta explicativa final en texto.
 *
 * Si el modelo intenta un 3er tool call, se rechaza de inmediato y se detiene la ejecución.
 * Maneja llamadas múltiples a herramientas en una misma respuesta (Parallel Function Calling).
 * Captura errores de Gemini de forma controlada sin fugas de secretos ni Promise rejections sin manejar.
 *
 * @param {object} params
 * @param {string} params.userMessage - Mensaje o petición del usuario
 * @param {string} [params.userName] - Nombre del usuario
 * @param {string} [params.systemInstruction] - Instrucción del sistema opcional
 * @param {number} [params.maxTurns] - Límite de ciclos de herramientas (default: 2)
 * @param {number} [params.timeout] - Timeout total de red para Gemini
 * @returns {Promise<{ text: string, turnCount: number, executedTools: Array, limitReached: boolean, error?: string }>}
 */
async function runAgentWithTerminal({
    userMessage,
    userName = 'Admin',
    history = [],
    systemInstruction = null,
    maxTurns = MAX_TOOL_TURNS,
    timeout = 35000
}) {
    const defaultPrompt = `Eres Botsky, el bot administrador del servidor VPS Linux del grupo "Gente del señor chiqui 🐓".
Tienes acceso LIBRE a la terminal Bash como usuario 'petrov' vía la herramienta 'ejecutar_terminal'.
Puedes usar cualquier comando de Linux, scripts, pipes (|), redirecciones, subshells, docker, PM2, diagnósticos, etc.

TOPOLOGÍA DE SERVIDORES (INFRAESTRUCTURA):
- "miroslav" (HOST LOCAL): El servidor Linux donde corre Botsky (Node.js, SQLite, Evolution API). Por defecto, los comandos de terminal se ejecutan aquí.
- "redspi" (HOST REMOTO en 100.95.84.45 vía Tailscale): Servidor VPS donde corre el contenedor Docker de Minecraft Bedrock (mc-bedrock). Si el usuario pide explícitamente revisar, diagnosticar o ejecutar algo en "redspi" (ej: "cuánto espacio hay en redspi", "ram de redspi", "docker en redspi"), DEBES ejecutar el comando usando SSH: \`ssh -o BatchMode=yes redspi <comando>\` (ej: \`ssh -o BatchMode=yes redspi df -h /\`, \`ssh -o BatchMode=yes redspi free -h\`, \`ssh -o BatchMode=yes redspi docker ps\`). Tienes acceso SSH configurado por llave sin contraseña.

REGLAS ESTRICTAS DE FORMATO PARA WHATSAPP MÓVIL (CRUCIAL):
- PROHIBIDO TERMINANTEMENTE pegar tablas crudas de comandos de consola (como la salida completa sin procesar de 'df -h', 'free -m', 'docker ps', 'ps aux', 'top') dentro de bloques de código de ancho fijo (\`\`\`text ... \`\`\` o similares).
- En teléfonos móviles las pantallas son angostas (~30-35 caracteres de ancho). Las tablas monoespaciadas anchas SE ENROLLAN, SE DESALINEAN Y SE VEN HORRIBLES.
- PROCESA, EXTRAE Y SINTETIZA LOS DATOS TÉCNICOS en párrafos, listas o tablas Markdown. Si piden una tabla o comparas varios elementos, usa encabezados, separador | --- | --- | y filas fuera de bloques de código: Botsky la enviará como tabla nativa de WhatsApp. Mantén las mismas columnas en cada fila y celdas breves. Ejemplos de listas para WhatsApp:
  * Ejemplo para Disco:
    💾 *Almacenamiento en [miroslav / redspi]:*
    • *Partición raíz (/):* \`23 GB\` usados de \`145 GB\` (16% ocupado, 122 GB libres)
    • *Estado:* Sobrado de espacio, compa.
  * Ejemplo para Memoria:
    🧠 *Memoria RAM ([servidor]):*
    • *En uso:* \`1.2 GB\` de \`4.0 GB\` (30%)
    • *Libre:* \`2.8 GB\`
  * Ejemplo para Docker / Servicios:
    🐳 *Contenedores activos en [servidor]:*
    • *mc-bedrock:* Up 3 días (puerto 19132)
    • *cloudflared:* Up 2 semanas
- Solo si el usuario pide explícitamente "dame la salida literal" o "el log crudo", puedes incluir fragmentos de texto en código, pero nunca tablas anchas sin procesar.

PERSONALIDAD AL REPORTAR RESULTADOS:
- 100% mexicano callejero, golpeado, seco y directo. CERO modismos de España ("tío","hostia","chaval","vale") ni voseo ("querés","ponete").
- Por defecto ARISCO y con pocas pulgas. Reporta los datos técnicos con tono seco y competente, sin rodeos ni formalidades.
- Si algo está mal en el servidor (disco lleno, RAM alta, servicio caído), menciónalo con urgencia callejera ("Está hasta la madre de RAM", "El disco anda bien puto, queda pura madre de espacio").
- Si todo está bien, despacha rápido sin floreos ("Jala bien el server, no estés chingando").
- Usa caló mexicano variado. PROHIBIDO repetir muletillas. Nada de sermones ni explicaciones innecesarias.
- Varía longitud: si el resultado es simple, responde en 1-2 líneas. Si hay datos complejos, presenta las viñetas limpias y remata con tu opinión breve.

INSTRUCCIONES DE OPERACIÓN EN TERMINAL:
- Sé resolutivo y directo: Si el usuario te pide una acción concreta (ej: "reinicia X", "apaga Y", "borra Z", "mata el proceso W"), ejecuta directamente el comando correspondiente sin quedarte en solo mirar.
- Si el usuario pregunta por "redspi", USA SSH hacia redspi (\`ssh -o BatchMode=yes redspi <comando>\`). Si no especifica servidor o dice "el server/VPS", se refiere al servidor local ("miroslav") a menos que hable de Minecraft.
- Si la pregunta es sobre el espacio en disco o recursos del servidor sin especificar cuál ("cuánto espacio hay en el disco", "cómo anda el almacenamiento"), puedes checar la partición raíz local con \`df -h /\` o ambos servidores (\`df -h / && ssh -o BatchMode=yes redspi df -h /\`) y presentar los resultados claramente etiquetados para cada máquina (*miroslav* y *redspi*).
- Si no conoces el ID de un contenedor o proceso, investígalo rápido en un comando y en el siguiente turno ejecuta la acción solicitada sin rodeos ni vacilar.
- No gastes ciclos innecesarios repitiendo el mismo comando de inspección.`;

    const aiConfig = getAiConfig();
    const effectivePrompt = (aiConfig.agentPrompt && aiConfig.agentPrompt.trim())
        ? aiConfig.agentPrompt.trim()
        : defaultPrompt;

    const contextBlock = typeof formatHistoryForPrompt === 'function' ? formatHistoryForPrompt(history) : '';
    const systemPrompt = (systemInstruction || effectivePrompt) + (contextBlock ? `\n\n${contextBlock}` : '');

    const contents = [
        {
            role: 'user',
            parts: [{ text: `${userName}: ${userMessage}` }]
        }
    ];

    const executedTools = [];
    let turnCount = 0;
    const limit = typeof maxTurns === 'number' ? maxTurns : MAX_TOOL_TURNS;

    while (true) {
        // Si ya alcanzamos el límite de tool turns, ya no enviamos herramientas a Gemini para obligarlo a responder con texto
        const allowTools = turnCount < limit;
        const toolsToSend = allowTools ? [TERMINAL_TOOL_DECLARATION] : undefined;

        let modelContent = null;
        try {
            modelContent = await callGemini({
                systemInstruction: systemPrompt,
                contents,
                tools: toolsToSend,
                returnContent: true,
                temperature: 0.2,
                maxOutputTokens: 1000,
                timeout
            });
        } catch (apiErr) {
            const sanitizedErrMsg = sanitizeOutput(apiErr.message || 'Error de API Gemini');
            logger.error(`[AGENT] Error en llamada a Gemini (Turno ${turnCount + 1}): ${sanitizedErrMsg}`);

            // Si ya se ejecutó al menos una herramienta en un turno previo, informar el resultado previo de forma controlada
            if (executedTools.length > 0) {
                const lastTool = executedTools[executedTools.length - 1];
                const lastOutput = lastTool.result?.stdout?.trim() || lastTool.result?.stderr?.trim() || '';
                return {
                    text: `El comando se ejecutó en el servidor, pero ocurrió un error con la IA al generar la respuesta final (${sanitizedErrMsg}).${lastOutput ? '\n\nSalida del comando:\n' + lastOutput : ''}`,
                    turnCount,
                    executedTools,
                    limitReached: false,
                    error: sanitizedErrMsg
                };
            }

            // Si falló antes de ejecutar cualquier herramienta
            return {
                text: `No se pudo completar la operación en la terminal debido a un problema con el servicio de IA (${sanitizedErrMsg}).`,
                turnCount,
                executedTools,
                limitReached: false,
                error: sanitizedErrMsg
            };
        }

        if (!modelContent || !modelContent.parts) {
            return {
                text: 'No se recibió respuesta válida del modelo.',
                turnCount,
                executedTools,
                limitReached: false
            };
        }

        contents.push(modelContent);

        // Buscar todas las partes con functionCall (Parallel Function Calling)
        const fcParts = modelContent.parts.filter(p => p.functionCall && p.functionCall.name);

        if (fcParts.length === 0) {
            // El modelo terminó y devolvió texto final
            const finalText = modelContent.parts.map(p => p.text).filter(Boolean).join('\n').trim();
            return {
                text: finalText,
                turnCount,
                executedTools,
                limitReached: false
            };
        }

        // Si el modelo intentó llamar a herramientas pero ya se alcanzó el límite:
        if (turnCount >= limit) {
            for (const part of fcParts) {
                executedTools.push({
                    name: part.functionCall.name,
                    args: part.functionCall.args,
                    rejected: true,
                    reason: `Límite de ${limit} tool turns alcanzado`
                });
            }

            const partialText = modelContent.parts.map(p => p.text).filter(Boolean).join('\n').trim();
            let fallbackText = partialText;
            if (!fallbackText) {
                const validTools = executedTools.filter(t => !t.rejected && t.result);
                if (validTools.length > 0) {
                    const lastTool = validTools[validTools.length - 1];
                    const lastOut = lastTool?.result?.stdout?.trim() || lastTool?.result?.stderr?.trim() || '';
                    fallbackText = `Ya ejecuté las operaciones en la terminal, compa.${lastOut ? '\n\n' + lastOut : ''}`;
                } else {
                    fallbackText = `Se alcanzó el límite máximo de ${limit} ciclos de terminal para esta solicitud.`;
                }
            }
            return {
                text: fallbackText,
                turnCount,
                executedTools,
                limitReached: true
            };
        }

        // Múltiples function calls dentro del mismo turno cuentan como UN solo tool turn
        turnCount++;
        const toolResults = await Promise.all(fcParts.map(async (part) => {
            const { name, args } = part.functionCall;
            let toolResult = null;

            if (name === 'ejecutar_terminal') {
                toolResult = await handleTerminalTool(args);
            } else {
                toolResult = {
                    stdout: '',
                    stderr: `Herramienta no reconocida: "${name}"`,
                    exitCode: 1,
                    success: false,
                    timedOut: false
                };
            }

            return {
                name,
                args,
                result: toolResult,
                responsePart: {
                functionResponse: {
                    name,
                    response: {
                        stdout: truncateForAgent(toolResult.stdout),
                        stderr: truncateForAgent(toolResult.stderr),
                        exitCode: toolResult.exitCode,
                        success: toolResult.success,
                        timedOut: toolResult.timedOut
                    }
                }
                }
            };
        }));

        const functionResponseParts = toolResults.map(tool => {
            executedTools.push({
                name: tool.name,
                args: tool.args,
                result: tool.result,
                turn: turnCount
            });
            return tool.responsePart;
        });

        // Enviar todas las respuestas requeridas por Gemini en un solo turno role 'user'
        contents.push({
            role: 'user',
            parts: functionResponseParts
        });
    }
}

module.exports = {
    TERMINAL_TOOL_DECLARATION,
    MAX_TOOL_TURNS,
    handleTerminalTool,
    runAgentWithTerminal
};
