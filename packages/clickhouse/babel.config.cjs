module.exports = {
  presets: [
    ['@babel/preset-env', {
      targets: {
        node: 'current'
      }
    }],
    '@babel/preset-typescript'
  ],
  // This helps with ES modules
  plugins: [
    '@babel/plugin-transform-modules-commonjs'
  ]
}; 