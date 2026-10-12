'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });
const test = require('node:test');
const assert = require('node:assert/strict');

const evolution = require('../src/services/evolution');
const agent = require('../src/services/agent');
const ai = require('../src/services/ai');
const { isAuthorizedAdmin, getSenderJid, cleanJidNumber } = require('../src/core/auth');
const { dispatch, _resetCooldowns } = require('../src/core/dispatcher');

// ─── 1. Pruebas Unitarias de Autenticación y Extracción de JID ────────────────

test('Auth: cleanJidNumber normaliza números eliminando servidor y dispositivo', () => {
    assert.strictEqual(cleanJidNumber('5215512345678@s.whatsapp.net'), '5215512345678');
    assert.strictEqual(cleanJidNumber('5215512345678:2@s.whatsapp.net'), '5215512345678');
    assert.strictEqual(cleanJidNumber('120363045678901234@g.us'), '120363045678901234');
    assert.strictEqual(cleanJidNumber('+52 1 55 1234-5678'), '5215512345678');
    assert.strictEqual(cleanJidNumber(null), '');
    assert.strictEqual(cleanJidNumber(''), '');
});

test('Auth: getSenderJid extrae el participante en grupos y from en privados', () => {
    // Grupo: debe extraer de key.participant o participant
    const groupMsg = {
        from: '120363045678901234@g.us',
        messageData: { key: { participant: '5215511111111@s.whatsapp.net' } }
    };
    assert.strictEqual(getSenderJid(groupMsg.from, groupMsg.messageData), '5215511111111@s.whatsapp.net');

    // Privado: extrae from si no hay participant
    const privateMsg = {
        from: '5215522222222@s.whatsapp.net',
        messageData: {}
    };
    assert.strictEqual(getSenderJid(privateMsg.from, privateMsg.messageData), '5215522222222@s.whatsapp.net');
});

test('Auth: isAuthorizedAdmin valida JID contra ALLOWED_NUMBERS_ADMIN', () => {
    const origEnv = process.env.ALLOWED_NUMBERS_ADMIN;
    process.env.ALLOWED_NUMBERS_ADMIN = '5215512345678, 5215587654321';

    try {
        // Admin autorizado en privado
        assert.strictEqual(isAuthorizedAdmin('5215512345678@s.whatsapp.net', {}), true);
        // Admin autorizado en grupo
        assert.strictEqual(isAuthorizedAdmin('120363045678901234@g.us', {
            key: { participant: '5215587654321:3@s.whatsapp.net' }
        }), true);
        // Usuario NO autorizado en privado
        assert.strictEqual(isAuthorizedAdmin('5219999999999@s.whatsapp.net', {}), false);
        // Usuario NO autorizado en grupo
        assert.strictEqual(isAuthorizedAdmin('120363045678901234@g.us', {
            key: { participant: '5219999999999@s.whatsapp.net' }
        }), false);
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origEnv;
    }
});

test('Auth: pushName o userName "Admin" NO confiere privilegios (Anti-Spoofing)', () => {
    const origEnv = process.env.ALLOWED_NUMBERS_ADMIN;
    process.env.ALLOWED_NUMBERS_ADMIN = '5215512345678';

    try {
        const fakeAdmin = {
            pushName: 'Admin',
            userName: 'Admin',
            key: { participant: '5219999999999@s.whatsapp.net' }
        };
        assert.strictEqual(isAuthorizedAdmin('120363045678901234@g.us', fakeAdmin), false);
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origEnv;
    }
});

test('Auth: fail-closed cuando no hay ALLOWED_NUMBERS_ADMIN configurado', () => {
    const origEnv = process.env.ALLOWED_NUMBERS_ADMIN;
    delete process.env.ALLOWED_NUMBERS_ADMIN;

    try {
        // Sin configuración, nadie tiene acceso (fail-closed)
        assert.strictEqual(isAuthorizedAdmin('5215512345678@s.whatsapp.net', {}), false);
        assert.strictEqual(isAuthorizedAdmin('120363045678901234@g.us', {
            key: { participant: '5215512345678@s.whatsapp.net' }
        }), false);
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origEnv;
    }
});

// ─── 2. Pruebas de Integración con el Dispatcher de WhatsApp ──────────────────

test('Dispatcher: Usuario autorizado invocando /@terminal ejecuta runAgentWithTerminal', async () => {
    _resetCooldowns();
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;
    const origNormal = process.env.ALLOWED_NUMBERS_NORMAL;
    const origHttp = evolution.client.post;
    const origRunAgent = agent.runAgentWithTerminal;
    const origRoute = ai.routeWithAI;

    process.env.ALLOWED_NUMBERS_ADMIN = '5215512345678';
    process.env.ALLOWED_NUMBERS_NORMAL = '5215512345678';

    let agentCalled = false;
    let agentReceivedParams = null;
    let sentMessages = [];

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    ai.routeWithAI = async () => ({
        action: 'terminal',
        args: { comando: 'uptime' }
    });

    agent.runAgentWithTerminal = async (params) => {
        agentCalled = true;
        agentReceivedParams = params;
        return {
            text: 'Servidor VPS activo y operando al 100%.',
            turnCount: 1,
            executedTools: [{ name: 'ejecutar_terminal' }],
            limitReached: false
        };
    };

    try {
        await dispatch({
            from: '5215512345678@s.whatsapp.net',
            text: '/@terminal uptime',
            messageType: 'conversation',
            messageData: {
                pushName: 'Petrov Admin'
            }
        });

        assert.strictEqual(agentCalled, true, 'runAgentWithTerminal debió ser llamado');
        assert.strictEqual(agentReceivedParams.userMessage, 'uptime');
        assert.strictEqual(agentReceivedParams.userName, 'Petrov Admin');
        assert.ok(sentMessages.some(m => m.text.includes('Servidor VPS activo y operando al 100%')));
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
        process.env.ALLOWED_NUMBERS_NORMAL = origNormal;
        evolution.client.post = origHttp;
        agent.runAgentWithTerminal = origRunAgent;
        ai.routeWithAI = origRoute;
    }
});

test('Dispatcher: Usuario NO autorizado invocando /@terminal recibe acceso denegado y NO ejecuta agente', async () => {
    _resetCooldowns();
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;
    const origNormal = process.env.ALLOWED_NUMBERS_NORMAL;
    const origHttp = evolution.client.post;
    const origRunAgent = agent.runAgentWithTerminal;
    const origRoute = ai.routeWithAI;

    process.env.ALLOWED_NUMBERS_ADMIN = '5215512345678';
    process.env.ALLOWED_NUMBERS_NORMAL = '5219999999999';

    let agentCalled = false;
    let sentMessages = [];

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    ai.routeWithAI = async () => ({
        action: 'terminal',
        args: { comando: 'cat /etc/passwd' }
    });

    agent.runAgentWithTerminal = async () => {
        agentCalled = true;
        return { text: 'NUNCA DEBE EJECUTARSE' };
    };

    try {
        await dispatch({
            from: '5219999999999@s.whatsapp.net',
            text: '/@terminal cat /etc/passwd',
            messageType: 'conversation',
            messageData: {
                pushName: 'Intruso'
            }
        });

        assert.strictEqual(agentCalled, false, 'runAgentWithTerminal NO debe ser llamado para usuarios no admin');
        assert.ok(sentMessages.some(m => m.text.includes('acceso denegado')), 'Debe enviar mensaje de acceso denegado');
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
        process.env.ALLOWED_NUMBERS_NORMAL = origNormal;
        evolution.client.post = origHttp;
        agent.runAgentWithTerminal = origRunAgent;
        ai.routeWithAI = origRoute;
    }
});

test('Dispatcher: Usuario no autorizado con pushName "Admin" o "Owner" es rechazado (Anti-Spoofing)', async () => {
    _resetCooldowns();
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;
    const origNormal = process.env.ALLOWED_NUMBERS_NORMAL;
    const origGroups = process.env.ALLOWED_GROUPS_NORMAL;
    const origHttp = evolution.client.post;
    const origRunAgent = agent.runAgentWithTerminal;
    const origRoute = ai.routeWithAI;

    process.env.ALLOWED_NUMBERS_ADMIN = '5215512345678';
    process.env.ALLOWED_GROUPS_NORMAL = '120363045678901234';

    let agentCalled = false;
    let sentMessages = [];

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    ai.routeWithAI = async () => ({
        action: 'terminal',
        args: { comando: 'df -h' }
    });

    agent.runAgentWithTerminal = async () => {
        agentCalled = true;
        return { text: 'No debe correr' };
    };

    try {
        await dispatch({
            from: '120363045678901234@g.us',
            text: '/@bash df -h',
            messageType: 'conversation',
            messageData: {
                pushName: 'Admin', // Suplantación de nombre visible
                key: { participant: '5219999999999@s.whatsapp.net' } // JID no autorizado
            }
        });

        assert.strictEqual(agentCalled, false, 'El agente no debe ser invocado por nombre falso');
        assert.ok(sentMessages.some(m => m.text.includes('acceso denegado')));
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
        process.env.ALLOWED_NUMBERS_NORMAL = origNormal;
        process.env.ALLOWED_GROUPS_NORMAL = origGroups;
        evolution.client.post = origHttp;
        agent.runAgentWithTerminal = origRunAgent;
        ai.routeWithAI = origRoute;
    }
});

test('Dispatcher: Usuario autorizado en grupo con pushName cualquiera es admitido por su JID', async () => {
    _resetCooldowns();
    const origAdmin = process.env.ALLOWED_NUMBERS_ADMIN;
    const origGroups = process.env.ALLOWED_GROUPS_NORMAL;
    const origHttp = evolution.client.post;
    const origRunAgent = agent.runAgentWithTerminal;
    const origRoute = ai.routeWithAI;

    process.env.ALLOWED_NUMBERS_ADMIN = '5215512345678';
    process.env.ALLOWED_GROUPS_NORMAL = '120363045678901234';

    let agentCalled = false;
    let sentMessages = [];

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    ai.routeWithAI = async () => ({
        action: 'terminal',
        args: { comando: 'uptime' }
    });

    agent.runAgentWithTerminal = async () => {
        agentCalled = true;
        return { text: 'Uptime: 45 días' };
    };

    try {
        await dispatch({
            from: '120363045678901234@g.us',
            text: '/@cmd uptime',
            messageType: 'conversation',
            messageData: {
                pushName: 'Panchito López', // Nombre cualquiera
                key: { participant: '5215512345678@s.whatsapp.net' } // JID autorizado
            }
        });

        assert.strictEqual(agentCalled, true, 'Debe autorizar al admin legítimo en el grupo');
        assert.ok(sentMessages.some(m => m.text.includes('Uptime: 45 días')));
    } finally {
        process.env.ALLOWED_NUMBERS_ADMIN = origAdmin;
        process.env.ALLOWED_GROUPS_NORMAL = origGroups;
        evolution.client.post = origHttp;
        agent.runAgentWithTerminal = origRunAgent;
        ai.routeWithAI = origRoute;
    }
});

test('Dispatcher: Comandos existentes (ej: ayuda) continúan funcionando intactos', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_NUMBERS_NORMAL;
    const origHttp = evolution.client.post;
    const origRoute = ai.routeWithAI;
    let sentMessages = [];

    process.env.ALLOWED_NUMBERS_NORMAL = '5219999999999';

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    ai.routeWithAI = async () => ({
        action: 'ayuda',
        args: {}
    });

    try {
        await dispatch({
            from: '5219999999999@s.whatsapp.net',
            text: '/@ayuda',
            messageType: 'conversation',
            messageData: { pushName: 'UsuarioComun' }
        });

        // Debe responder con el menú de ayuda existente sin bloquearlo
        assert.ok(sentMessages.length > 0, 'Debe haber respondido a ayuda');
        assert.ok(sentMessages[0].text.includes('comandos') || sentMessages[0].text.includes('Botsky') || sentMessages[0].text.includes('ayuda'));
    } finally {
        process.env.ALLOWED_NUMBERS_NORMAL = origNormal;
        evolution.client.post = origHttp;
        ai.routeWithAI = origRoute;
    }
});

test('Dispatcher: Mensajes normales de chat siguen respondiendo con chatWithBotsky sin invocar terminal', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_NUMBERS_NORMAL;
    const origChat = ai.chatWithBotsky;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;
    const origRunAgent = agent.runAgentWithTerminal;

    process.env.ALLOWED_NUMBERS_NORMAL = '5219999999999';

    let chatCalled = false;
    let agentCalled = false;
    let sentMessages = [];

    ai.routeWithAI = async () => ({
        action: 'chat',
        message: 'Hola compa, ¿cómo andas?'
    });

    ai.chatWithBotsky = async () => {
        chatCalled = true;
        return 'Hola compa, ¿cómo andas?';
    };

    agent.runAgentWithTerminal = async () => {
        agentCalled = true;
        return { text: 'terminal output' };
    };

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '5219999999999@s.whatsapp.net',
            text: 'hola botsky buenas tardes',
            messageType: 'conversation',
            messageData: { pushName: 'UsuarioComun' }
        });

        assert.strictEqual(agentCalled, false, 'El agente no debe invocarse en chat casual');
        assert.ok(sentMessages.some(m => m.text.includes('Hola compa')));
    } finally {
        process.env.ALLOWED_NUMBERS_NORMAL = origNormal;
        ai.chatWithBotsky = origChat;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
        agent.runAgentWithTerminal = origRunAgent;
    }
});

test('Dispatcher: action "ignore" descarta el mensaje y no envía nada a WhatsApp', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_GROUPS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origChat = ai.chatWithBotsky;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_GROUPS_NORMAL = '120363045678901234';

    let chatCalled = false;
    let sentMessages = [];

    ai.routeWithAI = async () => ({
        action: 'ignore'
    });

    ai.chatWithBotsky = async () => {
        chatCalled = true;
        return 'No debería enviarse';
    };

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '120363045678901234@g.us',
            text: 'ánimo padre',
            messageType: 'conversation',
            messageData: {
                key: { participant: '5219999999999@s.whatsapp.net' },
                pushName: 'Lisandro'
            }
        });

        assert.strictEqual(chatCalled, false, 'chatWithBotsky no debe invocarse cuando la acción es ignore');
        assert.strictEqual(sentMessages.length, 0, 'No debe enviarse ningún mensaje a WhatsApp cuando action es ignore');
    } finally {
        process.env.ALLOWED_GROUPS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        ai.chatWithBotsky = origChat;
        evolution.client.post = origHttp;
    }
});

test('Dispatcher: Insultos y mentadas de madre en grupo activan bypass directo de Gatekeeper y responden con chat (Opción 1)', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_GROUPS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_GROUPS_NORMAL = '120363045678901234';

    let routedWithAI = false;
    let sentMessages = [];

    ai.routeWithAI = async (msg) => {
        routedWithAI = true;
        return {
            action: 'chat',
            message: 'A mí no me hables así, cabrón. ¿O qué traes?'
        };
    };

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '120363045678901234@g.us',
            text: 'chinga tu madre pinche chatarra',
            messageType: 'conversation',
            messageData: {
                key: { participant: '5219999999999@s.whatsapp.net' },
                pushName: 'Troll'
            }
        });

        assert.strictEqual(routedWithAI, true, 'El insulto debe saltarse el gatekeeper y consultar a la IA inmediatamente');
        assert.strictEqual(sentMessages.length, 1, 'Debe responder al usuario que insultó');
        assert.ok(sentMessages[0].text.includes('cabrón'), 'Debe enviar la respuesta de defensa');
    } finally {
        process.env.ALLOWED_GROUPS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
    }
});

test('Dispatcher: Mensajes de una palabra como jaja o ok siguen filtrados a costo cero sin llamar a la IA', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_GROUPS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_GROUPS_NORMAL = '120363045678901234';

    let routedWithAI = false;
    let sentMessages = [];

    ai.routeWithAI = async () => {
        routedWithAI = true;
        return { action: 'chat', message: 'hola' };
    };

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '120363045678901234@g.us',
            text: 'jajajaja',
            messageType: 'conversation',
            messageData: {
                key: { participant: '5219999999999@s.whatsapp.net' },
                pushName: 'Amigo'
            }
        });

        assert.strictEqual(routedWithAI, false, 'Risas o relleno simple deben archivarse a costo cero sin llamar a la IA');
        assert.strictEqual(sentMessages.length, 0, 'No debe enviar ningún mensaje');
    } finally {
        process.env.ALLOWED_GROUPS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
    }
});

test('Dispatcher: Conversación grupal sin mención ni cita al bot es archivada en historial pero NO envía respuesta (anti-spam)', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_GROUPS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_GROUPS_NORMAL = '120363045678901234';

    let routedWithAI = false;
    let sentMessages = [];

    ai.routeWithAI = async (msg) => {
        routedWithAI = true;
        return {
            action: 'chat',
            message: 'La neta sí estuvo perrísima esa película.'
        };
    };

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        // Conversación normal entre amigos, sin mención a botsky y sin citar al bot
        await dispatch({
            from: '120363045678901234@g.us',
            text: 'qué buena película estuvo esa de batman ayer',
            messageType: 'conversation',
            messageData: {
                key: { participant: '5219999999999@s.whatsapp.net' },
                pushName: 'Amigo'
            }
        });

        assert.strictEqual(routedWithAI, false, 'No debe llamar a la IA para evitar spam');
        assert.strictEqual(sentMessages.length, 0, 'No debe enviar ningún mensaje al grupo');
    } finally {
        process.env.ALLOWED_GROUPS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
    }
});

test('Dispatcher: En grupo, responde cuando lo llaman por su nombre ("botsky", "bot", "botsito") con el contexto del chat', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_GROUPS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_GROUPS_NORMAL = '120363045678901234';

    let routedWithAI = false;
    let sentMessages = [];

    ai.routeWithAI = async (msg) => {
        routedWithAI = true;
        return {
            action: 'chat',
            message: 'La neta sí estuvo perrísima esa película.'
        };
    };

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '120363045678901234@g.us',
            text: 'botsky qué buena película estuvo esa de batman ayer',
            messageType: 'conversation',
            messageData: {
                key: { participant: '5219999999999@s.whatsapp.net' },
                pushName: 'Amigo'
            }
        });

        assert.strictEqual(routedWithAI, true, 'Cuando lo llaman por su nombre debe consultar a la IA');
        assert.strictEqual(sentMessages.length, 1, 'Debe enviar la respuesta de la IA al grupo');
        assert.ok(sentMessages[0].text.includes('perrísima'));
    } finally {
        process.env.ALLOWED_GROUPS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
    }
});

test('Dispatcher: En grupo, responde cuando citan/responden directamente a un mensaje de Botsky', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_GROUPS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_GROUPS_NORMAL = '120363045678901234';

    let routedWithAI = false;
    let sentMessages = [];

    ai.routeWithAI = async (msg) => {
        routedWithAI = true;
        return {
            action: 'chat',
            message: 'Te estoy respondiendo porque me citaste, compa.'
        };
    };

    evolution.client.post = async (url, data) => {
        if (data && data.text) {
            sentMessages.push({ to: data.number, text: data.text });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '120363045678901234@g.us',
            text: 'por qué dices eso?',
            messageType: 'extendedTextMessage',
            messageData: {
                key: { participant: '5219999999999@s.whatsapp.net' },
                pushName: 'Amigo',
                message: {
                    extendedTextMessage: {
                        text: 'por qué dices eso?',
                        contextInfo: {
                            participant: '5214437367565@s.whatsapp.net',
                            quotedMessage: {
                                conversation: 'Mensaje previo que dijo Botsky'
                            }
                        }
                    }
                }
            }
        });

        assert.strictEqual(routedWithAI, true, 'Cuando citan al bot debe consultar a la IA');
        assert.strictEqual(sentMessages.length, 1, 'Debe enviar la respuesta al grupo');
        assert.ok(sentMessages[0].text.includes('porque me citaste'));
    } finally {
        process.env.ALLOWED_GROUPS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
    }
});

test('Dispatcher: Petición en lenguaje natural para videos ("busca videos de perritos") enruta a descargar con query', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_NUMBERS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_NUMBERS_NORMAL = '5219999999999';

    ai.routeWithAI = async () => ({
        action: 'descargar',
        args: { query: 'perritos graciosos', adult: false }
    });

    let sentMessages = [];
    evolution.client.post = async (url, data) => {
        if (data && (data.text || data.caption || data.media)) {
            sentMessages.push({ to: data.number, text: data.text || data.caption || 'media' });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '5219999999999@s.whatsapp.net',
            text: 'oye botsky busca videos de perritos graciosos',
            messageType: 'conversation',
            messageData: { pushName: 'Usuario' }
        });

        // Al ejecutarse descargar con búsqueda, debe haber enviado mensaje de búsqueda o resultados (no "no sé qué decirte")
        assert.ok(sentMessages.length > 0, 'Debe ejecutar la búsqueda de videos');
        assert.ok(!sentMessages.some(m => m.text.includes('No sé ni qué decirte')), 'No debe caer en el fallback de confusión');
    } finally {
        process.env.ALLOWED_NUMBERS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
    }
});

test('Dispatcher: Sinónimo "video" devuelto por IA es normalizado a "descargar"', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_NUMBERS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_NUMBERS_NORMAL = '5219999999999';

    ai.routeWithAI = async () => ({
        action: 'video',
        args: { tema: 'goles del madrid' }
    });

    let sentMessages = [];
    evolution.client.post = async (url, data) => {
        if (data && (data.text || data.caption || data.media)) {
            sentMessages.push({ to: data.number, text: data.text || data.caption || 'media' });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '5219999999999@s.whatsapp.net',
            text: 'busca videos de goles del madrid',
            messageType: 'conversation',
            messageData: { pushName: 'Usuario' }
        });

        assert.ok(sentMessages.length > 0, 'Debe procesar la petición de video');
        assert.ok(!sentMessages.some(m => m.text.includes('No sé ni qué decirte')));
    } finally {
        process.env.ALLOWED_NUMBERS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
    }
});

test('Dispatcher: Desambiguación de "buscar" redirige a "descargar" si la petición pide videos', async () => {
    _resetCooldowns();
    const origNormal = process.env.ALLOWED_NUMBERS_NORMAL;
    const origRoute = ai.routeWithAI;
    const origHttp = evolution.client.post;

    process.env.ALLOWED_NUMBERS_NORMAL = '5219999999999';

    // Si la IA devolvió "buscar" (asumiendo drive) pero el usuario pidió videos
    ai.routeWithAI = async () => ({
        action: 'buscar',
        args: { query: 'videos de minecraft' }
    });

    let sentMessages = [];
    evolution.client.post = async (url, data) => {
        if (data && (data.text || data.caption || data.media)) {
            sentMessages.push({ to: data.number, text: data.text || data.caption || 'media' });
        }
        return { data: { status: 'SUCCESS' } };
    };

    try {
        await dispatch({
            from: '5219999999999@s.whatsapp.net',
            text: 'busca videos de minecraft',
            messageType: 'conversation',
            messageData: { pushName: 'Usuario' }
        });

        assert.ok(sentMessages.length > 0);
        assert.ok(!sentMessages.some(m => m.text.includes('No sé ni qué decirte')));
    } finally {
        process.env.ALLOWED_NUMBERS_NORMAL = origNormal;
        ai.routeWithAI = origRoute;
        evolution.client.post = origHttp;
    }
});


