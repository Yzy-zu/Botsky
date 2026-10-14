// @ts-check
'use strict';

/** @typedef {{ref:string,mime:string}} ImageRef */

/** Censorship work is supplied by the media adapter; this boundary fixes legacy settings.
 * @param {{censor:(image:ImageRef,options:{signal:AbortSignal,pixelBlock:number,barStart:number,barHeight:number,label:string})=>Promise<ImageRef>}} ports */
function createImageCensor({ censor }) {
    /** @param {ImageRef} image @param {AbortSignal} signal @returns {Promise<ImageRef>} */
    return async function censorImage(image, signal) {
        signal.throwIfAborted();
        if (!image || typeof image.ref !== 'string' || !image.ref.trim() || typeof image.mime !== 'string' || !image.mime.toLowerCase().startsWith('image/')) {
            throw new TypeError('Invalid image for censorship');
        }
        const output = await censor(image, { signal, pixelBlock: 36, barStart: 0.38, barHeight: 0.24,
            label: 'CENSURADO POR BOTSKY (COOPEREN XP)' });
        signal.throwIfAborted();
        if (!output || typeof output.ref !== 'string' || !output.ref.trim() || typeof output.mime !== 'string' || !output.mime.toLowerCase().startsWith('image/')) {
            throw new Error('Invalid censored image output');
        }
        return output;
    };
}

module.exports = { createImageCensor };
