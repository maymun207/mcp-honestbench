import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        // The transport test binds a real port and speaks real MCP; give it room.
        testTimeout: 20_000,
    },
});
