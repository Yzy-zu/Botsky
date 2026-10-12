// @ts-check
'use strict';
const {withRetry:retry}=require('./client');
/** @param {{client:import('./client').HttpClient,instance:string,clock:import('../../platform/clock').Clock,logger?:{info:(message:string)=>void}}} dependencies */
function createGroups({client:http,instance:INSTANCE,clock,logger={info(){}}}) {
    /** @param {()=>Promise<any>} fn */
    const withRetry=fn=>retry(fn,clock);
/** @param {string} groupJid */
async function getGroupInfo(groupJid) {
    return withRetry(() =>
        http.get(`/group/findGroupInfos/${INSTANCE}?groupJid=${encodeURIComponent(groupJid)}`)
    );
}

/** @param {string} groupJid */
async function getGroupInviteCode(groupJid) {
    return withRetry(() =>
        http.get(`/group/inviteCode/${INSTANCE}?groupJid=${encodeURIComponent(groupJid)}`)
    );
}

/** @param {string} groupJid @param {string} action @param {string[]|string} participants */
async function updateParticipant(groupJid, action, participants) {
    const list = Array.isArray(participants) ? participants : [participants];
    const cleanParticipants = list.map(p => {
        if (typeof p !== 'string') return String(p);
        p = p.trim();
        // Si ya incluye @lid o @s.whatsapp.net, preservarlo íntegro para grupos con LID
        if (p.includes('@')) return p;
        return p.replace(/[^0-9]/g, '');
    }).filter(p => p && p.length >= 10);

    logger.info(`Participant ${action} en ${encodeURIComponent(groupJid)} -> [${cleanParticipants.join(", ")}]`);
    return withRetry(() =>
        http.post(`/group/updateParticipant/${INSTANCE}?groupJid=${encodeURIComponent(groupJid)}`, {
            action,
            participants: cleanParticipants
        })
    );
}

/** @param {string} groupJid @param {string} action */
async function updateGroupSetting(groupJid, action) {
    // action: 'announcement' (mute) o 'not_announcement' (unmute)
    return withRetry(() =>
        http.post(`/group/updateSetting/${INSTANCE}?groupJid=${encodeURIComponent(groupJid)}`, {
            action
        })
    );
}

/** @param {string} jid @param {import("../../domain/ports").MessageKey} messageKey */
async function deleteMessage(jid, messageKey) {
    return withRetry(() =>
        http.post(`/chat/deleteMessage/${INSTANCE}`, {
            number: jid,
            key: messageKey
        })
    );
}


    return {getGroupInfo,groupInfo:getGroupInfo,getGroupInviteCode,updateParticipant,updateGroupSetting,deleteMessage,delete:deleteMessage};
}
module.exports={createGroups};
