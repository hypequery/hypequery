module.exports = {
  transform: {
    '^.+\\.(ts|tsx)$': [
      'ts-jest',
      {
        useESM: true,
      },
    ],
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  testEnvironment: 'node',
  testMatch: ['**/*.test.ts'],
  transformIgnorePatterns: [
    'node_modules/(?!(@clickhouse)/)',
  ],
  globals: {
    'ts-jest': {
      useESM: true,
    },
  },
}; 