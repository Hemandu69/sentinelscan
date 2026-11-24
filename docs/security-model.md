# Security model

SentinelScan is a single shared workspace on one machine. Authentication is intentionally absent. There are no user accounts, login screens or per-user authorization checks. Treat access to the local API as access to its workspace data.

## Network and credentials

The API binds to loopback and checks the configured Host header. Requests carrying a browser Origin must match the configured local web origin. PostgreSQL and ZAP are published only on loopback. Watchtower requests application API routes. The configured ZAP administration address is independent of the submitted website. The environment files may be synchronized if the checkouts are inside a cloud-synced folder. ZAP logs rejected keys and startup configuration, so refused checks never use a real key and the startup lines are suppressed by a logging override. Keep the ZAP key and database credentials private to the local services that require them.

The ZAP client selects a fixed administration address, supplies its key in a request header, and bounds request duration and response size. Provider failures surface as structured errors. A dropped connection before an HTTP response can make credential rejection indistinguishable from an outage.

## Target scope and consent

Ordinary destination validation checks HTTP(S) syntax and resolved IPv4 and IPv6 addresses. It rejects embedded credentials, loopback, private and other prohibited addresses. Each assessment records consent for its target URL snapshot. Validation happens at registration and again when consent is submitted, which resolves DNS afresh each time. SentinelScan itself never connects to a registered website, so it has no target redirects to follow. ZAP makes its own connections, behind the firewall described below.

Before import, verify that all results belong to the linked provider run and authorized scope. Treat stale IDs, mixed scope, incomplete reads and uncertain terminal outcomes as incomplete work. Explicit evidence of cancellation or failure must survive independently of the finding count.

## Controlled scans

Scan control is a fixed list of server-side ZAP operations against `http://juice-shop:3000/`. The browser cannot supply a ZAP action, rule, policy or destination. A start needs a fresh single-use consent token (five minutes, bound to website and address), passing readiness checks and no other scan. It ends the previous ZAP session. The scan stops above 90% memory, on any other site in ZAP, on unhealthy services, on ZAP errors, at its time limit, or if the firewall is gone. A stop that ZAP does not confirm is recorded as an unknown outcome.

**Firewall.** `sentinelscan-egress-guard:1` joins ZAP's network namespace with NET_ADMIN only and installs kernel rules. ZAP can open connections only to the demo container on port 3000, plus replies from its own API port. Everything else is refused: private, loopback, link-local and metadata addresses, the database, the gateway, the internet, other ports and DNS. The name is pinned in ZAP's hosts file. ZAP runs without the capability to change any of it. The rules are proven before each scan, compared every 10 seconds and before import, and locked afterwards. A ZAP restart removes them until the next scan. Someone who controls Docker on this machine can remove them.

## Optional AI analysis

Disabled by default and server-side only. When enabled and selected, sanitized alert text leaves this machine for the configured provider. See [finding intelligence](finding-intelligence.md).

## Evidence handling

Consent tokens expire after five minutes and are consumed on submission. The backend locks the active target and checks its canonical URL before creating a pending assessment. Import rechecks consent and the provider fingerprint, reads the active run's attributed alert IDs before and after fetching alerts, and validates normalized URLs. A failed final transaction rolls back the saved run observations, findings and completion together. Local tracking cancellation is available for every open assessment and has no effect on the provider process. The session fingerprint is never sent to the browser. A controlled scan attaches its own receipts on the server.

The current normalizer redacts supplied evidence and removes credentials, query strings and fragments from finding URLs. Store only sanitized summaries in project documentation. Exclude raw alerts, scan sessions, reports containing sensitive material, database dumps, Docker volume contents, local configuration and secrets from Git.
