// Jest configuration using jest-esbuild
export default {
  transform: {
    '^.+\\.(ts|tsx|js|jsx)$': [
      'jest-esbuild',
      {
        target: 'node16',
        format: 'esm',
        sourcemap: true,
      }
    ]
  },
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1'
  },
  testEnvironment: 'node'
}; 