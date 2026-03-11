import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { WinOverlay } from "@/components/WinOverlay";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata = {
  title: "Arkady",
  description: "Arkady is a trading bot for the Polymarket platform",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
        <WinOverlay />
      </body>
    </html>
  );
}
