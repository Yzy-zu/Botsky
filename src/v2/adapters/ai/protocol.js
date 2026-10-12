// @ts-check
'use strict';
/** Protocol parts deliberately include function call/response and inline native
 * media. They are provider data; execution and permissions remain in core.
 * @typedef {{text?:string,thought?:boolean,functionCall?:{name:string,args:Record<string,unknown>},functionResponse?:{name:string,response:unknown},inlineData?:{mimeType:string,data:string},executableCode?:unknown,codeExecutionResult?:unknown}} Part
 * @typedef {{role:string,parts:Part[]}} Content
 * @typedef {{post:(url:string,payload:Record<string,unknown>,options:{headers:Record<string,string>,timeout:number})=>Promise<{data:unknown}>}} HttpTransport
 * @typedef {{deadline?:number,generationProfile?:string,systemInstruction?:string,userMessage?:string,contents?:Content[]|null,tools?:unknown,toolConfig?:unknown,returnContent?:boolean,returnMetadata?:boolean,temperature?:number,maxOutputTokens?:number,maxTokens?:number,responseMimeType?:string|null,responseSchema?:unknown,jsonMode?:boolean,timeout?:number|null,media?:{data:string,mimeType:string}|null}} ProviderRequest
 * @typedef {{text?:string,content?:Content,finishReason:string|null}} Generation

 */
module.exports = {};
