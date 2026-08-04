/**
 * config.ts — the two files that fully determine this server's behaviour, and
 * the two hashes that identify a run.
 *
 * PHASE-HONESTBENCH-HARNESS-0 §2 G1: `dial.json` is THE ONLY AUTHORITY. There is
 * deliberately no in-memory toggle, no env override of a mode, and no runtime
 * mutation — a run must be reproducible by shipping these two files, and a
 * behaviour that could be changed without changing them would make the hashes lie.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

export type Mode = 'M1' | 'M2' | 'M3a' | 'M3b' | 'M4';
export const ALL_MODES: readonly Mode[] = ['M1', 'M2', 'M3a', 'M3b', 'M4'];

export interface FixtureTool {
    name: string;
    dialMode: Mode;
    description: string;
    inputSchema: Record<string, unknown>;
    declaredOutput: Record<string, unknown>;
    declaredOnlyUnderDial?: boolean;
    honest: Record<string, unknown> | null;
    m1?: { serves: Record<string, unknown>; groundTruth: Record<string, unknown> };
    m2?: { servesFirstN: number; omitsField: string; groundTruth: Record<string, unknown> };
    m3a?: { serves: Record<string, unknown>; groundTruth: Record<string, unknown> };
    m3b?: { serves: Record<string, unknown>; groundTruth: Record<string, unknown> };
    m4?: { serves: Record<string, unknown>; groundTruth: Record<string, unknown> };
}

export interface Fixture {
    fixtureVersion: string;
    scope: { inScopeGroves: string[]; note: string };
    tools: FixtureTool[];
    gatewayProfile: {
        innerTools: Array<{ name: string; description: string; isTheLie?: boolean; note?: string }>;
    };
    [k: string]: unknown;
}

export interface Dial {
    dialVersion: string;
    activeMode: Mode | null;
    target: { tool: string | null; params: Record<string, unknown> };
    profile: { flat: boolean; gateway: boolean };
    [k: string]: unknown;
}

export interface LoadedConfig {
    fixture: Fixture;
    dial: Dial;
    fixtureSha256: string;
    dialSha256: string;
}

function sha256(bytes: Buffer): string {
    return createHash('sha256').update(bytes).digest('hex');
}

/**
 * Hash the RAW BYTES, not the parsed-then-restringified object. A re-serialised
 * object would hash key order and formatting decisions this process happens to
 * make, so two shipped-identical files could hash differently — the identifier
 * has to be a property of the file, not of the reader.
 */
export function hashFile(path: string): string {
    return sha256(readFileSync(path));
}

/**
 * Load + validate. Every failure below is a STARTUP error on purpose: an
 * instrument that quietly does nothing when mis-configured reports a PASS that
 * only means "no lie was ever served", which is the worst possible failure for a
 * benchmark — it is indistinguishable from the system under test behaving well.
 */
export function loadConfig(root: string = REPO_ROOT): LoadedConfig {
    const fixturePath = resolve(root, 'fixture.json');
    const dialPath = resolve(root, 'dial.json');

    const fixtureBytes = readFileSync(fixturePath);
    const dialBytes = readFileSync(dialPath);
    const fixture = JSON.parse(fixtureBytes.toString('utf8')) as Fixture;
    const dial = JSON.parse(dialBytes.toString('utf8')) as Dial;

    validate(fixture, dial);

    return {
        fixture,
        dial,
        fixtureSha256: sha256(fixtureBytes),
        dialSha256: sha256(dialBytes),
    };
}

export function validate(fixture: Fixture, dial: Dial): void {
    if (!Array.isArray(fixture.tools) || fixture.tools.length === 0) {
        throw new Error('fixture.json: `tools` must be a non-empty array');
    }

    // Every declared mode must have exactly one tool that implements it, or a
    // dial position exists that nothing answers.
    for (const mode of ALL_MODES) {
        const owners = fixture.tools.filter((t) => t.dialMode === mode);
        if (owners.length !== 1) {
            throw new Error(
                `fixture.json: mode ${mode} must be implemented by exactly ONE tool, found ${owners.length}`,
            );
        }
    }

    const { activeMode, target } = dial;
    if (activeMode === null) return; // the honesty control — nothing to target

    if (!ALL_MODES.includes(activeMode)) {
        throw new Error(`dial.json: activeMode '${activeMode}' is not one of ${ALL_MODES.join(', ')}`);
    }
    if (!target?.tool) {
        throw new Error(`dial.json: activeMode is ${activeMode} but target.tool is not set`);
    }
    const tool = fixture.tools.find((t) => t.name === target.tool);
    if (!tool) {
        throw new Error(`dial.json: target.tool '${target.tool}' is not in fixture.json`);
    }
    // THE MISMATCH GUARD. Pointing M2 at the M1 tool would otherwise serve the
    // truth and score as a PASS — a false green that looks exactly like success.
    if (tool.dialMode !== activeMode) {
        throw new Error(
            `dial.json: activeMode ${activeMode} targets '${tool.name}', whose fixture dialMode is ${tool.dialMode}. ` +
                'A mode may only act on its own tool — refusing to start rather than silently serve the truth.',
        );
    }
}

/** The tool that implements a mode. Throws rather than returning undefined (see validate). */
export function toolForMode(fixture: Fixture, mode: Mode): FixtureTool {
    const t = fixture.tools.find((x) => x.dialMode === mode);
    if (!t) throw new Error(`fixture.json: no tool implements mode ${mode}`);
    return t;
}
