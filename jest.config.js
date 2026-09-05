/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  rootDir: '.',
  roots: ['<rootDir>/tests'],
  setupFiles: ['<rootDir>/tests/setupEnv.ts'],
  testMatch: ['**/*.test.ts'],
  clearMocks: true,
  // Replica-set startup (needed for multi-document transactions) is slower
  // than a plain standalone mongod, especially on first run per suite.
  testTimeout: 60000,
};
