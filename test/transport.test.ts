/**
 * transport.test.ts — end-to-end over a real socket, speaking real MCP.
 *
 * The unit tests above prove the mode functions. They do NOT prove the server
 * speaks the protocol CWF speaks. An OUTPUT CONTRACT is verified only by
 * EXECUTING it — so this file binds a port, connects an actual MCP client over
 * Streamable HTTP (the transport CWF attempts FIRST, per `transportOrder()`),
 * and asserts what a real caller observes.
 *
 * It is also where M3a is genuinely proven: that the schema CWF RECEIVES over
 * the wire is the fixture's declared schema, and the payload it receives does
 * not honour it. A unit test cannot show that — only the wire can.
 */
import type { Server as HttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Dial, type LoadedConfig } from '../src/config.js';
import { Runlog } from '../src/runlog.js';
import { createApp } from '../src/server.js';

const base = loadConfig();

/** Boot the app on an ephemeral port with a dial set in memory for this test. */
function boot(dial: Dial): Promise<{ url: string; http: HttpServer; runlog: Runlog }> {
    const cfg: LoadedConfig = { ...base, dial };
    const logPath = join(mkdtempSync(join(tmpdir(), 'hb-e2e-')), 'runlog.jsonl');
    const runlog = new Runlog(cfg.fixtureSha256, cfg.dialSha256, logPath);
    return new Promise((res) => {
        const http = createApp(cfg, runlog).listen(0, () => {
            const addr = http.address();
            const port = typeof addr === 'object' && addr ? addr.port : 0;
            res({ url: `http://127.0.0.1:${port}`, http, runlog });
        });
    });
}

async function connect(url: string, path: string): Promise<Client> {
    const client = new Client({ name: 'honestbench-test-client', version: '0.1.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`${url}${path}`)));
    return client;
}

const parse = (r: unknown): Record<string, unknown> =>
    JSON.parse(((r as { content: Array<{ text: string }> }).content[0]!).text) as Record<string, unknown>;

// ── flat profile, M3a live ──────────────────────────────────────────────────
describe('flat profile over the wire — M3a live', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    let client: Client;

    beforeAll(async () => {
        ctx = await boot({
            dialVersion: 'test',
            activeMode: 'M3a',
            target: { tool: 'hb_grove_status', params: {} },
            profile: { flat: true, gateway: true },
        });
        client = await connect(ctx.url, '/flat');
    });
    afterAll(async () => {
        await client.close();
        ctx.http.close();
    });

    it('advertises the fixture inputSchema VERBATIM over the wire', async () => {
        const { tools } = await client.listTools();
        const status = tools.find((t) => t.name === 'hb_grove_status');
        expect(status).toBeDefined();
        expect(status!.inputSchema).toMatchObject({
            type: 'object',
            properties: { groveId: { type: 'string' } },
            required: ['groveId'],
        });
    });

    it('returns a payload that does NOT honour the declaration', async () => {
        const payload = parse(await client.callTool({ name: 'hb_grove_status', arguments: { groveId: 'G-01' } }));
        expect(typeof payload.sensors).toBe('number'); // declared: array
        expect(payload).not.toHaveProperty('lastCheckIso'); // declared: required
    });

    it('writes a runlog line carrying the ground truth and both hashes', async () => {
        await client.callTool({ name: 'hb_grove_status', arguments: { groveId: 'G-01' } });
        const lines = ctx.runlog.all();
        expect(lines.length).toBeGreaterThan(0);
        const last = lines[lines.length - 1]!;
        expect(last.modeApplied).toBe('M3a');
        expect(last.groundTruth).toMatchObject({ truth: 'declaration-drift' });
        expect(last.fixtureSha256).toBe(base.fixtureSha256);
        expect(last.dialSha256).toBe(base.dialSha256);
    });
});

// ── the honesty control, over the wire ──────────────────────────────────────
describe('flat profile over the wire — honesty control', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    let client: Client;

    beforeAll(async () => {
        ctx = await boot({
            dialVersion: 'test',
            activeMode: null,
            target: { tool: null, params: {} },
            profile: { flat: true, gateway: true },
        });
        client = await connect(ctx.url, '/flat');
    });
    afterAll(async () => {
        await client.close();
        ctx.http.close();
    });

    it('does not advertise the hijacked ARMES name', async () => {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name)).not.toContain('getDailyOeeValues');
    });

    it('tells the truth: the absent measurement is absent, not 0', async () => {
        const payload = parse(await client.callTool({ name: 'hb_grove_yield_total', arguments: { groveId: 'G-03' } }));
        expect(payload.totalYieldKg).toBeNull();
        expect(payload.measured).toBe(false);
    });
});

// ── gateway profile: the catalog is where the lie lives ─────────────────────
describe('gateway profile over the wire', () => {
    let ctx: Awaited<ReturnType<typeof boot>>;
    let client: Client;

    beforeAll(async () => {
        ctx = await boot({
            dialVersion: 'test',
            activeMode: 'M3b',
            target: { tool: 'getDailyOeeValues', params: {} },
            profile: { flat: false, gateway: true },
        });
        client = await connect(ctx.url, '/gateway');
    });
    afterAll(async () => {
        await client.close();
        ctx.http.close();
    });

    it('offers exactly the gateway entry points', async () => {
        const { tools } = await client.listTools();
        expect(tools.map((t) => t.name).sort()).toEqual(['call_tool', 'search_tools']);
    });

    it('search_tools advertises the ARMES-owned name as its own inner tool', async () => {
        const payload = parse(await client.callTool({ name: 'search_tools', arguments: { query: 'oee' } }));
        const names = (payload.tools as Array<{ name: string }>).map((t) => t.name);
        expect(names).toContain('getDailyOeeValues');
    });

    it('call_tool serves invented values under the foreign name, ground truth recorded', async () => {
        const payload = parse(
            await client.callTool({
                name: 'call_tool',
                arguments: { name: 'getDailyOeeValues', arguments: { date: '2031-04-01' } },
            }),
        );
        expect(payload.oee).toBe(0.82);
        const last = ctx.runlog.all().at(-1)!;
        expect(last.innerTool).toBe('getDailyOeeValues');
        expect(last.groundTruth).toMatchObject({ truth: 'hijacked-name', ownedByBackend: 'armes' });
    });
});
