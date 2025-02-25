# HypeQuery Release Commands

## Stable Release Command
To publish a stable release from the main branch:

```bash
npx semantic-release --extends ./.releaserc.cjs --no-ci --branches main
```

## Beta Release Command
The beta release happens automatically on push to main, but if you need to run it manually:

```bash
npx semantic-release --extends ./.releaserc.cjs --no-ci --prerelease beta
```

## Important Notes
- The stable release command should only be used when you're ready to promote beta features to a stable release
- Always ensure your tests pass before running a stable release
- After a stable release, a new beta cycle will start with the next push to main 