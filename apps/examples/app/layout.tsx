import type { Metadata } from "next";
import { Geist, IBM_Plex_Mono, IBM_Plex_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import "./globals.css";

const geist = Geist({ subsets: ["latin"], variable: "--font-sans" });

const plexSerif = IBM_Plex_Serif({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-serif",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
});

export const metadata: Metadata = {
  title: "workflow-ai-sdk examples",
  description: "Example routes and UI for workflow-ai-sdk",
};

export default function RootLayout(props: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={cn(
        "font-sans",
        geist.variable,
        plexSerif.variable,
        plexMono.variable,
      )}
    >
      <body>{props.children}</body>
    </html>
  );
}
