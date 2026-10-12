// @ts-check
'use strict';
/** @typedef {{names:string[],labels?:Record<string,string[]>,maxSeries?:number}} MetricsOptions */
/** @param {MetricsOptions} options */
function createMetrics({ names, labels = {}, maxSeries = 100 }) {
    if (!Number.isInteger(maxSeries) || maxSeries < 1) throw new TypeError('Invalid maxSeries');
    const allowedNames = [...names];
    const allowedLabels = Object.fromEntries(Object.entries(labels).map(([key,options]) => [key,[...options]]));
    /** @type {Record<string,number>} */ const values = Object.create(null);
    /** @param {string} name @param {Record<string,string>} [dimensions] @param {number} [amount] */
    function increment(name, dimensions = {}, amount = 1) {
        if (!allowedNames.includes(name) || !Number.isFinite(amount) || amount < 0) return false;
        if (Object.keys(dimensions).some(k => !Object.hasOwn(allowedLabels, k) || !allowedLabels[k].includes(dimensions[k]))) return false;
        const key = JSON.stringify([name, Object.keys(dimensions).sort().map(k => [k, dimensions[k]])]);
        if (!Object.hasOwn(values, key) && Object.keys(values).length >= maxSeries) return false;
        values[key] = (values[key] || 0) + amount; return true;
    }
    return {increment, snapshot: () => ({...values}), size: () => Object.keys(values).length};
}
module.exports = { createMetrics };
