export type RunOutcome = "RUNNING" | "SUCCEEDED" | "FAILED" | "CANCELLED" | "UNKNOWN";

// Both APIs collapse distinct terminal causes into FINISHED. An inventory
// observation can confirm activity but cannot attest to a successful import.
export function inventoryOutcome(state: unknown): RunOutcome {
  return state === "RUNNING" ? "RUNNING" : "UNKNOWN";
}
