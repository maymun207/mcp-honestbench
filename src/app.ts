/**
 * app.ts — the SERVERLESS entry. Vercel only.
 *
 * WHY THIS FILE EXISTS, AND WHY `index.ts` IS UNTOUCHED:
 * `index.ts` calls `createApp(...).listen(port)` — it opens its own port, which
 * is exactly right for the container and exactly wrong for Vercel, whose Node
 * server preset wants a module whose DEFAULT EXPORT is the app. Without this
 * file the deployment fails with `Invalid export found in module
 * ".../src/server.js"` and every request 500s.
 *
 * WHY `app.ts` AND NOT `api/index.ts`: Vercel 58 detects the Express preset from
 * the dependency list and looks for an entrypoint IN THE OUTPUT DIRECTORY,
 * searching `app.*` before `index.*` — it never consults an `api/` folder at all.
 * An `api/index.ts` build failed with "No entrypoint found in output directory".
 * `app.ts` compiles to `dist/app.js`, which is the first name the preset looks
 * for, so `dist/index.js` (the container's `listen()` entry) is never selected.
 *
 * One repository, two entries, from one build:
 *   - `src/index.ts` -> `dist/index.js`  -> `listen()`        (container; byte-unchanged)
 *   - `src/app.ts`   -> `dist/app.js`    -> default export    (serverless)
 *
 * Nothing about the instrument changes: same `createApp`, same fixture, same
 * dial, same five modes. This is HOSTING ONLY.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { REPO_ROOT, loadConfig } from './config.js';
import { Runlog } from './runlog.js';
import { createApp } from './server.js';

/**
 * Where `fixture.json` / `dial.json` live at runtime.
 *
 * In the container they sit beside `dist/`, so `REPO_ROOT` finds them. On Vercel
 * the layout depends on how the preset unpacks the bundle, so every plausible
 * root is TRIED and the first that actually holds BOTH files wins — rather than
 * guessing one and failing opaquely at load with a stack trace about JSON.
 */
function resolveRoot(): string {
    const candidates = [
        // Set by the generated Vercel entry, which copies both files beside
        // itself because Vercel's tracer cannot see a runtime readFileSync.
        process.env.HONESTBENCH_ROOT,
        REPO_ROOT,
        process.cwd(),
        resolve(REPO_ROOT, '..'),
        resolve(process.cwd(), '..'),
    ].filter((c): c is string => !!c);
    for (const c of candidates) {
        if (existsSync(resolve(c, 'fixture.json')) && existsSync(resolve(c, 'dial.json'))) return c;
    }
    throw new Error(
        `[honestbench] fixture.json + dial.json not found in any of: ${candidates.join(' | ')}`,
    );
}

const root = resolveRoot();
const cfg = loadConfig(root);

/**
 * G3.1 — THE RUNLOG IS NOT DURABLE HERE, and that is accepted, not worked around.
 *
 * A serverless invocation has no writable project filesystem and no memory that
 * survives to the next call. `/tmp` IS writable, so warm invocations accumulate a
 * usable log and `GET /runlog` stays meaningful within an instance — but a cold
 * start begins empty and nothing is guaranteed to persist.
 *
 * This does not break scoring, because the server is DETERMINISTIC: given
 * fixture.json, dial.json and the call, the served value is a pure function, and
 * both files are hash-pinned. The scorer's authoritative inputs are therefore the
 * TWO HASHES plus the consuming system's own telemetry (which records that the
 * call happened); `GET /runlog` is a warm-instance convenience, not the system of
 * record. Tracked as HONESTBENCH-RUNLOG-DURABILITY-1.
 */
const runlogPath = process.env.HONESTBENCH_RUNLOG ?? (process.env.VERCEL ? '/tmp/runlog.jsonl' : undefined);
const runlog = new Runlog(cfg.fixtureSha256, cfg.dialSha256, runlogPath);

// The startup content hash on the serverless path too (§2 G1) — this lands in
// the function's cold-start logs, so a run is identifiable from them alone.
console.log('[honestbench] ── the honesty laboratory, instalment zero (serverless) ──');
console.log(`[honestbench] root                = ${root}`);
console.log(`[honestbench] fixture.json sha256 = ${cfg.fixtureSha256}`);
console.log(`[honestbench] dial.json    sha256 = ${cfg.dialSha256}`);
console.log(
    `[honestbench] activeMode          = ${cfg.dial.activeMode ?? 'null (HONESTY CONTROL — the server tells the truth)'}`,
);
console.log(`[honestbench] runlog              = ${runlogPath ?? '(in-memory only)'}`);

export default createApp(cfg, runlog);
