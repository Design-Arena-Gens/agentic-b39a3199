"use client";

import { OcrAgent } from "@/components/OcrAgent";

export default function Home() {
  return (
    <div style={{ minHeight: "100dvh", background: "#0b1020", color: "#e6e8ef" }}>
      <main style={{ maxWidth: 980, margin: "0 auto", padding: "48px 24px" }}>
        <header style={{ marginBottom: 24 }}>
          <h1 style={{ fontSize: 32, margin: 0 }}>Handwrite ? Rows Agent</h1>
          <p style={{ opacity: 0.8, marginTop: 8 }}>
            Upload handwritten notes or tables. The agent OCRs, parses, and appends rows. Review and export CSV.
          </p>
        </header>
        <OcrAgent />
      </main>
    </div>
  );
}
