import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      thresholds: {
        lines: 95,
        statements: 95,
        branches: 90,
        functions: 91,
      },
      exclude: [
        'dist/**',
        'coverage/**',
        'scripts/**',
        'prisma/**',
        'src/generated/**',
        'src/main.ts',
        'prisma.config.ts',
        'vitest.config.ts',
      ],
    },
  },
});
