# Finding intelligence

ZAP scans. SentinelScan verifies, stores and explains. Explanations are a layer on top of imported findings and never change them.

## Where each text comes from

| Label | Source |
|---|---|
| Scanner record | Imported ZAP alert: title, severity, confidence, location, parameter, evidence, references. Immutable here. |
| SentinelScan guide | Short texts in `src/modules/issues/guides.ts`, written by rule. General knowledge, not a statement about a website. Only rule 10104 has one so far. |
| AI interpretation | Optional model output. Always labelled, with provider, model and time. |

A card uses AI text if the issue is analysed, otherwise the guide, otherwise the scanner's own text.

## Issues

Findings form one issue only if assessment, rule, title, severity, confidence, method, parameter, description, remediation and weakness IDs are all equal. Only locations may differ. Records are never merged or deleted. Counts are shown separately: original alerts (from verified run evidence), imported findings, issues and affected locations.

| Route | Purpose |
|---|---|
| GET /api/v1/issues?assessmentId= | Issues of completed assessments, counts, AI coverage |
| GET /api/v1/analysis/status | Whether AI and its storage are available. No secrets. |
| POST /api/v1/assessments/:id/issues/:key/analysis | Analyse one issue. Empty body. A finished analysis is returned without another provider call. |

## AI analysis

Disabled by default. Enable it in the private API `.env`:

| Variable | Meaning |
|---|---|
| SENTINELSCAN_AI_PROVIDER | `anthropic` to enable. Empty disables. |
| ANTHROPIC_API_KEY | Required. Calls are billed by Anthropic. |
| SENTINELSCAN_AI_MODEL | Default `claude-opus-5-5` |
| SENTINELSCAN_AI_TIMEOUT_MS | Default 120000 |

The dependency is the official `@anthropic-ai/sdk` 1.13.0, used only on the server with a fixed address. Ambient credentials, profiles and base URLs are ignored. Refused requests may be answered by a fallback model that Anthropic chooses; the model that answered is recorded. Analysis starts only when the operator selects it.

**Sent:** alert title, description, severity, confidence, rule, method, parameter, affected URLs without query or fragment, redacted evidence, scanner remediation, references, weakness IDs. **Never sent:** keys, cookies, tokens, sessions, fingerprints, database values, assessment IDs, response bodies. Pattern redaction is a second line of defense and cannot recognize every secret.

**Accepted only if** the answer is JSON of the exact shape and contains no markup, unknown URL, unknown endpoint, unknown CVE or CWE, or claim of an applied fix, and its priority does not exceed what the scanner severity allows. Code examples are removed, because the technology is unknown. An unusable answer is retried once. An analysis whose input no longer matches the stored finding is shown as outdated. These checks cannot prove that an explanation is right.

Scanner text is untrusted. It is escaped, passed as data and rendered as plain text. Instructions inside it cannot change severity, status or scope, because the model has no such fields.

**Storage:** `finding_analyses` (migration `202611240001_finding_analyses`, **not applied yet**), one row per finding, bound to a digest of the exact input and prompt version. Changed input makes a stored analysis invisible. Without the table, the rest of the product works and analysis is unavailable.

## Reports

Reports regroup the verified findings and are withheld if any finding is missing, repeated or different. They mark AI text and stay complete without it. A stored PDF is shown as outdated once the layout or an analysis changes.
