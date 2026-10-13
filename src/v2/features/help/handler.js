// @ts-check
'use strict';
const { accessPolicy } = require('../../policies/access.policy');
/** @typedef {import('../../pipeline/contracts').Feature} Feature */
/** @param {{features:Feature[]|(()=>Feature[])}} options */
function createHelpHandler({ features }) {
    /** @param {import('../../pipeline/contracts').Ctx} ctx
     * @param {Record<string,unknown>} args @param {AbortSignal} signal
     * @returns {Promise<import('../../domain/types').Reply>} */
    return async function help(ctx, args, signal) {
        signal.throwIfAborted();
        const commands = (typeof features === 'function' ? features() : features)
            .filter(feature => feature.enabled !== false)
            .flatMap(feature => feature.commands)
            .filter(command => accessPolicy({ senderJid: ctx.event.sender.jid,
                chatId: ctx.event.chatId, isGroup: ctx.event.isGroup, roles: ctx.roles,
                requiredAccess: command.access, scope: command.scope }).allow)
            .sort((a, b) => a.name.localeCompare(b.name));
        const requested = typeof args.command === 'string' ? args.command.trim().toLowerCase() : '';
        const selected = requested ? commands.filter(command => command.name === requested
            || command.aliases?.includes(requested)) : commands;
        const lines = selected.map(command => {
            const examples = args.detail === true || requested ? command.help.examples : [];
            return `${command.name}: ${command.help.short}${examples.length ? '\n  ' + examples.join('\n  ') : ''}`;
        });
        return { parts: [{ type: 'text', text: lines.length
            ? 'Puedes pedirme estas acciones de forma natural:\n' + lines.join('\n')
            : requested ? 'No encuentro una acción disponible con ese nombre.' : 'No hay acciones disponibles aquí.' }],
        replyTo: ctx.event.id };
    };
}
module.exports = { createHelpHandler };
