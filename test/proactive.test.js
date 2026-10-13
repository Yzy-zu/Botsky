'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const {harness,proactiveHarness,gemini}=require('./aiOfflineHarness.test');
if(!process.env.DATA_DIR?.startsWith('/tmp/botsky-data'))throw Error('Run persistence tests with the isolated Docker verifier');

const db = require('../src/services/db');
const {evaluateProactiveAction}=harness({post:async()=>gemini(JSON.stringify({should_act:false,channel:'group',message:'',reason:'silence'}))}).ai;
const {chooseAutonomyState}=proactiveHarness().api;

test('Universal Lore 1: Estado doxxed y auto-canon de lore en db.js', async () => {
    const testJid = `test_lore_universal_${Date.now()}@s.whatsapp.net`;
    const userName = 'Mauro';

    // Inicialmente no está doxeado
    const initDox = await db.isUserDoxxed(testJid);
    assert.equal(initDox, false);

    // Marcar como doxeado
    await db.setUserDoxxedState(testJid, 1);
    const marked = await db.isUserDoxxed(testJid);
    assert.equal(marked, true);

    // Contexto de afinidad debe incluir el expediente de vigilancia
    const context = await db.getUserAffinityContext(testJid, userName);
    assert.ok(context.includes('EXPEDIENTE DE VIGILANCIA'), 'Debe incluir expediente de vigilancia');
    assert.ok(context.includes('FICHADO Y DOXEADO'), 'Debe alertar de estado fichado');

    // Registrar evento de lore automático
    await db.addLoreEvent(testJid, userName, 'Terminó ubicado y con su IP expuesta tras pasarse de lanza en el grupo.', 'Botsky');
    const events = await db.getLoreEvents(testJid);
    assert.ok(events.length > 0);
    assert.ok(events.some(e => e.event_text.includes('Terminó ubicado y con su IP expuesta')));

    // Simular perdón / tregua
    await db.setUserDoxxedState(testJid, 0);
    const unmark = await db.isUserDoxxed(testJid);
    assert.equal(unmark, false);

    // Evento de rendición
    await db.addLoreEvent(testJid, userName, 'Se dobló ante Botsky y pidió disculpas públicas para que le levantaran la sentencia cibernética.', 'Botsky');
    const updatedEvents = await db.getLoreEvents(testJid);
    assert.ok(updatedEvents.some(e => e.event_text.includes('Se dobló ante Botsky')));
});

test('Proactive 2: Presupuesto y cooldowns de mensajes espontáneos (canSendProactiveMessage)', async () => {
    const testGroup = `test_group_${Date.now()}@g.us`;
    const testUser = `test_proactive_user_${Date.now()}@s.whatsapp.net`;

    // Grupo inicialmente disponible
    const canGroupInitial = await db.canSendProactiveMessage('group');
    assert.equal(typeof canGroupInitial, 'boolean');

    // Registrar mensaje espontáneo grupal
    await db.recordProactiveMessage(testGroup, 'group', '¿Qué onda bola de huevones?');

    // Inmediatamente después debe bloquear el grupo por el cooldown mínimo de 2h
    const canGroupAfter = await db.canSendProactiveMessage('group');
    assert.equal(canGroupAfter, false, 'Debe respetar el cooldown de 2 horas entre mensajes proactivos grupales');

    // Privado inicialmente disponible para usuario nuevo
    const canPrivateInitial = await db.canSendProactiveMessage('private', testUser);
    assert.equal(canPrivateInitial, true);

    // Registrar mensaje espontáneo privado
    await db.recordProactiveMessage(testUser, 'private', 'Oye me quedé pensando en lo que dijiste...');

    // Inmediatamente después debe bloquear por límite diario (máx 1 al día)
    const canPrivateAfter = await db.canSendProactiveMessage('private', testUser);
    assert.equal(canPrivateAfter, false, 'Debe limitar a máx 1 mensaje privado espontáneo al día por usuario');
});

test('Proactive 3: evaluateProactiveAction devuelve estructura válida de decisión', async () => {
    const history = [
        { role: 'user', content: 'hola alguien sabe la tarea?' },
        { role: 'user', content: 'no ni idea' }
    ];
    const grudges = [
        { jid: '5214439999999@s.whatsapp.net', user_name: 'Paco', score: -60, mood: 'rencoroso', grievances: 2, last_reason: 'Insultó', is_doxxed: 1 }
    ];

    const decision = await evaluateProactiveAction({
        groupHistory: history,
        activeGrudges: grudges,
        idleMinutes: 120
    });

    assert.ok(typeof decision === 'object');
    assert.ok(typeof decision.should_act === 'boolean');
    assert.ok(['group', 'private'].includes(decision.channel));
    assert.ok(typeof decision.message === 'string');
});

test('Proactive 4: estado autónomo cambia según actividad y horario', () => {
    assert.deepEqual(
        JSON.parse(JSON.stringify(chooseAutonomyState({ idleMinutes: 90, historyLength: 1, currentHour: 14 }))),
        { mood: 'con hueva', objective: 'encontrar una oportunidad natural para reanimar el grupo' }
    );
    assert.deepEqual(
        JSON.parse(JSON.stringify(chooseAutonomyState({ idleMinutes: 5, historyLength: 8, currentHour: 18 }))),
        { mood: 'atento', objective: 'detectar una pregunta que se haya quedado sin respuesta' }
    );
});

test('Proactive 5: estado de personalidad y eventos sociales sobreviven en SQLite', async () => {
    const state = await db.getPersonalityState();
    assert.ok(state && state.id === 1);

    await db.updatePersonalityState({ mood: 'curioso', objective: 'probar memoria', objectiveUntil: Date.now() + 60000 });
    const updated = await db.getPersonalityState();
    assert.equal(updated.objective, 'probar memoria');

    const chatId = `test_personality_${Date.now()}@g.us`;
    await db.addSocialEvent(chatId, 'test', 'Botsky recordó una actividad.');
    const events = await db.getRecentSocialEvents(chatId, 5);
    assert.equal(events.length, 1);
    assert.equal(events[0].event_type, 'test');
});

test('Proactive 5b: la personalidad queda aislada por grupo', async () => {
    const groupA = `state_a_${Date.now()}@g.us`;
    const groupB = `state_b_${Date.now()}@g.us`;
    await db.updatePersonalityState({ chatId: groupA, mood: 'atento', objective: 'grupo A' });
    await db.updatePersonalityState({ chatId: groupB, mood: 'cansado', objective: 'grupo B' });

    const stateA = await db.getPersonalityState(groupA);
    const stateB = await db.getPersonalityState(groupB);
    assert.equal(stateA.objective, 'grupo A');
    assert.equal(stateB.objective, 'grupo B');
    assert.notEqual(stateA.mood, stateB.mood);
});

test('Proactive 5c: encuesta permite un voto por usuario y cierre', async () => {
    const chatId = `poll_${Date.now()}@g.us`;
    const poll = await db.createPoll({
        chatId,
        creatorJid: '5215500000001@s.whatsapp.net',
        creatorName: 'Creador',
        question: '¿Qué hacemos?',
        options: ['Minecraft', 'Película']
    });
    assert.equal(poll.options.length, 2);
    assert.equal((await db.votePoll(poll.id, '5215500000002@s.whatsapp.net', 0)).duplicate, false);
    assert.equal((await db.votePoll(poll.id, '5215500000002@s.whatsapp.net', 1)).duplicate, true);
    const results = await db.getPollResults(poll.id);
    assert.deepEqual(results.map(row => [row.option_index, row.votes]), [[0, 1]]);
    assert.equal(await db.closePoll(poll.id, chatId), true);
    assert.equal(await db.getActivePoll(chatId), null);
});

test('Proactive 6: pregunta reciente se evalúa semánticamente sin heurística de palabras', async () => {
    const now=Date.parse('2026-10-12T18:00:00Z');const history=[{role:'user',name:'Persona',content:'¿Alguien sabe si ya prendieron el server?',timestamp:now-60000}];
    const local=proactiveHarness({history,now});const result=await local.api.runProactiveCycle();
    assert.equal(result.reason,'ai_decided_silence');assert.equal(local.plans.length,1);assert.equal(local.plans[0].mode,'contextual');assert.equal(local.plans[0].groupHistory[0].content,history[0].content);assert.equal(local.sent.length,0);
    const old=proactiveHarness({history:[{role:'user',content:'¿Ya llegó?',timestamp:now-2*60*60*1000}],now});await old.api.runProactiveCycle();assert.equal(old.plans[0].mode,'idle','El historial vencido no activa modo contextual');
});

test('Proactive 7: actividad grupal usa decisión semántica y no convierte palabras en ejecución', async () => {
    const now=Date.parse('2026-10-12T18:00:00Z');const history=[{role:'user',name:'Persona',content:'Al rato armamos partida de Minecraft?',timestamp:now-120000},{role:'user',content:'Yo sí me apunto',timestamp:now-60000}];
    const local=proactiveHarness({history,now,decision:{should_act:true,channel:'group',message:'¿A qué hora se arma?',reason:'activity'}});const result=await local.api.runProactiveCycle();
    assert.equal(result.executed,true);assert.equal(local.plans[0].mode,'contextual');assert.deepEqual(local.sent,[['offline@g.us','¿A qué hora se arma?']]);
    const silence=proactiveHarness({history:[{role:'user',content:'Qué calor hace',timestamp:now}],now});await silence.api.runProactiveCycle();assert.equal(silence.plans.length,1);assert.equal(silence.sent.length,0);
});
