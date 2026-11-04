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
| `npm run docs:check`              | Relative documentation link checks.               |
| `npm run quality`                 | All checks above without automatic fixes.         |

Review automatic fixes and rerun `npm run quality`.
Formatting checks include Markdown, JSON, YAML, and type declarations.

## Project settings

Development rules are in the root `AGENTS.md`. `CLAUDE.md` imports only `AGENTS.md`.
Code analysis uses `.oxlintrc.json`.
The service runs JavaScript directly, without a build step or a TypeScript compiler.
Public `.d.ts` declarations remain available for applications that use type checking.
The service reads YAML settings and does not load `.env`.
Use the deployment skill's `update` command to update an existing installation.
Keep addresses, credentials, ports, certificate paths, and installation paths in private configuration.
Public examples must use placeholders or reserved example domains.
