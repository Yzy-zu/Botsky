'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createStickerFeature, parseSticker, parseEffect } = require('../../../../src/v2/features/sticker/manifest');
const { EFFECTS } = require('../../../../src/v2/features/sticker/handler');
const { createImageCensor } = require('../../../../src/v2/features/sticker/imageCensor');
const { createThumbnailCollage } = require('../../../../src/v2/features/sticker/thumbnailCollage');
const { createVoiceFeature, parseExplicit: parseVoice } = require('../../../../src/v2/features/voice/manifest');
const { isReply } = require('../../../../src/v2/domain/types');
const { AppError } = require('../../../../src/v2/domain/errors');

const signal = () => new AbortController().signal;
function context({ attachment, quote } = {}) {
    return { event: { id: 'in-media', chatId: '15555550123@s.whatsapp.net', isGroup: false,
        sender: { jid: '15555550123@s.whatsapp.net', number: '15555550123', name: 'Tester' }, text: 'test', kind: 'text',
        quoted: quote ? { messageId: 'quoted', senderJid: '15555550999@s.whatsapp.net', text: quote, isFromBot: false } : undefined },
    history: [{ role: 'user', content: 'Earlier context' }], attachment };
}
const audio = { id: 'audio', ownerJid: 'owner', chatId: 'group@g.us', expiresAt: 1, ref: 'media://audio', mime: 'audio/ogg', kind: 'audio' };
const image = { id: 'image', ownerJid: 'owner', chatId: 'group@g.us', expiresAt: 1, ref: 'media://image', mime: 'image/gif', kind: 'image' };

test('sticker manifest preserves aliases and crop/animation CLI flags with bounded URL parsing', () => {
    const feature = createStickerFeature({ downloadUrl: async () => ({ ref: 'source', mime: 'image/jpeg' }),
        createSticker: async () => ({ ref: 'sticker', mime: 'image/webp' }), applyEffect: async () => ({ ref: 'effect', mime: 'audio/ogg' }) });
    const command = feature.commands[0];
    assert.equal(command.name, 'sticker');
    assert.deepEqual(command.aliases, ['s', 'stickers', 'calca', 'calcas', 'pegatina', 'pegatinas']);
    assert.deepEqual(parseSticker(['-r', '-a']), { crop: true, animated: true });
    assert.deepEqual(parseSticker(['--recortar', '--animado', 'https://example.test/a.gif']),
        { crop: true, animated: true, url: 'https://example.test/a.gif' });
    assert.throws(() => parseSticker(['file:///etc/passwd']), /Invalid explicit/);
    assert.throws(() => parseSticker(['https://user:pass@example.test/a']), /Invalid explicit/);
    assert.throws(() => parseSticker(['--unknown']), /Invalid explicit/);
    assert.deepEqual(EFFECTS, ['ardilla', 'robot', 'lento', 'rapido', 'grave', 'eco', 'reversa']);
    assert.deepEqual(parseEffect(['ARDILLA']), { effect: 'ardilla' });
    assert.throws(() => parseEffect(['shell']), /Invalid explicit/);
    assert.deepEqual(parseEffect([]), {});
});

test('sticker uses attached and URL media ports, honors crop/animation limits, and returns a sticker reply', async () => {
    const calls = [];
    const command = createStickerFeature({
        downloadUrl: async (url, abort) => { calls.push(['download', url]); assert.equal(abort.aborted, false); return { ref: 'media://gif', mime: 'video/mp4' }; },
        createSticker: async (media, options) => { calls.push(['create', media, options]); return { ref: 'media://sticker', mime: 'image/webp' }; },
        applyEffect: async () => ({ ref: 'unused', mime: 'audio/ogg' })
    }).commands[0];
    const created = await command.handler(context({ attachment: image }), { crop: true, animated: true }, signal());
    assert.equal(calls[0][0], 'create');
    assert.equal(calls[0][1].ref, image.ref);
    assert.deepEqual({ id: calls[0][1].id, chatId: calls[0][1].chatId, ownerJid: calls[0][1].ownerJid },
        { id: image.id, chatId: image.chatId, ownerJid: image.ownerJid }, 'download gets the source identity required for provider decryption');
    assert.equal(calls[0][2].crop, true);
    assert.equal(calls[0][2].forceAnimated, true);
    assert.equal(calls[0][2].maxDurationSeconds, 6);
    assert.equal(isReply(created), true);
    assert.deepEqual(created.parts[0], { type: 'sticker', ref: 'media://sticker', mime: 'image/webp' });
    calls.length = 0;
    await command.handler(context(), { url: 'https://example.test/a.gif' }, signal());
    assert.deepEqual(calls[0], ['download', 'https://example.test/a.gif']);
    assert.equal(calls[1][2].forceAnimated, false, 'container inspection remains the injected adapter responsibility');
});

test('sticker and effect failures are bounded; effect types and cancellation are enforced', async () => {
    const failed = createStickerFeature({
        createSticker: async () => { throw Error('private media adapter path'); },
        applyEffect: async () => { throw Error('private ffmpeg path'); }
    });
    const sticker = await failed.commands[0].handler(context({ attachment: image }), {}, signal());
    assert.match(sticker.parts[0].text, /No pude crear el sticker/);
    assert.doesNotMatch(sticker.parts[0].text, /private media adapter path/);
    const effect = failed.commands[1];
    const missing = await effect.handler(context(), { effect: 'ardilla' }, signal());
    assert.match(missing.parts[0].text, /Responde a un audio o video/);
    const reply = await effect.handler(context({ attachment: audio }), { effect: 'ardilla' }, signal());
    assert.match(reply.parts[0].text, /No pude aplicar el efecto/);
    assert.doesNotMatch(reply.parts[0].text, /private ffmpeg path/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(effect.handler(context({ attachment: audio }), { effect: 'ardilla' }, controller.signal), { name: 'AbortError' });
});

test('image censorship port fixes legacy pixelation/bar settings and validates adapter output', async () => {
    let received;
    const censorImage = createImageCensor({ censor: async (input, options) => { received = { input, options }; return { ref: 'media://censored', mime: 'image/jpeg' }; } });
    const result = await censorImage({ ref: image.ref, mime: image.mime }, signal());
    assert.equal(result.ref, 'media://censored');
    assert.deepEqual({ pixelBlock: received.options.pixelBlock, barStart: received.options.barStart, barHeight: received.options.barHeight },
        { pixelBlock: 36, barStart: 0.38, barHeight: 0.24 });
    assert.match(received.options.label, /CENSURADO POR BOTSKY/);
    await assert.rejects(censorImage({ ref: 'audio', mime: 'audio/ogg' }, signal()), /Invalid image/);
});

test('thumbnail collage caps items, passes only valid HTTP thumbnail URLs, and returns null without usable thumbnails', async () => {
    let received;
    const collage = createThumbnailCollage({ render: async items => { received = items; return { ref: 'media://collage', mime: 'image/jpeg' }; } });
    const items = Array.from({ length: 10 }, (_, index) => ({ title: `video ${index}`, thumbnailUrl: `https://example.test/${index}.jpg` }));
    const result = await collage(items, signal());
    assert.equal(result.ref, 'media://collage');
    assert.equal(received.length, 8);
    assert.deepEqual(received[0], { title: 'video 0', thumbnailUrl: 'https://example.test/0.jpg' });
    assert.equal(await collage([{ title: 'none', thumbnailUrl: 'file:///private' }], signal()), null);
});

test('voice manifest keeps command aliases and explicit voice, duration, gender, and literal-text flags', () => {
    const feature = createVoiceFeature({ prepareScript: async () => ({ text: 'hi' }), synthesize: async () => ({ ref: 'voice', mime: 'audio/ogg' }), fitDuration: async media => media });
    const command = feature.commands[0];
    assert.deepEqual(command.aliases, ['audio', 'tts', 'habla', 'hablar', 'notadevoz']);
    assert.deepEqual(parseVoice(['--voice', 'dross', '--duration=30', 'texto literal']),
        { mode: 'verbatim', voice: 'dross', literalText: 'texto literal', durationSeconds: 30 });
    assert.deepEqual(parseVoice(['-m', 'Buenos', 'días']),
        { mode: 'verbatim', voice: 'mujer', literalText: 'Buenos días' });
    assert.deepEqual(parseVoice(['--goku', 'Vamos']), { mode: 'verbatim', voice: 'goku', literalText: 'Vamos' });
    assert.deepEqual(parseVoice(['-t', 'Hola']), { mode: 'verbatim', voice: 'hombre', literalText: 'Hola' });
    assert.deepEqual(parseVoice(['--voice', 'humana', 'Hola']).voice,'humana');
    assert.deepEqual(parseVoice(['--voice', 'paisa', 'Hola']).voice,'paisa');
    assert.equal(parseVoice(['--duration', '600', 'hola']).durationSeconds, 600);
    assert.equal(parseVoice(['x'.repeat(20000)]).literalText.length, 20000);
    assert.throws(() => parseVoice(['--duration', '999']), /Invalid explicit/);
    assert.throws(() => parseVoice(['--duration', '601']), /Invalid explicit/);
    assert.throws(() => parseVoice(['x'.repeat(20001)]), /Invalid explicit/);
    assert.throws(() => parseVoice(['--voice', 'unknown']), /Invalid explicit/);
    assert.equal(command.argsSchema.properties.durationSeconds.maximum, 600);
    assert.equal(command.argsSchema.properties.literalText.maxLength, 20000);
});

test('voice handler accepts legacy 600 second and 20,000 character bounds and rejects values beyond them', async () => {
    const seen = [];
    const feature = createVoiceFeature({
        prepareScript: async input => { seen.push(input); return { success:true, text:input.literalText || 'guion', durationSeconds:input.durationSeconds }; },
        synthesize: async () => ({ ref:'media://voice', mime:'audio/ogg', durationSeconds:5 }),
        fitDuration: async (media, target) => ({ ...media, durationSeconds:target })
    });
    const handler = feature.commands[0].handler;
    const longText = 'x'.repeat(20000);
    const accepted = await handler(context(), { mode:'verbatim', literalText:longText, durationSeconds:600 }, signal());
    assert.equal(accepted.parts[0].type, 'audio');
    assert.equal(seen[0].literalText.length, 20000);
    assert.equal(seen[0].durationSeconds, 600);
    assert.equal(seen.length, 1, 'invalid limits are rejected before invoking providers');
    const tooLong = await handler(context(), { mode:'verbatim', literalText:'x'.repeat(20001) }, signal());
    const tooLongDuration = await handler(context(), { mode:'compose', instruction:'hola', durationSeconds:601 }, signal());
    assert.match(tooLong.parts[0].text, /20,000 caracteres/);
    assert.match(tooLongDuration.parts[0].text, /1 a 600 segundos/);
    assert.equal(seen.length, 1);
});

test('voice handler uses injected script, synthesis, and duration ports and returns audio media', async () => {
    const calls = [];
    const command = createVoiceFeature({
        prepareScript: async (input, abort) => { calls.push(['script', input]); assert.equal(abort.aborted, false); return { success: true, text: 'Hola, aquí va.', voice: 'goku', mode: 'compose', durationSeconds: 12 }; },
        synthesize: async (text, options) => { calls.push(['synthesize', text, options.voice]); return { ref: 'media://voice', mime: 'audio/ogg', durationSeconds: 8 }; },
        fitDuration: async (media, target) => { calls.push(['fit', media.durationSeconds, target]); return { ...media, durationSeconds: target }; }
    }).commands[0];
    const reply = await command.handler(context({ quote: 'quoted content' }), { instruction: 'resume lo anterior', voice: 'dross', mode: 'compose', durationSeconds: 12 }, signal());
    assert.equal(calls[0][1].quotedText, 'quoted content');
    assert.equal(calls[0][1].history[0].content, 'Earlier context');
    assert.deepEqual(calls[1], ['synthesize', 'Hola, aquí va.', 'goku']);
    assert.deepEqual(calls[2], ['fit', 8, 12]);
    assert.equal(reply.replyTo, 'in-media');
    assert.deepEqual(reply.parts[0], { type: 'audio', ref: 'media://voice', mime: 'audio/ogg', transcript:'Hola, aquí va.', durationSeconds:12 });
});

test('verbatim voice uses quoted text when literal text is absent and never rewrites it', async () => {
    const calls=[];
    const command=createVoiceFeature({
        prepareScript:async input=>{calls.push(['script',input]);return{success:true,mode:'verbatim',text:input.literalText,voice:'mujer',durationSeconds:10};},
        synthesize:async text=>{calls.push(['synthesize',text]);return{ref:'voice-original',mime:'audio/ogg',durationSeconds:13};},
        fitDuration:async media=>media
    }).commands[0];
    const reply=await command.handler(context({quote:'Texto exacto citado'}),{mode:'verbatim',durationSeconds:10},signal());
    assert.equal(calls[0][1].literalText,'Texto exacto citado');
    assert.equal(calls.filter(([kind])=>kind==='synthesize').length,1);
    assert.deepEqual(reply.parts,[{type:'audio',ref:'voice-original',mime:'audio/ogg',transcript:'Texto exacto citado',durationSeconds:13},
        {type:'text',text:'La nota quedó en 13.0 s; buscábamos 10 s.'}]);
});

test('composed voice gets one duration revision and retains the closer recording', async () => {
    const scripts=[];const synthesized=[];const released=[];
    const command=createVoiceFeature({
        prepareScript:async input=>{scripts.push(input);return scripts.length===1?{success:true,mode:'compose',text:'Primer borrador',voice:'hombre',durationSeconds:10}:
            {success:true,mode:'compose',text:'Borrador ajustado',voice:'hombre',durationSeconds:10};},
        synthesize:async text=>{synthesized.push(text);return{ref:`voice-${synthesized.length}`,mime:'audio/ogg',durationSeconds:synthesized.length===1?14:10.5};},
        fitDuration:async media=>media,release:async ref=>{released.push(ref);}
    }).commands[0];
    const reply=await command.handler(context(),{mode:'compose',instruction:'Explica la reunión',durationSeconds:10},signal());
    assert.equal(scripts.length,2);assert.equal(scripts[1].revision.previousText,'Primer borrador');
    assert.equal(scripts[1].revision.measuredSeconds,14);assert.deepEqual(synthesized,['Primer borrador','Borrador ajustado']);
    assert.deepEqual(released,['voice-1']);
    assert.deepEqual(reply.parts,[{type:'audio',ref:'voice-2',mime:'audio/ogg',transcript:'Borrador ajustado',durationSeconds:10.5}]);
});

test('composed voice keeps the closer first recording and reports mismatch; unknown measurement does not retry', async () => {
    let scripts=0,syntheses=0;const released=[];
    const command=createVoiceFeature({
        prepareScript:async()=>{scripts++;return{success:true,mode:'compose',text:scripts===1?'Initial':'Revision',durationSeconds:10};},
        synthesize:async()=>{syntheses++;return{ref:`voice-${syntheses}`,mime:'audio/ogg',...(syntheses===1?{durationSeconds:12}:{durationSeconds:15})};},
        fitDuration:async media=>media,release:async ref=>released.push(ref)
    }).commands[0];
    const reply=await command.handler(context(),{mode:'compose',instruction:'Resume',durationSeconds:10},signal());
    assert.equal(syntheses,2);assert.deepEqual(released,['voice-2']);
    assert.deepEqual(reply.parts,[{type:'audio',ref:'voice-1',mime:'audio/ogg',transcript:'Initial',durationSeconds:12},
        {type:'text',text:'La nota quedó en 12.0 s; buscábamos 10 s.'}]);

    scripts=0;syntheses=0;
    const unknown=createVoiceFeature({prepareScript:async()=>{scripts++;return{success:true,text:'Sin medición',durationSeconds:10};},
        synthesize:async()=>{syntheses++;return{ref:'voice-unmeasured',mime:'audio/ogg'};},fitDuration:async media=>media}).commands[0];
    const unknownReply=await unknown.handler(context(),{mode:'compose',instruction:'Resume',durationSeconds:10},signal());
    assert.equal(scripts,1);assert.equal(syntheses,1);assert.deepEqual(unknownReply.parts,[{type:'audio',ref:'voice-unmeasured',mime:'audio/ogg',transcript:'Sin medición'}]);
});

test('quota and cancellation during a duration revision release the first output exactly once', async () => {
    for (const failure of ['quota','abort']) {
        const controller=new AbortController();let scripts=0,syntheses=0;const released=[];
        const command=createVoiceFeature({
            prepareScript:async()=>{scripts++;if(scripts===2){if(failure==='abort')controller.abort();else throw new AppError('quota');}
                return{success:true,mode:'compose',text:'Borrador',durationSeconds:10};},
            synthesize:async()=>{syntheses++;return{ref:'voice-initial',mime:'audio/ogg',durationSeconds:12};},
            fitDuration:async media=>media,release:async ref=>released.push(ref)
        }).commands[0];
        if(failure==='quota') await assert.rejects(command.handler(context(),{mode:'compose',instruction:'Resume',durationSeconds:10},controller.signal),{kind:'quota'});
        else await assert.rejects(command.handler(context(),{mode:'compose',instruction:'Resume',durationSeconds:10},controller.signal),{name:'AbortError'});
        assert.equal(syntheses,1);assert.deepEqual(released,['voice-initial']);
    }
});

test('voice clarification, adapter failure, and cancellation never leak provider details', async () => {
    let synthesisCalls = 0;
    const clarification = createVoiceFeature({ prepareScript: async () => ({ success: false, question: '¿Qué quieres que diga?' }),
        synthesize: async () => { synthesisCalls++; return { ref: 'voice', mime: 'audio/ogg' }; }, fitDuration: async media => media }).commands[0];
    assert.equal((await clarification.handler(context(), {}, signal())).parts[0].text, '¿Qué quieres que diga?');
    assert.equal(synthesisCalls, 0);
    const failure = createVoiceFeature({ prepareScript: async () => ({ success: true, text: 'hello' }),
        synthesize: async () => { throw Error('private provider token'); }, fitDuration: async media => media }).commands[0];
    const fallback = await failure.handler(context(), {}, signal());
    assert.match(fallback.parts[0].text, /No pude preparar o enviar/);
    assert.doesNotMatch(fallback.parts[0].text, /private provider token/);
    const controller = new AbortController(); controller.abort();
    await assert.rejects(failure.handler(context(), {}, controller.signal), { name: 'AbortError' });
});
