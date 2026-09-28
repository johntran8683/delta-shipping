"use client";

import { useParams } from "next/navigation";
import { ManualDnForm } from "@/components/manual-dn-form";

export default function EditDeliveryNotePage() {
  const params = useParams<{ id: string }>();
  return <ManualDnForm mode="edit" dnId={params.id} />;
}
