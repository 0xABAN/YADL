"use client";

import Auth from "@/components/Auth";

export default function Home() {
  return (
    <div className="create auth">
      <header>
        <a className="word" href="/">YADL+</a>
      </header>
      <div className="body">
        <Auth />
      </div>
    </div>
  );
}
