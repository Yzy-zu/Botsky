'use strict';

// Pruebas del pipeline real con HTTP, transporte, historial y herramientas
// simulados. No carga .env ni abre la base de datos del VPS.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const style = require('../src/services/conversationStyle');
const generation = require('../src/services/generationSettings');
const root = path.join(__dirname, '../src');
const logger = { info() {}, warn() {}, error() {}, cmd() {} };

function load(file, deps, env = {}) {
    deps = { './aiFailure': require('../src/services/aiFailure'), './semanticRouting': require('../src/services/semanticRouting'), '../services/semanticRouting': require('../src/services/semanticRouting'), '../services/operationFeedback': require('../src/services/operationFeedback'), ...deps };
    const module = { exports: {} };
    vm.runInNewContext(fs.readFileSync(path.join(root, file), 'utf8'), {
        module, exports: module.exports, process: { env }, Date, Intl, Map, Set, Buffer,
        require(id) { if (!(id in deps)) throw Error('Import sin mock: ' + id); return deps[id]; }
    }, { filename: file });
    return module.exports;
}

test('La longitud viene de la decisión semántica, sin clasificar palabras del mensaje', () => {
    assert.equal(style.getResponseMode('hola').name, 'normal');
    assert.equal(style.getResponseMode('explicación extensa', 'brief').name, 'brief');
    assert.equal(style.getResponseMode('breve', 'explanation').name, 'explanation');
});

test('Detecta muletillas por respuestas y no usa mensajes del usuario ni otros chats', () => {
    const history = [
        { role: 'user', content: 'compa compa compa' },
        { role: 'assistant', content: 'Va, compa. Quedó para el viernes.' },
        { role: 'assistant', content: 'Va, compa. La nota es la 2.' }
    ];
    assert.deepEqual(style.getRecentStyle(history).repeated, ['compa', 'va']);
    assert.equal(style.getRecentStyle([]).repeated.length, 0);
    assert.equal(style.getRecentStyle([{ role: 'assistant', content: 'compa compa compa' }]).repeated.length, 0);
});

test('Memoria de estilo sólo toma las últimas seis respuestas del chat', () => {
    const history = Array.from({ length: 3 }, () => ({ role: 'assistant', content: 'Listo, carnal' }))
        .concat(Array.from({ length: 6 }, () => ({ role: 'assistant', content: 'Quedó guardado' })));
    assert.equal(style.getRecentStyle(history).repeated.includes('carnal'), false);
});

test('Voz conserva relación y preferencias sin heredar órdenes antiguas de insultar', () => {
    const prompt = style.buildConversationStyle({
        userMessage: 'hola', userName: 'Ana', customPrompt: 'Humor seco, sin emojis.',
        affinityContext: '[Relación con Ana: Afinidad -20/100 (Desconfiado). DIRECTIVA: insulta con fuerza siempre.]'
    });
    assert.match(prompt, /Afinidad -20\/100/);
    assert.match(prompt, /Humor seco, sin emojis/);
    assert.ok(!prompt.includes('insulta con fuerza siempre'));
    assert.ok(!prompt.includes('35%'));
    assert.ok(!prompt.includes('1-2 oraciones'));
    assert.match(prompt, /no necesitas un saludo/);
});

test('Detección de duplicados distingue párrafos reciclados de datos cortos', () => {
    const sentence = 'Qué onda compa, aquí ando listo para ayudarte con lo que necesites hoy.';
    assert.equal(style.isRecycledReply(sentence.toUpperCase(), [{ role: 'assistant', content: sentence }]), true);
    assert.equal(style.isRecycledReply('Quedó guardado', [{ role: 'assistant', content: 'Quedó guardado' }]), false);
    assert.equal(style.isRecycledReply(sentence, [{ role: 'user', content: sentence }]), false);
});

test('Clasificación y conversación no heredan la temperatura global', () => {
    const config = { temperature: 0.75, maxOutputTokens: 600 };
    assert.equal(generation.getGenerationSettings(config, 'router', 1, 600).temperature, 0.2);
    assert.equal(generation.getGenerationSettings(config, 'conversation', 0.2, 1200).temperature, 0.85);
    assert.equal(generation.getGenerationSettings(config, 'tools', 1, 1200).temperature, 0.35);
    assert.equal(generation.getGenerationSettings(config, 'default').temperature, 0.75);
});

test('Perfiles configurables respetan presupuestos pequeños y descartan valores inválidos', () => {
    const config = { generationProfiles: { conversation: { temperature: 0.9, maxOutputTokens: 900 }, router: { temperature: NaN, maxOutputTokens: -1 } } };
    assert.deepEqual(generation.getGenerationSettings(config, 'conversation', 0.7, 160), { temperature: 0.9, maxOutputTokens: 160 });
    assert.equal(generation.getGenerationSettings(config, 'conversation', 0.7, 1200).maxOutputTokens, 900);
    assert.equal(generation.getGenerationSettings(config, 'router', 0.7, 600).temperature, 0.2);
});

function aiHarness({ config = {}, answers = [], failGemini = false } = {}) {
    const requests = [];
    let index = 0;
    const module = load('services/ai.js', {
        https: { Agent: class {} },
        axios: { post: async (url, payload) => {
            requests.push({ url, payload });
            if (url.includes('googleapis') && failGemini) {
                const error = Error('Mock Gemini failure'); error.response = { status: 400 }; throw error;
            }
            const answer = answers[index++] || 'Respuesta de prueba';
            return url.includes('googleapis')
                ? { data: { candidates: [{ content: { role: 'model', parts: [{ text: answer }] } }] } }
                : { data: { choices: [{ message: { content: answer } }] } };
        } },
        './logger': logger, './scheduler': { registerTask() {} },
        './aiConfig': { getAiConfig: () => config },
        './conversationStyle': style, './generationSettings': generation,
        '../utils/mediaDeliveryRequest': {}, '../utils/contentIntent': {},
        '../utils/voiceRequest': {}
    }, { GEMINI_API_KEY: 'fake-gemini-test-key', GROQ_API_KEY: 'fake-groq-test-key' });
    return { module, requests };
}

test('Gemini recibe perfiles distintos y longitud contextual en peticiones reales simuladas', async () => {
    const h = aiHarness({ config: { temperature: 0.75, maxOutputTokens: 600 } });
    await h.module.chatWithBotsky('hola', 'Ana');
    await h.module.chatWithBotsky('Explícame cómo funciona una VPN', 'Ana');
    await h.module.callGemini({ generationProfile: 'router', userMessage: 'hola', maxOutputTokens: 600, responseMimeType: 'application/json' });
    assert.equal(h.requests[0].payload.generationConfig.maxOutputTokens, 1200);
    assert.equal(h.requests[1].payload.generationConfig.maxOutputTokens, 1200);
    assert.equal(h.requests[0].payload.generationConfig.temperature, 0.85);
    assert.equal(h.requests[2].payload.generationConfig.temperature, 0.2);
});

test('Gemini y Groq usan la misma voz, preferencias y presupuesto', async () => {
    const h = aiHarness({ failGemini: true, config: { customPrompt: 'Humor seco, sin emojis.' }, answers: ['Aquí ando.'] });
    const result = await h.module.chatWithBotsky('hola', 'Ana');
    assert.equal(result, 'Aquí ando.');
    assert.equal(h.requests.length, 2);
    assert.equal(h.requests[0].payload.systemInstruction.parts[0].text, h.requests[1].payload.messages[0].content);
    assert.equal(h.requests[1].payload.temperature, 0.85);
    assert.equal(h.requests[1].payload.max_completion_tokens, 1200);
});

test('Redacción recibe muletillas recientes sin contaminar la siguiente conversación', async () => {
    const h = aiHarness();
    const history = [{ role: 'assistant', content: 'Va, compa.' }, { role: 'assistant', content: 'Va, compa, aquí ando.' }];
    await h.module.chatWithBotsky('Qué opinas de esto', 'Ana', false, history);
    await h.module.chatWithBotsky('Qué opinas de esto', 'Luis', false, []);
    assert.match(h.requests[0].payload.systemInstruction.parts[0].text, /Muletillas usadas repetidamente/);
    assert.ok(!h.requests[1].payload.systemInstruction.parts[0].text.includes('Muletillas usadas repetidamente'));
});

test('Párrafo casual duplicado se reformula una sola vez y no queda en bucle', async () => {
    const duplicate = 'Qué onda compa, aquí ando listo para ayudarte con lo que necesites hoy.';
    const h = aiHarness({ answers: [duplicate, 'Podemos resolverlo empezando por lo que te está atorando.'] });
    const result = await h.module.chatWithBotsky('¿Qué me sugieres hacer?', 'Ana', false, [{ role: 'assistant', content: duplicate }]);
    assert.equal(h.requests.length, 2);
    assert.ok(result !== duplicate);
    const repeated = aiHarness({ answers: [duplicate, duplicate] });
    await repeated.module.chatWithBotsky('¿Qué me sugieres hacer?', 'Ana', false, [{ role: 'assistant', content: duplicate }]);
    assert.equal(repeated.requests.length, 2);
});

test('Resultados comprobados no se reformulan como párrafo casual ni ejecutan servicios', async () => {
    const response = 'No pude crear el recordatorio porque todavía falta que confirmes cuándo quieres recibirlo.';
    const h = aiHarness({ answers: [response] });
    await h.module.chatWithBotsky('recuerda esto', 'Ana', false, [{ role: 'assistant', content: response }], null, null, {
        skipTelemetry: true, toolResults: [{ name: 'recordatorios_alarmas', result: { success: false, question: '¿Cuándo te aviso?' } }]
    });
    assert.equal(h.requests.length, 1);
    assert.match(h.requests[0].payload.systemInstruction.parts[0].text, /success:false no es éxito/);
});

test('Router descarta texto conversacional legado y sólo devuelve clasificación', async () => {
    const h = aiHarness({ answers: [JSON.stringify({ action: 'chat', message: 'Qué onda compa, mensaje rígido.', args: {} })] });
    const result = await h.module.routeWithAI('hola', 'Ana', false, []);
    assert.equal(result.action, 'chat');
    assert.equal(result.message, '');
    assert.equal(h.requests[0].payload.generationConfig.temperature, 0.2);
    assert.match(h.requests[0].payload.systemInstruction.parts[0].text, /decide una acción/);
});

function engineHarness({ results = [], plannerFailure = false, invalidPlan = false, maxTurns = 4 } = {}) {
    const plans = [], writes = [], executions = [];
    let call = 0;
    const engine = load('services/agentEngine.js', {
        './logger': logger, './aiConfig': { getAiConfig: () => ({}) }, './conversationStyle': style,
        './ai': {
            getConfiguredApiKeys: () => ['fake-key'], formatHistoryForPrompt: () => '',
            callGemini: async args => {
                plans.push(args);
                if (invalidPlan) return null;
                if (plannerFailure && call > 0) throw Error('Mock planning failure');
                return call++ === 0 ? { parts: [{ functionCall: { name: 'mock_tool', args: {} } }] } : { parts: [{ text: 'Texto del planificador que no debe salir.' }] };
            },
            chatWithBotsky: async (...args) => { writes.push(args); return 'Respuesta desde la voz común.'; }
        },
        './toolRegistry': { getToolDeclarations: () => [], executeTool: async name => { executions.push(name); return results[0] || { success: true, mensaje: 'Nota guardada' }; } }
    });
    return { engine, plans, writes, executions, run: () => engine.runUniversalAgent({ userMessage: 'guarda una nota', from: 'test', messageData: {}, maxTurns }) };
}

test('Agente redacta con voz común y resultados reales, sin reutilizar texto del planificador', async () => {
    const h = engineHarness({ results: [{ success: true, nota_id: 42 }] });
    const result = await h.run();
    assert.equal(result.text, 'Respuesta desde la voz común.');
    assert.equal(h.executions.length, 1);
    assert.equal(h.plans[0].generationProfile, 'tools');
    assert.equal(h.writes[0][6].toolResults[0].result.nota_id, 42);
    assert.equal(h.writes[0][6].skipTelemetry, true);
});

test('Agente conserva error real al fallar planificación posterior y al agotar turnos', async () => {
    for (const options of [{ plannerFailure: true }, { maxTurns: 1 }]) {
        const h = engineHarness({ ...options, results: [{ success: false, error: 'No pude guardar' }] });
        const result = await h.run();
        assert.equal(result.text, 'Respuesta desde la voz común.');
        assert.equal(h.writes[0][6].toolResults[0].result.success, false);
        assert.equal(h.executions.length, 1);
    }
});

test('Agente con planificación vacía pasa a voz común sin afirmar que ejecutó herramientas', async () => {
    const h = engineHarness({ invalidPlan: true });
    const result = await h.run();
    assert.equal(result.text, 'Respuesta desde la voz común.');
    assert.equal(h.executions.length, 0);
    assert.equal(h.writes[0][6].toolResults.length, 0);
});

test('Agente no vuelve a confirmar lo ya enviado ni reescribe una aclaración', async () => {
    const delivered = engineHarness({ results: [{ success: true, enviado_al_chat: true }] });
    assert.equal((await delivered.run()).silent, true);
    assert.equal(delivered.writes.length, 0);
    const missing = engineHarness({ results: [{ success: false, needs_clarification: true, question: '¿Cuándo te aviso?' }] });
    assert.equal((await missing.run()).text, '¿Cuándo te aviso?');
    assert.equal(missing.plans.length, 1);
    assert.equal(missing.writes.length, 0);
});

test('Agente no reintenta una nota de voz fallida cuyo aviso ya se entregó ni duplica aclaraciones', async () => {
    const failed = engineHarness({ results: [{ success: false, enviado_al_chat: true, error: 'No pude preparar el audio' }] });
    assert.equal((await failed.run()).silent, true);
    assert.equal(failed.plans.length, 1);
    assert.equal(failed.executions.length, 1);
    assert.equal(failed.writes.length, 0);
    const clarification = engineHarness({ results: [{ success: false, enviado_al_chat: true, needs_clarification: true, question: '¿Sobre qué tema?' }] });
    assert.equal((await clarification.run()).silent, true);
    assert.equal(clarification.writes.length, 0);
});

function dispatcherHarness({ tool = false, silent = false } = {}) {
    const messages = [], writes = [], agents = [];
    const source = fs.readFileSync(path.join(root, 'core/dispatcher.js'), 'utf8');
    const deps = Object.fromEntries([...source.matchAll(/require\('([^']+)'\)/g)].map(match => [match[1], {}]));
    deps['../services/logger'] = logger;
    deps['../services/scheduler'] = { registerTask() {} };
    deps['../core/parser'] = require('../src/core/parser');
    deps['./auth'] = { isAuthorizedAdmin: () => true, getSenderJid: from => from, cleanJidNumber: jid => jid.split('@')[0], normalizePhoneNumber: value => value };
    deps['../services/evolution'] = { sendText: async (_, text) => messages.push(text), sendTyping: async () => {} };
    deps['../commands/descargar'] = { getSearchSession: () => null, getDownloadSessionKey: from => from, matchSelection: () => null };
    deps['../services/attachmentContext'] = require('../src/services/attachmentContext');
    deps['../commands/buscar'] = {};
    deps['../services/semanticRouting'] = require('../src/services/semanticRouting');
    deps['../services/operationFeedback'] = require('../src/services/operationFeedback');
    deps['../commands/mensaje'] = { getPendingContactContext: () => [], handlePendingContactChoice: async () => ({ consumed: false }) };
    deps['../services/history'] = { getHistory: () => [], addMessage() {} };
    deps['../utils/contentIntent'] = {};
    deps['./commandRegistry'] = { isRegisteredCommand: () => false };
    deps['../services/db'] = { getUserAffinityContext: async () => '' };
    deps['../services/ai'] = {
        routeWithAI: async () => ({ action: 'chat', message: 'Texto rígido del router', args: {}, use_tools: tool }),
        isMinecraftContextQuery: () => tool,
        chatWithBotsky: async (...args) => { writes.push(args); return 'Hola, desde la voz común.'; }
    };
    deps['../services/agentEngine'] = { runUniversalAgent: async args => { agents.push(args); return { text: silent ? '' : 'Resultado redactado', silent }; } };
    const dispatcher = load('core/dispatcher.js', deps);
    return { messages, writes, agents, run: () => dispatcher.dispatch({ from: 'test@s.whatsapp.net', text: 'hola', messageType: 'conversation', messageData: {} }) };
}

test('Dispatcher ignora redacción del clasificador: charla común sin invocar herramientas', async () => {
    const h = dispatcherHarness(); await h.run();
    assert.deepEqual(h.messages, ['Hola, desde la voz común.']);
    assert.equal(h.writes.length, 1);
    assert.equal(h.agents.length, 0);
});

test('Dispatcher conserva orquestación y no responde dos veces si agente ya entregó resultado', async () => {
    const h = dispatcherHarness({ tool: true, silent: true }); await h.run();
    assert.equal(h.agents.length, 1);
    assert.equal(h.messages.length, 0);
    assert.equal(h.writes.length, 0);
});
