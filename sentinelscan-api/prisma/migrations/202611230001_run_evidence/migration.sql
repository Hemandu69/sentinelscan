CREATE TABLE run_evidence (
 assessment_id UUID NOT NULL,
 kind TEXT NOT NULL,
 contract_version INTEGER NOT NULL CHECK (contract_version >= 1),
 session_key TEXT NOT NULL CHECK (session_key ~ '^[0-9a-f]{64}$'),
 outcome TEXT NOT NULL CHECK (outcome IN ('SUCCEEDED','FAILED','CANCELLED','UNKNOWN')),
 reasons TEXT[] NOT NULL,
 facts JSONB NOT NULL,
 facts_digest TEXT NOT NULL CHECK (facts_digest ~ '^[0-9a-f]{64}$'),
 collected_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY (assessment_id,kind),
 FOREIGN KEY (assessment_id,kind) REFERENCES assessment_runs(assessment_id,kind) ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE FUNCTION run_evidence_is_insert_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'run_evidence is insert-only';
END
$$;
CREATE TRIGGER run_evidence_insert_only BEFORE UPDATE OR DELETE ON run_evidence
 FOR EACH ROW EXECUTE FUNCTION run_evidence_is_insert_only();
