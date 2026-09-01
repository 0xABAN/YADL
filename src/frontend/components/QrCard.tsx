"use client";

import { useEffect, useState } from "react";
import QR from "qrcode";

/** Side panel: QR for opening the same URL on a phone. */
export default function QrCard({
  url,
  title = "Scan on mobile",
}: {
  url: string;
  title?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!url) {
      setSrc(null);
      return;
    }
    let alive = true;
    QR.toDataURL(url, {
      width: 96,
      margin: 1,
      color: { dark: "#000000", light: "#ffffff" },
      errorCorrectionLevel: "M",
    }).then((d) => {
      if (alive) setSrc(d);
    });
    return () => {
      alive = false;
    };
  }, [url]);

  return (
    <div className="qr-side">
      <h2>{title}</h2>
      <div className="qr-frame">
        {src ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={src} alt={`QR code for ${url}`} width={96} height={96} />
        ) : (
          <span className="qr-ph" aria-hidden="true" />
        )}
      </div>
    </div>
  );
}
