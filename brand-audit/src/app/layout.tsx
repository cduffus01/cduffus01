import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Brand Audit — See if your website is on-brand",
  description:
    "Paste your website. We'll find inconsistent fonts, colors, components and visual styles — and show you how to fix them.",
  openGraph: {
    title: "See if your website is on-brand.",
    description:
      "Paste your website. We'll find inconsistent fonts, colors, components and visual styles.",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbf9" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
