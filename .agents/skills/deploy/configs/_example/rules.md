# Installation rules

Describe the installation purpose, branch, public endpoint, and checks required before changes.

Record network restrictions, the existing nginx site, and occupied ports.
Installations sharing a host need separate checkout paths, service names, loopback ports, and nginx snippets.
Their public hostname/port and managed routes must also be distinct.

Record the catalog path and recovery steps. Application settings and keys share config/local.yaml in the checkout.
Never include access tokens or private keys in these rules.
