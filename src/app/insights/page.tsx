"use client";
// Customer Insights. /insights is the overview of the whole customer base; /insights?id=<customer> is
// that customer's profile (the same CustomerProfile used by /customers/[id]). The URL is the source of
// truth, so browser back/forward, the sidebar link and Copilot links all land on the right view.
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { useApp } from "@/components/AppProvider";
import { CustomerProfile } from "@/components/CustomerProfile";
import { InsightsOverview } from "@/components/InsightsOverview";
import { Button, CustomerPicker, DataGate } from "@/components/ui";

export default function InsightsPage() {
  return (
    <Suspense fallback={null}>
      <DataGate>
        <Inner />
      </DataGate>
    </Suspense>
  );
}

function Inner() {
  const { dispatch, analysis } = useApp();
  const router = useRouter();
  const qid = useSearchParams().get("id");
  const id = qid && analysis.byId[qid] ? qid : null;

  const open = (cid: string) => {
    dispatch({ type: "SELECT_CUSTOMER", customerId: cid });
    router.push(`/insights?id=${encodeURIComponent(cid)}`);
  };
  const choose = (cid: string) => {
    dispatch({ type: "SELECT_CUSTOMER", customerId: cid });
    router.replace(`/insights?id=${encodeURIComponent(cid)}`, { scroll: false });
  };

  if (!qid) return <InsightsOverview onOpen={open} />;
  // An unknown ID falls through to CustomerProfile, which shows its own "not found" state.
  return (
    <CustomerProfile
      id={id ?? qid}
      actions={
        <>
          <Button onClick={() => router.push("/insights")}>All customers</Button>
          <CustomerPicker value={id} onChange={choose} />
        </>
      }
    />
  );
}
