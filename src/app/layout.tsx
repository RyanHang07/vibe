import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { TRPCReactProvider } from "@/trpc/client";
import { Toaster } from "@/components/ui/sonner";
import { ThemeProvider } from "next-themes";
import { ClerkProvider } from "@clerk/nextjs";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Datum",
  description:
    "Generated code, actually checked. Every generation is type-checked and bundled in a sandbox before it claims to work.",
  icons: {
    icon: "/logo.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <ClerkProvider
      appearance={{
        variables: {
          // Deep indigo, matching --datum-indigo. Clerk's appearance API
          // takes a plain colour string, so this cannot read the CSS
          // variable and has to be kept in step by hand.
          colorPrimary: "#3a2fa0",
        }
      }}
    >
      <TRPCReactProvider>
        <html lang="en" suppressHydrationWarning>
          {/*
            General Sans, the freely-licensed stand-in for the reference
            site's Aeonik Pro. Loaded here rather than through an `@import`
            in globals.css: `@import "tailwindcss"` expands inline, so a
            font import written after it is no longer at the top of the
            generated stylesheet, and CSS rejects that outright.

            Fontshare has no `next/font` provider, so this is a plain link
            with preconnects. `display=swap` means text renders in the
            fallback grotesk immediately rather than waiting on the font.
          */}
          <head>
            <link rel="preconnect" href="https://api.fontshare.com" />
            <link rel="preconnect" href="https://cdn.fontshare.com" crossOrigin="" />
            <link
              rel="stylesheet"
              href="https://api.fontshare.com/v2/css?f%5B%5D=general-sans@400,500,600,700&display=swap"
            />
          </head>
          <body
            className={`${geistSans.variable} ${geistMono.variable} antialiased`}
          >
              <ThemeProvider
                attribute="class"
                defaultTheme="system"
                enableSystem
                disableTransitionOnChange
              >
                <Toaster />
                {children}
              </ThemeProvider>
          </body>
        </html>
      </TRPCReactProvider>
    </ClerkProvider>
  );  
}

