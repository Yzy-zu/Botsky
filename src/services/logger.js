'use strict';

// ─── Colores ANSI ──────────────────────────────────────────────────────────────
const C = {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
};

function timestamp() {
    return new Date().toLocaleTimeString('es-MX', { hour12: false });
}

function fmt(color, label, ...args) {
    const ts = `${C.dim}[${timestamp()}]${C.reset}`;
    const lbl = `${C.bold}${color}[${label}]${C.reset}`;
    console.log(ts, lbl, ...args);
}

const logger = {
    info: (...a) => fmt(C.cyan, 'INFO', ...a),
    success: (...a) => fmt(C.green, 'OK', ...a),
    warn: (...a) => fmt(C.yellow, 'WARN', ...a),
    error: (...a) => fmt(C.red, 'ERROR', ...a),
    cmd: (...a) => fmt(C.magenta, 'CMD', ...a),
    queue: (...a) => fmt(C.blue, 'QUEUE', ...a),
};

module.exports = logger;
