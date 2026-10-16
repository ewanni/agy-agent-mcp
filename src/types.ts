export type ReasoningEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type AgentMode = 'accept-edits' | 'plan';

export interface AgyRunOptions {
  prompt: string;
  conversation_id?: string;
  continue_recent?: boolean;
  working_dir?: string;
  add_dirs?: string[];
  model?: string;
  effort?: ReasoningEffort;
  mode?: AgentMode;
  dangerously_skip_permissions?: boolean;
  sandbox?: boolean;
  disable_slash_commands?: boolean;
  timeout_seconds?: number;
  heartbeat_interval_seconds?: number;
  inactivity_timeout_seconds?: number;
  return_metadata?: boolean;
  signal?: AbortSignal;
}

export interface AgyUsage {
  input_tokens: number;
  output_tokens: number;
  thinking_tokens?: number;
  cache_read_tokens?: number;
  total_tokens: number;
}

export interface AgyResultJson {
  conversation_id: string;
  status: 'SUCCESS' | 'ERROR';
  response: string;
  error?: string;
  duration_seconds: number;
  num_turns: number;
  usage?: AgyUsage;
}

export interface StreamEventInit {
  event: 'init';
  conversation_id: string;
  init: {
    cwd: string;
    tools: string[];
    permission_mode: string;
  };
}

export interface StreamEventStepUpdate {
  event: 'step_update';
  step_update: {
    conversation_id?: string;
    step_index: number;
    state: 'ACTIVE' | 'DONE' | string;
    step_type: 'user_input' | 'agent_response' | string;
    text_delta?: string;
    duration_seconds?: number;
    usage?: AgyUsage;
  };
}

export interface StreamEventResult {
  event: 'result';
  result: AgyResultJson;
}

export type StreamEvent =
  | StreamEventInit
  | StreamEventStepUpdate
  | StreamEventResult
  | { event: string; [key: string]: unknown };

export interface AgyModelInfo {
  id: string;
  name: string;
}

export interface HeartbeatStatus {
  conversation_id: string;
  elapsed_seconds: number;
  last_activity_seconds_ago: number;
  steps_completed: number;
  current_step_type?: string;
  received_chars: number;
  is_alive: boolean;
}

export interface AgyRunOutput {
  success: boolean;
  conversation_id: string;
  response: string;
  error?: string;
  duration_seconds: number;
  num_turns: number;
  usage?: AgyUsage;
  raw?: AgyResultJson;
}
