'use strict';

// Object.freeze(Map/Set) does not freeze their contents. Keep all mutable
// collections inside constructed instances, including the TtlStore itself.
module.exports = {
    meta: { type: 'problem', schema: [], messages: { global: 'Create mutable Map/Set state inside an instance or function, never at module scope.' } },
    create(context) {
        return {
            NewExpression(node) {
                const callee = node.callee;
                const name = callee.type === 'Identifier' ? callee.name
                    : callee.type === 'MemberExpression' && callee.object.type === 'Identifier'
                        && ['global', 'globalThis'].includes(callee.object.name)
                        ? (callee.property.name || callee.property.value) : '';
                if (!['Map', 'Set'].includes(name)) return;
                let parent = node.parent;
                while (parent) {
                    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(parent.type)) return;
                    if (parent.type === 'PropertyDefinition' && !parent.static) return;
                    parent = parent.parent;
                }
                context.report({ node, messageId: 'global' });
            }
        };
    }
};
