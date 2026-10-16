import type { AgyRunOptions, AgyRunOutput, AgyModelInfo, StreamEvent, HeartbeatStatus } from './types.js';
export interface ActiveSession {
    conversationId: string;
    prompt: string;
    workingDir: string;
    startedAt: number;
    lastActivityAt: number;
    stepsCompleted: number;
    currentStepType?: string;
    receivedChars: number;
    pid?: number;
    kill: (reason?: string) => void;
}
export declare function getActiveSessions(): ActiveSession[];
export declare function cancelSession(conversationIdOrPid: string): boolean;
export declare function resolveAgyBinary(): string;
export declare function getAgyVersion(agyPath?: string): Promise<string>;
export declare function listModels(agyPath?: string): Promise<AgyModelInfo[]>;
export declare function runAgy(options: AgyRunOptions, agyPath?: string, callbacks?: {
    onEvent?: (event: StreamEvent) => void;
    onHeartbeat?: (status: HeartbeatStatus) => void;
}): Promise<AgyRunOutput>;
