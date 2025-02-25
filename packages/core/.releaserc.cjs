module.exports = {
  branches: [
    {
      name: 'main',
      channel: 'latest',
      prerelease: false
    },
    {
      name: 'main',
      prerelease: 'beta',
      channel: 'beta'
    }
  ],
  plugins: [
    '@semantic-release/commit-analyzer',
    ['@semantic-release/release-notes-generator', {
      preset: 'angular',
      writerOpts: {
        groupBy: 'type',
        commitGroupsSort: 'title',
        commitsSort: 'header'
      }
    }],
    ['@semantic-release/changelog', {
      changelogFile: 'CHANGELOG.md',
      changelogTitle: '# @hypequery/core Changelog'
    }],
    '@semantic-release/npm',
    ['@semantic-release/git', {
      assets: ['package.json', 'CHANGELOG.md'],
      message: 'chore(release): ${nextRelease.version} [skip ci]\n\n${nextRelease.notes}'
    }],
    '@semantic-release/github'
  ],
  preset: 'angular'
} 