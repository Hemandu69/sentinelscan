export const categories = [
  "CRITICAL",
  "HIGH",
  "MEDIUM",
  "LOW",
  "INFO",
  "OTHER",
] as const;
export type Dashboard = {
  totalChecks: number;
  completedChecks: number;
  findingCount: number;
  severityCounts: Record<(typeof categories)[number], number>;
};
function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function readDashboard(body: unknown): Dashboard {
  const data = body as Partial<Dashboard> | null;
  const counts = data?.severityCounts;
  if (
    !counts ||
    !isCount(data?.totalChecks) ||
    !isCount(data.completedChecks) ||
    !isCount(data.findingCount) ||
    data.completedChecks > data.totalChecks ||
    (!data.completedChecks && data.findingCount > 0) ||
    !categories.every((key) => isCount(counts[key])) ||
    categories.reduce((sum, key) => sum + counts[key], 0) !== data.findingCount
  )
    throw new Error("Invalid dashboard response.");
  return {
    totalChecks: data.totalChecks,
    completedChecks: data.completedChecks,
    findingCount: data.findingCount,
    severityCounts: counts,
  };
}
