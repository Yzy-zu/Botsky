// @ts-check
'use strict';
const { TtlStore } = require('./platform/ttlStore');
const { createRateLimiter } = require('./platform/rateLimiter');
const { TieredQueue } = require('./platform/queue');
const { createPipeline } = require('./pipeline');
const { createHelpFeature } = require('./features/help/manifest');
const { createSystemInfoFeature } = require('./features/system-info/manifest');
/** Only composition constructs services; loading this file performs no IO.
 * @param {Omit<Parameters<typeof createPipeline>[0],'store'|'queue'|'features'|'rateState'|'onAccept'|'onReply'> & {rate?:{windowMs?:number,maxEvents?:number,cooldownMs?:number},getStatus:Parameters<typeof createSystemInfoFeature>[0]['getStatus'],extraFeatures?:import('./pipeline/contracts').Feature[]}} options */
function createApplication(options) {
    const store = new TtlStore({ clock: options.clock, maxEntries: 10000 });
    const queue = new TieredQueue({ clock: options.clock });
    /** @type {import('./pipeline/contracts').Feature[]} */ const features = [];
    features.push(createHelpFeature({ features: () => features }), createSystemInfoFeature({ getStatus: options.getStatus }), ...(options.extraFeatures || []));
    const limiter = createRateLimiter({ clock: options.clock, store, ...options.rate });
    const pipeline = createPipeline({ ...options, store, queue, features, rateState: event => limiter.snapshot(event), onAccept: event => { limiter.observe(event); }, onReply: event => { limiter.markReply(event); } });
    return { pipeline, features, store, queue, dispose() { pipeline.dispose(); queue.dispose(); store.dispose(); } };
}
module.exports = { createApplication };
