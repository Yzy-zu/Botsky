'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const axios = require('axios');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { executeBash } = require('../src/services/terminal');
const {
    TERMINAL_TOOL_DECLARATION,
    MAX_TOOL_TURNS,
    handleTerminalTool,
    runAgentWithTerminal
} = require('../src/services/agent');

// ─── 1. Pruebas de Bash en Terminal (Pipes, Redirecciones, Subshell, &&, ||) ──

test('Agent-Bash: comando simple y echo', async () => {
    const res = await executeBash('echo "hola agente"');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.exitCode, 0);
    assert.strictEqual(res.stdout.trim(), 'hola agente');
});

test('Agent-Bash: pwd devuelve directorio de trabajo', async () => {
    const res = await executeBash('pwd');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.trim().startsWith('/'));
});

test('Agent-Bash: id muestra que ejecuta siempre como petrov (UID 1002)', async () => {
    const res = await executeBash('id');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('uid=1002(petrov)'));
    assert.ok(res.stdout.includes('gid=1002(petrov)'));
});

test('Agent-Bash: printf formatea cadenas correctamente', async () => {
    const res = await executeBash('printf "%s:%s" Alpha Beta');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.stdout, 'Alpha:Beta');
});

test('Agent-Bash: pipes (|) funcionan con encadenamiento de utilidades', async () => {
    const res = await executeBash('echo -e "pera\nmanzana\nuva" | sort | tr "a-z" "A-Z"');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.stdout.trim(), 'MANZANA\nPERA\nUVA');
});

test('Agent-Bash: operador && ejecuta condicionalmente el siguiente comando', async () => {
    const res = await executeBash('echo primero && echo segundo');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.stdout.trim(), 'primero\nsegundo');
});

test('Agent-Bash: operador || salta ante error y ejecuta el fallback', async () => {
    const res = await executeBash('false || echo fallback_ejecutado');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.stdout.trim(), 'fallback_ejecutado');
});

test('Agent-Bash: redirección (> y <) a archivo temporal y lectura', async () => {
    const tempFile = '/tmp/botsky_test_redir_' + Date.now() + '.txt';
    const res = await executeBash(`echo "archivo de prueba" > ${tempFile} && cat ${tempFile} && rm -f ${tempFile}`);
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.stdout.trim(), 'archivo de prueba');
});

test('Agent-Bash: subshell (...) aísla contexto y variables', async () => {
    const res = await executeBash('(VAR_TEST="aislada"; echo "$VAR_TEST") && [ -z "$VAR_TEST" ] && echo "fuera_vacia"');
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.stdout.trim(), 'aislada\nfuera_vacia');
});

test('Agent-Bash: comando inexistente devuelve resultado controlado con código de error', async () => {
    const res = await executeBash('comando_completamente_inexistente_xyz_888');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.timedOut, false);
    assert.ok(res.exitCode !== 0);
    assert.ok(res.stderr.includes('not found') || res.stderr.includes('no se encontró') || res.exitCode === 127);
});

test('Agent-Bash: exit code != 0 refleja el código exacto de salida', async () => {
    const res = await executeBash('exit 33');
    assert.strictEqual(res.success, false);
    assert.strictEqual(res.exitCode, 33);
    assert.strictEqual(res.timedOut, false);
});

test('Agent-Bash: proceso hijo en segundo plano', async () => {
    const res = await executeBash('sleep 0.1 & echo "hijo_en_background"');
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('hijo_en_background'));
});

test('Agent-Bash: timeout termina proceso y subprocesos hijos sin dejarlos huérfanos', async () => {
    const marker = 'botsky_bash_orphan_' + Date.now();
    const res = await executeBash(`(sleep 100 ${marker} &) && sleep 100`, { timeoutMs: 500 });
    assert.strictEqual(res.timedOut, true);
    assert.strictEqual(res.success, false);

    // Esperar propagación de señales SIGKILL al grupo
    await new Promise(r => setTimeout(r, 600));

    // Verificar con pgrep que el proceso con el marcador no siga vivo
    const check = await executeBash(`pgrep -f ${marker}`);
    assert.strictEqual(check.stdout.trim(), '', 'El proceso hijo debe morir con el process group');
});

test('Agent-Bash: stdout grande es truncado de forma acotada (bounded)', async () => {
    const res = await executeBash("node -e 'console.log(\"X\".repeat(80000))'", { maxStdoutBytes: 1024 });
    assert.strictEqual(res.success, true);
    assert.ok(res.stdout.includes('[... Salida truncada: se excedió el límite de 1024 bytes'));
    assert.ok(res.stdout.length < 3000);
});

test('Agent-Bash: stderr grande es truncado de forma acotada (bounded)', async () => {
    const res = await executeBash("node -e 'console.error(\"Y\".repeat(80000))'", { maxStderrBytes: 1024 });
    assert.strictEqual(res.success, true);
    assert.ok(res.stderr.includes('[... Salida truncada: se excedió el límite de 1024 bytes'));
    assert.ok(res.stderr.length < 3000);
});

test('Agent-Bash: sanitización de secretos en salida de Bash', async () => {
    const fakeKey = 'AQ.SecretFakeBashKey_1234567890';
    const res = await executeBash(`echo "La clave es ${fakeKey}"`, { extraSecrets: [fakeKey] });
    assert.strictEqual(res.stdout.includes(fakeKey), false);
    assert.ok(res.stdout.includes('La clave es [REDACTED_SECRET]'));
});

// ─── 2. Pruebas de Function Calling y Turnos del Agente ────────────────────────

test('Agent-Tool: handleTerminalTool valida parámetros y ejecuta comando', async () => {
    // 1. Tool call correctamente formado
    const okRes = await handleTerminalTool({ comando: 'echo "test_tool_ok"' });
    assert.strictEqual(okRes.success, true);
    assert.strictEqual(okRes.stdout.trim(), 'test_tool_ok');

    // 2. Tool call sin comando
    const emptyRes = await handleTerminalTool({});
    assert.strictEqual(emptyRes.success, false);
    assert.ok(emptyRes.stderr.includes('obligatorio'));
});

test('Agent-Loop: Gemini recibe resultado de herramienta y responde (Mock Turn 1)', async () => {
    const origPost = axios.post;
    let turn = 0;

    axios.post = async (url, payload) => {
        turn++;
        if (turn === 1) {
            // Turno 1: Gemini solicita ejecutar comando
            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    {
                                        functionCall: {
                                            name: 'ejecutar_terminal',
                                            args: { comando: 'uptime' }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            };
        } else if (turn === 2) {
            // Turno 2: Gemini recibe el resultado de la herramienta y da la respuesta final
            const lastPart = payload.contents[payload.contents.length - 1].parts[0];
            assert.ok(lastPart.functionResponse, 'Gemini debe recibir la functionResponse');
            assert.strictEqual(lastPart.functionResponse.name, 'ejecutar_terminal');
            assert.ok(lastPart.functionResponse.response.stdout, 'Debe incluir stdout de la terminal');

            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    { text: 'El servidor está activo y funcionando normalmente.' }
                                ]
                            }
                        }
                    ]
                }
            };
        }
    };

    try {
        const agentResult = await runAgentWithTerminal({
            userMessage: '¿Cómo está el servidor?'
        });

        assert.strictEqual(agentResult.turnCount, 1);
        assert.strictEqual(agentResult.text, 'El servidor está activo y funcionando normalmente.');
        assert.strictEqual(agentResult.executedTools.length, 1);
        assert.strictEqual(agentResult.executedTools[0].name, 'ejecutar_terminal');
        assert.strictEqual(agentResult.executedTools[0].args.comando, 'uptime');
        assert.strictEqual(agentResult.limitReached, false);
    } finally {
        axios.post = origPost;
    }
});

test('Agent-Loop: Gemini puede realizar un segundo tool call (2 turnos) y responder', async () => {
    const origPost = axios.post;
    let turn = 0;

    axios.post = async (url, payload) => {
        turn++;
        if (turn === 1) {
            // Tool call 1
            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    {
                                        functionCall: {
                                            name: 'ejecutar_terminal',
                                            args: { comando: 'df -h' }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            };
        } else if (turn === 2) {
            // Tool call 2
            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    {
                                        functionCall: {
                                            name: 'ejecutar_terminal',
                                            args: { comando: 'free -m' }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            };
        } else if (turn === 3) {
            // Respuesta final
            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    { text: 'Disco y memoria RAM están con suficiente espacio libre.' }
                                ]
                            }
                        }
                    ]
                }
            };
        }
    };

    try {
        const agentResult = await runAgentWithTerminal({
            userMessage: 'Revisa disco y memoria'
        });

        assert.strictEqual(agentResult.turnCount, 2, 'Debe haber completado exactamente 2 turnos de herramientas');
        assert.strictEqual(agentResult.executedTools.length, 2);
        assert.strictEqual(agentResult.executedTools[0].args.comando, 'df -h');
        assert.strictEqual(agentResult.executedTools[1].args.comando, 'free -m');
        assert.strictEqual(agentResult.text, 'Disco y memoria RAM están con suficiente espacio libre.');
        assert.strictEqual(agentResult.limitReached, false);
    } finally {
        axios.post = origPost;
    }
});

test('Agent-Loop: un tercer tool call es rechazado obligatoriamente por el límite', async () => {
    const origPost = axios.post;
    let turn = 0;

    axios.post = async () => {
        turn++;
        // El modelo intenta llamar a herramientas indefinidamente en cada turno
        return {
            data: {
                candidates: [
                    {
                        content: {
                            role: 'model',
                            parts: [
                                {
                                    functionCall: {
                                        name: 'ejecutar_terminal',
                                        args: { comando: `echo intento_${turn}` }
                                    }
                                },
                                { text: `Respuesta parcial en turno ${turn}` }
                            ]
                        }
                    }
                ]
            }
        };
    };

    try {
        const agentResult = await runAgentWithTerminal({
            userMessage: 'Ejecuta tareas indefinidas',
            maxTurns: 2
        });

        // Debe haber ejecutado exactamente 2 herramientas
        assert.strictEqual(agentResult.turnCount, 2, 'No debe pasar de 2 turnos');
        assert.strictEqual(agentResult.limitReached, true, 'Debe marcar limitReached');
        // El 3er intento debe estar registrado como rechazado
        const rejected = agentResult.executedTools.find(t => t.rejected);
        assert.ok(rejected, 'Debe haber registrado el rechazo del tercer intento');
        assert.ok(rejected.reason.includes('Límite de 2 tool turns alcanzado'));
    } finally {
        axios.post = origPost;
    }
});

test('Agent-Loop: error de herramienta no causa crash y es comunicado al modelo', async () => {
    const origPost = axios.post;
    let turn = 0;

    axios.post = async (url, payload) => {
        turn++;
        if (turn === 1) {
            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    {
                                        functionCall: {
                                            name: 'ejecutar_terminal',
                                            args: { comando: 'comando_fallido_con_error_123' }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            };
        } else if (turn === 2) {
            const lastPart = payload.contents[payload.contents.length - 1].parts[0];
            const resp = lastPart.functionResponse.response;
            assert.strictEqual(resp.success, false, 'La respuesta de la herramienta debe indicar fallo');
            assert.ok(resp.exitCode !== 0, 'Exit code debe ser distinto de 0');

            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    { text: 'El comando solicitado no existe en el sistema.' }
                                ]
                            }
                        }
                    ]
                }
            };
        }
    };

    try {
        const agentResult = await runAgentWithTerminal({
            userMessage: 'Ejecuta comando_fallido'
        });

        assert.strictEqual(agentResult.turnCount, 1);
        assert.strictEqual(agentResult.executedTools[0].result.success, false);
        assert.strictEqual(agentResult.text, 'El comando solicitado no existe en el sistema.');
    } finally {
        axios.post = origPost;
    }
});

test('Agent-Live: Gemini ejecuta uptime en VPS mediante Function Calling real y responde', async () => {
    const agentResult = await runAgentWithTerminal({
        userMessage: '¿cuánto tiempo lleva encendido el servidor? Usa la herramienta ejecutar_terminal con el comando uptime'
    });

    assert.ok(agentResult.text && agentResult.text.length > 0, 'Debe devolver respuesta de texto');
    assert.ok(agentResult.executedTools.length >= 1, 'Debe haber ejecutado al menos 1 herramienta');
    assert.strictEqual(agentResult.executedTools[0].name, 'ejecutar_terminal');
    const out = agentResult.executedTools[0].result.stdout;
    assert.ok(out.includes('load average') || out.includes('up'), 'La salida debe contener datos reales de uptime');
});


test('Agent-Loop: múltiples function calls en el mismo turno ejecutan y reciben todas sus functionResponse', async () => {
    const origPost = axios.post;
    let turn = 0;
    let capturedResponses = null;
    const startedAt = Date.now();

    axios.post = async (url, payload) => {
        turn++;
        if (turn === 1) {
            // Gemini devuelve 2 function calls concurrentes en el mismo turno
            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    {
                                        functionCall: {
                                            name: 'ejecutar_terminal',
                                            args: { comando: 'sleep 0.2; echo "salida_1"' }
                                        }
                                    },
                                    {
                                        functionCall: {
                                            name: 'ejecutar_terminal',
                                            args: { comando: 'sleep 0.2; echo "salida_2"' }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            };
        } else if (turn === 2) {
            // Turno 2: Verificamos que payload.contents contenga las 2 functionResponse en el último mensaje
            const lastMsg = payload.contents[payload.contents.length - 1];
            capturedResponses = lastMsg.parts;

            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    { text: 'Ambos comandos se ejecutaron correctamente.' }
                                ]
                            }
                        }
                    ]
                }
            };
        }
    };

    try {
        const agentResult = await runAgentWithTerminal({
            userMessage: 'Ejecuta dos comandos paralelos'
        });

        assert.strictEqual(agentResult.turnCount, 1, 'Múltiples llamadas en el mismo turno cuentan como 1 solo tool turn');
        assert.strictEqual(agentResult.executedTools.length, 2, 'Deben haberse ejecutado ambas herramientas');
        assert.strictEqual(agentResult.executedTools[0].args.comando, 'sleep 0.2; echo "salida_1"');
        assert.strictEqual(agentResult.executedTools[1].args.comando, 'sleep 0.2; echo "salida_2"');
        
        assert.ok(Array.isArray(capturedResponses), 'Debe haber un array de partes de respuesta');
        assert.strictEqual(capturedResponses.length, 2, 'Debe haber exactamente 2 functionResponse enviadas a Gemini');
        assert.strictEqual(capturedResponses[0].functionResponse.name, 'ejecutar_terminal');
        assert.strictEqual(capturedResponses[1].functionResponse.name, 'ejecutar_terminal');
        assert.strictEqual(capturedResponses[0].functionResponse.response.stdout.trim(), 'salida_1');
        assert.strictEqual(capturedResponses[1].functionResponse.response.stdout.trim(), 'salida_2');
        assert.strictEqual(agentResult.text, 'Ambos comandos se ejecutaron correctamente.');
        assert.ok(Date.now() - startedAt < 380, 'Las herramientas del mismo turno deben ejecutarse en paralelo');
    } finally {
        axios.post = origPost;
    }
});

test('Agent-Loop: error en callGemini tras ejecutar herramienta devuelve resultado controlado sin crash', async () => {
    const origPost = axios.post;
    const testSecret = 'AQ.SecretFake_12345678';
    process.env.TEST_SECRET_KEY = testSecret;
    let turn = 0;

    axios.post = async () => {
        turn++;
        if (turn === 1) {
            // Turno 1: Gemini pide ejecutar herramienta
            return {
                data: {
                    candidates: [
                        {
                            content: {
                                role: 'model',
                                parts: [
                                    {
                                        functionCall: {
                                            name: 'ejecutar_terminal',
                                            args: { comando: 'echo "resultado_exitoso_antes_del_crash"' }
                                        }
                                    }
                                ]
                            }
                        }
                    ]
                }
            };
        } else {
            // Turno 2: Fallo de red / API en Gemini con intento de fuga de clave simulada
            const fakeError = new Error(`Network timeout con clave ${testSecret}`);
            throw fakeError;
        }
    };

    try {
        const agentResult = await runAgentWithTerminal({
            userMessage: 'Ejecuta y luego falla'
        });

        // Debe devolver resultado controlado en lugar de unhandled rejection
        assert.ok(agentResult, 'Debe devolver un objeto de resultado');
        assert.strictEqual(agentResult.turnCount, 1);
        assert.strictEqual(agentResult.executedTools.length, 1);
        assert.strictEqual(agentResult.executedTools[0].result.success, true);
        assert.ok(agentResult.text.includes('El comando se ejecutó en el servidor'));
        assert.ok(agentResult.text.includes('resultado_exitoso_antes_del_crash'));
        assert.ok(!agentResult.text.includes(testSecret), 'No debe filtrar secretos en el mensaje de error');
        assert.ok(!agentResult.error.includes(testSecret), 'El diagnóstico tampoco debe filtrar secretos');
        assert.ok(!agentResult.text.includes('Network timeout con clave'), 'No debe mostrar el error crudo del proveedor');
        assert.strictEqual(agentResult.error, 'AI gemini: provider_unavailable', 'Debe devolver el diagnóstico seguro del proveedor');
        assert.ok(agentResult.text.includes(agentResult.error), 'La respuesta debe incluir el diagnóstico seguro');
    } finally {
        axios.post = origPost;
        delete process.env.TEST_SECRET_KEY;
    }
});
