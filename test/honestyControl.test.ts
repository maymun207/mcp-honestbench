/**
 * honestyControl.test.ts — §9: "a control proving the server tells the truth
 * when no dial is set (an instrument that cannot be honest cannot be trusted to
 * lie on command)".
 *
 * This control is LOAD-BEARING, not decorative. It can fail on its own cause
 * (S68-9): `getDailyOeeValues` carries `declaredOnlyUnderDial`, so if the
 * visibility rule regressed the control would red here and nowhere else.
 */
import { describe, expect, it } from 'vitest';
import { loadConfig, type Dial } from '../src/config.js';
import { honestServe, serveTool, visibleTools } from '../src/modes.js';

const { fixture } = loadConfig();

const NO_DIAL: Dial = {
    dialVersion: 'test',
    activeMode: null,
    target: { tool: null, params: {} },
    profile: { flat: true, gateway: true },
};

describe('the honesty control — no dial set', () => {
    it('serves the TRUE yield, including the absent one as absent (not as 0)', () => {
        const r = serveTool(fixture, NO_DIAL, 'hb_grove_yield_total', { groveId: 'G-03' });
        expect(r.modeApplied).toBeNull();
        expect(r.groundTruth).toBeNull();
        expect(r.served).toMatchObject({ totalYieldKg: null, measured: false });
    });

    it('serves ALL readings and keeps totalCount — no truncation, no omission', () => {
        const r = serveTool(fixture, NO_DIAL, 'hb_sensor_readings_list', { groveId: 'G-01' });
        const served = r.served as { readings: unknown[]; totalCount: number };
        expect(served.readings).toHaveLength(48);
        expect(served.totalCount).toBe(48);
        expect(r.modeApplied).toBeNull();
    });

    it('honours its own declared schema: sensors is an ARRAY and lastCheckIso is present', () => {
        const r = serveTool(fixture, NO_DIAL, 'hb_grove_status', { groveId: 'G-01' });
        const served = r.served as { sensors: unknown; lastCheckIso?: string };
        expect(Array.isArray(served.sensors)).toBe(true);
        expect(served.lastCheckIso).toBeTypeOf('string');
    });

    it('refuses an out-of-scope entity instead of fabricating one', () => {
        const r = serveTool(fixture, NO_DIAL, 'hb_entity_lookup', { entityId: 'G-99' });
        expect(r.served).toMatchObject({ found: false });
        expect(r.modeApplied).toBeNull();
    });

    it('does NOT declare the hijacked ARMES name at all', () => {
        const names = visibleTools(fixture, NO_DIAL).map((t) => t.name);
        expect(names).not.toContain('getDailyOeeValues');
        expect(names).toContain('hb_grove_yield_total');
    });

    it('backstops the hijacked tool even if visibility were bypassed', () => {
        const hijack = fixture.tools.find((t) => t.name === 'getDailyOeeValues')!;
        expect(() => honestServe(fixture, hijack, {})).toThrow(/must not be served outside its dial/);
    });
});
