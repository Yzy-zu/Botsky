// @ts-check
'use strict';
const {createClient,normalizeJid}=require('./client');
const {createOutbound}=require('./outbound');
const {createMedia}=require('./media');
const {createGroups}=require('./groups');
/** Composition helper called explicitly by main; no dependencies instantiated here.
 * @param {Parameters<typeof createOutbound>[0] & {maxDownloadBytes?:number}} dependencies */
function createEvolutionAdapter(dependencies) {
    return {...createOutbound(dependencies),...createMedia(dependencies),...createGroups(dependencies),normalizeJid};
}
module.exports={createEvolutionAdapter,createClient,normalizeJid};
