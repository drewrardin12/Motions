import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MOTIONS — Your day, in order",
  description: "A visual, shared home rhythm for the moments that repeat.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}<script dangerouslySetInnerHTML={{__html:`if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('./sw.js'))}`}} /></body>
    </html>
  );
}
