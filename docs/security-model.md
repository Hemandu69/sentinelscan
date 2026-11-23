# Security model

SentinelScan is a single shared workspace on one machine. Authentication is intentionally absent. There are no user accounts, login screens or per-user authorization checks. Treat access to the local API as access to its workspace data.

## Network and credentials

The API binds to loopback and checks the configured Host header. Requests carrying a browser Origin must match the configured local web origin. PostgreSQL and ZAP are published only on loopback. Watchtower requests application API routes. The configured ZAP administration address is independent of the submitted website. The environment files may be synchronized if the checkouts are inside a cloud-synced folder. Keep the ZAP key and database credentials private to the local services that require them.

The ZAP client selects a fixed administration address, supplies its key in a request header, and bounds request duration and response size. Provider failures surface as structured errors. A dropped connection before an HTTP response can make credential rejection indistinguishable from an outage.

## Target scope and consent

Ordinary destination validation checks HTTP(S) syntax and resolved IPv4 and IPv6 addresses. It rejects embedded credentials, loopback, private and other prohibited addresses. Each assessment records consent for its target URL snapshot. Validation happens at registration and again when consent is submitted, which resolves DNS afresh each time. SentinelScan itself never connects to a registered website, so it has no target redirects to follow. ZAP makes its own connections, and the current Compose network does not restrict its outbound traffic. Operator scoping in ZAP is therefore required. Operator association with local demonstration results is a design requirement; it must preserve ordinary destination validation.

Before import, verify that all results belong to the linked provider run and authorized scope. Treat stale IDs, mixed scope, incomplete reads and uncertain terminal outcomes as incomplete work. Explicit evidence of cancellation or failure must survive independently of the finding count.

## Evidence handling

Consent tokens expire after five minutes and are consumed on submission. The backend locks the active target and checks its canonical URL before creating a pending assessment. Import rechecks consent and the provider fingerprint, reads the active run's attributed alert IDs before and after fetching alerts, and validates normalized URLs. A failed final transaction rolls back the saved run observations, findings and completion together. Local tracking cancellation is available for every open assessment and has no effect on the provider process. The session fingerprint is nonsecret and is never fetched or attached automatically by Watchtower.

The current normalizer redacts supplied evidence and removes credentials, query strings and fragments from finding URLs. Store only sanitized summaries in project documentation. Exclude raw alerts, scan sessions, reports containing sensitive material, database dumps, Docker volume contents, local configuration and secrets from Git.
