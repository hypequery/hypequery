---
"@hypequery/cli": patch  
"@hypequery/react": patch  
"@hypequery/serve": patch

Ensure the release workflow builds every package before running the Changesets publish step so the CI release ships with fresh `dist` artifacts.