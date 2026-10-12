// @ts-check
'use strict';

const { record, AiProviderError } = require('./failures');
const { isBoundedJson } = require('./schema');
/** Normalize untrusted provider parts into domain-only variants. Raw content
 * remains available only through callGemini's legacy provider ABI.
 * @param {unknown} value @param {string} provider
 * @returns {import('../../domain/ports').LLMPart[]} */
function normalizeParts(value, provider) {
    function invalid() { return new AiProviderError({ provider, kind: 'invalid_response' }); }
    if (!Array.isArray(value) || value.length > 100) throw invalid();
    /** @type {import('../../domain/ports').LLMPart[]} */ const result = [];
    for (const original of value) {
        if (!original || typeof original !== 'object' || Array.isArray(original)) throw invalid();
        const part = record(original);
        if (part.thought !== undefined && typeof part.thought !== 'boolean') throw invalid();
        if (part.thought === true) continue;
        const variants = ['text', 'inlineData', 'functionCall', 'functionResponse'].filter(name => Object.hasOwn(part, name));
        if (variants.length !== 1) throw invalid();
        if (variants[0] === 'text') {
            if (typeof part.text !== 'string' || part.text.length > 1048576) throw invalid();
            result.push({ text: part.text });
        } else if (variants[0] === 'inlineData') {
            const data = record(part.inlineData);
            if (typeof data.mimeType !== 'string' || typeof data.data !== 'string' || !data.data) throw invalid();
            result.push({ inlineData: { mimeType: data.mimeType, data: data.data } });
        } else if (variants[0] === 'functionCall') {
            const call = record(part.functionCall);
            if (typeof call.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(call.name) || !call.args || typeof call.args !== 'object' || Array.isArray(call.args) || !isBoundedJson(call.args)) throw invalid();
            result.push({ functionCall: { name: call.name, args: structuredClone(/** @type {Record<string,unknown>} */(call.args)) } });
        } else {
            const response = record(part.functionResponse);
            if (typeof response.name !== 'string' || !/^[a-zA-Z][a-zA-Z0-9_.-]{0,63}$/.test(response.name) || !Object.hasOwn(response, 'response') || !isBoundedJson(response.response)) throw invalid();
            result.push({ functionResponse: { name: response.name, response: structuredClone(response.response) } });
        }
    }
    if (!result.length) throw invalid();
    return result;
}
module.exports = { normalizeParts };
