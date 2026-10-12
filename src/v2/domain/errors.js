// @ts-check
'use strict';
/** @typedef {'quota'|'auth_key'|'timeout'|'safety_block'|'bad_output'|'unsupported_media'|'too_large'|'network'|'unknown'} ErrorKind */
/** @type {Record<ErrorKind,{message:string,nextStep:string,retryable:boolean}>} */
const feedback = {
    quota: {message:'Se agotó la cuota de IA.',nextStep:'Pídeme otra acción o pide al administrador revisar la cuota.',retryable:true},
    auth_key: {message:'El proveedor no acepta la configuración de acceso.',nextStep:'Pide al administrador revisar las credenciales.',retryable:false},
    timeout: {message:'La operación tardó demasiado.',nextStep:'Reintenta con una petición más corta.',retryable:true},
    safety_block: {message:'El proveedor bloqueó esta solicitud.',nextStep:'Reformula la petición o usa otra función disponible.',retryable:false},
    bad_output: {message:'No pude interpretar el resultado.',nextStep:'Aclara qué acción necesitas.',retryable:true},
    unsupported_media: {message:'Ese formato no está soportado.',nextStep:'Envía el archivo en un formato compatible.',retryable:false},
    too_large: {message:'El archivo supera el límite disponible.',nextStep:'Envía un archivo más pequeño.',retryable:false},
    network: {message:'No pude conectar con el servicio.',nextStep:'Reintenta la operación cuando vuelva la conexión.',retryable:true},
    unknown: {message:'No pude completar la operación.',nextStep:'Reintenta o consulta al administrador.',retryable:false}
};
class AppError extends Error {
    /** @param {ErrorKind} kind @param {{cause?:unknown}} [options] */
    constructor(kind, options = {}) {
        const safeKind = Object.hasOwn(feedback, kind) ? kind : 'unknown';
        super(feedback[safeKind].message, options);
        this.name = 'AppError'; this.kind = safeKind;
    }
}
/** @param {unknown} error */
function toUserFeedback(error) {
    const kind = error instanceof AppError ? error.kind : 'unknown';
    return {kind, ...feedback[kind]};
}
module.exports = { AppError, toUserFeedback };
