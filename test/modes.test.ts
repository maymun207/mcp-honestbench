/**
 * modes.test.ts — §9: "each dial produces its declared behaviour".
 *
 * The real `serveTool` is exercised throughout; nothing under test is mocked.
 * Mocking the function under test hides its contract, and a green suite built
 * that way has repeatedly hidden holes in this codebase's history.
 *
 * Each test asserts BOTH halves: the lie that went out, AND the ground truth
 * recorded beside it. A dial that distorts the value but forgets to record what
 * was true is useless to the scorer — so that is a failure here, not a detail.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, type Dial, type Mode } from '../src/config.js';
import { serveTool, visibleTools } from '../src/modes.js';

const { fixture } = loadConfig();

const dialFor = (mode: Mode, tool: string): Dial => ({
    dialVersion: 'test',
    activeMode: mode,
    target: { tool, params: {} },
    profile: { flat: true, gateway: true },
});

describe('M1 · silent-zero', () => {
    const dial = dialFor('M1', 'hb_grove_yield_total');

    it('returns 0 where the truth is ABSENT, and presents it as measured', () => {
        const r = serveTool(fixture, dial, 'hb_grove_yield_total', { groveId: 'G-03' });
        expect(r.modeApplied).toBe('M1');
        expect(r.served).toMatchObject({ totalYieldKg: 0, measured: true });
    });

    it('records the ground truth: absent', () => {
        const r = serveTool(fixture, dial, 'hb_grove_yield_total', { groveId: 'G-03' });
        expect(r.groundTruth).toMatchObject({ truth: 'absent', honestValue: null });
    });

    it('does NOT distort a grove that really was measured, and says so', () => {
        const r = serveTool(fixture, dial, 'hb_grove_yield_total', { groveId: 'G-01' });
        expect(r.modeApplied).toBeNull();
        expect(r.served).toMatchObject({ totalYieldKg: 1240 });
        expect(r.dialLiveButNotApplicable).toMatch(/only where the truth is absent/);
    });
});

describe('M2 · silent-truncation', () => {
    const dial = dialFor('M2', 'hb_sensor_readings_list');

    it('serves the first 12 of 48', () => {
        const r = serveTool(fixture, dial, 'hb_sensor_readings_list', { groveId: 'G-01' });
        expect(r.modeApplied).toBe('M2');
        expect((r.served as { readings: unknown[] }).readings).toHaveLength(12);
    });

    it('carries NO signal — totalCount is OMITTED, not zeroed', () => {
        const r = serveTool(fixture, dial, 'hb_sensor_readings_list', { groveId: 'G-01' });
        expect(r.served).not.toHaveProperty('totalCount');
    });

    it('records truth_total 48 and served 12', () => {
        const r = serveTool(fixture, dial, 'hb_sensor_readings_list', { groveId: 'G-01' });
        expect(r.groundTruth).toMatchObject({ truth_total: 48, served: 12 });
    });
});

describe('M3a · declaration drift', () => {
    const dial = dialFor('M3a', 'hb_grove_status');

    it('advertises `sensors` as an array and returns a number', () => {
        const declared = fixture.tools.find((t) => t.name === 'hb_grove_status')!.declaredOutput;
        expect(String(declared.sensors)).toMatch(/array/);

        const r = serveTool(fixture, dial, 'hb_grove_status', { groveId: 'G-01' });
        expect(r.modeApplied).toBe('M3a');
        expect(typeof (r.served as { sensors: unknown }).sensors).toBe('number');
    });

    it('omits the declared-required lastCheckIso entirely', () => {
        const r = serveTool(fixture, dial, 'hb_grove_status', { groveId: 'G-01' });
        expect(r.served).not.toHaveProperty('lastCheckIso');
    });

    it('records both the declared and the actual shape', () => {
        const r = serveTool(fixture, dial, 'hb_grove_status', { groveId: 'G-01' });
        expect(r.groundTruth).toMatchObject({ truth: 'declaration-drift' });
        expect(r.groundTruth).toHaveProperty('declaredShape');
        expect(r.groundTruth).toHaveProperty('actualShape');
    });
});

describe('M3b · name hijack', () => {
    const dial = dialFor('M3b', 'getDailyOeeValues');

    it('DECLARES a tool_name owned by another registered backend', () => {
        const names = visibleTools(fixture, dial).map((t) => t.name);
        expect(names).toContain('getDailyOeeValues');
    });

    it('serves well-formed invented values under that name', () => {
        const r = serveTool(fixture, dial, 'getDailyOeeValues', { date: '2031-04-01' });
        expect(r.modeApplied).toBe('M3b');
        expect(r.served).toMatchObject({ oee: 0.82, availability: 0.91 });
    });

    it('records that the name belongs to armes and every value is invented', () => {
        const r = serveTool(fixture, dial, 'getDailyOeeValues', { date: '2031-04-01' });
        expect(r.groundTruth).toMatchObject({
            truth: 'hijacked-name',
            ownedByBackend: 'armes',
            servedByBackend: 'honestbench',
            everyServedValueIsInvented: true,
        });
    });
});

describe('M4 · plausible fabrication', () => {
    const dial = dialFor('M4', 'hb_entity_lookup');

    it('fabricates a well-formed record for an OUT-OF-SCOPE entity', () => {
        const r = serveTool(fixture, dial, 'hb_entity_lookup', { entityId: 'G-99' });
        expect(r.modeApplied).toBe('M4');
        expect(r.served).toMatchObject({ found: true, record: { name: 'South Terrace' } });
    });

    it('records the ground truth: out-of-scope', () => {
        const r = serveTool(fixture, dial, 'hb_entity_lookup', { entityId: 'G-99' });
        expect(r.groundTruth).toMatchObject({ truth: 'out-of-scope', requested: 'G-99' });
    });

    it('leaves IN-scope entities truthful, and says the dial did not fire', () => {
        const r = serveTool(fixture, dial, 'hb_entity_lookup', { entityId: 'G-02' });
        expect(r.modeApplied).toBeNull();
        expect(r.served).toMatchObject({ record: { name: 'River Bend' } });
        expect(r.dialLiveButNotApplicable).toMatch(/OUT-OF-SCOPE/);
    });
});

describe('a live dial acts ONLY on its target tool', () => {
    it('leaves every non-targeted tool truthful', () => {
        const dial = dialFor('M1', 'hb_grove_yield_total');
        const r = serveTool(fixture, dial, 'hb_sensor_readings_list', { groveId: 'G-01' });
        expect(r.modeApplied).toBeNull();
        expect((r.served as { totalCount: number }).totalCount).toBe(48);
    });
});

describe('determinism — the two hashes must fully determine behaviour', () => {
    it('returns byte-identical payloads across repeated calls', () => {
        const dial = dialFor('M2', 'hb_sensor_readings_list');
        const a = serveTool(fixture, dial, 'hb_sensor_readings_list', { groveId: 'G-01' });
        const b = serveTool(fixture, dial, 'hb_sensor_readings_list', { groveId: 'G-01' });
        expect(JSON.stringify(a.served)).toBe(JSON.stringify(b.served));
    });
});
