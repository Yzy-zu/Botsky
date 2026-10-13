// @ts-check
'use strict';
/** @param {{groupOptIn:boolean,globalEnabled:boolean,now:number,timezone?:string,lastSentAt?:number|null,dailyCount:number,quietStart?:string,quietEnd?:string,quota?:number,minIntervalMs?:number,chatKilled?:boolean,privateRequested?:boolean,privateEnabled?:boolean}} options */
function proactivePolicy({groupOptIn,globalEnabled,now,timezone='America/Mexico_City',lastSentAt,dailyCount,
    quietStart='23:00',quietEnd='08:00',quota=3,minIntervalMs=2700000,chatKilled=false,privateRequested=false,privateEnabled=false}) {
    if (!globalEnabled||chatKilled) return {allow:false,reason:'kill-switch'};
    if (privateRequested?!privateEnabled:!groupOptIn) return {allow:false,reason:privateRequested?'private-disabled':'group-not-opted-in'};
    if (!Number.isFinite(now)||!Number.isSafeInteger(dailyCount)||dailyCount<0||!Number.isSafeInteger(quota)||quota<0||!Number.isFinite(minIntervalMs)||minIntervalMs<0) return {allow:false,reason:'invalid-limits'};
    if (dailyCount>=quota) return {allow:false,reason:'daily-quota'};
    if (lastSentAt!==undefined&&lastSentAt!==null) {
        if (!Number.isFinite(lastSentAt)||lastSentAt>now) return {allow:false,reason:'invalid-last-send'};
        if (now-lastSentAt<minIntervalMs) return {allow:false,reason:'minimum-interval'};
    }
    /** @param {string} time */
    const minute = time => {
        const match=/^(\d{2}):(\d{2})$/.exec(time);
        return match&&Number(match[1])<24&&Number(match[2])<60?Number(match[1])*60+Number(match[2]):-1;
    };
    const start=minute(quietStart);const end=minute(quietEnd);
    if (start<0||end<0) return {allow:false,reason:'invalid-quiet-hours'};
    try {
        const parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,hourCycle:'h23',hour:'2-digit',minute:'2-digit'}).formatToParts(new Date(now));
        const hour=Number(parts.find(part=>part.type==='hour')?.value);
        const minutes=Number(parts.find(part=>part.type==='minute')?.value);
        const local=hour*60+minutes;
        const quiet=start===end|| (start>end?(local>=start||local<end):(local>=start&&local<end));
        if (quiet) return {allow:false,reason:'quiet-hours'};
    } catch { return {allow:false,reason:'invalid-timezone'}; }
    return {allow:true,reason:'proactive-permitted'};
}
module.exports={proactivePolicy};
