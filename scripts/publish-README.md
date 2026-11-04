# Publishing fa-model-catalog

Use Node.js 22.12 or newer and install dependencies with `npm ci`.
Review repository changes and authenticate with `npm login` before running the script.
Running it commits changes, pushes `master` to `origin`, and publishes a public npm package.

```sh
node scripts/publish.js --help
node scripts/publish.js --no-bump
node scripts/publish.js
node scripts/publish.js --add-all
```

Use `--no-bump` (or `-n`) to publish the current version, including the first release at `0.1.0`.
Otherwise, `npm version patch --no-git-tag-version --ignore-scripts` increments the patch version in
`package.json` and `package-lock.json` without creating a Git tag or running version scripts.

By default, `git add -u` stages modifications and deletions of tracked files.
Use `--add-all` (or `-a`) to also stage untracked files allowed by Git ignore rules.
Previously staged files are included too; review the index before running the script.

The script performs these steps:

1. Switch to the project root, validate the package name and version, and require the `master` branch.
2. Run `npm run quality`: unit and integration tests, lint, formatting, and documentation checks.
3. Update the version unless `--no-bump` is set.
4. Show package contents using `npm pack --dry-run --ignore-scripts` before committing or pushing.
5. Stage changes and create a commit named after the version if the index is not empty.
6. Push `master` to `origin`, including when no new commit was necessary.
7. Run `npm publish --access public --ignore-scripts`, since quality checks have already passed.

The package runs JavaScript directly from `src`; no compilation is needed.
The `files` list in [package.json](../package.json) selects runtime source, type declarations, schemas,
commands, documentation, the example catalog, and example deployment settings.
The root `.npmignore` excludes development tools, local catalogs, and private settings.
See the [project README](../README.md) for public imports and the command-line entry point.

Failures stop execution with a nonzero exit code. Version changes, commits, and pushes are not rolled back.
Inspect repository and registry state before retrying a failed publication with `--no-bump`.
An already published npm version cannot be reused.
Ordinary `npm publish` still runs the project's `prepublishOnly` quality checks.
