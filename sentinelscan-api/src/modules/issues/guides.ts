// Short explanations written for SentinelScan. They are general knowledge about a scanner rule,
// not AI output and not a statement about a particular website. Rules without a guide use
// the scanner's own text.
export type Guide = {
  plainTitle: string;
  summary: string;
  whatHappened: string;
  whyItMatters: string;
  nextAction: string;
  verify: string[];
};
const guides: Record<string, Guide> = {
  "10104": {
    plainTitle: "The site responds differently to different browsers",
    summary:
      "The scanner received a different response when it changed the browser name it sent. This is often harmless.",
    whatHappened:
      "Every browser introduces itself with a User-Agent header. The scanner repeated a request with other User-Agent values, such as an old browser or a search engine, and the response was not identical to the original one.",
    whyItMatters:
      "Different responses can be intended, for example a mobile version or a changing part of a page. It deserves a look only if a particular browser name reveals content, features or error details that other visitors should not see. The alert alone does not show that this happens.",
    nextAction: "Compare the responses once. If the differences are intended, no change is needed.",
    verify: [
      "Request the affected location with your normal browser and again with another User-Agent value, on a site you are authorized to test.",
      "Compare the status and the content. Repeat the same request twice first, because pages that always change will differ anyway.",
      "Check that no version shows private content, debug output or an administration feature.",
    ],
  },
};
export const guideFor = (ruleId: string | null) =>
  ruleId !== null && Object.hasOwn(guides, ruleId) ? guides[ruleId] : null;
