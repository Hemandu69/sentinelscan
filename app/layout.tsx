import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "The Watchtower · SentinelScan",
  description:
    "Monitor registered websites and review security checks in your local workspace.",
};
const themeInit =
  "try{document.documentElement.dataset.theme=localStorage.getItem('watchtower-theme')==='dark'?'dark':'light'}catch{}";
export default function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
