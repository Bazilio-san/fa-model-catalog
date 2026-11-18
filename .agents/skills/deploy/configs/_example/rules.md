# Installation rules

Describe the installation purpose, branch, public endpoint, and checks required before changes.

Record network restrictions, the web server (Nginx or Caddy) with its file for this installation, and occupied ports.
Installations sharing a host need separate checkout paths, service names, and loopback ports.
Their public hostname/port and managed routes must also be distinct.

Record the catalog path and recovery steps. Application settings and keys share config/local.yaml in the checkout.
Never include access tokens or private keys in these rules.

Inspect the web server's sites, includes, certificates, and listeners before choosing a layout.
Save the installation's web server configuration as *.config in this folder. Record each file's remote destination,
complete-site or fragment scope, include or symlink arrangement, certificate dependencies, and verification steps.
Apply these files only for setup, demonstrated configuration problems, or a requested web server change.
Keep working remote configuration untouched during routine application deployment and updates.
