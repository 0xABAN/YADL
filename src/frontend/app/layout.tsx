import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "yadl" };
export const viewport: Viewport = { themeColor: "#000000" };

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" style={{ colorScheme: "dark" }}>
      <body>{children}</body>
    </html>
  );
}
