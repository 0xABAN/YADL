"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import Studio from "@/components/Studio";
import { TetrisLoaderCard } from "@/components/ui/loader-tetris-card";

function Body() {
  const { id } = useParams<{ id: string }>();
  return <Studio id={id} />;
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="shell loading-shell">
          <TetrisLoaderCard />
        </div>
      }
    >
      <Body />
    </Suspense>
  );
}
