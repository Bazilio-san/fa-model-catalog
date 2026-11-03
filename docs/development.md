# Development setup

Install the Node.js version specified in `package.json`. Run `npm ci`, then `npm run quality` from the repository root.
To describe servers, copy `servers.example.md` to `servers.local.md` and fill in local values.
The private file is excluded from Git and is read by the agent only for operations that require connections.
Service configuration and startup are described in the [operations guide](operations.md).

## Checks

| Command                           | Purpose                                           |
| --------------------------------- | ------------------------------------------------- |
| `npm test` or `npm run test:code` | Unit checks without external systems.             |
| `npm run test:integration`        | Server and client checks over a local connection. |
| `npm run lint`                    | Source analysis using `.oxlintrc.json`.           |
| `npm run lint:fix`                | Automatic fixes and formatting.                   |
| `npm run format:check`            | Formatting checks without changing files.         |
| `npm run type:check`              | Type declaration checks.                          |
| `npm run docs:check`              | Relative documentation link checks.               |
| `npm run quality`                 | All checks above without automatic fixes.         |

Review automatic fixes and rerun `npm run quality`.
Formatting checks include Markdown, JSON, YAML, and type declarations.
The exclusions for these formats from the `fa-harness` template are not used here.

## Settings adapted from the template

Development rules are in the root `AGENTS.md`. `CLAUDE.md` imports only `AGENTS.md`.

The analyzer settings come from the template's `.oxlintrc.json`, preserving code and import checks.
The environment is limited to Node.js; browser, jQuery, Vue, and absent entry-point overrides were removed.
Type declarations are checked separately by `type:check`.

The `test` shortcut and `lint:fix` command were adapted from `package.json`.
Dependencies and `package-lock.json` belong to this service; the template lockfile is not copied.
When changing dependencies, update the lockfile through npm and verify installation with `npm ci`.

The original `README.md` and `start.md` describe another application. Their roles here are covered by the root README,
this document, and the operations guide. The `servers.example.md` template is adapted for the model catalog.
Shared `.gitignore`, `.rgignore`, `.gitattributes`, and `.oxfmtrc.json` settings account for local paths.

The template's `update.cjs` requires `src/config.js` and database migration commands that are absent here.
Update the server through the existing `update` command in the project's deployment skill.
The `.env.example` file is not copied: the service reads YAML settings and does not load `.env`.
The `AGENTS-PROMPT-RULES.md` and `AGENTS-LLM-CAPTURE.md` rules concern language model calls;
the catalog makes no such calls and has neither their client nor their request capture mechanism.
