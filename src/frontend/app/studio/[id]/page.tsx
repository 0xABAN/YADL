"use client";

import { Suspense } from "react";
import { useParams } from "next/navigation";
import Studio from "@/components/Studio";
import { TetrisLoader } from "@/components/ui/loader-tetris";

function Body() {
  const { id } = useParams<{ id: string }>();
  return <Studio id={id} />;
}

export default function Page() {
  return (
    <Suspense
      fallback={
        <div className="shell loading-shell">
          <TetrisLoader cellSize={4} gap={1.5} speed={36} label="Loading" />
        </div>
      }
    >
      <Body />
    </Suspense>
  );
}
