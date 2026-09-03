"use client";

import { Suspense } from "react";
import Auth from "@/modules/auth/Auth";

export default function Home() {
  return (
    <div className="create auth">
      <header>
        <a className="word" href="/auth">yadl.</a>
      </header>
      <div className="body">
        <Suspense>
          <Auth />
        </Suspense>
      </div>
    </div>
  );
}
