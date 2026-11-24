import { z } from "zod";

export const promptVersion = "1";
const text = (max: number) => z.string().trim().min(1).max(max);
export const priorities = ["NO_ACTION", "LOW", "MEDIUM", "HIGH", "URGENT"] as const;

// The model returns plain text fields only. Severity, confidence, scope and evidence are
// absent on purpose: they come from the scanner record and can never be supplied here.
export const analysisSchema = z.strictObject({
  plainTitle: text(120),
  summary: text(400),
  whatHappened: text(1500),
  whyItMatters: text(1500),
  technicalExplanation: text(2000),
  potentialImpact: text(1200),
  practicalPriority: z.enum(priorities),
  priorityReason: text(600),
  recommendedAction: text(400),
  remediation: z.array(text(600)).max(8),
  verificationSteps: z.array(text(600)).min(1).max(8),
  falsePositiveNotes: text(1000),
  limitations: text(1000),
  evidenceSufficient: z.boolean(),
  exampleCode: z.nullable(text(2000)),
});
export type Analysis = z.infer<typeof analysisSchema>;

export type AnalysisInput = {
  alertName: string;
  description: string;
  scannerSeverity: string;
  scannerConfidence: string;
  ruleId: string | null;
  method: string | null;
  parameter: string | null;
  affectedUrls: string[];
  evidence: string | null;
  scannerRemediation: string | null;
  references: string[];
  cweId: number | null;
  wascId: number | null;
};
