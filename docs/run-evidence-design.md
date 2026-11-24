# Run evidence contract v1

Status: contract v1.1 approved and verified live on 24 November 2026 with one genuine Juice Shop assessment. Stored as `contract_version` 2; the facts carry `"contract": "1.1"`. The storage migration is applied. Without it, import answers EVIDENCE_STORAGE_UNAVAILABLE.

## Contract v1.1 exceptions

Exactly two, fixed in `src/integrations/zap/exceptions.ts`. They are not configurable, and anything else stays UNKNOWN. Each is recomputed when evidence is judged, must be identical in both collections, and is stored and reported.

| Rule | Behavior | Accepted only if |
|---|---|---|
| 90034 Cloud Metadata | Forges the Host header of requests to the target | Every request address is on the authorized origin; exactly 13 differing messages; `scanProgress` and the log each count 13; each value is one of six fixed values; each request falls inside the rule's logged start and end |
| 20015 Heartbleed | Raw-socket probes without a stored message | Reported requests exceed stored messages by exactly 3; `scanProgress` and the log each count 3; the rule completed |

Both also need one scan host equal to the authorized origin, an undisturbed log, and equal request totals over all rules in `scanProgress` and the log. The counts depend on the target and the installed rules. A different target, add-on version or policy may produce other counts, and is then refused.

Limits: a Host header does not show where a connection went, and neither does a response body. The raw probes have no record of their own; only the scan host and the rule's counts support their destination.

## Why listings are not enough

Verified in the installed ZAP 2.17.0 bytecode: both run listings lack a URL, and both a stopped and a completed run read FINISHED. The inventory adapter therefore still reports UNKNOWN. Only contract evidence can produce SUCCEEDED.

## Evidence required for SUCCEEDED

Every row must hold, for both runs where applicable. A missing, contradictory, duplicated or truncated item gives UNKNOWN.

| # | Evidence | Source | Rule |
|---|---|---|---|
| 1 | Session | Docker inspect and ZAP session location | Fingerprint equals the stored receipt before and after collection |
| 2 | Receipt | PostgreSQL | Saved during the same session, and not before the run started |
| 3 | Spider end | ZAP log | One start on the exact target and one `Spider scanning complete: true`, with no `Stopping spidering process by request` |
| 4 | Active end | ZAP log | One `started` and one `completed` for the ID. No `scanner with ID N stopped`, `stopped host/plugin` or `An error occurred while active scanning` |
| 4a | Uniqueness | ZAP log | Exactly one spider and one active scan in the session. Rule and host lines carry no scan ID, so a second scan makes attribution impossible. |
| 5 | Rules | ZAP log and `scanProgress` | No pending, running or unknown rule. Completed and skipped counts agree. Skipped rules are stored and disclosed. |
| 6 | Scope | Log host and `scanProgress` | Exactly one host, equal to the authorized origin |
| 7 | Messages | `messagesIds` and each message | Every attributed message read, all inside the origin, the ID set unchanged, and as many as the listing's `reqCount`, apart from the v1.1 exceptions |
| 8 | Findings | `alertsIds` and each alert | Existing rules: complete, in scope, ID set unchanged, and its size equal to the listing's `alertCount` |
| 9 | Listing | Run listings | FINISHED and 100 for both. Necessary, never sufficient |

`scanner ... completed` alone proves nothing: ZAP also writes it after a stop or an error. `scanProgress` alone proves little: a stop during the last rules can look complete.

## Outcomes

| Evidence | Outcome |
|---|---|
| All rows hold | SUCCEEDED |
| Explicit stop for this ID | CANCELLED |
| Explicit thread error for this ID | FAILED |
| Anything else, including a killed container, rotated log or restarted session | UNKNOWN |

A rule skipped by time limit or by the operator reduces coverage and gives UNKNOWN. The absence of an out-of-band (OAST) service is accepted and disclosed.

## Collector

- Read-only, server-side, no new browser input. Reads `docker logs` for the fingerprinted container ID and the existing ZAP views.
- Log window: from the container's first line. The container's startup marker must be present, otherwise the log was truncated. The current `local` driver rotates at about 100 MB; the 23 November log is far below that.
- A new session inside the container resets the window, because scan IDs restart per session. The session file must be created and named in the log, and equal ZAP's current session location.
- Only anchored lines with the expected thread, level and logger are parsed. Output is bounded, and lines are never stored raw or shown.
- The key must not be present in the window. `zap-log4j2.properties` suppresses the line that contains it.

## Log trust

Scanned sites influence some log text, so a forged line is conceivable. Mitigations: anchored parsing, refusal of duplicate or contradictory lifecycle lines, agreement with the authenticated API on rule counts, host and alerts. The remaining risk is a local operator or a compromised ZAP, which the local-only security model already trusts.

## Storage

An additive `run_evidence` table: assessment, kind, contract version, session key, collection time, structured facts, reason codes, outcome, SHA-256 digest of the canonical facts. A trigger rejects updates and deletes. No URLs beyond the origin, no headers, bodies, keys or log lines.

The digest detects accidental change. It does not protect against someone with database write access.

## Import

1. Check consent, scope, receipts and status, as today.
2. Collect evidence, read findings, collect evidence again. Facts must be identical.
3. In one transaction: lock the assessment, recheck, insert evidence, insert findings, set COMPLETED. Trustworthy evidence of a stop or error instead stores that evidence, sets CANCELLED or FAILED and imports nothing.
4. A repeat returns the stored result without provider access. Any failure rolls everything back.

## Verified and unverified

Verified live: the `scanProgress` shape and its agreement with the log, retained temporary messages, and `reqCount` as stored messages plus raw probes. Not verified: whether reaching the spider's maximum duration also logs `complete: true` (no maximum is configured).

## Operator rules for an importable run

1. Use a container whose log does not contain the API key (after rotation with `zap-log4j2.properties`).
2. Create a new named ZAP session first. Run exactly one spider, then one active scan.
3. Save each receipt after that run starts and while the container is untouched.
4. Do not stop, pause past a limit or restart anything. Do not start another scan in that session.
5. Rehearse with `npm.cmd run inspect:zap -- --evidence <spider id> <active id>`. It reads only and prints facts and missing evidence, without checking receipts.
