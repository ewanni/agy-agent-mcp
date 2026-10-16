import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as readline from 'node:readline';
const execFileAsync = promisify(execFile);
let cachedAgyPath = null;
const activeSessions = new Map();
export function getActiveSessions() {
    return Array.from(activeSessions.values());
}
export function cancelSession(conversationIdOrPid) {
    for (const [key, session] of activeSessions.entries()) {
        if (key === conversationIdOrPid || String(session.pid) === conversationIdOrPid) {
            session.kill('Cancelled via cancelSession');
            activeSessions.delete(key);
            return true;
        }
    }
    return false;
}
export function resolveAgyBinary() {
    if (cachedAgyPath && fs.existsSync(cachedAgyPath)) {
        return cachedAgyPath;
    }
    const envPath = process.env.AGY_PATH;
    if (envPath && fs.existsSync(envPath)) {
        cachedAgyPath = envPath;
        return envPath;
    }
    const candidatePaths = [
        path.join(process.env.HOME || '', '.local', 'bin', 'agy'),
        '/usr/local/bin/agy',
        '/usr/bin/agy',
    ];
    for (const candidate of candidatePaths) {
        if (candidate && fs.existsSync(candidate)) {
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                cachedAgyPath = candidate;
                return candidate;
            }
            catch {
                // continue
            }
        }
    }
    const pathEnv = process.env.PATH || '';
    for (const dir of pathEnv.split(path.delimiter)) {
        if (!dir)
            continue;
        const candidate = path.join(dir, 'agy');
        if (fs.existsSync(candidate)) {
            try {
                fs.accessSync(candidate, fs.constants.X_OK);
                cachedAgyPath = candidate;
                return candidate;
            }
            catch {
                // continue
            }
        }
    }
    throw new Error('The "agy" binary was not found. Please install agy CLI or set the AGY_PATH environment variable.');
}
export async function getAgyVersion(agyPath) {
    const binary = agyPath || resolveAgyBinary();
    try {
        const { stdout } = await execFileAsync(binary, ['--version']);
        return stdout.trim();
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to check agy version: ${message}`);
    }
}
export async function listModels(agyPath) {
    const binary = agyPath || resolveAgyBinary();
    try {
        const { stdout } = await execFileAsync(binary, ['models'], {
            maxBuffer: 10 * 1024 * 1024,
        });
        const lines = stdout.split('\n');
        const models = [];
        for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line || line.includes('Fetching available models')) {
                continue;
            }
            const tabParts = line.split('\t');
            if (tabParts.length >= 2) {
                models.push({
                    id: tabParts[0].trim(),
                    name: tabParts.slice(1).join('\t').trim(),
                });
                continue;
            }
            const spaceMatch = line.match(/^([a-z0-9._-]+)\s{2,}(.+)$/i);
            if (spaceMatch) {
                models.push({
                    id: spaceMatch[1].trim(),
                    name: spaceMatch[2].trim(),
                });
            }
        }
        return models;
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to list agy models: ${message}`);
    }
}
export function runAgy(options, agyPath, callbacks) {
    return new Promise((resolve, reject) => {
        let binary;
        try {
            binary = agyPath || resolveAgyBinary();
        }
        catch (err) {
            return reject(err);
        }
        const args = ['-p', options.prompt];
        if (options.conversation_id) {
            args.push('--conversation', options.conversation_id);
        }
        else if (options.continue_recent) {
            args.push('--continue');
        }
        const skipPermissions = options.dangerously_skip_permissions ?? true;
        if (skipPermissions) {
            args.push('--dangerously-skip-permissions');
        }
        if (options.model) {
            args.push('--model', options.model);
        }
        if (options.effort) {
            args.push('--effort', options.effort);
        }
        if (options.mode) {
            args.push('--mode', options.mode);
        }
        if (options.sandbox) {
            args.push('--sandbox');
        }
        if (options.disable_slash_commands) {
            args.push('--disable-slash-commands');
        }
        if (options.add_dirs && options.add_dirs.length > 0) {
            for (const dir of options.add_dirs) {
                args.push('--add-dir', dir);
            }
        }
        args.push('--output-format', 'stream-json');
        const workingDir = options.working_dir || process.cwd();
        const child = spawn(binary, args, {
            cwd: workingDir,
            stdio: ['ignore', 'pipe', 'pipe'],
            env: {
                ...process.env,
            },
        });
        const startTime = Date.now();
        let lastActivityTime = Date.now();
        let stepsCompleted = 0;
        let currentStepType = undefined;
        let detectedConversationId = options.conversation_id || '';
        let finalResult = null;
        let accumulatedTextDelta = '';
        let stderrOutput = '';
        let isTerminated = false;
        let terminationReason = '';
        const sessionKey = `proc_${child.pid || Math.random()}`;
        const killProcess = (reason = 'Terminated') => {
            if (isTerminated)
                return;
            isTerminated = true;
            terminationReason = reason;
            try {
                child.kill('SIGTERM');
            }
            catch {
                // ignore
            }
            const forceKillTimer = setTimeout(() => {
                try {
                    child.kill('SIGKILL');
                }
                catch {
                    // ignore
                }
            }, 4000);
            if (typeof forceKillTimer.unref === 'function') {
                forceKillTimer.unref();
            }
        };
        const sessionObj = {
            conversationId: detectedConversationId,
            prompt: options.prompt,
            workingDir,
            startedAt: startTime,
            lastActivityAt: lastActivityTime,
            stepsCompleted: 0,
            receivedChars: 0,
            pid: child.pid,
            kill: killProcess,
        };
        activeSessions.set(sessionKey, sessionObj);
        // 1. Total Hard Timeout (Default 3600 seconds = 1 hour)
        const timeoutSeconds = options.timeout_seconds ?? 3600;
        let timeoutTimer = null;
        if (timeoutSeconds > 0) {
            timeoutTimer = setTimeout(() => {
                killProcess(`Execution exceeded maximum allowed timeout of ${timeoutSeconds}s.`);
            }, timeoutSeconds * 1000);
            if (typeof timeoutTimer.unref === 'function') {
                timeoutTimer.unref();
            }
        }
        // 2. Inactivity Watchdog (Default 300 seconds = 5 minutes of dead silence with no stream events or output)
        const inactivityTimeoutSeconds = options.inactivity_timeout_seconds ?? 300;
        let inactivityTimer = null;
        const resetInactivityTimer = () => {
            lastActivityTime = Date.now();
            sessionObj.lastActivityAt = lastActivityTime;
            if (inactivityTimer)
                clearTimeout(inactivityTimer);
            if (inactivityTimeoutSeconds > 0) {
                inactivityTimer = setTimeout(() => {
                    killProcess(`Inactivity watchdog triggered: no output or response from agent for ${inactivityTimeoutSeconds}s (possible network failure, hang or dead connection).`);
                }, inactivityTimeoutSeconds * 1000);
                if (typeof inactivityTimer.unref === 'function') {
                    inactivityTimer.unref();
                }
            }
        };
        resetInactivityTimer();
        // 3. Heartbeat Interval (Periodically emits progress to caller)
        const heartbeatIntervalSeconds = options.heartbeat_interval_seconds ?? 15;
        let heartbeatTimer = null;
        if (heartbeatIntervalSeconds > 0 && callbacks?.onHeartbeat) {
            heartbeatTimer = setInterval(() => {
                const now = Date.now();
                const status = {
                    conversation_id: detectedConversationId || sessionObj.conversationId,
                    elapsed_seconds: Math.round((now - startTime) / 1000),
                    last_activity_seconds_ago: Math.round((now - lastActivityTime) / 1000),
                    steps_completed: stepsCompleted,
                    current_step_type: currentStepType,
                    received_chars: accumulatedTextDelta.length,
                    is_alive: !child.killed,
                };
                try {
                    callbacks.onHeartbeat?.(status);
                }
                catch {
                    // ignore callback error
                }
            }, heartbeatIntervalSeconds * 1000);
            if (typeof heartbeatTimer.unref === 'function') {
                heartbeatTimer.unref();
            }
        }
        // 4. Client AbortSignal listener (e.g. if MCP client cancels request)
        if (options.signal) {
            if (options.signal.aborted) {
                killProcess('Request aborted by client');
            }
            else {
                options.signal.addEventListener('abort', () => {
                    killProcess('Request aborted by client');
                });
            }
        }
        child.stderr.on('data', (data) => {
            resetInactivityTimer();
            const str = data.toString();
            stderrOutput += str;
        });
        const rl = readline.createInterface({
            input: child.stdout,
            crlfDelay: Infinity,
        });
        rl.on('line', (line) => {
            resetInactivityTimer();
            const trimmed = line.trim();
            if (!trimmed || !trimmed.startsWith('{')) {
                return;
            }
            try {
                const parsed = JSON.parse(trimmed);
                if (parsed.event === 'init' &&
                    'conversation_id' in parsed &&
                    typeof parsed.conversation_id === 'string') {
                    detectedConversationId = parsed.conversation_id;
                    sessionObj.conversationId = detectedConversationId;
                    activeSessions.set(detectedConversationId, sessionObj);
                }
                if (parsed.event === 'step_update' && 'step_update' in parsed) {
                    const step = parsed.step_update;
                    if (step && typeof step === 'object') {
                        if (typeof step.step_type === 'string') {
                            currentStepType = step.step_type;
                            sessionObj.currentStepType = step.step_type;
                        }
                        if (step.state === 'DONE') {
                            stepsCompleted++;
                            sessionObj.stepsCompleted = stepsCompleted;
                        }
                        if (typeof step.text_delta === 'string') {
                            accumulatedTextDelta += step.text_delta;
                            sessionObj.receivedChars = accumulatedTextDelta.length;
                        }
                    }
                }
                if (parsed.event === 'result' && 'result' in parsed && parsed.result) {
                    finalResult = parsed.result;
                    if (finalResult.conversation_id) {
                        detectedConversationId = finalResult.conversation_id;
                        sessionObj.conversationId = detectedConversationId;
                    }
                }
                if (callbacks?.onEvent) {
                    callbacks.onEvent(parsed);
                }
            }
            catch {
                // Line wasn't valid NDJSON, ignore
            }
        });
        child.on('error', (err) => {
            cleanup();
            reject(new Error(`Failed to spawn agy: ${err.message}`));
        });
        const cleanup = () => {
            if (timeoutTimer)
                clearTimeout(timeoutTimer);
            if (inactivityTimer)
                clearTimeout(inactivityTimer);
            if (heartbeatTimer)
                clearInterval(heartbeatTimer);
            activeSessions.delete(sessionKey);
            if (detectedConversationId) {
                activeSessions.delete(detectedConversationId);
            }
        };
        child.on('close', (code, signal) => {
            cleanup();
            if (isTerminated) {
                return resolve({
                    success: false,
                    conversation_id: detectedConversationId,
                    response: accumulatedTextDelta,
                    error: terminationReason || `Agy agent was terminated (timeout/aborted).`,
                    duration_seconds: Math.round((Date.now() - startTime) / 1000),
                    num_turns: stepsCompleted > 0 ? stepsCompleted : 0,
                });
            }
            if (finalResult) {
                if (finalResult.status === 'ERROR') {
                    return resolve({
                        success: false,
                        conversation_id: detectedConversationId || finalResult.conversation_id,
                        response: finalResult.response || '',
                        error: finalResult.error || stderrOutput.trim() || 'Unknown error occurred in agy agent.',
                        duration_seconds: finalResult.duration_seconds || 0,
                        num_turns: finalResult.num_turns || 0,
                        usage: finalResult.usage,
                        raw: finalResult,
                    });
                }
                return resolve({
                    success: true,
                    conversation_id: detectedConversationId || finalResult.conversation_id,
                    response: finalResult.response || accumulatedTextDelta,
                    duration_seconds: finalResult.duration_seconds || 0,
                    num_turns: finalResult.num_turns || 1,
                    usage: finalResult.usage,
                    raw: finalResult,
                });
            }
            if (code !== 0) {
                const errorMsg = stderrOutput.trim() ||
                    (signal
                        ? `Process terminated with signal ${signal}`
                        : `Process exited with code ${code}`);
                return resolve({
                    success: false,
                    conversation_id: detectedConversationId,
                    response: accumulatedTextDelta,
                    error: errorMsg,
                    duration_seconds: Math.round((Date.now() - startTime) / 1000),
                    num_turns: stepsCompleted,
                });
            }
            return resolve({
                success: true,
                conversation_id: detectedConversationId,
                response: accumulatedTextDelta,
                duration_seconds: Math.round((Date.now() - startTime) / 1000),
                num_turns: Math.max(1, stepsCompleted),
            });
        });
    });
}
