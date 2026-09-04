import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    include: ['test/**/*.test.ts'],
    // The e2e suites drive one shared stack and one database, so a second
    // worker registering into the same island slots would race the first.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
})
