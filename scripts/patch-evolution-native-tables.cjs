'use strict';

const fs = require('node:fs');

const MODULE_PATH = '/evolution/botsky/src/integrations/evolutionNativeTables.js';
const PATCHED_CONDITION = '(t.viewOnceMessage||t.botForwardedMessage?.message?.richResponseMessage)';
const METHOD = 'async sendMessage(e,t,o,i,n,r,a,c){';

function patchEvolutionBundle(source) {
    const routePattern = /\.post\(this\.routerPath\("sendText"\),\.\.\.([\w$]+),async\(([\w$]+),([\w$]+)\)=>\{let ([\w$]+)=await this\.dataValidate\(\{request:\2,schema:[\w$]+,ClassRef:[\w$]+,execute:\(([\w$]+),([\w$]+)\)=>([\w$]+)\.sendText\(\5,\6\)\}\);return \3\.status\(201\)\.json\(\4\)\}\)/g;
    const routes = [...source.matchAll(routePattern)];
    if (routes.length !== 1) throw new Error('Unsupported Evolution bundle: expected one guarded sendText route');
    const route = routes[0];
    const addition = `.post(this.routerPath("sendNativeTable"),...${route[1]},require('${MODULE_PATH}').createNativeTableHandler(()=>${route[7]}.waMonitor))`;
    const methods = [...source.matchAll(/async sendMessage\(e,t,o,i,n,r,a,c\)\{/g)];
    if (methods.length !== 1) throw new Error('Unsupported Evolution bundle: expected one Baileys sendMessage method');
    const methodStart = methods[0].index;
    const methodEnd = source.indexOf('async ', methodStart + METHOD.length);
    if (methodEnd === -1) throw new Error('Unsupported Evolution bundle: missing following method');
    const method = source.slice(methodStart, methodEnd);
    const oldCondition = ',t.viewOnceMessage){let ';
    const newCondition = `,${PATCHED_CONDITION}){let `;
    const existingRoutes = [...source.matchAll(/this\.routerPath\("sendNativeTable"\)/g)].length;
    const oldCount = method.split(oldCondition).length - 1;
    const newCount = method.split(newCondition).length - 1;
    if (existingRoutes || newCount) {
        if (existingRoutes !== 1 || newCount !== 1 || oldCount !== 0 || source.slice(route.index - addition.length, route.index) !== addition) {
            throw new Error('Incomplete or conflicting native-table patch');
        }
        return source;
    }
    if (oldCount !== 1 || !method.includes('this.client.relayMessage(e,t,{messageId:r})')) {
        throw new Error('Unsupported Evolution bundle: raw relay branch changed');
    }
    let patched = source.slice(0, methodStart) + method.replace(oldCondition, newCondition) + source.slice(methodEnd);
    patched = patched.replace(route[0], addition + route[0]);

    const viewOnceTarget = '(0,R.generateWAMessageFromContent)("",{[n]:{...i[n]}},{userJid:this.instance.wuid})';
    const viewOnceReplacement = '(0,R.generateWAMessageFromContent)("",(e?.viewOnce||e?.options?.viewOnce)?{viewOnceMessage:{message:{[n]:{...i[n],viewOnce:!0}}}}:{[n]:{...i[n]}},{userJid:this.instance.wuid})';
    if (patched.includes(viewOnceTarget)) {
        patched = patched.replace(viewOnceTarget, viewOnceReplacement);
    }

    return patched;
}

if (require.main === module) {
    const target = process.argv[2];
    if (!target) throw new Error('Usage: node patch-evolution-native-tables.cjs /evolution/dist/main.js');
    const source = fs.readFileSync(target, 'utf8');
    const patched = patchEvolutionBundle(source);
    if (patched !== source) {
        const temp = `${target}.native-table.tmp`;
        fs.writeFileSync(temp, patched, { mode: fs.statSync(target).mode });
        fs.renameSync(temp, target);
    }
    process.stdout.write(patched === source ? 'Native-table patch already applied\n' : 'Native-table patch applied\n');
}

module.exports = { patchEvolutionBundle };
