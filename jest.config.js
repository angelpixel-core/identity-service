process.env.NODE_ENV = 'test';

/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  setupFiles: ['<rootDir>/tests/setup.ts'],
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.[tj]s?(x)',
    '**/tests/**/*.spec.[tj]s?(x)',
    '**/tests/**/test_*.[tj]s?(x)',
  ],
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: 'tsconfig.json',
      },
    ],
  },
  moduleDirectories: ['node_modules', '<rootDir>'],
  verbose: true,
  clearMocks: true,
  restoreMocks: true,
};

