# Demonstration guide

## Show

1. Overview: real counts, latest assessment, service health.
2. Websites, Local Juice Shop: history of assessments.
3. Security Scans: the start dialog with exact address, consent, configuration and readiness. Starting a scan takes about six minutes and ends ZAP's previous session.
4. AI Analysis: plain explanation, next step, coverage. It states honestly that AI is not configured.
5. Findings: the original ZAP records behind it.
6. Reports: preview and download the PDF.

## Verified

| Claim | Evidence |
|---|---|
| One genuine assessment, 24 November 2026 (`83ee2301…`) | 24 attributed alerts became 2 informational findings, one issue at two locations |
| Repeat import changes nothing | Repeated against the real database |
| Firewall blocks every other destination | Checked inside the real ZAP network with the kernel's refusal counter, without a scan |
| Controlled start and stop | One operator-started Juice Shop scan was stopped from Watchtower and recorded as Cancelled. That was before the firewall existed. |
| Everything else | Fixture tests |

## Disclose

- No complete scan has run behind the firewall yet.
- Passive alerts are not imported. DOM-based XSS (rule 40026) is not tested. One rule was skipped because no out-of-band service is selected. This is not full OWASP coverage.
- The absence of a finding does not show that the website is secure. There is no security score.
- The scan of 22 November keeps outcome UNKNOWN.
- The Spider uses ZAP's 48 threads. The two-thread limit applies to the Active Scan.
- On 24 November one operator-started Spider of hemandu.com ran behind the firewall for eight seconds (`b4e125c5…`). It stopped itself and imported nothing. Public scanning has been removed since.
- Scans are limited to Juice Shop. Other websites can be registered for reference only.

## Check the result independently

From the infrastructure checkout:

```powershell
$id = '83ee2301-c70b-4c6b-b66d-b8f275d066f0'
"SELECT status,finished_at FROM sentinelscan.assessments WHERE id='$id'; SELECT normalized_severity,count(*) FROM sentinelscan.findings WHERE assessment_id='$id' GROUP BY 1;" | docker --context desktop-linux compose exec -T postgres psql -X -U sentinel -d sentinelscan
```

An existing database is migrated only with `.\verify-and-migrate.ps1 -AssessmentId <id>` from the API checkout, which backs it up first. This needs a decision by the owner.
