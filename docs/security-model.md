# Security model

SentinelScan is a single shared workspace on one machine. Authentication is intentionally absent. There are no user accounts, login screens or per-user authorization checks. Treat access to the local API as access to its workspace data.

## Network and credentials

The API binds to loopback and checks the configured Host header. Requests carrying a browser Origin must match the configured local web origin. PostgreSQL and ZAP are published only on loopback. Watchtower requests application API routes. The configured ZAP administration address is independent of the submitted website. The environment files may be synchronized if the checkouts are inside a cloud-synced folder. ZAP logs rejected keys and startup configuration, so refused checks never use a real key and the startup lines are suppressed by a logging override. Keep the ZAP key and database credentials private to the local services that require them.

The ZAP client selects a fixed administration address, supplies its key in a request header, and bounds request duration and response size. Provider failures surface as structured errors. A dropped connection before an HTTP response can make credential rejection indistinguishable from an outage.

## Target scope and consent

Ordinary destination validation checks HTTP(S) syntax and resolved IPv4 and IPv6 addresses. It rejects embedded credentials, loopback, private and other prohibited addresses. Each assessment records consent for its target URL snapshot. Full validation happens when eligibility is shown, when consent is submitted and when a scan starts, which resolves DNS afresh each time. SentinelScan itself never connects to a registered website, so it has no target redirects to follow. ZAP makes its own connections. Scans started in Watchtower run behind the firewall described below. Scans run by hand are not restricted and are accepted for the demo only. Operator association with local demonstration results is a design requirement; it must preserve ordinary destination validation.

Before import, verify that all results belong to the linked provider run and authorized scope. Treat stale IDs, mixed scope, incomplete reads and uncertain terminal outcomes as incomplete work. Explicit evidence of cancellation or failure must survive independently of the finding count.

## Controlled scans

Scan control is a fixed list of server-side ZAP operations. The browser cannot supply a ZAP action, rule, exclusion, policy or address other than the registered one. Registration checks syntax only and authorizes nothing. A scan needs all of these:

| Step | Check |
|---|---|
| Eligibility | http(s), no credentials, canonical root address, public host name, every resolved IPv4 and IPv6 address public, firewall image present |
| Consent | Fresh single-use token for the exact website and address, five minutes, wording version and time stored with the assessment |
| Start | Address resolved and validated again. The firewall is applied and proven before ZAP is used. |
| Before testing | Address validated again and firewall compared |
| During | Firewall compared every 10 seconds; also memory, health, errors, time and any other site in ZAP |
| End | Firewall compared before import, then every destination is locked |

**Firewall.** `sentinelscan-egress-guard:1` joins ZAP's network namespace with NET_ADMIN only and installs kernel rules. ZAP can then open connections only to the validated IPv4 addresses on the one authorized port, plus replies from its own API port. Everything else is refused: private, loopback, link-local and metadata addresses, the database, the gateway, other ports, IPv6 and DNS. The host name is pinned in ZAP's hosts file, so later DNS answers have no effect. ZAP runs without the capability to change any of it. If the rules are missing, for example after a restart of ZAP, the scan is stopped.

**Safety limits for public websites.** Addresses for sign-out, deletion and reset, payment and orders, administration, publishing and messages are excluded from both scans, and ZAP must confirm the exact list. Forms are not submitted during discovery. The demo keeps the settings that its evidence was verified with.

**Limits.** Word lists cannot recognize every dangerous endpoint. A shared address, such as a content delivery network, also serves other websites; their names do not resolve in ZAP and their origins stop the scan, but a connection to that address is not blocked. The rules hold from a scan's start until ZAP restarts; after a restart ZAP is unrestricted until the next scan. A compromised Docker host can remove the rules. Attack traffic may also breach a hosting provider's terms, which the operator must check.

## Optional AI analysis

Disabled by default and server-side only. When enabled and selected, sanitized alert text leaves this machine for the configured provider. See [finding intelligence](finding-intelligence.md).

## Evidence handling

Consent tokens expire after five minutes and are consumed on submission. The backend locks the active target and checks its canonical URL before creating a pending assessment. Import rechecks consent and the provider fingerprint, reads the active run's attributed alert IDs before and after fetching alerts, and validates normalized URLs. A failed final transaction rolls back the saved run observations, findings and completion together. Local tracking cancellation is available for every open assessment and has no effect on the provider process. The session fingerprint is never sent to the browser. A controlled scan attaches its own receipts on the server.

The current normalizer redacts supplied evidence and removes credentials, query strings and fragments from finding URLs. Store only sanitized summaries in project documentation. Exclude raw alerts, scan sessions, reports containing sensitive material, database dumps, Docker volume contents, local configuration and secrets from Git.
