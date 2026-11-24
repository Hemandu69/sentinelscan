export class ApiError extends Error {
  readonly status: number;
  // Fixed codes only. Never provider text.
  readonly reasons: readonly string[];
  constructor(status: number, code: string, reasons: readonly string[] = []) {
    super(code);
    this.status = status;
    this.reasons = reasons;
  }
}
