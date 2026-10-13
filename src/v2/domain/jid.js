// @ts-check
'use strict';
/** Canonical equality within a JID namespace; LID never becomes a phone number.
 * @param {string} value */
function normalizeJid(value) {
    const input = value.trim();
    if (!input) return '';
    const segments=input.split('@');
    if (segments.length>2) return '';
    const [local, sourceDomain = 's.whatsapp.net'] = segments;
    const domain = sourceDomain === 'c.us' ? 's.whatsapp.net' : sourceDomain;
    if (!['s.whatsapp.net','g.us','lid'].includes(domain)) return '';
    let number = local.replace(/:[0-9]+$/, '');
    if (domain === 's.whatsapp.net') {
        number = number.replace(/^\+/, '');
        if (!/^\d+$/.test(number)) return '';
        if (number.length === 13 && number.startsWith('521')) number = `52${number.slice(3)}`;
        else if (number.length === 10) number = `52${number}`;
    }
    if (domain==='lid'&&!/^\d+$/.test(number)) return '';
    if (domain==='g.us'&&!/^\d+(?:-\d+)?$/.test(number)) return '';
    return number ? `${number}@${domain}` : '';
}
module.exports = { normalizeJid };
