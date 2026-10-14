'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { writeZip, DEFAULT_MAX_BYTES, MAX_CLASSIC_ZIP_BYTES } = require('../../../../src/v2/adapters/media/zip');

async function fixture() {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-zip-test-'));
    const first = path.join(root, 'page-02.jpg'), second = path.join(root, 'page-01.jpg');
    await fs.writeFile(first, Buffer.from([255, 216, 255, 0, 1]));
    await fs.writeFile(second, Buffer.from([255, 216, 255, 0, 2]));
    return { root, first, second, output: path.join(root, 'pages.zip'), dispose: () => fs.rm(root, { recursive: true, force: true }) };
}

test('writes store ZIP readable by independent Python zipfile oracle with input order and UTF-8 names', async () => {
    const f = await fixture();
    try {
        await writeZip([{ path: f.first, name: 'página-02.jpg' }, { path: f.second, name: 'página-01.jpg' }], f.output, { signal: new AbortController().signal });
        const script = 'import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps([(n,z.read(n).hex()) for n in z.namelist()],ensure_ascii=False))';
        const result = JSON.parse(execFileSync('python3', ['-c', script, f.output], { encoding: 'utf8' }));
        assert.deepEqual(result, [['página-02.jpg', 'ffd8ff0001'], ['página-01.jpg', 'ffd8ff0002']]);
        assert.equal((await fs.stat(f.output)).mode & 0o777, 0o600);
    } finally { await f.dispose(); }
});

test('rejects path traversal, duplicate names, oversized archives and too many entries', async () => {
    const f = await fixture();
    try {
        await assert.rejects(writeZip([{ path: f.first, name: '../escape' }], f.output, { signal: new AbortController().signal }), /name/);
        await assert.rejects(writeZip([{ path: f.first, name: 'same' }, { path: f.second, name: 'same' }], f.output, { signal: new AbortController().signal }), /duplicate/);
        await assert.rejects(writeZip([{ path: f.first, name: 'one.jpg' }], f.output, { signal: new AbortController().signal, maxBytes: 2 }), /byte limit/);
        await assert.rejects(writeZip(Array.from({ length: 101 }, () => ({ path: f.first, name: 'x' })), f.output, { signal: new AbortController().signal }), /file count/);
        await assert.rejects(fs.stat(f.output), { code: 'ENOENT' });
    } finally { await f.dispose(); }
});

test('rejects files outside its owned output directory and cleans a partial archive after abort', async () => {
    const f = await fixture();
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'botsky-zip-outside-'));
    try {
        await assert.rejects(writeZip([{ path: path.join(outside, 'secret') , name: 'secret' }], f.output, { signal: new AbortController().signal }), /outside/);
        const controller = new AbortController();
        const abortingFs = { ...fs, open: async (...args) => {
            const handle = await fs.open(...args);
            return { writeFile: async data => { await handle.writeFile(data); controller.abort(new Error('aborted')); }, close: () => handle.close() };
        } };
        await assert.rejects(writeZip([{ path: f.first, name: 'page.jpg' }], f.output, { signal: controller.signal, fs: abortingFs }), /aborted/);
        await assert.rejects(fs.stat(f.output), { code: 'ENOENT' });
    } finally { await f.dispose(); await fs.rm(outside, { recursive: true, force: true }); }
});

test('checks input stat size before allocating contents with readFile', async () => {
    const f = await fixture();
    let readCalled = false;
    try {
        const guardedFs = { ...fs,
            lstat: async file => file === f.first ? { isFile:()=>true, isSymbolicLink:()=>false, size:21 } : fs.lstat(file),
            readFile: async () => { readCalled = true; throw Error('readFile must not run'); }
        };
        await assert.rejects(writeZip([{ path:f.first, name:'large.jpg' }], f.output, { signal:new AbortController().signal, maxBytes:20, fs:guardedFs }), /byte limit/);
        assert.equal(readCalled, false);
    } finally { await f.dispose(); }
});

test('supports configured limits above the default while enforcing classic ZIP bounds', async () => {
    const f = await fixture();
    try {
        const result=await writeZip([{path:f.first,name:'page.jpg'}],f.output,{signal:new AbortController().signal,maxBytes:21*1024*1024});
        assert.ok(result.bytes<DEFAULT_MAX_BYTES);
        await fs.unlink(f.output);
        await assert.rejects(writeZip([{path:f.first,name:'page.jpg'}],f.output,{signal:new AbortController().signal,maxBytes:MAX_CLASSIC_ZIP_BYTES+1}),/byte limit/);
        await assert.rejects(fs.stat(f.output),{code:'ENOENT'});
    } finally { await f.dispose(); }
});

test('default 20 MiB cap rejects oversized input stat before reading', async () => {
    const f = await fixture();
    let readCalled=false;
    try {
        const cappedFs={...fs,
            lstat:async file=>file===f.first?{isFile:()=>true,isSymbolicLink:()=>false,size:DEFAULT_MAX_BYTES+1}:fs.lstat(file),
            readFile:async()=>{readCalled=true;throw Error('readFile must not run');}
        };
        await assert.rejects(writeZip([{path:f.first,name:'large.jpg'}],f.output,{signal:new AbortController().signal,fs:cappedFs}),/byte limit/);
        assert.equal(readCalled,false);
    } finally { await f.dispose(); }
});
