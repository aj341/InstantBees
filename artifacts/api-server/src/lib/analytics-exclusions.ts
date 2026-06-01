export const EXCLUDED_ANALYTICS_EMAILS = new Set([
  "aj@commercialgrowth.com.au",
]);

export function isExcludedAnalyticsEmail(email: string | null | undefined): boolean {
  return EXCLUDED_ANALYTICS_EMAILS.has(String(email ?? "").trim().toLowerCase());
}
