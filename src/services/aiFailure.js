'use strict';

// Provider responses never cross this boundary. Diagnostics are restricted to
// known protocol fields; prompts, generated text, headers and bodies stay out.
const KINDS = new Set(['blocked', 'empty_response', 'invalid_response', 'configuration', 'rate_limit',
    'provider_unavailable', 'network', 'invalid_request']);
const CODES = new Set(['INVALID_ARGUMENT', 'PERMISSION_DENIED', 'UNAUTHENTICATED', 'RESOURCE_EXHAUSTED',
    'UNAVAILABLE', 'INTERNAL', 'DEADLINE_EXCEEDED', 'json_validate_failed', 'model_not_found',
    'invalid_api_key', 'context_length_exceeded', 'rate_limit_exceeded', 'content_policy_violation',
    'invalid_request_error', 'authentication_error', 'permission_error']);
const FINISH_REASONS = new Set(['STOP', 'MAX_TOKENS', 'SAFETY', 'RECITATION', 'BLOCKLIST',
    'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'OTHER', 'MALFORMED_FUNCTION_CALL',
    'UNEXPECTED_TOOL_CALL', 'stop', 'length', 'content_filter', 'tool_calls']);
const BLOCK_REASONS = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'IMAGE_SAFETY', 'content_filter']);
const NETWORK_CODES = new Set(['ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ERR_NETWORK', 'ECONNREFUSED']);
const PARAMETERS = new Set(['model', 'messages', 'response_format', 'temperature', 'max_tokens',
    'max_completion_tokens', 'reasoning_format', 'reasoning_effort', 'include_reasoning']);

function diagnostic(input = {}) {
    const result = {
        kind: KINDS.has(input.kind) ? input.kind : 'provider_unavailable',
        provider: ['gemini', 'groq', 'router'].includes(input.provider) ? input.provider : 'router',
        retryable: input.retryable === true
    };
    if (Number.isInteger(input.httpStatus) && input.httpStatus >= 100 && input.httpStatus <= 599) result.httpStatus = input.httpStatus;
    if (CODES.has(input.providerCode)) result.providerCode = input.providerCode;
    if (FINISH_REASONS.has(input.finishReason)) result.finishReason = input.finishReason;
    if (BLOCK_REASONS.has(input.blockReason)) result.blockReason = input.blockReason;
    if (NETWORK_CODES.has(input.networkCode)) result.networkCode = input.networkCode;
    if (PARAMETERS.has(input.parameter)) result.parameter = input.parameter;
    return result;
}

class AiProviderError extends Error {
    constructor(input) {
        const safe = diagnostic(input);
        super(`AI ${safe.provider}: ${safe.kind}`);
        this.name = 'AiProviderError';
        this.diagnostic = safe;
    }
}

function classifyAiError(error, provider) {
    if (error instanceof AiProviderError) return diagnostic(error.diagnostic);
    const httpStatus = error?.response?.status;
    const detail = error?.response?.data?.error || {};
    const providerCode = CODES.has(detail.code) ? detail.code : CODES.has(detail.status) ? detail.status : detail.type;
    let kind = 'provider_unavailable';
    if (providerCode === 'content_policy_violation') kind = 'blocked';
    else if (providerCode === 'json_validate_failed') kind = 'invalid_response';
    else if (httpStatus === 401 || httpStatus === 403 || providerCode === 'model_not_found') kind = 'configuration';
    else if (httpStatus === 429) kind = 'rate_limit';
    else if (httpStatus === 400 || httpStatus === 413 || httpStatus === 422) kind = 'invalid_request';
    else if (NETWORK_CODES.has(error?.code)) kind = 'network';
    return diagnostic({ provider, kind, httpStatus, providerCode, parameter: detail.param,
        networkCode: error?.code, retryable: ['network', 'rate_limit', 'provider_unavailable'].includes(kind) });
}

function assertGeminiResponse(data, { needsText = true } = {}) {
    const candidate = data?.candidates?.[0];
    const promptBlock = data?.promptFeedback?.blockReason;
    if ((promptBlock && promptBlock !== 'BLOCK_REASON_UNSPECIFIED') || BLOCK_REASONS.has(candidate?.finishReason)) {
        throw new AiProviderError({ kind: 'blocked', provider: 'gemini',
            finishReason: candidate?.finishReason, blockReason: promptBlock || candidate?.finishReason });
    }
    const content = candidate?.content;
    const parts = Array.isArray(content?.parts) ? content.parts.filter(part => !part.thought) : [];
    const text = parts.map(part => typeof part.text === 'string' ? part.text : '').join('\n').trim();
    if (['MALFORMED_FUNCTION_CALL', 'UNEXPECTED_TOOL_CALL', 'OTHER'].includes(candidate?.finishReason)) {
        throw new AiProviderError({ provider: 'gemini', kind: 'invalid_response', finishReason: candidate.finishReason });
    }
    const hasPayload = text || parts.some(part => part.functionCall || part.inlineData || part.executableCode || part.codeExecutionResult);
    if (!hasPayload || (needsText && !text)) throw new AiProviderError({ provider: 'gemini',
        kind: candidate?.finishReason === 'MAX_TOKENS' ? 'invalid_response' : 'empty_response', finishReason: candidate?.finishReason });
    return { content, text, finishReason: candidate?.finishReason || null };
}

function assertGroqResponse(data) {
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === 'content_filter' || choice?.message?.refusal) {
        throw new AiProviderError({ provider: 'groq', kind: 'blocked', finishReason: choice?.finish_reason });
    }
    const text = typeof choice?.message?.content === 'string' ? choice.message.content.trim() : '';
    if (!text) throw new AiProviderError({ provider: 'groq',
        kind: choice?.finish_reason === 'length' ? 'invalid_response' : 'empty_response', finishReason: choice?.finish_reason });
    return { text, finishReason: choice.finish_reason || null };
}

module.exports = { AiProviderError, diagnostic, classifyAiError, assertGeminiResponse, assertGroqResponse };
