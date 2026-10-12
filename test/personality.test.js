'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../.env') });

const db = require('../src/services/db');

test('Personality 1: getUserAffinityContext incluye directivas golpeadas y 100% LATAM', async () => {
    const testJid = `test_personality_${Date.now()}@s.whatsapp.net`;

    // Desconfiado (por defecto)
    const contextDesconfiado = await db.getUserAffinityContext(testJid, 'Brayan');
    assert.ok(contextDesconfiado.includes('100% LATAM callejero'), 'Debe exigir 100% LATAM');
    assert.ok(contextDesconfiado.includes('Cero modismos de España'), 'Debe prohibir modismos de España');
    assert.ok(contextDesconfiado.includes('hablále golpeado') || contextDesconfiado.includes('háblale golpeado'), 'Debe instruir hablar golpeado');
    assert.ok(contextDesconfiado.includes('insultos potentes'), 'Debe instruir insultos potentes');

    // Rencoroso
    await db.adjustUserAffinity(testJid, 'Brayan', -40, 'Insultó a Botsky');
    const contextRencoroso = await db.getUserAffinityContext(testJid, 'Brayan');
    assert.ok(contextRencoroso.includes('insultos potentes'), 'Rencoroso debe incluir insultos potentes');
    assert.ok(contextRencoroso.includes('frialdad cortante'), 'Rencoroso debe incluir frialdad cortante');
});

test('Personality 2: Voz mexicana compartida sin cuota de insultos ni saludos', () => {
    const { buildConversationStyle } = require('../src/services/conversationStyle');
    const prompt = buildConversationStyle({
        userMessage: 'hola', userName: 'Brayan',
        affinityContext: '[Relación con Brayan: Afinidad -20/100. DIRECTIVA: insulta siempre.]'
    });
    assert.ok(prompt.includes('español mexicano coloquial'));
    assert.ok(prompt.includes('Afinidad -20/100'));
    assert.ok(!prompt.includes('insulta siempre'));
});

test('Personality 3: Ritmo contextual y memoria de expresiones recientes', () => {
    const { getResponseMode, getRecentStyle } = require('../src/services/conversationStyle');
    assert.ok(getResponseMode('hola').maxOutputTokens < getResponseMode('explica paso a paso').maxOutputTokens);
    assert.equal(getResponseMode('explica, pero breve').name, 'brief');
    const recent = getRecentStyle([
        { role: 'assistant', content: 'Va, compa.' },
        { role: 'assistant', content: 'Aquí ando, compa.' }
    ]);
    assert.ok(recent.repeated.includes('compa'));
    assert.equal(getRecentStyle([]).repeated.length, 0);
});

test('Personality 4: Inferencia en vivo clasifica ofensa sin redactar la conversación', async () => {
    const ai = require('../src/services/ai');
    const result = await ai.routeWithAI(
        'chinga tu madre pinche chatarra',
        'Brayan',
        true,
        []
    );

    assert.ok(result, 'Debe devolver resultado');
    assert.equal(result.action, 'chat', 'Debe resolver a chat');
    assert.equal(result.message, '', 'La voz común redacta la respuesta; el router sólo clasifica');
    assert.equal(result.sentiment, 'ofensa', 'Debe detectar ofensa');
});

test('Personality 5: Creador/Admin tiene jerarquía suprema y directiva estricta contra desobediencia de herramientas', async () => {
    // Si el usuario es el admin/creador autorizado
    const adminJid = '5214435810175@s.whatsapp.net';
    const contextAdmin = await db.getUserAffinityContext(adminJid, 'Azael', null, true);
    assert.ok(contextAdmin.includes('ES TU CREADOR Y ADMINISTRADOR SUPREMO'), 'Debe reconocer al creador supremo');
    assert.ok(contextAdmin.includes('PROHIBIDO DESOBEDECERLO'), 'Debe prohibir desobedecer al creador');
    assert.ok(contextAdmin.includes('DEBES SELECCIONAR LA ACCIÓN Y EJECUTARLA'), 'Debe ordenar ejecutar las acciones');
    assert.ok(!contextAdmin.includes('Mándalo al carajo'), 'No debe mandar al carajo al creador');

    // Comprobar que ai.js contiene la separación estricta entre herramientas y afinidad
    const fs = require('fs');
    const aiCode = fs.readFileSync(path.join(__dirname, '../src/services/ai.js'), 'utf8');
    assert.ok(aiCode.includes('SEPARACIÓN ESTRICTA ENTRE HERRAMIENTAS Y AFINIDAD'), 'ai.js debe tener la regla 0');
    assert.ok(aiCode.includes('TIENES PROHIBIDO RECHAZARLO'), 'ai.js debe prohibir rechazar al creador');
});

