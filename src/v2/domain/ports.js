// @ts-check
'use strict';

/** @typedef {import('./errors').ErrorKind} ErrorKind */
/** @typedef {{text:string}|{inlineData:{mimeType:string,data:string}}|{functionCall:{name:string,args:Record<string,unknown>}}|{functionResponse:{name:string,response:unknown}}} LLMPart */
/** @typedef {{role:'system'|'user'|'assistant'|'tool',parts:LLMPart[]}} LLMMessage */
/** @typedef {{name:string,description?:string,parameters?:Record<string,unknown>}} LLMTool */
/** @typedef {{task:'route'|'chat'|'agent'|'vision',messages:LLMMessage[],tools?:LLMTool[],schema?:Record<string,unknown>,budget:{maxOutputTokens:number,timeoutMs:number,temperature?:number}}} LLMRequest */
/** @typedef {{text?:string,parts:LLMPart[],toolCalls:Array<{name:string,args:Record<string,unknown>}>,finishReason?:string|null,provider:'gemini'|'groq'}} LLMData */
/** @typedef {{kind:ErrorKind,retryable:boolean,diagnostic?:Readonly<Record<string,string|number|boolean>>}} LLMFailure */
/** @typedef {{ok:true,data:LLMData}|{ok:false,failure:LLMFailure}} LLMResult */
/** @typedef {{generate:(request:LLMRequest)=>Promise<LLMResult>}} LLM */

/** @typedef {{id:string,remoteJid?:string,fromMe?:boolean,participant?:string}} MessageKey */
/** @typedef {{quoted?:{key:MessageKey,message?:Record<string,unknown>},mentions?:string[],delayMs?:number}} TextOptions */
/** Delivery IDs come from the provider, never invented for echo tracking.
 * @typedef {{messageId?:string,raw?:unknown}} Delivery */
/** @typedef {{sendText:(to:string,text:string,options?:TextOptions)=>Promise<unknown>,
 * sendMedia:(to:string,filePath:string,caption?:string,forceDocument?:boolean,isHd?:boolean,delayMs?:number|null,customFileName?:string|null,textOptions?:TextOptions)=>Promise<unknown>,
 * sendVoice:(to:string,filePath:string,options?:{transcript?:string,durationSeconds?:number|null})=>Promise<unknown>,
 * sendSticker:(to:string,filePath:string)=>Promise<unknown>,
 * react:(to:string,reaction:string,key:MessageKey|string)=>Promise<unknown>,
 * typing:(to:string,delayMs?:number)=>Promise<unknown>,
 * delete:(to:string,key:MessageKey)=>Promise<unknown>,
 * edit:(to:string,text:string,key:MessageKey)=>Promise<unknown>,
 * groupInfo:(groupJid:string)=>Promise<unknown>}} Messenger */

/** @typedef {{jid:string,xp:number,level:number,strikes:number}} User */
/** @typedef {{getOrCreate:(jid:string)=>Promise<User>,get:(jid:string)=>Promise<User|undefined>,addXp:(jid:string,amount:number)=>Promise<unknown>}} UsersRepo */
/** @typedef {{id?:number,chat_id?:string,role:string,content:string,name:string|null,timestamp:number}} ConversationMessage */
/** @typedef {{append:(chatId:string,role:string,content:string,name?:string,timestamp?:number)=>Promise<unknown>,recent:(chatId:string,limit?:number)=>Promise<ConversationMessage[]>,clear:(chatId:string)=>Promise<unknown>}} ConversationRepo */

// Ports are type contracts. Loading them creates no service instances or I/O.
module.exports = {};
