import { randomUUID } from "node:crypto";
import { ApiError } from "../../lib/errors.ts";
export const wording =
  "I own this website or have explicit permission to perform security testing on it.";
export const version = "2";
// Consent given under an earlier wording stays valid for the assessment it was given for.
export const acceptedVersions = ["1", version];
export function confirmations(now = Date.now) {
  const pending = new Map<
    string,
    { targetId: string; url: string; expires: number }
  >();
  return {
    issue(targetId: string, url: string) {
      for (const [key, item] of pending) {
        if (item.expires > now()) break;
        pending.delete(key);
      }
      if (pending.size >= 2048) throw new ApiError(429, "CONFIRMATION_LIMIT");
      const token = randomUUID(),
        expires = now() + 300000;
      pending.set(token, { targetId, url, expires });
      return { token, wording, version, url, expiresAt: new Date(expires) };
    },
    consume(token: string, targetId: string, url: string) {
      const item = pending.get(token);
      if (
        !item ||
        item.expires <= now() ||
        item.targetId !== targetId ||
        item.url !== url
      )
        throw new ApiError(409, "NEW_CONFIRMATION_REQUIRED");
      pending.delete(token);
    },
  };
}
