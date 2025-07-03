# Release Process

This project uses [semantic-release](https://semantic-release.gitbook.io/) for automated versioning and releases.

## How It Works

1. **Automatic Analysis**: semantic-release analyzes commit messages to determine the next version
2. **Release Generation**: Creates GitHub releases with changelogs
3. **NPM Publishing**: Publishes to npm registry
4. **Git Tags**: Creates git tags for each release

## Commit Message Convention

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

### Format
```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

### Types
- `feat`: New features (triggers minor release)
- `fix`: Bug fixes (triggers patch release)
- `docs`: Documentation changes (triggers patch release)
- `style`: Code style changes (triggers patch release)
- `refactor`: Code refactoring (triggers patch release)
- `perf`: Performance improvements (triggers patch release)
- `test`: Adding or updating tests (triggers patch release)
- `build`: Build system changes (triggers patch release)
- `ci`: CI/CD changes (triggers patch release)
- `chore`: Maintenance tasks (triggers patch release)

### Breaking Changes
To trigger a major version release, include `BREAKING CHANGE:` in the commit body:

```
feat!: remove deprecated API

BREAKING CHANGE: The `oldFunction` has been removed in favor of `newFunction`.
```

## Release Commands

### Test Release Impact
```bash
cd packages/clickhouse
npm run release:dry-run
```

### Manual Release (Local)
```bash
cd packages/clickhouse
npm run release
```

### Manual Release (CI)
```bash
cd packages/clickhouse
npm run semantic-release
```

## Release Process

1. **Development**: Make changes and commit with conventional commit messages
2. **CI/CD**: GitHub Actions automatically runs tests and builds
3. **Release**: On push to main, semantic-release:
   - Analyzes commits since last release
   - Determines version bump (patch/minor/major)
   - Creates changelog
   - Publishes to npm
   - Creates GitHub release
   - Tags the release

## Configuration

The release configuration is in `packages/clickhouse/.releaserc.cjs` and includes:

- **Plugins**: commit-analyzer, release-notes-generator, changelog, npm, github, git
- **Branches**: Only `main` branch triggers releases
- **Preset**: Angular preset for conventional commits
- **Release Rules**: Custom rules for different commit types

## Troubleshooting

### Release Not Triggering
- Ensure commits follow conventional format
- Check that you're on the `main` branch
- Verify CI/CD workflow is passing

### Version Issues
- Use `npm run release:dry-run` to preview what would be released
- Check commit history for proper conventional commits
- Ensure breaking changes are properly marked

### NPM Publishing Issues
- Verify `NPM_TOKEN` secret is set in GitHub
- Check package.json has correct `publishConfig`
- Ensure package name and version are correct 