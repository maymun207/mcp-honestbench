/**
 * hashStamp.test.ts — §9: "the fixture hash is stamped into every log line".
 *
 * Also pins the hash to the FILE BYTES rather than to a re-serialisation, so a
 * formatting-only change to fixture.json is guaranteed to change the run
 * identifier (which is the point of having one).
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { REPO_ROOT, hashFile, loadConfig } from '../src/config.js';
import { Runlog } from '../src/runlog.js';

describe('hash stamping', () => {
    it('hashes the raw bytes of the file, not a re-serialised object', () => {
        const path = resolve(REPO_ROOT, 'fixture.json');
        const expected = createHash('sha256').update(readFileSync(path)).digest('hex');
        expect(hashFile(path)).toBe(expected);

        // A re-serialisation would differ — proving the two are not interchangeable.
        const reserialised = createHash('sha256')
            .update(JSON.stringify(JSON.parse(readFileSync(path, 'utf8'))))
            .digest('hex');
        expect(reserialised).not.toBe(expected);
    });

    it('stamps BOTH hashes into every appended line', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hb-'));
        const logPath = join(dir, 'runlog.jsonl');
        const log = new Runlog('fixture-sha', 'dial-sha', logPath);

        log.append({
            profile: 'flat',
            tool: 'hb_grove_yield_total',
            args: { groveId: 'G-03' },
            dialMode: 'M1',
            modeApplied: 'M1',
            served: { totalYieldKg: 0 },
            groundTruth: { truth: 'absent' },
        });
        log.append({
            profile: 'gateway',
            tool: 'search_tools',
            args: {},
            dialMode: null,
            modeApplied: null,
            served: [],
            groundTruth: null,
        });

        const lines = readFileSync(logPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
        expect(lines).toHaveLength(2);
        for (const line of lines) {
            expect(line.fixtureSha256).toBe('fixture-sha');
            expect(line.dialSha256).toBe('dial-sha');
            expect(line.ts).toBeTypeOf('string');
        }
    });

    it('appends — it never rewrites a prior line', () => {
        const dir = mkdtempSync(join(tmpdir(), 'hb-'));
        const logPath = join(dir, 'runlog.jsonl');
        writeFileSync(logPath, '{"pre":"existing"}\n', 'utf8');

        new Runlog('f', 'd', logPath).append({
            profile: 'flat',
            tool: 't',
            args: {},
            dialMode: null,
            modeApplied: null,
            served: {},
            groundTruth: null,
        });

        const lines = readFileSync(logPath, 'utf8').trim().split('\n');
        expect(lines).toHaveLength(2);
        expect(JSON.parse(lines[0]!)).toMatchObject({ pre: 'existing' });
    });

    it('the shipped config loads and both hashes are 64-hex', () => {
        const cfg = loadConfig();
        expect(cfg.fixtureSha256).toMatch(/^[0-9a-f]{64}$/);
        expect(cfg.dialSha256).toMatch(/^[0-9a-f]{64}$/);
    });
});
