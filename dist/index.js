#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { runAgy, listModels, getAgyVersion, resolveAgyBinary, getActiveSessions, cancelSession, } from './agy.js';
const server = new McpServer({
    name: 'agy-mcp',
    version: '1.1.0',
});
function formatAgentOutput(result, returnMetadata) {
    let output = result.response.trim();
    if (returnMetadata) {
        const metaParts = [
            `\n\n---`,
            `**Conversation ID:** \`${result.conversation_id || 'N/A'}\``,
            `**Duration:** ${result.duration_seconds.toFixed(2)}s`,
            `**Turns:** ${result.num_turns}`,
        ];
        if (result.usage) {
            metaParts.push(`**Tokens:** ${result.usage.total_tokens.toLocaleString()} (input: ${result.usage.input_tokens.toLocaleString()}, output: ${result.usage.output_tokens.toLocaleString()}${result.usage.thinking_tokens ? `, thinking: ${result.usage.thinking_tokens.toLocaleString()}` : ''})`);
        }
        output += metaParts.join('\n');
    }
    return output;
}
// Helper to send heartbeat progress & logging
function createHeartbeatHandler(serverInstance, toolName) {
    return (status) => {
        const logMsg = `[Heartbeat] ${toolName} active: ${status.elapsed_seconds}s elapsed, steps done: ${status.steps_completed}, chars: ${status.received_chars}, last activity: ${status.last_activity_seconds_ago}s ago`;
        // 1. Write to stderr (seen in Zed logs & terminal)
        process.stderr.write(`${logMsg}\n`);
        // 2. Send MCP logging message if client supports logging
        try {
            serverInstance.sendLoggingMessage({
                level: 'info',
                data: logMsg,
            });
        }
        catch {
            // ignore
        }
    };
}
// 1. agy_agent: Run an autonomous agent task
server.tool('agy_agent', 'Execute a prompt or task autonomously using the Antigravity (agy) CLI agent. Features built-in heartbeat, network/inactivity watchdog, and configurable timeout.', {
    prompt: z.string().describe('The task, instruction, or prompt for the agent to execute'),
    conversation_id: z
        .string()
        .optional()
        .describe('Optional conversation ID to resume a previous conversation'),
    working_dir: z
        .string()
        .optional()
        .describe('Working directory (workspace root) where the agent should operate'),
    add_dirs: z
        .array(z.string())
        .optional()
        .describe('Additional directory paths to add to the agent workspace'),
    model: z
        .string()
        .optional()
        .describe('Model to use, e.g. gemini-3.8-flash-high, claude-sonnet-4-6, gemini-3.1-pro-high (see agy_list_models)'),
    effort: z
        .enum(['low', 'medium', 'high', 'xhigh', 'max'])
        .optional()
        .describe('Reasoning effort level for the model'),
    mode: z
        .enum(['accept-edits', 'plan'])
        .optional()
        .describe('Agent mode: "accept-edits" (default, executes code changes) or "plan" (planning only, no file edits)'),
    dangerously_skip_permissions: z
        .boolean()
        .optional()
        .default(true)
        .describe('Auto-approve tool permissions without prompting (default: true)'),
    sandbox: z
        .boolean()
        .optional()
        .default(false)
        .describe('Run inside sandbox with terminal restrictions enabled (default: false)'),
    timeout_seconds: z
        .number()
        .optional()
        .default(3600)
        .describe('Maximum execution time in seconds (default: 3600 = 1 hour)'),
    inactivity_timeout_seconds: z
        .number()
        .optional()
        .default(300)
        .describe('Watchdog: maximum allowed seconds of silence without any agent output or activity before auto-aborting due to hang or network failure (default: 300 = 5 minutes)'),
    return_metadata: z
        .boolean()
        .optional()
        .default(false)
        .describe('Append conversation ID, token usage, and duration metadata to output'),
}, async (args, extra) => {
    try {
        const options = {
            prompt: args.prompt,
            conversation_id: args.conversation_id,
            working_dir: args.working_dir,
            add_dirs: args.add_dirs,
            model: args.model,
            effort: args.effort,
            mode: args.mode,
            dangerously_skip_permissions: args.dangerously_skip_permissions,
            sandbox: args.sandbox,
            timeout_seconds: args.timeout_seconds,
            inactivity_timeout_seconds: args.inactivity_timeout_seconds,
            return_metadata: args.return_metadata,
            signal: extra?.signal,
        };
        const result = await runAgy(options, undefined, {
            onHeartbeat: createHeartbeatHandler(server, 'agy_agent'),
        });
        if (!result.success) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Agent execution failed:\n${result.error || result.response}\n\nConversation ID: ${result.conversation_id || 'none'}`,
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: formatAgentOutput(result, args.return_metadata),
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Failed to run agy agent: ${message}`,
                },
            ],
        };
    }
});
// 2. agy_run: Convenient alias for agy_agent
server.tool('agy_run', 'Alias for agy_agent. Run a single prompt or task with the agy CLI agent.', {
    prompt: z.string().describe('The task or question for the agy agent'),
    conversation_id: z.string().optional().describe('Resume previous conversation ID'),
    working_dir: z.string().optional().describe('Workspace directory'),
    model: z.string().optional().describe('Model name override'),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional().describe('Reasoning effort'),
    mode: z.enum(['accept-edits', 'plan']).optional().describe('accept-edits or plan'),
    dangerously_skip_permissions: z.boolean().optional().default(true),
    timeout_seconds: z.number().optional().default(3600),
    inactivity_timeout_seconds: z.number().optional().default(300),
    return_metadata: z.boolean().optional().default(false),
}, async (args, extra) => {
    try {
        const result = await runAgy({
            prompt: args.prompt,
            conversation_id: args.conversation_id,
            working_dir: args.working_dir,
            model: args.model,
            effort: args.effort,
            mode: args.mode,
            dangerously_skip_permissions: args.dangerously_skip_permissions,
            timeout_seconds: args.timeout_seconds,
            inactivity_timeout_seconds: args.inactivity_timeout_seconds,
            return_metadata: args.return_metadata,
            signal: extra?.signal,
        }, undefined, {
            onHeartbeat: createHeartbeatHandler(server, 'agy_run'),
        });
        if (!result.success) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Agent execution failed:\n${result.error || result.response}`,
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: formatAgentOutput(result, args.return_metadata),
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Failed to run agy: ${message}`,
                },
            ],
        };
    }
});
// 3. agy_continue: Resume conversation
server.tool('agy_continue', 'Continue an existing agy conversation session with a follow-up prompt. If conversation_id is omitted, continues the most recent session.', {
    prompt: z.string().describe('Follow-up instructions or message for the agent'),
    conversation_id: z
        .string()
        .optional()
        .describe('Conversation ID to continue. If omitted, resumes the most recent conversation'),
    working_dir: z.string().optional().describe('Workspace directory'),
    model: z.string().optional().describe('Model override'),
    effort: z.enum(['low', 'medium', 'high', 'xhigh', 'max']).optional(),
    mode: z.enum(['accept-edits', 'plan']).optional(),
    dangerously_skip_permissions: z.boolean().optional().default(true),
    timeout_seconds: z.number().optional().default(3600),
    inactivity_timeout_seconds: z.number().optional().default(300),
    return_metadata: z.boolean().optional().default(false),
}, async (args, extra) => {
    try {
        const result = await runAgy({
            prompt: args.prompt,
            conversation_id: args.conversation_id,
            continue_recent: !args.conversation_id,
            working_dir: args.working_dir,
            model: args.model,
            effort: args.effort,
            mode: args.mode,
            dangerously_skip_permissions: args.dangerously_skip_permissions,
            timeout_seconds: args.timeout_seconds,
            inactivity_timeout_seconds: args.inactivity_timeout_seconds,
            return_metadata: args.return_metadata,
            signal: extra?.signal,
        }, undefined, {
            onHeartbeat: createHeartbeatHandler(server, 'agy_continue'),
        });
        if (!result.success) {
            return {
                isError: true,
                content: [
                    {
                        type: 'text',
                        text: `Conversation turn failed:\n${result.error || result.response}`,
                    },
                ],
            };
        }
        return {
            content: [
                {
                    type: 'text',
                    text: formatAgentOutput(result, args.return_metadata),
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Failed to continue agy conversation: ${message}`,
                },
            ],
        };
    }
});
// 4. agy_session_status: Check status of running agents (Heartbeat query)
server.tool('agy_session_status', 'Inspect active agy agent processes, uptime, last activity timestamps, and progress. Useful to determine if an agent is still working, paused, or stuck.', {}, async () => {
    try {
        const sessions = getActiveSessions();
        if (sessions.length === 0) {
            return {
                content: [
                    {
                        type: 'text',
                        text: 'No active agy agent tasks currently running.',
                    },
                ],
            };
        }
        const now = Date.now();
        const formatted = sessions.map((s, idx) => {
            const uptime = Math.round((now - s.startedAt) / 1000);
            const silence = Math.round((now - s.lastActivityAt) / 1000);
            return [
                `### Session #${idx + 1}`,
                `- **PID:** \`${s.pid || 'unknown'}\``,
                `- **Conversation ID:** \`${s.conversationId || 'pending'}\``,
                `- **Workspace:** \`${s.workingDir}\``,
                `- **Running for:** ${uptime}s`,
                `- **Last activity:** ${silence}s ago`,
                `- **Steps completed:** ${s.stepsCompleted}`,
                `- **Current step:** ${s.currentStepType || 'initializing'}`,
                `- **Output buffer:** ${s.receivedChars} characters`,
                `- **Prompt preview:** "${s.prompt.slice(0, 120).replace(/\n/g, ' ')}..."`,
            ].join('\n');
        });
        return {
            content: [
                {
                    type: 'text',
                    text: `Active agy agent sessions (${sessions.length}):\n\n${formatted.join('\n\n')}`,
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Failed to get session status: ${message}`,
                },
            ],
        };
    }
});
// 5. agy_cancel_session: Terminate stuck/hanging agent task
server.tool('agy_cancel_session', 'Forcefully cancel a running agy agent session by conversation ID or PID.', {
    target: z
        .string()
        .describe('The conversation_id or process PID of the session to terminate'),
}, async ({ target }) => {
    try {
        const stopped = cancelSession(target);
        if (stopped) {
            return {
                content: [
                    {
                        type: 'text',
                        text: `Successfully cancelled session/PID: \`${target}\`.`,
                    },
                ],
            };
        }
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `No running session found matching: \`${target}\`.`,
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Failed to cancel session: ${message}`,
                },
            ],
        };
    }
});
// 6. agy_list_models: List supported models
server.tool('agy_list_models', 'List all available AI models supported by the agy CLI (e.g. Gemini, Claude, GPT-OSS).', {}, async () => {
    try {
        const models = await listModels();
        const formatted = models
            .map((m) => `- \`${m.id}\`: ${m.name}`)
            .join('\n');
        return {
            content: [
                {
                    type: 'text',
                    text: `Available agy models:\n\n${formatted}`,
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Failed to list models: ${message}`,
                },
            ],
        };
    }
});
// 7. agy_info: Get agy installation and environment details
server.tool('agy_info', 'Get information about the agy CLI binary path, version, and environment configuration.', {}, async () => {
    try {
        const binaryPath = resolveAgyBinary();
        const version = await getAgyVersion(binaryPath);
        const info = {
            version,
            binaryPath,
            cwd: process.cwd(),
            nodeVersion: process.version,
            platform: process.platform,
            arch: process.arch,
            activeSessionsCount: getActiveSessions().length,
        };
        return {
            content: [
                {
                    type: 'text',
                    text: `Antigravity (agy) CLI MCP Server\n\n- **Version:** ${info.version}\n- **Binary Path:** \`${info.binaryPath}\`\n- **Current Working Directory:** \`${info.cwd}\`\n- **Node:** \`${info.nodeVersion}\` (${info.platform}-${info.arch})\n- **Active Sessions:** ${info.activeSessionsCount}`,
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            isError: true,
            content: [
                {
                    type: 'text',
                    text: `Failed to retrieve agy info: ${message}`,
                },
            ],
        };
    }
});
// Resources
server.resource('agy-models', 'agy://models', async (uri) => {
    try {
        const models = await listModels();
        return {
            contents: [
                {
                    uri: uri.href,
                    text: JSON.stringify(models, null, 2),
                    mimeType: 'application/json',
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            contents: [
                {
                    uri: uri.href,
                    text: JSON.stringify({ error: message }),
                    mimeType: 'application/json',
                },
            ],
        };
    }
});
server.resource('agy-info', 'agy://info', async (uri) => {
    try {
        const binaryPath = resolveAgyBinary();
        const version = await getAgyVersion(binaryPath);
        return {
            contents: [
                {
                    uri: uri.href,
                    text: JSON.stringify({
                        version,
                        binaryPath,
                        cwd: process.cwd(),
                        node: process.version,
                        activeSessions: getActiveSessions().length,
                    }, null, 2),
                    mimeType: 'application/json',
                },
            ],
        };
    }
    catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            contents: [
                {
                    uri: uri.href,
                    text: JSON.stringify({ error: message }),
                    mimeType: 'application/json',
                },
            ],
        };
    }
});
// Prompts
server.prompt('delegate_task', 'Delegate a programming or analysis task to the agy agent', {
    task: z.string().describe('The task description or goal'),
    working_dir: z.string().optional().describe('Workspace path'),
}, ({ task, working_dir }) => ({
    messages: [
        {
            role: 'user',
            content: {
                type: 'text',
                text: `Please use the \`agy_agent\` tool to execute this task autonomously:\n\nTask: ${task}${working_dir ? `\nWorkspace: ${working_dir}` : ''}`,
            },
        },
    ],
}));
server.prompt('code_review', 'Request an autonomous code review with agy agent in plan mode', {
    target_path: z.string().optional().describe('Path to files or repository to review'),
    focus: z.string().optional().describe('Specific focus, e.g. security, performance, bugs'),
}, ({ target_path, focus }) => ({
    messages: [
        {
            role: 'user',
            content: {
                type: 'text',
                text: `Please use the \`agy_agent\` tool with mode="plan" to perform a detailed code review of ${target_path || 'the current workspace'}.${focus ? ` Focus particularly on: ${focus}.` : ''}`,
            },
        },
    ],
}));
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    process.stderr.write('agy-mcp server v1.1.0 running on stdio (heartbeat & watchdog enabled)\n');
}
main().catch((error) => {
    process.stderr.write(`Fatal error running agy-mcp server: ${error}\n`);
    process.exit(1);
});
