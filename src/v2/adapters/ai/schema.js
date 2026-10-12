// @ts-check
'use strict';
const {record}=require('./failures');
/** Bounded JSON schema subset used for structured provider outcomes. Unknown
 * validation keywords fail closed instead of claiming successful validation.
 * @param {unknown} value @param {Record<string,unknown>} schema @param {number} [depth] */
function validateSchema(value,schema,depth=0){
    if(depth>16)return false;
    const allowed=['type','properties','required','additionalProperties','items','enum','minimum','maximum','minItems','maxItems','minLength','maxLength','description','title'];
    if(Object.keys(schema).some(k=>!allowed.includes(k)))return false;
    if(Array.isArray(schema.enum)&&!schema.enum.some(v=>JSON.stringify(v)===JSON.stringify(value)))return false;
    if(schema.type==='object'){
        if(!value||typeof value!=='object'||Array.isArray(value))return false;const v=record(value),properties=record(schema.properties);
        if(Array.isArray(schema.required)&&schema.required.some(k=>typeof k!=='string'||!Object.hasOwn(v,k)))return false;
        for(const [k,item] of Object.entries(v)){if(Object.hasOwn(properties,k)){if(!validateSchema(item,record(properties[k]),depth+1))return false;}else if(schema.additionalProperties===false)return false;}
    }else if(schema.type==='array'){
        if(!Array.isArray(value)||value.length>10000)return false;if(typeof schema.minItems==='number'&&value.length<schema.minItems)return false;if(typeof schema.maxItems==='number'&&value.length>schema.maxItems)return false;
        if(schema.items&&value.some(v=>!validateSchema(v,record(schema.items),depth+1)))return false;
    }else if(schema.type==='string'){
        if(typeof value!=='string')return false;if(typeof schema.minLength==='number'&&value.length<schema.minLength)return false;if(typeof schema.maxLength==='number'&&value.length>schema.maxLength)return false;
    }else if(schema.type==='number'||schema.type==='integer'){
        if(typeof value!=='number'||!Number.isFinite(value)||(schema.type==='integer'&&!Number.isInteger(value)))return false;
        if(typeof schema.minimum==='number'&&value<schema.minimum)return false;if(typeof schema.maximum==='number'&&value>schema.maximum)return false;
    }else if(schema.type==='boolean'){if(typeof value!=='boolean')return false;}else if(schema.type==='null'){if(value!==null)return false;}else if(schema.type!==undefined)return false;
    return true;
}
module.exports={validateSchema};
