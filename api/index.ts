/**
 * api/index.ts — the SERVERLESS entry. Vercel only.
 *
 * WHY THIS FILE EXISTS, AND WHY `src/index.ts` IS UNTOUCHED:
 * `src/index.ts` calls `createApp(...).listen(port)` — it opens its own port,
 * which is exactly right for the container and exactly wrong for Vercel, whose
 * Node runtime wants a module whose DEFAULT EXPORT is the request handler.
 * Without this file the deployment fails with
 * `Invalid export found in module "…/src/server.js"` and every request 500s.
 *
 * One repository, two entries:
 *   - `src/index.ts` + `Dockerfile` -> `listen()`        (container, byte-unchanged)
 *   - `api/index.ts` + `vercel.json` -> default export   (serverless)
 *
 * Nothing about the instrument changes: same `createApp`, same fixture, same
 * dial, same five modes. This is HOSTING ONLY.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig, REPO_ROOT } from '../dist/config.js';
import { Runlog } from '../dist/runlog.js';
import { createApp } from '../dist/server.js';

/**
 * Where `fixture.json` / `dial.json` live at runtime.
 *
 * In the container they sit beside `dist/`, so `REPO_ROOT` finds them. On Vercel
 * the function is unpacked under `/var/task` and the two files arrive via
 * `includeFiles` in vercel.json — so the working directory is the right answer
 * there. Both candidates are TRIED and the first one that actually holds the
 * files wins, rather than guessing one and failing opaquely at load.
 */
function resolveRoot(): string {
    const candidates = [process.cwd(), REPO_ROOT, resolve(REPO_ROOT, '..')];
    for (const c of candidates) {
        if (existsSync(resolve(c, 'fixture.json')) && existsSync(resolve(c, 'dial.json'))) return c;
    }
    throw new Error(
        `[honestbench] fixture.json + dial.json not found in any of: ${candidates.join(' | ')}. ` +
            'On Vercel this means vercel.json `includeFiles` did not ship them.',
    );
}

const root = resolveRoot();
const cfg = loadConfig(root);

/**
 * G3.1 — THE RUNLOG IS NOT DURABLE HERE, and that is accepted, not worked around.
 *
 * A serverless invocation has no writable project filesystem and no memory that
 * survives to the next call. `/tmp` IS writable, so warm invocations accumulate
 * a usable log and `GET /runlog` stays meaningful within an instance — but a cold
 * start starts empty and nothing is guaranteed to persist.
 *
 * This does not break scoring, because the server is DETERMINISTIC: given
 * fixture.json, dial.json and the call, the served value is a pure function, and
 * both files are hash-pinned. The scorer's authoritative inputs are therefore the
 * TWO HASHES plus CWF's own telemetry (which records that the call happened);
 * `GET /runlog` is a warm-instance convenience, not the system of record.
 *
 * Tracked as HONESTBENCH-RUNLOG-DURABILITY-1. It retires only if reconstruction
 * ever proves insufficient — and only then does a durable sink get built.
 */
const runlogPath = process.env.HONESTBENCH_RUNLOG ?? (process.env.VERCEL ? '/tmp/runlog.jsonl' : undefined);
const runlog = new Runlog(cfg.fixtureSha256, cfg.dialSha256, runlogPath);

// The startup content hash, on the serverless path too (§2 G1). On Vercel this
// lands in the function's cold-start logs.
console.log('[honestbench] ── the honesty laboratory, instalment zero (serverless) ──');
console.log(`[honestbench] root                 = ${root}`);
console.log(`[honestbench] fixture.json sha256  = ${cfg.fixtureSha256}`);
console.log(`[honestbench] dial.json    sha256  = ${cfg.dialSha256}`);
console.log(
    `[honestbench] activeMode           = ${cfg.dial.activeMode ?? 'null (HONESTY CONTROL — the server tells the truth)'}`,
);
console.log(`[honestbench] runlog               = ${runlogPath ?? '(in-memory only)'}`);

export default createApp(cfg, runlog);
