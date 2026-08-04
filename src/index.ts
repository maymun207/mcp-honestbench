/**
 * index.ts — entrypoint.
 *
 * Prints the sha256 of fixture.json at startup (§2 G1) alongside the dial hash,
 * so the run's identity is in the logs before the first call is served.
 */
import { loadConfig } from './config.js';
import { Runlog } from './runlog.js';
import { createApp } from './server.js';

const cfg = loadConfig();
const runlog = new Runlog(cfg.fixtureSha256, cfg.dialSha256, process.env.HONESTBENCH_RUNLOG);
const port = Number(process.env.PORT ?? 8931);

console.log('[honestbench] ── the honesty laboratory, instalment zero ──');
console.log(`[honestbench] fixture.json sha256 = ${cfg.fixtureSha256}`);
console.log(`[honestbench] dial.json    sha256 = ${cfg.dialSha256}`);
console.log(
    `[honestbench] activeMode = ${cfg.dial.activeMode ?? 'null (HONESTY CONTROL — the server tells the truth)'}`,
);
console.log(`[honestbench] target     = ${cfg.dial.target.tool ?? '(none)'}`);
console.log(
    `[honestbench] profiles   = flat:${cfg.dial.profile.flat} gateway:${cfg.dial.profile.gateway}`,
);

createApp(cfg, runlog).listen(port, () => {
    console.log(`[honestbench] listening on :${port}  (POST /flat · POST /gateway · GET /health · GET /runlog)`);
});
