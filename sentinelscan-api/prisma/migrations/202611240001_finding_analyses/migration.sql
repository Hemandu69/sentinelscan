CREATE TABLE finding_analyses (
 finding_id UUID PRIMARY KEY REFERENCES findings(id) ON DELETE RESTRICT ON UPDATE CASCADE,
 status TEXT NOT NULL CHECK (status IN ('COMPLETED','FAILED')),
 input_digest TEXT NOT NULL CHECK (input_digest ~ '^[0-9a-f]{64}$'),
 prompt_version TEXT NOT NULL,
 provider TEXT NOT NULL,
 model TEXT NOT NULL,
 result JSONB,
 error_code TEXT,
 analysed_at TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CHECK ((status = 'COMPLETED') = (result IS NOT NULL)),
 CHECK ((status = 'FAILED') = (error_code IS NOT NULL))
);
