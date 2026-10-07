import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'shared', include: ['shared/src/**/*.test.ts'] } },
      {
        // Needs the Firebase emulators — run with `npm run test:emulator`.
        test: {
          name: 'emulator',
          include: ['tests/**/*.test.ts'],
          testTimeout: 30_000,
          hookTimeout: 60_000,
          fileParallelism: false,
        },
      },
    ],
  },
});
