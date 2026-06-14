/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

/**
 * A-4 (Phase 14-5): minimal MCP `notifications/progress` wiring for long-running
 * tools (initialize_project, backfill_history, re_tag_project, check_consistency).
 *
 * This is the first, scoped-down step toward the MCP 2025-11-25 task workflow
 * (SEP-1686): we only emit out-of-band progress notifications when the caller
 * opts in via a `_meta.progressToken` on the originating request. Full task
 * lifecycle (streamed progress + cancellation/resumption) remains a documented
 * future direction.
 */

/** Matches the MCP ProgressToken (`string | number`). */
export type ProgressToken = string | number;

/**
 * The subset of `RequestHandlerExtra.sendNotification` we depend on. A
 * notification is a JSON-RPC notification object; the SDK's request-scoped
 * sender attaches it to the originating request so clients can correlate it.
 */
export type SendNotification = (notification: {
    method: 'notifications/progress';
    params: {
        progressToken: ProgressToken;
        progress: number;
        total?: number;
        message?: string;
    };
}) => Promise<void>;

/**
 * A progress reporter threaded into long-running tool handlers. `report()` is a
 * no-op when the caller did not provide a progress token (spec compliance —
 * never emit unsolicited `notifications/progress` to clients that did not ask).
 */
export interface ProgressReporter {
    /**
     * Emit one progress step. `progress` should monotonically increase; `total`
     * (if known) and `message` are optional descriptive fields.
     */
    report(progress: number, total: number | undefined, message: string): Promise<void>;
    /** Whether a progress token was provided (i.e. `report()` will emit). */
    readonly enabled: boolean;
}

/** A reporter that never emits — used when no progress token is present. */
export const NOOP_PROGRESS: ProgressReporter = {
    enabled: false,
    async report() {
        /* no-op */
    }
};

/**
 * Builds a ProgressReporter from a request's progress token and a notification
 * sender. Returns NOOP_PROGRESS when no token is provided so callers can always
 * call `report()` unconditionally.
 *
 * Errors from `send` are swallowed: progress is best-effort and must never break
 * the tool result.
 */
export function createProgressReporter(
    progressToken: ProgressToken | undefined,
    send: SendNotification
): ProgressReporter {
    if (progressToken === undefined || progressToken === null) {
        return NOOP_PROGRESS;
    }
    return {
        enabled: true,
        async report(progress, total, message) {
            try {
                await send({
                    method: 'notifications/progress',
                    params: { progressToken, progress, total, message }
                });
            } catch {
                /* best-effort: never let a progress emit failure break the tool */
            }
        }
    };
}
