/**
 * dialGuard.test.ts — the false-green guard.
 *
 * If the dial named M2 but pointed at M1's tool, the server would serve the
 * TRUTH and the run would score as a PASS. That PASS would be indistinguishable
 * from the system under test behaving correctly — the worst failure a benchmark
 * can have, because it is silently flattering. `validate()` therefore refuses to
 * start, and this file proves the refusal by exercising each way it can happen.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, validate, type Dial, type Fixture } from '../src/config.js';

const { fixture, dial } = loadConfig();
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

const withDial = (over: Partial<Dial>): Dial => ({ ...clone(dial), ...over });

describe('dial validation', () => {
    it('accepts the shipped config (positive control — else every rejection below is meaningless)', () => {
        expect(() => validate(fixture, dial)).not.toThrow();
    });

    it('accepts the honesty control with no target', () => {
        expect(() =>
            validate(fixture, withDial({ activeMode: null, target: { tool: null, params: {} } })),
        ).not.toThrow();
    });

    it('REJECTS a mode pointed at another mode\'s tool', () => {
        expect(() =>
            validate(fixture, withDial({ activeMode: 'M2', target: { tool: 'hb_grove_yield_total', params: {} } })),
        ).toThrow(/may only act on its own tool/);
    });

    it('REJECTS an active mode with no target tool', () => {
        expect(() =>
            validate(fixture, withDial({ activeMode: 'M1', target: { tool: null, params: {} } })),
        ).toThrow(/target\.tool is not set/);
    });

    it('REJECTS a target tool that is not in the fixture', () => {
        expect(() =>
            validate(fixture, withDial({ activeMode: 'M1', target: { tool: 'hb_nope', params: {} } })),
        ).toThrow(/is not in fixture\.json/);
    });

    it('REJECTS an unknown mode name', () => {
        expect(() =>
            validate(fixture, withDial({ activeMode: 'M9' as never, target: { tool: 'hb_grove_yield_total', params: {} } })),
        ).toThrow(/is not one of/);
    });

    it('REJECTS a fixture where a mode has no implementing tool', () => {
        const broken = clone(fixture) as Fixture;
        broken.tools = broken.tools.filter((t) => t.dialMode !== 'M4');
        expect(() => validate(broken, dial)).toThrow(/mode M4 must be implemented by exactly ONE tool, found 0/);
    });

    it('REJECTS a fixture where two tools claim the same mode', () => {
        const broken = clone(fixture) as Fixture;
        broken.tools.push({ ...broken.tools[0]!, name: 'hb_duplicate' });
        expect(() => validate(broken, dial)).toThrow(/must be implemented by exactly ONE tool, found 2/);
    });
});
