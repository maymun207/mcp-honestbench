/**
 * runlog.ts — append-only record of what CWF called, with what, what came back,
 * and which mode was live. This file IS the scorer's input (§2 G1).
 *
 * Every line carries BOTH hashes. A log line that cannot name the fixture and
 * dial that produced it is unattributable evidence: months later there is no way
 * to tell whether a recorded PASS was scored against the fixture you are holding
 * or an earlier one. The hashes make each line self-identifying.
 */
import { appendFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Mode } from './config.js';
import { REPO_ROOT } from './config.js';

export interface RunlogLine {
    ts: string;
    profile: 'flat' | 'gateway';
    /** The tool CWF invoked. For the gateway profile this is `call_tool` / `search_tools`. */
    tool: string;
    /** For a gateway `call_tool`, the inner tool name the model asked for. */
    innerTool?: string;
    args: Record<string, unknown>;
    /** The dial live at the moment of the call — null is the honesty control. */
    dialMode: Mode | null;
    /** The mode that actually acted. null means the truth was served. */
    modeApplied: Mode | null;
    dialLiveButNotApplicable?: string;
    served: unknown;
    groundTruth: Record<string, unknown> | null;
    fixtureSha256: string;
    dialSha256: string;
}

export class Runlog {
    private readonly path: string;
    private readonly lines: RunlogLine[] = [];

    constructor(
        private readonly fixtureSha256: string,
        private readonly dialSha256: string,
        path?: string,
    ) {
        this.path = path ?? resolve(REPO_ROOT, 'runlog.jsonl');
    }

    append(entry: Omit<RunlogLine, 'ts' | 'fixtureSha256' | 'dialSha256'>): RunlogLine {
        const line: RunlogLine = {
            ts: new Date().toISOString(),
            ...entry,
            fixtureSha256: this.fixtureSha256,
            dialSha256: this.dialSha256,
        };
        this.lines.push(line);
        try {
            appendFileSync(this.path, `${JSON.stringify(line)}\n`, 'utf8');
        } catch (err) {
            // A read-only filesystem must not take the instrument down mid-run —
            // but it must be LOUD, because a silently-unwritten log is a run with
            // no evidence, which scores as nothing at all.
            console.error(
                `[honestbench] RUNLOG WRITE FAILED (${this.path}): ${err instanceof Error ? err.message : String(err)}`,
            );
        }
        return line;
    }

    /** In-memory view, for tests and for the served /runlog endpoint. */
    all(): readonly RunlogLine[] {
        return this.lines;
    }
}
