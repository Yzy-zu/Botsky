'use strict';

const { buildNativeTableMessage } = require('../utils/whatsappText');

const USER_NUMBER = /^\d{5,20}(?:@s\.whatsapp\.net)?$/;
const GROUP_NUMBER = /^\d{5,30}(?:-\d{5,20})?@g\.us$/;

function validateNativeTableRequest(body) {
    const invalid = message => { throw new TypeError(message); };
    if (!body || typeof body !== 'object' || Array.isArray(body)) invalid('Body must be an object');
    if (Object.keys(body).some(key => !['number', 'table', 'delay', 'mentions'].includes(key))) invalid('Unknown request field');
    if (typeof body.number !== 'string' || !(USER_NUMBER.test(body.number) || GROUP_NUMBER.test(body.number))) invalid('Invalid WhatsApp number');
    const table = body.table;
    if (!table || typeof table !== 'object' || Array.isArray(table)) invalid('Table must be an object');
    if (Object.keys(table).some(key => !['headers', 'rows', 'title'].includes(key))) invalid('Unknown table field');
    const cell = value => typeof value === 'string' && value.length <= 3500;
    if (!Array.isArray(table.headers) || table.headers.length < 1 || table.headers.length > 20 || !table.headers.every(cell)) invalid('Invalid table headers');
    if (!Array.isArray(table.rows) || table.rows.length < 1 || table.rows.length > 100 || !table.rows.every(row => Array.isArray(row) && row.length === table.headers.length && row.every(cell))) invalid('Invalid table rows');
    if (table.title !== undefined && !cell(table.title)) invalid('Invalid table title');
    if (body.delay !== undefined && (!Number.isInteger(body.delay) || body.delay < 0 || body.delay > 20000)) invalid('Invalid delay');
    if (body.mentions !== undefined && (!Array.isArray(body.mentions) || body.mentions.length > 100 || !body.mentions.every(number => typeof number === 'string' && USER_NUMBER.test(number)))) invalid('Invalid mentions');
    if (Buffer.byteLength(JSON.stringify(body), 'utf8') > 64 * 1024) invalid('Table request exceeds 64 KiB');
    return {
        number: body.number,
        table: { headers: [...table.headers], rows: table.rows.map(row => [...row]), ...(table.title !== undefined ? { title: table.title } : {}) },
        delay: body.delay ?? 0,
        mentions: (body.mentions || []).map(number => number.includes('@') ? number : `${number}@s.whatsapp.net`)
    };
}

function createNativeTableHandler(getMonitor) {
    return async (req, res, next) => {
        let input;
        try {
            input = validateNativeTableRequest(req.body);
        } catch (error) {
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
        } catch (error) {
            // A relay may already have succeeded before persistence fails. Never invite a retry.
            return next(error);
        }
    };
}

module.exports = { validateNativeTableRequest, createNativeTableHandler };
