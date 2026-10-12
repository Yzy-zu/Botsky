// @ts-check
'use strict';

const { buildNativeTableMessage } = require('./whatsappText');

const USER_NUMBER = /^\d{5,20}(?:@s\.whatsapp\.net)?$/;
const GROUP_NUMBER = /^\d{5,30}(?:-\d{5,20})?@g\.us$/;

/** @param {any} body */
function validateNativeTableRequest(body) {
    const invalid = (/** @type {any} */ message) => { throw new TypeError(message); };
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Body must be an object');
    if (Object.keys(body).some(key => !['number', 'table', 'delay', 'mentions'].includes(key))) invalid('Unknown request field');
    if (typeof body.number !== 'string' || !(USER_NUMBER.test(body.number) || GROUP_NUMBER.test(body.number))) invalid('Invalid WhatsApp number');
    const table = body.table;
    if (!table || typeof table !== 'object' || Array.isArray(table)) invalid('Table must be an object');
    if (Object.keys(table).some(key => !['headers', 'rows', 'title'].includes(key))) invalid('Unknown table field');
    const cell = (/** @type {any} */ value) => typeof value === 'string' && value.length <= 3500;
    if (!Array.isArray(table.headers) || table.headers.length < 1 || table.headers.length > 20 || !table.headers.every(cell)) invalid('Invalid table headers');
    if (!Array.isArray(table.rows) || table.rows.length < 1 || table.rows.length > 100 || !table.rows.every((/** @type {any} */ row) => Array.isArray(row) && row.length === table.headers.length && row.every(cell))) invalid('Invalid table rows');
    if (table.title !== undefined && !cell(table.title)) invalid('Invalid table title');
    if (body.delay !== undefined && (!Number.isInteger(body.delay) || body.delay < 0 || body.delay > 20000)) invalid('Invalid delay');
    if (body.mentions !== undefined && (!Array.isArray(body.mentions) || body.mentions.length > 100 || !body.mentions.every((/** @type {any} */ number) => typeof number === 'string' && USER_NUMBER.test(number)))) invalid('Invalid mentions');
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 64 * 1024) invalid('Table request exceeds 64 KiB');
    return {
        number: body.number,
        table: { headers: [...table.headers], rows: table.rows.map((/** @type {any} */ row) => [...row]), ...(table.title !== undefined ? { title: table.title } : {}) },
        delay: body.delay ?? 0,
        mentions: (body.mentions || []).map((/** @type {any} */ number) => number.includes('@') ? number : `${number}@s.whatsapp.net`)
    };
}

/** @param {any} getMonitor */
function createNativeTableHandler(getMonitor) {
    return async (/** @type {any} */ req, /** @type {any} */ res, /** @type {(error:unknown)=>void} */ next) => {
        let input;
        try {
            input = validateNativeTableRequest(req.body);
        } catch (caught) {
            const error = /** @type {any} */ (caught);
            return res.status(400).json({ code: 'NATIVE_TABLE_INVALID', message: error.message });
        }
        try {
            const name = req.params?.instanceName;
            const instances = getMonitor()?.waInstances;
            const service = name && instances && Object.prototype.hasOwnProperty.call(instances, name) ? instances[name] : null;
            if (!service) return res.status(404).json({ code: 'INSTANCE_NOT_FOUND', message: 'Instance not found' });
            const connection = service.connectionStatus;
            if ((typeof connection === 'string' ? connection : connection?.state) !== 'open') {
                return res.status(409).json({ code: 'INSTANCE_DISCONNECTED', message: 'Instance is disconnected' });
            }
            if (typeof service.sendMessageWithTyping !== 'function' || typeof service.client?.relayMessage !== 'function') {
                return res.status(400).json({ code: 'NATIVE_TABLE_UNSUPPORTED', message: 'Native tables require a Baileys instance' });
            }
            const message = buildNativeTableMessage(input.table, { mentions: input.mentions });
            const result = await service.sendMessageWithTyping(input.number, message, {
                delay: input.delay, presence: 'composing', mentioned: input.mentions
            });
            return res.status(201).json(result);
        } catch (caught) {
            const error = /** @type {any} */ (caught);
            // A relay may already have succeeded before persistence fails. Never invite a retry.
            return next(error);
        }
    };
}

const MODULE_PATH = '/evolution/botsky/src/integrations/evolutionNativeTables.js';
const PATCHED_CONDITION = '(t.viewOnceMessage||t.botForwardedMessage?.message?.richResponseMessage)';
const METHOD = 'async sendMessage(e,t,o,i,n,r,a,c){';

/** @param {any} source @param {any} modulePath */
function patchEvolutionBundle(source, modulePath = MODULE_PATH) {
    if (!/^\/[a-zA-Z0-9_./-]+$/.test(modulePath)) throw new TypeError('Invalid integration module path');
    const routePattern = /\.post\(this\.routerPath\("sendText"\),\.\.\.([\w$]+),async\(([\w$]+),([\w$]+)\)=>\{let ([\w$]+)=await this\.dataValidate\(\{request:\2,schema:[\w$]+,ClassRef:[\w$]+,execute:\(([\w$]+),([\w$]+)\)=>([\w$]+)\.sendText\(\5,\6\)\}\);return \3\.status\(201\)\.json\(\4\)\}\)/g;
    const routes = [...source.matchAll(routePattern)];
    if (routes.length !== 1) throw new Error('Unsupported Evolution bundle: expected one guarded sendText route');
    const route = routes[0];
    const addition = `.post(this.routerPath("sendNativeTable"),...${route[1]},require('${modulePath}').createNativeTableHandler(()=>${route[7]}.waMonitor))`;
    const methods = [...source.matchAll(/async sendMessage\(e,t,o,i,n,r,a,c\)\{/g)];
    if (methods.length !== 1) throw new Error('Unsupported Evolution bundle: expected one Baileys sendMessage method');
    const methodStart = methods[0].index;
    const methodEnd = source.indexOf('async ', methodStart + METHOD.length);
    if (methodEnd === -1) throw new Error('Unsupported Evolution bundle: missing following method');
    const method = source.slice(methodStart, methodEnd);
    const oldCondition = ',t.viewOnceMessage){let ';
    const newCondition = `,${PATCHED_CONDITION}){let `;
    const existingRoutes = [...source.matchAll(/this\.routerPath\("sendNativeTable"\)/g)].length;
    const oldCount = method.split(oldCondition).length - 1;
    const newCount = method.split(newCondition).length - 1;
    if (existingRoutes || newCount) {
        if (existingRoutes !== 1 || newCount !== 1 || oldCount !== 0 || source.slice(route.index - addition.length, route.index) !== addition) {
            throw new Error('Incomplete or conflicting native-table patch');
        }
        return source;
    }
    if (oldCount !== 1 || !method.includes('this.client.relayMessage(e,t,{messageId:r})')) {
        throw new Error('Unsupported Evolution bundle: raw relay branch changed');
    }
    let patched = source.slice(0, methodStart) + method.replace(oldCondition, newCondition) + source.slice(methodEnd);
    patched = patched.replace(route[0], addition + route[0]);

    const viewOnceTarget = '(0,R.generateWAMessageFromContent)("",{[n]:{...i[n]}},{userJid:this.instance.wuid})';
    const viewOnceReplacement = '(0,R.generateWAMessageFromContent)("",(e?.viewOnce||e?.options?.viewOnce)?{viewOnceMessage:{message:{[n]:{...i[n],viewOnce:!0}}}}:{[n]:{...i[n]}},{userJid:this.instance.wuid})';
    if (patched.includes(viewOnceTarget)) {
        patched = patched.replace(viewOnceTarget, viewOnceReplacement);
    }

    return patched;
}


module.exports = { validateNativeTableRequest, createNativeTableHandler, patchEvolutionBundle };
