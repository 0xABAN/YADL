"use client";

import React, { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function Auth() {
  const router = useRouter();
  const params = useSearchParams();
  const [login, setLogin] = useState(true);
  const [err, setErr] = useState<string | null>(params.get("err") === "github" ? "GitHub sign-in failed." : null);
  const [busy, setBusy] = useState(false);
  const go = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (busy) return;
    const fd = new FormData(e.currentTarget);
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(login ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: String(fd.get("email") || ""),
          password: String(fd.get("password") || ""),
          name: String(fd.get("name") || ""),
        }),
      });
      if (r.status === 409) {
        setErr("Email already registered.");
        return;
      }
      if (!r.ok) {
        setErr(login ? "Wrong email or password." : "Could not sign up.");
        return;
      }
      router.push("/create");
    } finally {
      setBusy(false);
    }
  };

  const socialBtn: React.CSSProperties = {
    width: "100%",
    padding: "0.65rem",
    borderRadius: 6,
    border: "1px solid #333",
    background: "transparent",
    color: "#fff",
    fontWeight: 500,
    fontSize: "0.875rem",
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: "0.5rem",
    marginBottom: "0.4rem",
  };
  const input: React.CSSProperties = {
    width: "100%",
    padding: "0.65rem 0.85rem",
    borderRadius: 6,
    border: "1px solid #333",
    background: "#000",
    color: "#fff",
    fontSize: "0.875rem",
    outline: "none",
  };
  const primary: React.CSSProperties = {
    width: "100%",
    padding: "0.65rem",
    borderRadius: 6,
    border: "none",
    background: "#ededed",
    color: "#000",
    fontWeight: 500,
    fontSize: "0.875rem",
    cursor: "pointer",
  };
  const link: React.CSSProperties = {
    color: "#fff",
    fontWeight: 500,
    background: "none",
    border: "none",
    padding: 0,
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: "inherit",
  };

  const GitHubIcon = (
    <svg viewBox="0 0 24 24" fill="currentColor" style={{ width: 16, height: 16, flexShrink: 0 }}>
      <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.699-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.379.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.577.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" />
    </svg>
  );

  return (
    <div className="sheet">
      <div style={{ width: "100%", maxWidth: 540, display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center" }}>
        <div style={{ background: "#111", width: 44, height: 44, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: "1.15rem", marginBottom: "0.75rem", border: "1px solid #333" }}>Y+</div>
        <h1 style={{ fontSize: "1.35rem", fontWeight: 600, marginBottom: "0.25rem", letterSpacing: "-0.025em" }}>{login ? "Sign in to Account" : "Sign up for Account"}</h1>
        <p style={{ fontSize: "0.85rem", color: "#888", marginBottom: "0.85rem", lineHeight: 1.5 }}>{login ? "Sign in to your Account." : "Create a new account to get started."}</p>

        <form onSubmit={go} style={{ width: "100%", display: "flex", flexDirection: "column", gap: "0.65rem" }}>
          {!login && <input style={input} name="name" type="text" placeholder="Full Name" required />}
          <input style={input} name="email" type="email" placeholder="name@work-email.com" required />
          <input style={input} name="password" type="password" placeholder="Password" required />
          {err && <small className="err">{err}</small>}
          <button type="submit" style={primary} disabled={busy}>{login ? "Continue with Email" : "Sign Up with Email"}</button>
        </form>

        <div style={{ height: 1, background: "#222", width: "100%", margin: "0.85rem 0" }} />

        <a href="/api/auth/github" style={{ ...socialBtn, marginBottom: 0, textDecoration: "none" }}>{GitHubIcon}{login ? "Continue with GitHub" : "Sign up with GitHub"}</a>

        <div style={{ marginTop: "1.25rem", fontSize: "0.875rem", color: "#888" }}>
          {login ? "Don't have an account? " : "Already have an account? "}
          <button type="button" onClick={() => setLogin(!login)} style={link}>{login ? "Sign Up" : "Sign In"}</button>
        </div>
        <div style={{ marginTop: "0.85rem", fontSize: "0.75rem", color: "#666", lineHeight: 1.5, textAlign: "center" }}>
          By proceeding, you agree to creating a YADL+ account
          <br />
          subject to our{" "}
          <a href="#" style={{ color: "#888" }}>Terms of Service</a> and <a href="#" style={{ color: "#888" }}>Privacy Policy</a>.
        </div>
      </div>
    </div>
  );
}
