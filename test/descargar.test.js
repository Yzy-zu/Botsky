const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { buildArgs, matchSelection, handleDescargar, getDownloadSessionKey, inProgressDownloads, extractAdultUrl } = require('../src/commands/descargar');
const evolution = require('../src/services/evolution');
const drive = require('../src/services/drive');
const progress = require('../src/services/progress');

test('descargar: buildArgs genera flags estándar para YouTube', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const args = buildArgs(url, 'mp4', '480', false, '/tmp/test_session');
    assert.ok(args.includes(url));
    assert.ok(args.includes('--no-playlist'));
    assert.ok(args.includes('--user-agent'));
    assert.ok(args.includes('--socket-timeout'));
    assert.ok(args.includes('30'));
});

test('descargar: buildArgs detecta Spotify y genera comando para spotdl', () => {
    const url = 'https://open.spotify.com/track/4cOdK2wGLETKBW3PvgPWqT';
    const args = buildArgs(url, 'mp3', '480', false, '/tmp/test_spotify');
    assert.strictEqual(args[0], 'download');
    assert.strictEqual(args[1], url);
    assert.ok(args.includes('--format'));
    assert.ok(args.includes('mp3'));
    assert.ok(args.includes('--output'));
});

test('descargar: matchSelection reconoce números, expresiones coloquiales, puntuación y formatos', () => {
    assert.strictEqual(matchSelection('el 1')?.num, 1);
    const sel2 = matchSelection('descárgame el 2 mp3');
    assert.strictEqual(sel2?.num, 2);
    assert.strictEqual(sel2?.format, 'mp3');
    assert.strictEqual(matchSelection('#3')?.num, 3);
    assert.strictEqual(matchSelection('# 3')?.num, 3);
    assert.strictEqual(matchSelection('4')?.num, 4);

    // Formas femeninas y sustantivos coloquiales
    assert.strictEqual(matchSelection('la 1')?.num, 1);
    assert.strictEqual(matchSelection('la opcion 2')?.num, 2);
    assert.strictEqual(matchSelection('opcion 3')?.num, 3);
    assert.strictEqual(matchSelection('rola 2')?.num, 2);
    assert.strictEqual(matchSelection('canción 1')?.num, 1);

    // Verbos adicionales y cortesías con espacios o puntuación
    assert.strictEqual(matchSelection('pon el 1')?.num, 1);
    assert.strictEqual(matchSelection('pon la 1')?.num, 1);
    assert.strictEqual(matchSelection('el 1 por favor')?.num, 1);
    assert.strictEqual(matchSelection('el 1.')?.num, 1);
    assert.strictEqual(matchSelection('el 1!')?.num, 1);
    assert.strictEqual(matchSelection('descárgame el 2, porfa')?.num, 2);
    assert.strictEqual(matchSelection('¿el 1?')?.num, 1);
    assert.strictEqual(matchSelection('¡el 2!')?.num, 2);
    assert.strictEqual(matchSelection('túmbate la 2 en mp3 por favor')?.num, 2);
    assert.strictEqual(matchSelection('túmbate la 2 en mp3 por favor')?.format, 'mp3');

    // Alias de formato de audio
    const selAudio = matchSelection('el 4 en audio');
    assert.strictEqual(selAudio?.num, 4);
    assert.strictEqual(selAudio?.format, 'mp3');

    // Casos negativos que no deben ser selección
    assert.strictEqual(matchSelection('hola compa'), null);
    assert.strictEqual(matchSelection('descarga el video de shakira'), null);
    assert.strictEqual(matchSelection('100'), null);
});

test('descargar: extractAdultUrl detecta dominios adultos sin protocolo y los normaliza', () => {
    assert.strictEqual(extractAdultUrl('mira www.xvideos.com/video123'), 'https://www.xvideos.com/video123');
    assert.strictEqual(extractAdultUrl('xvideos.com/video456 compa'), 'https://xvideos.com/video456');
    assert.strictEqual(extractAdultUrl('https://pornhub.com/view_video.php?viewkey=123'), 'https://pornhub.com/view_video.php?viewkey=123');
    assert.strictEqual(extractAdultUrl('https://youtube.com/watch?v=123'), null);
});

test('descargar: handleDescargar ignora fotos de TikTok en silencio', async () => {
    const url = 'https://www.tiktok.com/@user/photo/1234567890';
    let threw = false;
    try {
        await handleDescargar({ flags: {}, args: [url] }, '123@s.whatsapp.net', { key: { id: 'test_msg_1' } });
    } catch {
        threw = true;
    }
    assert.strictEqual(threw, false, 'No debe lanzar excepción');
});

test('descargar: auto-subida a Google Drive cuando excede el límite de WhatsApp', async () => {
    const origUpload = drive.uploadFile;
    const origSendText = evolution.sendText;
    const origSendReaction = evolution.sendReaction;
    const origSpawn = progress.spawnWithProgress;

    let driveUploaded = false;
    let driveLinkSent = false;

    drive.uploadFile = async (filePath, mimeType, name) => {
        driveUploaded = true;
        return { id: 'drive_123', webViewLink: 'https://drive.google.com/file/d/test123/view' };
    };

    evolution.sendText = async (to, msg) => {
        if (msg.includes('Google Drive') && msg.includes('https://drive.google.com')) {
            driveLinkSent = true;
        }
    };

    evolution.sendReaction = async () => {};

    const tmpDir = process.env.TMP_DIR || '/tmp/whatsapp-bot';
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });

    progress.spawnWithProgress = async (cmd, argsArray, opts) => {
        const outIdx = argsArray.indexOf('-o');
        if (outIdx !== -1) {
            const outTemplate = argsArray[outIdx + 1];
            const realOut = outTemplate.replace('%(ext)s', 'mp4');
            const fakeBuf = Buffer.alloc(52 * 1024 * 1024);
            fs.writeFileSync(realOut, fakeBuf);
        }
        return { stdout: '', stderr: '' };
    };

    try {
        await handleDescargar(
            { flags: {}, args: ['https://www.youtube.com/watch?v=fakeHeavyVideo'] },
            'test_user@s.whatsapp.net',
            { key: { id: 'test_heavy_msg' } }
        );

        assert.strictEqual(driveUploaded, true, 'Debe haberse llamado a drive.uploadFile');
        assert.strictEqual(driveLinkSent, true, 'Debe haberse enviado el enlace de Drive por WhatsApp');
    } finally {
        drive.uploadFile = origUpload;
        evolution.sendText = origSendText;
        evolution.sendReaction = origSendReaction;
        progress.spawnWithProgress = origSpawn;
    }
});

test('descargar: exporta getDownloadSessionKey e inProgressDownloads correctamente', () => {
    assert.strictEqual(typeof getDownloadSessionKey, 'function');
    assert.ok(inProgressDownloads instanceof Map);
});

test('descargar: buildArgs no incluye límites arbitrarios (--max-filesize, filesize<?10M, corte de 5min)', () => {
    const url = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ';
    const args = buildArgs(url, 'mp4', '720', false, '/tmp/test_session');
    assert.strictEqual(args.includes('--max-filesize'), false, 'No debe incluir --max-filesize');
    assert.strictEqual(args.includes('15M'), false, 'No debe tener límite de 15M');
    assert.strictEqual(args.includes('*00:00:00-00:05:00'), false, 'No debe tener corte forzado a 5 minutos');
    const fIdx = args.indexOf('-f');
    assert.ok(fIdx !== -1);
    assert.strictEqual(args[fIdx + 1].includes('filesize<?10M>'), false, 'No debe tener filtro filesize<?10M>');
});

test('descargar: peticiones con términos para adultos activan isAdult y consultan searchAdultList', async () => {
    const descargarMod = require('../src/commands/descargar');
    const origSearchAdult = descargarMod.searchAdultList;
    const mediaSearch = require('../src/services/mediaSearch');
    const origSearchMedia = mediaSearch.searchMedia;
    const origSendText = evolution.sendText;

    let searchAdultCalled = false;
    let searchMediaCalled = false;
    let sentMessage = '';

    descargarMod.searchAdultList = async (query) => {
        searchAdultCalled = true;
        return [{ title: 'Video cochino', url: 'https://www.xvideos.com/video123', duration: '10 min', estimatedSize: '💾 ~22MB' }];
    };
    mediaSearch.searchMedia = async () => {
        searchMediaCalled = true;
        return { status: 'success', items: [] };
    };
    evolution.sendText = async (to, msg) => {
        sentMessage = msg;
    };

    try {
        await handleDescargar(
            { flags: {}, args: ['busca', 'porno', 'de', 'latinas'], semanticDecision: { action: 'descargar' } },
            'user123@s.whatsapp.net',
            { key: { id: 'msg_adult_search' } }
        );

        assert.strictEqual(searchAdultCalled, true, 'Debe llamar a searchAdultList');
        assert.strictEqual(searchMediaCalled, false, 'No debe llamar a searchMedia de YouTube');
        assert.ok(sentMessage.includes('🔞 *Videos encontrados para:*'), 'Debe incluir header para adultos');
        assert.ok(sentMessage.includes('no mames que te bajes una de 2 horas'), 'Debe conservar humor mexicano');
    } finally {
        descargarMod.searchAdultList = origSearchAdult;
        mediaSearch.searchMedia = origSearchMedia;
        evolution.sendText = origSendText;
    }
});

test('descargar: matchSelection funciona para seleccionar de la lista aunque exista semanticDecision', async () => {
    const { setSearchSession, clearSearchSession } = require('../src/commands/descargar');
    const origSpawn = progress.spawnWithProgress;
    const origSendMedia = evolution.sendMedia;
    let mediaSent = false;
    let mediaCaption = '';

    const sessionKey = 'user_select@s.whatsapp.net';
    setSearchSession(sessionKey, {
        results: [
            { title: 'Video 1', url: 'https://www.xvideos.com/video1' },
            { title: 'Video 2', url: 'https://www.xvideos.com/video2' }
        ],
        isAdult: true,
        searchQuery: 'latinas',
        format: 'mp4',
        quality: '480'
    });

    progress.spawnWithProgress = async (cmd, argsArray) => {
        const outIdx = argsArray.indexOf('-o');
        if (outIdx !== -1) {
            const outTemplate = argsArray[outIdx + 1];
            const realOut = outTemplate.replace('%(ext)s', 'mp4');
            fs.writeFileSync(realOut, Buffer.alloc(1024));
        }
        return { stdout: '', stderr: '' };
    };

    evolution.sendMedia = async (to, file, caption) => {
        mediaSent = true;
        mediaCaption = caption;
    };

    try {
        await handleDescargar(
            { flags: {}, args: ['descárgame el 2 mp3'], semanticDecision: { action: 'descargar' } },
            sessionKey,
            { key: { id: 'msg_select_2' } }
        );

        assert.strictEqual(mediaSent, true, 'Debe haber enviado el archivo multimedia');
        assert.ok(mediaCaption.includes('ahí está tu cochinada cerdo, lávate las manos'), 'Debe enviar caption para adultos con carrilla pesada');
    } finally {
        clearSearchSession(sessionKey);
        progress.spawnWithProgress = origSpawn;
        evolution.sendMedia = origSendMedia;
    }
});

test('descargar: URL de sitio adulto sin protocolo activa isAdult y se procesa directamente', async () => {
    const origSpawn = progress.spawnWithProgress;
    const origSendMedia = evolution.sendMedia;
    let downloadedUrl = '';
    let mediaCaption = '';

    progress.spawnWithProgress = async (cmd, argsArray) => {
        downloadedUrl = argsArray[argsArray.length - 1];
        const outIdx = argsArray.indexOf('-o');
        if (outIdx !== -1) {
            const outTemplate = argsArray[outIdx + 1];
            const realOut = outTemplate.replace('%(ext)s', 'mp4');
            fs.writeFileSync(realOut, Buffer.alloc(1024));
        }
        return { stdout: '', stderr: '' };
    };

    evolution.sendMedia = async (to, file, caption) => {
        mediaCaption = caption;
    };

    try {
        await handleDescargar(
            { flags: {}, args: ['www.xvideos.com/video999/test'] },
            'user_direct@s.whatsapp.net',
            { key: { id: 'msg_direct_adult' } }
        );

        assert.strictEqual(downloadedUrl, 'https://www.xvideos.com/video999/test');
        assert.ok(mediaCaption.includes('ahí está tu cochinada cerdo, lávate las manos'));
    } finally {
        progress.spawnWithProgress = origSpawn;
        evolution.sendMedia = origSendMedia;
    }
});

test('descargar: searchAdultList limpia preposiciones y términos adultos de la consulta', async () => {
    const { searchAdultList } = require('../src/commands/descargar');
    const origFetch = global.fetch;
    let queriedUrl = '';

    global.fetch = async (url) => {
        queriedUrl = url;
        return {
            ok: true,
            text: async () => '<div id="video_1"><a href="/video100" title="Test Video"></a><span class="duration">5 min</span></div>'
        };
    };

    try {
        const results = await searchAdultList('porno de latinas');
        assert.ok(queriedUrl.includes('k=latinas'), `La URL debe contener "latinas" limpio, fue: ${queriedUrl}`);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].title, 'Test Video');
    } finally {
        global.fetch = origFetch;
    }
});

test('descargar: matchSelection maneja menciones de bot y expresiones reflexivas mexicanas', () => {
    assert.strictEqual(matchSelection('@5214437367565 el 1')?.num, 1);
    assert.strictEqual(matchSelection('@Botsky la 2')?.num, 2);
    assert.strictEqual(matchSelection('bájate la 1')?.num, 1);
    assert.strictEqual(matchSelection('descárgate el 2')?.num, 2);
    assert.strictEqual(matchSelection('pónte la 3')?.num, 3);
    assert.strictEqual(matchSelection('quiero ver el 2')?.num, 2);
});

test('descargar: searchAdultList limpia verbos imperativos esdrújulos con acento', async () => {
    const { searchAdultList } = require('../src/commands/descargar');
    const origFetch = global.fetch;
    const queries = [];

    global.fetch = async (url) => {
        queries.push(url);
        return {
            ok: true,
            text: async () => '<div id="video_1"><a href="/video100" title="Test Video"></a><span class="duration">5 min</span></div>'
        };
    };

    try {
        await searchAdultList('descárgame porno de latinas');
        await searchAdultList('búscame porno de milfs');
        await searchAdultList('bájame porno de rubias');

        assert.ok(queries[0].includes('k=latinas'), `Debe contener "latinas", fue: ${queries[0]}`);
        assert.ok(queries[1].includes('k=milfs'), `Debe contener "milfs", fue: ${queries[1]}`);
        assert.ok(queries[2].includes('k=rubias'), `Debe contener "rubias", fue: ${queries[2]}`);
    } finally {
        global.fetch = origFetch;
    }
});

test('descargar: selección explícita sin sesión activa informa amistosamente al usuario', async () => {
    let failureMsg = '';
    const origFail = progress.Progress.prototype.fail;
    progress.Progress.prototype.fail = async function (msg) {
        failureMsg = msg;
    };

    try {
        await handleDescargar(
            { flags: {}, args: ['el 1'] },
            'empty_user@s.whatsapp.net',
            { key: { id: 'msg_no_session' } }
        );

        assert.ok(failureMsg.includes('No hay ninguna lista de videos activa'), 'Debe informar que no hay lista activa');
    } finally {
        progress.Progress.prototype.fail = origFail;
    }
});

test('descargar: extractAdultUrl limpia puntuación final y admite espejos numéricos (xvideos2, xnxx2)', () => {
    assert.strictEqual(extractAdultUrl('mira www.xvideos.com/video123.'), 'https://www.xvideos.com/video123');
    assert.strictEqual(extractAdultUrl('mira https://www.xvideos.com/video123, checalo'), 'https://www.xvideos.com/video123');
    assert.strictEqual(extractAdultUrl('(https://www.xvideos.com/video123)'), 'https://www.xvideos.com/video123');
    assert.strictEqual(extractAdultUrl('mira www.xvideos.com/video123?'), 'https://www.xvideos.com/video123');
    assert.strictEqual(extractAdultUrl('https://www.xvideos2.com/video555'), 'https://www.xvideos2.com/video555');
    assert.strictEqual(extractAdultUrl('https://www.xnxx2.com/video666'), 'https://www.xnxx2.com/video666');
});

test('descargar: matchSelection reconoce variantes reflexivas y verbos coloquiales mexicanos (échame el 1, échate la 2)', () => {
    assert.strictEqual(matchSelection('échame el 1')?.num, 1);
    assert.strictEqual(matchSelection('échate la 2')?.num, 2);
    assert.strictEqual(matchSelection('descarga 2')?.num, 2);
    assert.strictEqual(matchSelection('baja 3')?.num, 3);
});

test('descargar: searchAdultList limpia videos porno, clips, múltiples artículos y preserva categorías como pelirrojas', async () => {
    const { searchAdultList } = require('../src/commands/descargar');
    const origFetch = global.fetch;
    const queries = [];

    global.fetch = async (url) => {
        queries.push(url);
        return {
            ok: true,
            text: async () => '<div id="video_1"><a href="/video100" title="Test Video"></a><span class="duration">5 min</span></div>'
        };
    };

    try {
        await searchAdultList('busca videos porno de latinas');
        await searchAdultList('un video porno de mexicanas');
        await searchAdultList('una porno de pelirrojas');

        assert.ok(queries[0].includes('k=latinas'), `Debe contener "latinas", fue: ${queries[0]}`);
        assert.ok(queries[1].includes('k=mexicanas'), `Debe contener "mexicanas", fue: ${queries[1]}`);
        assert.ok(queries[2].includes('k=pelirrojas'), `Debe preservar categoría "pelirrojas" intacta, fue: ${queries[2]}`);
    } finally {
        global.fetch = origFetch;
    }
});

test('descargar: búsqueda con acentos en términos adultos ("videos eróticos") activa isAdult', async () => {
    const descargarMod = require('../src/commands/descargar');
    const origSearchAdult = descargarMod.searchAdultList;
    const mediaSearch = require('../src/services/mediaSearch');
    const origSearchMedia = mediaSearch.searchMedia;
    const origSendText = evolution.sendText;
    let searchAdultCalled = false;
    let searchMediaCalled = false;

    evolution.sendText = async () => {};
    descargarMod.searchAdultList = async () => {
        searchAdultCalled = true;
        return [{ title: 'Video erotico', url: 'https://www.xvideos.com/v1', duration: '5 min' }];
    };
    mediaSearch.searchMedia = async () => {
        searchMediaCalled = true;
        return { status: 'success', items: [] };
    };

    try {
        await handleDescargar(
            { flags: {}, args: ['videos eróticos'] },
            'user_erotico@s.whatsapp.net',
            { key: { id: 'msg_erotico' } }
        );

        assert.strictEqual(searchAdultCalled, true, 'Debe activar searchAdultList para "videos eróticos"');
        assert.strictEqual(searchMediaCalled, false, 'No debe consultar YouTube');
    } finally {
        descargarMod.searchAdultList = origSearchAdult;
        mediaSearch.searchMedia = origSearchMedia;
        evolution.sendText = origSendText;
    }
});

test('descargar: búsqueda genera y envía collage de miniaturas con sendMedia', async () => {
    const mediaSearch = require('../src/services/mediaSearch');
    const origSearchMedia = mediaSearch.searchMedia;
    const thumbCollage = require('../src/utils/thumbnailCollage');
    const origGenerateCollage = thumbCollage.generateThumbnailCollage;
    const origSendMedia = evolution.sendMedia;
    const origSendText = evolution.sendText;

    let mediaSentTo = null;
    let mediaFileSent = null;
    let mediaCaptionSent = null;
    let textSent = false;
    const dummyCollage = '/tmp/whatsapp-bot/test_collage_mock.jpg';
    fs.writeFileSync(dummyCollage, Buffer.from('mock-image'));

    thumbCollage.generateThumbnailCollage = async (items) => {
        return dummyCollage;
    };
    mediaSearch.searchMedia = async () => {
        return {
            status: 'success',
            items: [
                { title: 'Video 1', url: 'https://www.youtube.com/watch?v=vid1', thumbnailUrl: 'https://i.ytimg.com/vi/vid1/mqdefault.jpg', duration: '3:00' },
                { title: 'Video 2', url: 'https://www.youtube.com/watch?v=vid2', thumbnailUrl: 'https://i.ytimg.com/vi/vid2/mqdefault.jpg', duration: '4:00' }
            ]
        };
    };
    evolution.sendMedia = async (to, file, caption) => {
        mediaSentTo = to;
        mediaFileSent = file;
        mediaCaptionSent = caption;
    };
    evolution.sendText = async () => {
        textSent = true;
    };

    try {
        await handleDescargar(
            { flags: {}, args: ['canciones chidas'] },
            'user_collage@s.whatsapp.net',
            { key: { id: 'msg_collage' } }
        );

        assert.strictEqual(mediaSentTo, 'user_collage@s.whatsapp.net', 'Debe enviar a través de sendMedia');
        assert.strictEqual(mediaFileSent, dummyCollage);
        assert.ok(mediaCaptionSent.includes('🎬 *Encontré estas opciones para:* "canciones chidas"'));
        assert.ok(mediaCaptionSent.includes('*1.* Video 1'));
        assert.strictEqual(textSent, false, 'No debe usar sendText si el collage se envió con éxito');
        assert.strictEqual(fs.existsSync(dummyCollage), false, 'El archivo temporal de collage debe ser eliminado');
    } finally {
        mediaSearch.searchMedia = origSearchMedia;
        thumbCollage.generateThumbnailCollage = origGenerateCollage;
        evolution.sendMedia = origSendMedia;
        evolution.sendText = origSendText;
        if (fs.existsSync(dummyCollage)) fs.unlinkSync(dummyCollage);
    }
});

test('descargar: searchAdultList extrae thumbnailUrl correctamente de data-src o src', async () => {
    const { searchAdultList } = require('../src/commands/descargar');
    const origFetch = global.fetch;

    global.fetch = async (url) => {
        return {
            ok: true,
            text: async () => '<div id="video_1"><a href="/video100" title="Test Adult Video"></a><span class="duration">12 min</span><img data-src="https://thumb.xvideos-cdn.com/test_THUMBNUM.jpg" /></div>'
        };
    };

    try {
        const results = await searchAdultList('latinas');
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].thumbnailUrl, 'https://thumb.xvideos-cdn.com/test_1.jpg', 'Debe extraer y normalizar THUMBNUM a 1');
    } finally {
        global.fetch = origFetch;
    }
});