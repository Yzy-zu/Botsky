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
    /** @type {Promise<void>|undefined} */ let disposing;
    /** Stop admissions/output synchronously; resolve only after running work settles. */
    function dispose() {
        if (disposing) return disposing;
        const pipelineDone = pipeline.dispose();
        const queueDone = queue.dispose();
        disposing = (async () => {
            const results = await Promise.allSettled([pipelineDone,queueDone]);
            limiter.dispose();
            store.dispose();
            const failure = results.find(result => result.status === 'rejected');
            if (failure?.status === 'rejected') throw failure.reason;
        })();
        return disposing;
    }
    return { pipeline, features, store, queue, dispose };
}
module.exports = { createApplication };
