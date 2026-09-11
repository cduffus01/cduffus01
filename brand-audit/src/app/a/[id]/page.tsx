import { notFound } from "next/navigation";
import { AuditView } from "@/components/AuditView";
import { getStore } from "@/lib/store";

export const dynamic = "force-dynamic";

/**
 * One URL for waiting and for results, so a finished audit is shareable
 * (spec section 31) and there is no redirect flash mid-audit.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{6,64}$/i.test(id)) return { title: "Brand Audit" };
  const audit = await getStore().getAudit(id);
  if (!audit) return { title: "Brand Audit" };
  return {
    title:
      audit.status === "complete" && audit.brandScore !== null
        ? `${audit.domain} — Brand Score ${audit.brandScore}`
        : `Auditing ${audit.domain}…`,
    description: audit.summary?.verdict ?? "Brand consistency audit.",
  };
}

export default async function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[a-f0-9]{6,64}$/i.test(id)) notFound();

  // Server-rendered first paint avoids a blank frame before the first poll.
  const audit = await getStore().getAudit(id);
  if (!audit) notFound();

  return <AuditView id={id} initial={audit} />;
}
