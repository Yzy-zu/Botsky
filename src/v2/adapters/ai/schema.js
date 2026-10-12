// @ts-check
'use strict';

const MAX_DEPTH = 16;
const MAX_NODES = 10000;
const MAX_TEXT = 1048576;
/** @param {unknown} value @returns {value is Record<string,unknown>} */
function plainObject(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
}
/** Validate the whole untrusted tree, including properties without a schema.
 * No getters, cycles, exotic objects, non-finite numbers or unsafe merge keys.
 * @param {unknown} value */
function isBoundedJson(value) {
    let nodes = 0;
    let textSize = 0;
    const ancestors = new Set();
    /** @param {unknown} item @param {number} depth @returns {boolean} */
    function walk(item, depth) {
        if (++nodes > MAX_NODES || depth > MAX_DEPTH) return false;
        if (item === null || typeof item === 'boolean') return true;
        if (typeof item === 'number') return Number.isFinite(item);
        if (typeof item === 'string') { textSize += item.length; return textSize <= MAX_TEXT; }
        if (!Array.isArray(item) && !plainObject(item)) return false;
        if (ancestors.has(item)) return false;
        ancestors.add(item);
        let valid = true;
        if (Array.isArray(item)) {
            if (item.length > MAX_NODES) valid = false;
            else for (let i = 0; i < item.length; i++) {
                const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
                if (!descriptor || !('value' in descriptor) || !walk(descriptor.value, depth + 1)) { valid = false; break; }
            }
        } else {
            const keys = Object.keys(item);
            if (keys.length > MAX_NODES) valid = false;
            else for (const key of keys) {
                textSize += key.length;
                const descriptor = Object.getOwnPropertyDescriptor(item, key);
                if (textSize > MAX_TEXT || ['__proto__', 'prototype', 'constructor'].includes(key) || !descriptor || !('value' in descriptor) || !walk(descriptor.value, depth + 1)) { valid = false; break; }
            }
        }
        ancestors.delete(item);
        return valid;
    }
    try { return walk(value, 0); } catch { return false; }
}
/** Validate all schema branches, including absent optional properties.
 * Unknown keywords and malformed keyword values fail closed.
 * @param {unknown} value */
function isSupportedSchema(value) {
    if (!isBoundedJson(value)) return false;
    /** @param {unknown} schema @returns {boolean} */
    function visit(schema) {
        if (!plainObject(schema)) return false;
        const allowed = ['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minimum', 'maximum', 'minItems', 'maxItems', 'minLength', 'maxLength', 'description', 'title'];
        if (Object.keys(schema).some(key => !allowed.includes(key))) return false;
        if (schema.type !== undefined && !['object', 'array', 'string', 'number', 'integer', 'boolean', 'null'].includes(String(schema.type))) return false;
        if (schema.properties !== undefined && (!plainObject(schema.properties) || !Object.values(schema.properties).every(visit))) return false;
        if (schema.required !== undefined && (!Array.isArray(schema.required) || new Set(schema.required).size !== schema.required.length || !schema.required.every(key => typeof key === 'string'))) return false;
        if (schema.additionalProperties !== undefined && typeof schema.additionalProperties !== 'boolean') return false;
        if (schema.items !== undefined && !visit(schema.items)) return false;
        if (schema.enum !== undefined && (!Array.isArray(schema.enum) || !schema.enum.length)) return false;
        for (const key of ['minimum', 'maximum']) if (schema[key] !== undefined && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]))) return false;
        for (const key of ['minItems', 'maxItems', 'minLength', 'maxLength']) if (schema[key] !== undefined && (!Number.isSafeInteger(schema[key]) || Number(schema[key]) < 0)) return false;
        for (const key of ['description', 'title']) if (schema[key] !== undefined && typeof schema[key] !== 'string') return false;
        return true;
    }
    return visit(value);
}
/** Object member order has no semantic meaning in JSON Schema enum.
 * @param {unknown} left @param {unknown} right @returns {boolean} */
function equalJson(left, right) {
    if (left === right) return true;
    if (Array.isArray(left) && Array.isArray(right)) return left.length === right.length && left.every((value, i) => equalJson(value, right[i]));
    if (!plainObject(left) || !plainObject(right)) return false;
    const keys = Object.keys(left);
    return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && equalJson(left[key], right[key]));
}
/** Bounded supported subset. Both the schema and full data tree are checked.
 * @param {unknown} value @param {Record<string,unknown>} schema */
function validateSchema(value, schema) {
    if (!isSupportedSchema(schema) || !isBoundedJson(value)) return false;
    /** @param {unknown} item @param {Record<string,unknown>} rule @returns {boolean} */
    function matches(item, rule) {
        if (Array.isArray(rule.enum) && !rule.enum.some(option => equalJson(option, item))) return false;
        const type = rule.type;
        if (type === 'object' && !plainObject(item)) return false;
        if (type === 'array' && !Array.isArray(item)) return false;
        if (type === 'string' && typeof item !== 'string') return false;
        if ((type === 'number' || type === 'integer') && (typeof item !== 'number' || (type === 'integer' && !Number.isInteger(item)))) return false;
        if (type === 'boolean' && typeof item !== 'boolean') return false;
        if (type === 'null' && item !== null) return false;
        // Applicators retain normal JSON Schema semantics when type is omitted.
        if (plainObject(item)) {
            const properties = plainObject(rule.properties) ? rule.properties : {};
            if (Array.isArray(rule.required) && rule.required.some(key => !Object.hasOwn(item, key))) return false;
            for (const [key, child] of Object.entries(item)) {
                if (Object.hasOwn(properties, key)) {
                    if (!matches(child, /** @type {Record<string,unknown>} */(properties[key]))) return false;
                } else if (rule.additionalProperties === false) return false;
            }
        }
        if (Array.isArray(item)) {
            if (typeof rule.minItems === 'number' && item.length < rule.minItems) return false;
            if (typeof rule.maxItems === 'number' && item.length > rule.maxItems) return false;
            if (plainObject(rule.items) && !item.every(child => matches(child, /** @type {Record<string,unknown>} */(rule.items)))) return false;
        }
        if (typeof item === 'string') {
            if (typeof rule.minLength === 'number' && item.length < rule.minLength) return false;
            if (typeof rule.maxLength === 'number' && item.length > rule.maxLength) return false;
        }
        if (typeof item === 'number') {
            if (typeof rule.minimum === 'number' && item < rule.minimum) return false;
            if (typeof rule.maximum === 'number' && item > rule.maximum) return false;
        }
        return true;
    }
    return matches(value, schema);
}
module.exports = { validateSchema, isSupportedSchema, isBoundedJson };
