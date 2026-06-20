/**
 * Copyright (c) 2026 Cynapx Contributors
 * Licensed under the MIT License (MIT).
 * See LICENSE in the project root for license information.
 */

/**
 * A-4 (Phase 14-5): minimal MCP `notifications/progress` wiring for long-running
 * tools (initialize_project, backfill_history, re_tag_project, check_consistency).
 *
 * We only emit out-of-band progress notifications when the caller opts in via a
 * `_meta.progressToken` on the originating request; without a token nothing is
 * emitted (spec compliance — never push unsolicited progress).
 *
 * M-1 (Phase 15-3) — spec-tracking note. The original 2025-11-25 stable spec
 * shipped Tasks (SEP-1686) as an experimental core primitive. The 2026-07-28
 * spec RC redesigns this: Tasks is DEMOTED from the core specification to an
 * extension, with a server-directed model — the server returns a task handle
 * from the `tools/call` response and the client drives execution via
 * `tasks/get` / `tasks/update` / `tasks/cancel`. `tasks/list` is removed (there
 * is no session to enumerate against under the stateless transport). Anyone who
 * shipped against the 2025-11-25 experimental Tasks API must migrate to this new
 * lifecycle.
 *
 * Cynapx never adopted the experimental Tasks lifecycle — it only emits
 * progress-token notifications — so NOTHING here breaks under the RC. Crucially,
 * the progress-token opt-in adopted in P14-5 is RETAINED in the 2026-07-28 RC and
 * is NOT deprecated: this minimal model stays compatible. A full task-lifecycle
 * adoption (if ever pursued) must target the 2026-07-28 extension model, not the
 * 2025-11-25 core API.
 *
 * Verdict: tracking only — full task-lifecycle migration is DEFERRED until the
 * SDK v2 stable release (current `latest` is 1.x, still the session-id model).
 * Refs:
 *   - 2026-07-28 RC: https://blog.modelcontextprotocol.io/posts/2026-07-28-release-candidate/
 *   - SEP-1686 (Tasks): https://github.com/modelcontextprotocol/modelcontextprotocol/issues/1686
 *   - typescript-sdk#2042: https://github.com/modelcontextprotocol/typescript-sdk/issues/2042
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
