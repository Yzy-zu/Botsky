# Heavy command progress and prepared chat context

The executor now exposes two optional composition hooks. They are deliberately
outside the feature handlers so the root can wire messaging and native media
reading without coupling either concern into the pipeline.

`createExecutor({ onProgress })` invokes the best-effort callback for heavy
commands with `{ correlationId, chatId, command, phase }`. Phases are
`queued`, `running`, `completed`, `failed`, and `cancelled`. Events are emitted
only after command resolution, access policy, and argument-schema validation.
The callback is never awaited; synchronous throws and rejected promises are
ignored. Calling `stop()` silences pending hook calls. The executor does not
send reactions or claim that a reply was acknowledged: `completed` means only
that the handler returned a valid reply. Composition must use its delivery
acknowledgement path for any post-send reaction. The runtime now wires queued/running to a best-effort hourglass reaction and clears it after composition finishes, or uses an error reaction on failure. It does not claim a WhatsApp delivery acknowledgement. TR-0368 remains pending verification.

For media-aware chat, `createExecutor({ prepareChatContext })` calls the optional
callback only after routing has returned `kind: 'chat'`. Its signature is
`(ctx, signal) => Promise<{ parts: LLMPart[], task?: 'chat' | 'vision', maxOutputTokens?: number }>`. The
executor appends those parts to the user message, preserves the default chat
task and token budget unless explicitly overridden, and accepts only a bounded
integer token budget from 1 through 8192. The callback receives an abort signal;
the executor checks it after preparation and after inference so shutdown,
cancellation, and timeouts cannot produce a late reply. No provider request
object or raw media bytes are accepted through this hook; the composition layer
must return validated LLM parts and keep its own configuration bounded.

Both hooks are optional. Without them, existing chat and command behavior stays
on the original execution path. The root composition now wires both callbacks behind the documents feature flag. Functional scenarios and delivery verification remain deferred by the user; the production QR/help/status canary does not enable these hooks.
