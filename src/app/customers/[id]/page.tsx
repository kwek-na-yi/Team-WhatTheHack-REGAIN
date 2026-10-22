"use client";
// Direct link to one customer's profile (e.g. from the directory). The profile itself lives in
// CustomerProfile and is shared with the Customer Insights page.
import { useParams } from "next/navigation";
import { CustomerProfile } from "@/components/CustomerProfile";
import { ButtonLink, DataGate } from "@/components/ui";

export default function CustomerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(params.id ?? "");
  return (
    <DataGate>
      <CustomerProfile id={id} actions={<ButtonLink href="/customers">Back to directory</ButtonLink>} />
    </DataGate>
  );
}
