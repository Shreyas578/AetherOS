import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], variable: "--font-outfit" });

export const metadata: Metadata = {
  title: "AetherOS | Pharos Agent Ecosystem",
  description: "Skill-to-Agent Dual Cascade Dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} ${outfit.variable} dark`}>
      <body className="min-h-screen bg-background font-sans antialiased text-foreground">
        
        {/* Navbar */}
        <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-background/80 backdrop-blur">
          <div className="container flex h-16 items-center justify-between px-4 sm:px-8">
            <div className="flex items-center gap-6 md:gap-10">
              <Link href="/" className="flex items-center space-x-2">
                <div className="relative h-8 w-8 overflow-hidden rounded-full border border-primary/50 bg-primary/20 flex items-center justify-center">
                  <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-primary" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                </div>
                <span className="inline-block font-outfit font-bold text-xl gradient-text">AetherOS</span>
              </Link>
              <nav className="flex gap-6">
                <Link href="/" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                  Overview
                </Link>
                <Link href="/chat" className="text-sm font-medium text-muted-foreground hover:text-primary transition-colors">
                  Orchestrator Chat
                </Link>
              </nav>
            </div>
            <div className="flex items-center space-x-4">
              <div className="hidden sm:flex items-center space-x-1 text-sm text-muted-foreground">
                <span className="relative flex h-3 w-3">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-secondary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-secondary"></span>
                </span>
                <span className="ml-2">Pharos Testnet</span>
              </div>
            </div>
          </div>
        </header>

        <main className="container mx-auto px-4 py-8 sm:px-8">
          {children}
        </main>
      </body>
    </html>
  );
}
