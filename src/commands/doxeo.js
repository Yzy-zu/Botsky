'use strict';

const evolution = require('../services/evolution');
const logger = require('../services/logger');

// Pools de datos técnicos aleatorios para generar trazas creíbles (estilo doxx copypasta)
const IPS = [
    '92.28.211.234',
    '187.189.214.102',
    '201.141.33.19',
    '189.215.88.104',
    '148.243.60.15',
    '187.190.114.82',
    '200.68.136.241',
    '189.178.42.66'
];

const COORDS = [
    { n: '43.7462', w: '12.4893' },
    { n: '19.4326', w: '-99.1332' },
    { n: '20.6596', w: '-103.3496' },
    { n: '25.6866', w: '-100.3161' },
    { n: '19.7027', w: '-101.1923' },
    { n: '21.1619', w: '-86.8515' },
    { n: '22.1565', w: '-100.9855' }
];

const MACS = [
    '5A:78:3E:7E:00',
    'BC:D1:D3:58:91:AA',
    '48:8F:5A:1C:3B:90',
    'F4:8C:50:8A:11:42',
    '70:3A:CB:44:89:D1',
    'E0:D5:5E:2B:6F:83'
];

const ISPS = [
    'Ucom Universal',
    'Telmex Telecomunicaciones',
    'Totalplay Telecomunicaciones',
    'Megacable Holdings S.A.B.',
    'Izzi Telecom / Cablevisión',
    'Axtel Red Troncal'
];

const DNS_SUFFIXES = [
    'Dlink',
    'huawei.lan',
    'gateway.local',
    'hitronhub.home',
    'sercomm.local',
    'arris.lan'
];

const ROUTER_VENDORS = [
    'ERICSSON',
    'HUAWEI TECHNOLOGIES CO.',
    'SERCOMM CORP',
    'ARRIS GROUP INC.',
    'ZTE CORPORATION',
    'TP-LINK SYSTEMS'
];

function getRandom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
}

function generateRandomSSN() {
    let ssn = '';
    for (let i = 0; i < 16; i++) {
        ssn += Math.floor(Math.random() * 10);
    }
    return ssn;
}

function generateRandomIpv6() {
    const hex = () => Math.floor(Math.random() * 65535).toString(16);
    return `fe80::${hex()}:${hex()}:${hex()}:${hex()}%12`;
}

/**
 * Genera la ficha técnica y seria de rastreo (copypasta técnica, datos falsos, SIN DEVICE VENDOR).
 */
function generateMockDoxeo(targetName, isRevenge = false) {
    const ip = getRandom(IPS);
    const coord = getRandom(COORDS);
    const ssn = generateRandomSSN();
    const ipv6 = generateRandomIpv6();
    const mac = getRandom(MACS);
    const isp = getRandom(ISPS);
    const dnsSuffix = getRandom(DNS_SUFFIXES);
    const routerVendor = getRandom(ROUTER_VENDORS);

    const traceBlock = 
`\`\`\`
[TRACE REPORT] TARGET: ${targetName}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
IP: ${ip}
N: ${coord.n}
W: ${coord.w}
SS Number: ${ssn}
IPv6: ${ipv6}
UPNP: Enabled
DMZ: 10.112.42.15
MAC: ${mac}
ISP: ${isp}
DNS: 8.8.8.8
ALT DNS: 1.1.1.8.1
DNS SUFFIX: ${dnsSuffix}
WAN: 100.23.10.15
WAN TYPE: Private Nat
GATEWAY: 192.168.0.1
SUBNET MASK: 255.255.0.255
UDP OPEN PORTS: 8080, 80
TCP OPEN PORTS: 443
ROUTER VENDOR: ${routerVendor}
CONNECTION: UNENCRYPTED / LOCATED
━━━━━━━━━━━━━━━━━━━━━━━━━━━━
\`\`\``;

    if (isRevenge) {
        return `A ver si aquí a solas me sostienes la mirada, cabrón. Vi cómo andas abriendo el hocico en el grupo.\n\nYa te tengo ubicado:\n\n${traceBlock}\n\nVuelve a mentarme la madre o a tirarme mierda y te descalabro la conexión, pendejo. Quedas advertido.`;
    }

    return `\`[SYSTEM] INITIATING TRACE ROUTE...\`\n*TARGET:* ${targetName}\n\n${traceBlock}`;
}

/**
 * Comando para doxear técnicamente a un usuario.
 */
async function handleDoxeo(parsed = {}, from, messageData = {}) {
    try {
        let targetName = null;

        // 1. Verificar si hay usuario mencionado (@usuario)
        const contextInfo = messageData?.message?.extendedTextMessage?.contextInfo;
        const mentions = contextInfo?.mentionedJid || [];
        if (mentions.length > 0) {
            const clean = mentions[0].split('@')[0];
            targetName = `@${clean}`;
        }

        // 2. Si no hay mención, extraer de parsed.args o texto
        if (!targetName && parsed.args && parsed.args.length > 0) {
            targetName = parsed.args.join(' ').replace(/^[@]/, '').trim();
        }

        // 3. Fallback: usar el pushName del remitente
        if (!targetName) {
            targetName = messageData?.pushName || 'Host';
        }

        const doxeoText = generateMockDoxeo(targetName, false);
        await evolution.sendText(from, doxeoText);
    } catch (err) {
        logger.error(`[DOXEO] Error al ejecutar doxeo técnico: ${err.message}`);
        await evolution.sendText(from, 'Error en el enrutamiento de traza. Inténtalo de nuevo.');
    }
}

module.exports = {
    handleDoxeo,
    generateMockDoxeo
};
