// @ts-check
'use strict';
const crypto = require('node:crypto');
/** @param {string} text @param {string} masterKey @returns {string} */
function encrypt(text, masterKey) {
    const salt = crypto.randomBytes(16); const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', crypto.scryptSync(masterKey, salt, 32), iv);
    const data = cipher.update(text, 'utf8', 'hex') + cipher.final('hex');
    return `${salt.toString('hex')}:${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${data}`;
}
/** @param {string} token @param {string} masterKey @returns {string} */
function decrypt(token, masterKey) {
    const parts = token.split(':');
    if (![3, 4].includes(parts.length)) throw new Error('Invalid encrypted token format');
    if (parts.length === 4 && !/^[a-fA-F0-9]{32}$/.test(parts[0])) throw new Error('Invalid encrypted token format');
    const salt = parts.length === 4 ? Buffer.from(parts.shift() || '', 'hex') : 'salt';
    const [iv, tag, data] = parts;
    if (!/^[a-fA-F0-9]{24}$/.test(iv) || !/^[a-fA-F0-9]{32}$/.test(tag) || !/^(?:[a-fA-F0-9]{2})*$/.test(data) || (Buffer.isBuffer(salt) && salt.length !== 16)) throw new Error('Invalid encrypted token format');
    const decipher = crypto.createDecipheriv('aes-256-gcm', crypto.scryptSync(masterKey, salt, 32), Buffer.from(iv, 'hex'));
    decipher.setAuthTag(Buffer.from(tag, 'hex'));
    return decipher.update(data, 'hex', 'utf8') + decipher.final('utf8');
}
module.exports = { encrypt, decrypt };
