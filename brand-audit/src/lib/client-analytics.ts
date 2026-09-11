"use client";

const sent = new Set<string>();

/** Fire-and-forget funnel instrumentation; never blocks or throws. */
export function trackEvent(
  name: string,
  auditId?: string,
  props: Record<string, string | number | boolean> = {},
): void {
  const key = `${name}:${auditId ?? ""}:${JSON.stringify(props)}`;
  // De-duplicate per page load so React strict-mode double effects and repeated
  // interactions don't distort the funnel.
  if (sent.has(key)) return;
  sent.add(key);

  const body = JSON.stringify({ name, auditId, props });
  try {
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([body], { type: "application/json" }));
      return;
    }
  } catch { /* fall through to fetch */ }
  void fetch("/api/events", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    keepalive: true,
  }).catch(() => undefined);
}
