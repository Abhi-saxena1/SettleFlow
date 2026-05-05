import "./globals.css";

export const metadata = {
  title: "SettleFlow | Instant B2B Payments",
  description: "Programmable B2B payments, escrow, and AI risk analysis for SMEs."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
