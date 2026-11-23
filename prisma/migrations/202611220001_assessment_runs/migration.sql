CREATE TABLE assessment_runs (
 assessment_id UUID NOT NULL REFERENCES assessments(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 kind TEXT NOT NULL CHECK (kind IN ('spider','active')),
 session_key TEXT NOT NULL CHECK (session_key ~ '^[0-9a-f]{64}$'),
 scan_id TEXT NOT NULL CHECK (scan_id ~ '^[0-9]{1,12}$'),
 state TEXT,
 progress INTEGER CHECK (progress BETWEEN 0 AND 100),
 associated_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 observed_at TIMESTAMPTZ(3) NOT NULL,
 PRIMARY KEY (assessment_id,kind),
 UNIQUE (session_key,kind,scan_id)
);
