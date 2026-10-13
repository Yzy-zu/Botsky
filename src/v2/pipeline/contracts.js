// @ts-check
'use strict';
/** @typedef {import('../domain/events').InboundEvent} InboundEvent */
/** @typedef {import('../domain/types').AddressingDecision} AddressingDecision */
/** @typedef {import('../domain/types').Decision} Decision */
/** @typedef {import('../domain/types').Reply} Reply */
/** @typedef {{id:string,ownerJid:string,expiresAt:number,resultMessageId:string,createdAt:number,selectionValid?:boolean,feature?:string,name?:string,args?:Record<string,unknown>}} Session */
/** @typedef {{id:string,ownerJid:string,expiresAt:number,quotedMatch?:boolean,ref:string,mime:string,kind?:string}} Attachment */
/** @typedef {{session?:Session,attachment?:Attachment,airdropActive?:boolean}} AddressingMetadata */
/** @typedef {{admins:string[],owners:string[],members?:string[],groups?:string[]}} Roles */
/** @typedef {{event:InboundEvent,addressing:AddressingDecision,history:ReadonlyArray<{role:string,content:string}>,attachment?:Attachment,session?:Session,correlationId:string,roles:Roles}} Ctx */
/** @typedef {{name:string,aliases?:string[],scope:('private'|'group')[],access:'public'|'member'|'admin'|'owner',tier:'none'|'light'|'heavy',argsSchema?:Record<string,unknown>,parseExplicit?:(tokens:string[])=>Record<string,unknown>,allowLong?:boolean,help:{short:string,examples:string[]},handler:(ctx:Ctx,args:Record<string,unknown>,signal:AbortSignal)=>Promise<Reply>}} Command */
/** @typedef {{id:string,commands:Command[],intents?:Array<{id:string,description:string,schema:Record<string,unknown>,command:string}>,rules?:Array<{match:(ctx:Ctx)=>boolean,name:string,args:Record<string,unknown>}>,enabled?:boolean}} Feature */
/** @typedef {{kind:'ignore'|'denied'|'decision'|'reply'|'error',reason?:string,event?:InboundEvent,addressing?:AddressingDecision,decision?:Decision,reply?:Reply}} PipelineResult */
module.exports = {};
