// @ts-check
'use strict';
// Compile-only structural checks: providers implement the core's single port.
/** @param {ReturnType<typeof import('../../src/v2/adapters/ai').createAiAdapter>} adapter
 * @returns {import('../../src/v2/domain/ports').LLM} */
function llm(adapter) { return adapter; }
/** @param {ReturnType<typeof import('../../src/v2/adapters/evolution').createEvolutionAdapter>} adapter
 * @returns {import('../../src/v2/domain/ports').Messenger} */
function messenger(adapter) { return adapter; }
/** @param {ReturnType<typeof import('../../src/v2/adapters/store/repos/users').createUsersRepo>} repo
 * @returns {import('../../src/v2/domain/ports').UsersRepo} */
function users(repo) { return repo; }
/** @param {ReturnType<typeof import('../../src/v2/adapters/store/repos/conversation').createConversationRepo>} repo
 * @returns {import('../../src/v2/domain/ports').ConversationRepo} */
function conversation(repo) { return repo; }
module.exports = { llm, messenger, users, conversation };
