'use strict';

// Presentation consumes technical outcomes. It never interprets the request or
// asks the user to fix a provider/configuration failure.
function aiRoutingFailureMessage(failure = {}) {
    switch (failure.kind) {
        case 'blocked':
            return 'El servicio de IA no pudo procesar esta solicitud. No ejecuté nada.';
        case 'configuration':
        case 'invalid_request':
            return 'Tengo un problema para comunicarme con la IA. Necesito corregirlo antes de procesar tu petición.';
        case 'rate_limit':
            return 'La IA llegó a su límite de solicitudes. Intenta de nuevo en un rato.';
        case 'empty_response':
        case 'invalid_response':
            return 'La IA no devolvió una instrucción válida. No ejecuté nada; intenta de nuevo en un momento.';
        case 'network':
        case 'provider_unavailable':
            return 'La IA no está disponible ahorita. Intenta de nuevo en un momento.';
        default:
            return 'No pude interpretar tu petición ahorita. Intenta de nuevo en un momento.';
    }
}

function searchFailureMessage(result = {}) {
    if (result.status === 'empty') {
        return 'No encontré resultados para esa búsqueda. Puedes probar con otro nombre o pasarme un enlace.';
    }
    if (result.status === 'invalid') return '¿Qué video o canción quieres buscar?';
    switch (result.diagnostic?.code) {
        case 'timeout':
            return 'La búsqueda tardó demasiado y se detuvo. Intenta de nuevo en un momento.';
        case 'dependency_missing':
            return 'Mi buscador tiene un problema de configuración. Necesito corregirlo para poder buscar.';
        case 'rate_limit':
            return 'El buscador llegó a su límite de solicitudes. Intenta de nuevo en un rato.';
        default:
            return 'No pude consultar el buscador ahorita. Intenta de nuevo en un momento o pásame un enlace.';
    }
}

module.exports = { aiRoutingFailureMessage, searchFailureMessage };
