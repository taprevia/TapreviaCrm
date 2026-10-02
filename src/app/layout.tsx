import type { Metadata } from "next";
import localFont from "next/font/local";
import "./globals.css";
import { ToastProvider } from "@/components/ui/toast";

const geistSans = localFont({
  src: "./fonts/GeistVF.woff",
  variable: "--font-geist-sans",
  display: "swap",
});

const geistMono = localFont({
  src: "./fonts/GeistMonoVF.woff",
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Taprevia - NFC Smart Card Management Platform",
  description: "Manage your NFC smart cards, digital profiles, and capture leads with Taprevia. The modern solution for digital networking.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans`}>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
