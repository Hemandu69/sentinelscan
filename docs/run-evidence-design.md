# Run evidence contract v1

Status: approved on 23 November 2026 and implemented offline. Verified with fixtures, including sanitized lifecycle lines from a real run. Not verified against live ZAP. The storage migration `202611230001_run_evidence` was applied to the existing workspace on 23 November 2026 after a verified backup, with existing rows unchanged. Without it, import answers EVIDENCE_STORAGE_UNAVAILABLE.

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
| 7 | Messages | `messagesIds` and each message | Every attributed message read, all inside the origin, the ID set unchanged, and as many as the listing's `reqCount` |
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

## Unverified until a live run

- The JSON shape of `scanProgress`, and whether it agrees with the log.
- Whether `persistTemporaryMessages` is enabled. If it is not, `messagesIds` is incomplete and row 7 must fail.
- Whether reaching the spider's maximum duration also logs `complete: true`.
- Whether `reqCount` should equal the number of message IDs.

## Operator rules for an importable run

1. Use a container whose log does not contain the API key (after rotation with `zap-log4j2.properties`).
2. Create a new named ZAP session first. Run exactly one spider, then one active scan.
3. Save each receipt after that run starts and while the container is untouched.
4. Do not stop, pause past a limit or restart anything. Do not start another scan in that session.
5. Rehearse with `npm.cmd run inspect:zap -- --evidence <spider id> <active id>`. It reads only and prints facts and missing evidence, without checking receipts.
