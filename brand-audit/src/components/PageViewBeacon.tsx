"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/client-analytics";

/** Fires one funnel event on mount (spec section 27). */
export function PageViewBeacon({ name, auditId }: { name: string; auditId?: string }) {
  useEffect(() => {
    trackEvent(name, auditId);
  }, [name, auditId]);
  return null;
}
