import type { Metadata } from "next";
import { Exo_2, Orbitron } from "next/font/google";
import { Providers } from "@/components/Providers";
import "./globals.css";

const exo = Exo_2({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const orbitron = Orbitron({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
});

export const metadata: Metadata = {
  title: "GateWars",
  description:
    "Local turn-based GateWars remake — Next.js, vector gate visuals, SQLite save.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${exo.variable} ${orbitron.variable} h-full`}>
      <body className="min-h-full antialiased">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
