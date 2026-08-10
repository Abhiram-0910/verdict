export const ERROR_TRANSLATIONS: Record<string, string> = {
  // ── Capture Pipeline ──────────────────────────────────────────────────────
  // These produce status: 'failed' on the job — no screenshot or findings saved.
  TIMEOUT: "The website took too long to load. It might be down or unusually slow right now.",
  NAVIGATION_ERROR: "We couldn't reach this website. Please check if the URL is correct and publicly accessible.",
  BLOCKED: "This website actively blocked our automated browser (likely via Cloudflare or a Captcha).",

  // ── AI / Critique Agents ──────────────────────────────────────────────────
  // These appear as failureReason when status: 'complete' but an agent failed (partial result).
  AI_TIMEOUT: "The AI took too long to respond. Try running the audit again, or use your own API key to switch providers.",
  AI_RATE_LIMIT: "The AI provider is temporarily overwhelmed — try again in a few minutes, or use your own API key below to skip the wait.",
  AI_MALFORMED_OUTPUT: "The AI generated an invalid response that we couldn't parse. This is a rare hiccup — try running it again.",
  FETCH_FAILED: "We had trouble connecting to the AI provider. Their API might be experiencing downtime.",
  INVALID_API_KEY: "That API key was rejected — double check it's correct and has the right permissions, then try again.",

  // ── Soft Degradation ──────────────────────────────────────────────────────
  // These appear as partialReason on a CaptureSuccess — screenshot + Web Vitals still saved.
  AXE_FAILED: "The website's strict security policy (CSP) blocked our accessibility scanner. Accessibility findings are unavailable, but the visual and copy audit completed normally.",
  FONTS_NOT_READY: "Some fonts were still loading when the screenshot was taken. Visual results may not reflect the fully-rendered state.",

  // ── General ───────────────────────────────────────────────────────────────
  DB_WRITE_FAILED: "We successfully analyzed the page, but encountered a database error while saving the results.",
  UNKNOWN: "An unexpected error occurred during the audit."
};

/**
 * Returns a user-friendly error message for a given failure reason code.
 * Falls back to the raw reason if no translation exists.
 */
export function translateError(reason: string | null | undefined): string {
  if (!reason) return 'Unknown error occurred';
  return ERROR_TRANSLATIONS[reason] || reason;
}
