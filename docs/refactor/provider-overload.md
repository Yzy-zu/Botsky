# Gemini model overload handling

The legacy callGemini previously treated every 5xx response as key-specific: it marked the current key in cooldown and retried the request against every configured key. For Gemini's typed model-overload response (503 with provider status UNAVAILABLE, or an overload message), that creates a rotation storm without changing the overloaded model or request.

The bounded behavior is now:

- A typed global model overload stops Gemini attempts for that request after the first response. It does not mark the key unhealthy.
- Existing per-key 429 rotation and exponential cooldown remain unchanged.
- Other 5xx/network retries retain their existing behavior.
- Existing chat, semantic-router, chronicle, and voice-script callers may use Groq only when its actual configured key is available. A Gemini safety block does not fall through to Groq in these paths.
- Provider logs use the filtered diagnostic shape. They do not log the provider response body or exception message.

This change does not alter credentials, models, quotas, or configuration.

## Verification still required

Run the offline legacy tests for callGemini with a fake 503 UNAVAILABLE response and several configured keys; assert one Gemini request and no key cooldowns. Also test that a subsequent independent request is not suppressed, that a 429 still rotates keys and applies cooldown, that chat/route/voice-script falls back to Groq when configured after overload, and that blocked Gemini content never calls Groq. Verify masked/sanitized diagnostics contain no key, prompt, or response text. These provider-path tests have not been run as part of this change. The existing audit test that expects 503 to rotate to key 2 is now an obsolete assertion and should be replaced with the global-overload behavior above.
