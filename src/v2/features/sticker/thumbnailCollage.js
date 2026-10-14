// @ts-check
'use strict';
const { normalizeHttpUrl } = require('./handler');

/** @typedef {{title:string,thumbnailUrl?:string}} SearchItem */
/** @typedef {{ref:string,mime:string}} ImageRef */

/** @param {{render:(items:SearchItem[],signal:AbortSignal)=>Promise<ImageRef|null>}} ports */
function createThumbnailCollage({ render }) {
    /** @param {SearchItem[]} items @param {AbortSignal} signal @returns {Promise<ImageRef|null>} */
    return async function generateThumbnailCollage(items, signal) {
        signal.throwIfAborted();
        if (!Array.isArray(items) || items.length === 0) return null;
        const limited = [];
        for (const item of items.slice(0, 8)) {
            if (!item || typeof item.title !== 'string') continue;
            let thumbnailUrl;
            if (typeof item.thumbnailUrl === 'string' && item.thumbnailUrl) {
                try { thumbnailUrl = normalizeHttpUrl(item.thumbnailUrl); } catch { thumbnailUrl = undefined; }
            }
            limited.push({ title: item.title.slice(0, 300), ...(thumbnailUrl ? { thumbnailUrl } : {}) });
        }
        if (!limited.some(item => item.thumbnailUrl)) return null;
        const output = await render(limited, signal);
        signal.throwIfAborted();
        return output && typeof output.ref === 'string' && output.ref.trim() && typeof output.mime === 'string' && output.mime.toLowerCase().startsWith('image/') ? output : null;
    };
}

module.exports = { createThumbnailCollage };
