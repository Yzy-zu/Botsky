'use strict';

const DEFAULTS = {
    router: { temperature: 0.2, maxOutputTokens: 1800 },
    conversation: { temperature: 0.85, maxOutputTokens: 1200 },
    tools: { temperature: 0.35, maxOutputTokens: 1200 },
    content: { temperature: 0.35, maxOutputTokens: 8192 },
    voice: { temperature: 0.7, maxOutputTokens: 4096 }
};

function validTemperature(value) {
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 2;
}

function validTokens(value) {
    return Number.isInteger(value) && value > 0;
}

function getGenerationSettings(config = {}, profile = 'default', temperature = 0.7, maxOutputTokens = 300) {
    if (!Object.prototype.hasOwnProperty.call(DEFAULTS, profile)) {
        return {
            temperature: validTemperature(config.temperature) ? config.temperature : temperature,
            maxOutputTokens: validTokens(config.maxOutputTokens) ? config.maxOutputTokens : maxOutputTokens
        };
    }
    const defaults = DEFAULTS[profile];
    const override = config.generationProfiles?.[profile] || {};
    return {
        temperature: validTemperature(override.temperature) ? override.temperature : defaults.temperature,
        // Es un techo, no una cuota de texto. Conserva presupuestos pequeños
        // solicitados por el contexto aunque el límite del perfil sea mayor.
        maxOutputTokens: Math.min(validTokens(maxOutputTokens) ? maxOutputTokens : defaults.maxOutputTokens,
            validTokens(override.maxOutputTokens) ? override.maxOutputTokens : defaults.maxOutputTokens)
    };
}

module.exports = { getGenerationSettings };
