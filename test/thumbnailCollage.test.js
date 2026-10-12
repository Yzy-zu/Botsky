'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { generateThumbnailCollage, downloadThumbnail } = require('../src/utils/thumbnailCollage');

describe('thumbnailCollage utility', () => {

    test('retorna null si la lista de items está vacía o es inválida', async () => {
        assert.equal(await generateThumbnailCollage([]), null);
        assert.equal(await generateThumbnailCollage(null), null);
        assert.equal(await generateThumbnailCollage('no-array'), null);
    });

    test('downloadThumbnail retorna false si la URL es inválida o inexistente', async () => {
        assert.equal(await downloadThumbnail(null, '/tmp/dummy.jpg'), false);
        assert.equal(await downloadThumbnail('', '/tmp/dummy.jpg'), false);
        assert.equal(await downloadThumbnail('https://dominio-totalmente-falso-que-no-existe-12345.com/img.jpg', '/tmp/dummy.jpg'), false);
    });

    test('genera un collage JPEG válido con 4 miniaturas y limpia archivos temporales', async () => {
        const items = [
            { id: '1', title: 'Video 1', thumbnailUrl: 'https://i.ytimg.com/vi/u0XHVssfsYM/mqdefault.jpg' },
            { id: '2', title: 'Video 2', thumbnailUrl: 'https://i.ytimg.com/vi/d-J28k_MY6Y/mqdefault.jpg' },
            { id: '3', title: 'Video 3', thumbnailUrl: 'https://i.ytimg.com/vi/y0sF5xhGreA/mqdefault.jpg' },
            { id: '4', title: 'Video 4', thumbnailUrl: 'https://i.ytimg.com/vi/u0XHVssfsYM/mqdefault.jpg' }
        ];

        const collagePath = await generateThumbnailCollage(items);
        assert.ok(collagePath, 'Debe devolver una ruta de archivo');
        assert.ok(fs.existsSync(collagePath), 'El archivo generado debe existir');
        
        const stats = fs.statSync(collagePath);
        assert.ok(stats.size > 5000, `El collage debe tener un tamaño razonable (>5KB), actual: ${stats.size}`);

        // Limpiar archivo final de prueba
        fs.unlinkSync(collagePath);
        assert.ok(!fs.existsSync(collagePath));
    });

    test('maneja items con miniaturas fallidas usando fondo de respaldo sin lanzar excepción', async () => {
        const items = [
            { id: '1', title: 'Video OK', thumbnailUrl: 'https://i.ytimg.com/vi/u0XHVssfsYM/mqdefault.jpg' },
            { id: '2', title: 'Video Roto', thumbnailUrl: 'https://url-invalida-404.test/foto.jpg' }
        ];

        const collagePath = await generateThumbnailCollage(items);
        assert.ok(collagePath, 'Debe generar el collage incluso si una miniatura falla');
        assert.ok(fs.existsSync(collagePath));
        
        const stats = fs.statSync(collagePath);
        assert.ok(stats.size > 2000, 'El collage resultante debe ser válido');

        fs.unlinkSync(collagePath);
    });
});
