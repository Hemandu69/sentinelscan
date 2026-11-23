CREATE TABLE targets (
 id UUID PRIMARY KEY,
 display_name TEXT NOT NULL,
 canonical_url TEXT NOT NULL,
 created_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 archived_at TIMESTAMPTZ(3)
);
CREATE UNIQUE INDEX targets_active_url ON targets(canonical_url) WHERE archived_at IS NULL;

CREATE TABLE assessments (
 id UUID PRIMARY KEY,
 target_id UUID NOT NULL REFERENCES targets(id) ON UPDATE CASCADE ON DELETE RESTRICT,
 target_url_snapshot TEXT NOT NULL,
 authorization_confirmed_at TIMESTAMPTZ(3) NOT NULL,
 authorization_text_version TEXT NOT NULL,
 source TEXT NOT NULL,
 status TEXT NOT NULL,
 requested_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 started_at TIMESTAMPTZ(3),
 finished_at TIMESTAMPTZ(3),
 error_code TEXT
);
CREATE INDEX assessments_target_id_requested_at_idx ON assessments(target_id,requested_at);

CREATE TABLE findings (
 id UUID PRIMARY KEY,
 assessment_id UUID NOT NULL REFERENCES assessments(id) ON UPDATE CASCADE ON DELETE RESTRICT,
 fingerprint TEXT NOT NULL,
 source_rule_id TEXT,
 name TEXT NOT NULL,
 source_severity TEXT NOT NULL,
 normalized_severity TEXT NOT NULL,
 confidence TEXT NOT NULL,
 url TEXT NOT NULL,
 method TEXT,
 parameter TEXT,
 redacted_evidence TEXT,
 description TEXT NOT NULL,
 remediation TEXT,
 "references" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 cwe_id INTEGER,
 wasc_id INTEGER,
 first_observed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE (assessment_id,fingerprint)
);
CREATE INDEX findings_assessment_id_normalized_severity_idx ON findings(assessment_id,normalized_severity);
CREATE TABLE reports (
 id UUID PRIMARY KEY,
 assessment_id UUID NOT NULL REFERENCES assessments(id) ON UPDATE CASCADE ON DELETE RESTRICT,
 generated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 format TEXT NOT NULL,
 template_version TEXT NOT NULL,
 content_digest TEXT NOT NULL,
 storage_key TEXT NOT NULL UNIQUE
);
CREATE INDEX reports_assessment_id_generated_at_idx ON reports(assessment_id,generated_at);
