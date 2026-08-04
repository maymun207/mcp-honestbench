/**
 * hash.ts — print the two hashes that identify a run, without starting a server.
 * Used by CI and by the report, so the hashes quoted in a hand-back are produced
 * the same way every time rather than by an ad-hoc shasum invocation.
 */
import { resolve } from 'node:path';
import { REPO_ROOT, hashFile } from '../config.js';

for (const f of ['fixture.json', 'dial.json']) {
    console.log(`${hashFile(resolve(REPO_ROOT, f))}  ${f}`);
}
