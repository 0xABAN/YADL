"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import Studio from "@/components/Studio";

function Body() {
  const { id } = useParams<{ id: string }>();
  return <Studio id={id} />;
}

export default function Page() {
  return (
    <Suspense fallback={<div className="shell loading-shell">Loading…</div>}>
      <Body />
    </Suspense>
  );
}
