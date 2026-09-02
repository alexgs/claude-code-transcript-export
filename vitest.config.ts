import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // Tests must never read the developer's real ~/.claude/projects; every
    // fixture is checked in. See docs/plans §0.1.
    environment: 'node',
  },
});
