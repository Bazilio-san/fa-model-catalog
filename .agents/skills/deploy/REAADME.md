# Using the deploy skill

Use this skill to deploy and maintain this project's Linux service through SSH and systemd.
Read [SKILL.md](SKILL.md) before deployment or maintenance. It contains the operational rules and required checks.

## Select an installation

Copy [configs/_example](configs/_example/) to `configs/<server_name>/` and fill in these required files:

- `config.yaml`: SSH connection, public hostname, checkout directory, branch, service name, and existing Nginx site.
- `local.yaml`: shared access token and application listener settings.
- `rules.md`: installation purpose, restrictions, checks, and recovery instructions.

Real installation folders are ignored by Git. Keep private settings and credentials out of commits and packages.
Use a name matching `[a-z0-9][a-z0-9._-]*`; `_example` cannot be selected for execution.
Always pass `--server <server_name>`. There is no default server. Read that installation's `rules.md` first.
Run commands separately for each installation when working with multiple servers.

## Settings and defaults

The repository is fixed to `https://github.com/Bazilio-san/fa-model-catalog.git`; do not set `remote.repository`.
HTTPS uses port `443` by default. Set `deployment.publicPort` only for a nonstandard HTTPS port.
`remote.port` is the SSH port, while `server.port` is the application's loopback port.
The configured Nginx site must already provide HTTPS for the public hostname and port with a valid certificate.

Set the shared access token directly in `local.yaml`:

```yaml
access:
  token: REPLACE_WITH_ACCESS_TOKEN
server:
  host: 127.0.0.1
  port: 3000
  reloadIntervalMs: 5000
```

Replace the placeholder with the generated token. Consumers use that same token for bearer authentication.
The wrapper uploads application settings to `<appDirectory>/config/local.yaml`; SSH settings stay local.
Use `push-config` to apply changed application settings or tokens to an existing installation.

### Catalog selection

Do not set `deployment.catalogSource`. For `deploy` and `push-catalog`, the wrapper selects the first existing file:

1. `.agents/skills/deploy/configs/<server_name>/catalog.yaml`.
2. `catalog.yaml` in the local project root.
3. `catalog.example.yaml` in the local project root.

The wrapper validates the selected catalog and copies it to `<appDirectory>/catalog.yaml` on the server.
Both `deploy` and `push-catalog` replace the destination catalog, including when it already exists.
Regular code updates preserve the installed catalog.

`server.catalogFile` is optional for application startup. When omitted, the application uses `catalog.yaml`
in its project root, falling back to root `catalog.example.yaml`. An explicit relative path resolves from
the application settings file's directory. Deployment always uses `<appDirectory>/catalog.yaml`.

## Run commands

From the project root:

```sh
node .agents/skills/deploy/scripts/remote.js --server <server_name> show
node .agents/skills/deploy/scripts/remote.js --server <server_name> <command>
```

The wrapper also works from other directories when invoked by its absolute path.
Before changing a server, run `show` and check the host, checkout, branch, service, endpoints, and catalog source.
`show` reads local settings without connecting or printing credentials.

| Command | Purpose |
| --- | --- |
| `inspect` | Inspect target identity, tools, Nginx site, and listener port. |
| `deploy` | Provision the service, install catalog and settings, configure routes, start, and verify. |
| `check` | Fetch Git state and check whether synchronization is needed without restarting. |
| `update` | Synchronize committed code through the project updater and verify. |
| `start`, `restart` | Synchronize code and force a service restart. |
| `stop` | Stop the selected service. |
| `status`, `logs` | Read service status or recent logs. |
| `push-catalog` | Validate and replace the catalog using the selection order above. |
| `push-config` | Upload application settings, reconcile Nginx routes, restart, and verify. |
| `verify` | Check service readiness, public access control, model retrieval, and logs. |

## Operational rules

Deploy code from reviewed, committed, and pushed Git changes. Do not upload a working tree as server code.
Follow the preparation and validation requirements in [SKILL.md](SKILL.md) before initial deployment.
Updates synchronize tracked files to the selected commit while preserving ignored settings and catalog data.
Keep installations on a shared host separate by checkout, service name, loopback port, and public hostname/port.
Change only the selected service and its managed routes; preserve other services, certificates, and shared sites.
After changes, verify internal and public readiness, unauthenticated denial, and authenticated model retrieval.
Inspect recent logs before reporting success. This skill does not authorize npm publication or consumer changes.
