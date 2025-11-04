"use client";

import React, { useCallback, useMemo, useRef, useState } from "react";
import Tesseract from "tesseract.js";
import { downloadAsCsv } from "@/lib/csv";

type ExtractResult = {
  fileName: string;
  text: string;
  progress: number; // 0..1
  status: "idle" | "recognizing" | "done" | "error";
  error?: string;
};

type Row = string[];

const sectionStyle: React.CSSProperties = {
  background: "#121936",
  border: "1px solid #1c2550",
  borderRadius: 12,
  padding: 16,
  marginBottom: 16,
};

const labelStyle: React.CSSProperties = { fontSize: 13, opacity: 0.9 };

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid #2a366b",
  background: "#0e1430",
  color: "#e6e8ef",
};

const buttonStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderRadius: 8,
  border: "1px solid #2a366b",
  background: "#1b2656",
  color: "#e6e8ef",
  cursor: "pointer",
};

const pillStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  border: "1px solid #2a366b",
  borderRadius: 999,
  fontSize: 12,
  opacity: 0.8,
};

function parseTextToRows(
  text: string,
  opts: { delimiter: "auto" | "comma" | "tab" | "pipe" | "spaces" | "custom"; customPattern?: string }
): Row[] {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const autoGuess = (): { split: (s: string) => string[] } => {
    // Heuristic: prioritize pipe, comma, tab, then multi-spaces
    const sample = lines.slice(0, 10).join("\n");
    if (/\|/.test(sample)) return { split: (s) => s.split(/\s*\|\s*/g) };
    if (/,/.test(sample)) return { split: (s) => s.split(/\s*,\s*/g) };
    if (/\t/.test(sample)) return { split: (s) => s.split(/\t/g) };
    return { split: (s) => s.split(/\s{2,}/g) };
  };

  let splitter: (s: string) => string[];
  switch (opts.delimiter) {
    case "comma":
      splitter = (s) => s.split(/\s*,\s*/g);
      break;
    case "tab":
      splitter = (s) => s.split(/\t/g);
      break;
    case "pipe":
      splitter = (s) => s.split(/\s*\|\s*/g);
      break;
    case "spaces":
      splitter = (s) => s.split(/\s{2,}/g);
      break;
    case "custom":
      try {
        const re = new RegExp(opts.customPattern ?? "\\s+", "g");
        splitter = (s) => s.split(re);
      } catch {
        splitter = (s) => s.split(/\s{2,}/g);
      }
      break;
    case "auto":
    default:
      splitter = autoGuess().split;
  }

  return lines.map((l) => splitter(l).map((c) => c.trim()));
}

export function OcrAgent(): React.ReactElement {
  const [extracts, setExtracts] = useState<ExtractResult[]>([]);
  const [columnsInput, setColumnsInput] = useState<string>("Item, Quantity, Price");
  const [delimiter, setDelimiter] = useState<"auto" | "comma" | "tab" | "pipe" | "spaces" | "custom">("auto");
  const [customPattern, setCustomPattern] = useState<string>("");
  const [rows, setRows] = useState<Row[]>([]);
  const [isAppending, setIsAppending] = useState<boolean>(false);
  const [isExporting, setIsExporting] = useState<boolean>(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const columns = useMemo(() =>
    columnsInput
      .split(",")
      .map((c) => c.trim())
      .filter((c) => c.length > 0),
  [columnsInput]);

  const handleFiles = useCallback((files: FileList | null) => {
    if (!files || files.length === 0) return;
    const initial: ExtractResult[] = Array.from(files).map((f) => ({
      fileName: f.name,
      text: "",
      progress: 0,
      status: "recognizing",
    }));
    setExtracts((prev) => [...prev, ...initial]);

    Array.from(files).forEach(async (file, index) => {
      const localIndex = extracts.length + index;
      try {
        const { data } = await Tesseract.recognize(file, "eng", {
          logger: (m) => {
            if (m.status === "recognizing text" && typeof m.progress === "number") {
              setExtracts((prev) => {
                const next = [...prev];
                if (next[localIndex]) next[localIndex].progress = m.progress;
                return next;
              });
            }
          },
        });

        setExtracts((prev) => {
          const next = [...prev];
          if (next[localIndex]) {
            next[localIndex].text = data.text ?? "";
            next[localIndex].progress = 1;
            next[localIndex].status = "done";
          }
          return next;
        });
      } catch (err) {
        setExtracts((prev) => {
          const next = [...prev];
          if (next[localIndex]) {
            next[localIndex].status = "error";
            next[localIndex].error = (err as Error)?.message ?? "OCR failed";
          }
          return next;
        });
      }
    });
  }, [extracts.length]);

  const handleDrop: React.DragEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();
    if (e.dataTransfer.files) handleFiles(e.dataTransfer.files);
  };

  const handleAppend = async () => {
    setIsAppending(true);
    try {
      const parsedBlocks = extracts
        .filter((x) => x.status === "done" && x.text.trim().length > 0)
        .map((x) => parseTextToRows(x.text, { delimiter, customPattern }));

      const newRows = parsedBlocks.flat();
      setRows((prev) => [...prev, ...newRows]);
    } finally {
      setIsAppending(false);
    }
  };

  const tableHasColumns = columns.length > 0;
  const maxCols = useMemo(() => Math.max(columns.length, ...rows.map((r) => r.length), 0), [columns.length, rows]);

  const samplePreview = useMemo(() => {
    const text = extracts.find((x) => x.status === "done")?.text ?? "";
    if (!text) return [] as Row[];
    return parseTextToRows(text, { delimiter, customPattern }).slice(0, 10);
  }, [extracts, delimiter, customPattern]);

  const clearAll = () => {
    setExtracts([]);
    setRows([]);
  };

  const exportCsv = async () => {
    setIsExporting(true);
    try {
      const header = columns.length ? columns : Array.from({ length: maxCols }, (_, i) => `col_${i + 1}`);
      await downloadAsCsv([header, ...rows], "handwrite_rows.csv");
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <div>
      <section style={sectionStyle}>
        <div style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap" }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Upload images</div>
            <div style={{ ...labelStyle, marginTop: 4 }}>PNG, JPG, or scanned PDFs (as images)</div>
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button
              type="button"
              style={buttonStyle}
              onClick={() => inputRef.current?.click()}
            >
              Select files
            </button>
            <button type="button" style={{ ...buttonStyle, background: "#262f62" }} onClick={clearAll}>Clear</button>
          </div>
        </div>

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: "none" }}
          onChange={(e) => handleFiles(e.target.files)}
        />

        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
          style={{
            marginTop: 12,
            border: "1px dashed #2a366b",
            borderRadius: 12,
            padding: 24,
            textAlign: "center",
            background: "#0d1431",
          }}
        >
          <div>Drag & drop images here</div>
          <div style={{ marginTop: 6, opacity: 0.8, fontSize: 13 }}>Agent performs OCR automatically</div>
        </div>

        {extracts.length > 0 && (
          <div style={{ marginTop: 16, display: "grid", gap: 10 }}>
            {extracts.map((ex, idx) => (
              <div key={`${ex.fileName}-${idx}`} style={{ display: "flex", gap: 12, alignItems: "center", justifyContent: "space-between", background: "#0d1431", border: "1px solid #1c2550", padding: 10, borderRadius: 10 }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{ex.fileName}</div>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>
                    {ex.status === "recognizing" && <span style={pillStyle}>recognizing {(ex.progress * 100).toFixed(0)}%</span>}
                    {ex.status === "done" && <span style={pillStyle}>done</span>}
                    {ex.status === "error" && <span style={{ ...pillStyle, borderColor: "#6b2a2a" }}>error: {ex.error}</span>}
                  </div>
                </div>
                <div style={{ flex: 1, marginLeft: 8 }}>
                  <div style={{ height: 6, background: "#0b1020", border: "1px solid #1c2550", borderRadius: 999 }}>
                    <div style={{ height: "100%", width: `${Math.max(8, ex.progress * 100)}%`, background: "#2f80ed", borderRadius: 999 }} />
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section style={sectionStyle}>
        <div style={{ display: "grid", gap: 10 }}>
          <div>
            <div style={labelStyle}>Columns (comma separated)</div>
            <input
              style={inputStyle}
              placeholder="e.g. Date, Name, Amount"
              value={columnsInput}
              onChange={(e) => setColumnsInput(e.target.value)}
            />
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={labelStyle}>Delimiter</div>
              <select style={{ ...inputStyle, width: "100%" }} value={delimiter} onChange={(e) => setDelimiter(e.target.value as any)}>
                <option value="auto">Auto</option>
                <option value="comma">Comma</option>
                <option value="tab">Tab</option>
                <option value="pipe">Pipe |</option>
                <option value="spaces">Multiple spaces</option>
                <option value="custom">Custom RegExp</option>
              </select>
            </div>
            {delimiter === "custom" && (
              <div style={{ flex: 2, minWidth: 260 }}>
                <div style={labelStyle}>Custom RegExp splitter</div>
                <input
                  style={inputStyle}
                  placeholder="e.g. \\s{3,} or \\s*;\\s*"
                  value={customPattern}
                  onChange={(e) => setCustomPattern(e.target.value)}
                />
              </div>
            )}
            <div>
              <button type="button" style={buttonStyle} disabled={isAppending} onClick={handleAppend}>
                {isAppending ? "Appending?" : "Append parsed rows"}
              </button>
            </div>
          </div>

          {samplePreview.length > 0 && (
            <div>
              <div style={{ ...labelStyle, marginBottom: 6 }}>Preview from first completed OCR</div>
              <div style={{ overflowX: "auto", border: "1px solid #1c2550", borderRadius: 10 }}>
                <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 480 }}>
                  <thead>
                    <tr>
                      {Array.from({ length: Math.max(columns.length, ...samplePreview.map((r) => r.length), 0) }).map((_, i) => (
                        <th key={i} style={{ textAlign: "left", padding: "8px 10px", borderBottom: "1px solid #1c2550", background: "#0e1430" }}>
                          {columns[i] ?? `col_${i + 1}`}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {samplePreview.map((r, ri) => (
                      <tr key={ri}>
                        {Array.from({ length: Math.max(columns.length, r.length) }).map((_, ci) => (
                          <td key={ci} style={{ padding: "8px 10px", borderBottom: "1px solid #1c2550" }}>{r[ci] ?? ""}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </section>

      <section style={sectionStyle}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 12 }}>
          <div>
            <div style={{ fontSize: 18, fontWeight: 600 }}>Appended rows</div>
            <div style={{ ...labelStyle, marginTop: 4 }}>{rows.length} rows</div>
          </div>
        </div>

        <div style={{ overflowX: "auto", border: "1px solid #1c2550", borderRadius: 10, marginBottom: 12 }}>
          <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 640 }}>
            <thead>
              <tr>
                {Array.from({ length: maxCols }).map((_, i) => (
                  <th key={i} style={{ textAlign: "left", padding: "10px 12px", borderBottom: "1px solid #1c2550", background: "#0e1430" }}>
                    {tableHasColumns ? columns[i] ?? `col_${i + 1}` : `col_${i + 1}`}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={maxCols} style={{ padding: 14, opacity: 0.7 }}>No rows yet. Upload images and click Append.</td>
                </tr>
              ) : (
                rows.map((r, ri) => (
                  <tr key={ri}>
                    {Array.from({ length: maxCols }).map((_, ci) => (
                      <td key={ci} style={{ padding: "10px 12px", borderBottom: "1px solid #1c2550" }}>
                        {r[ci] ?? ""}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button type="button" style={buttonStyle} disabled={rows.length === 0 || isExporting} onClick={exportCsv}>
            {isExporting ? "Exporting?" : "Export CSV"}
          </button>
          <button type="button" style={{ ...buttonStyle, background: "#262f62" }} onClick={() => setRows([])} disabled={rows.length === 0}>
            Clear rows
          </button>
        </div>
      </section>
    </div>
  );
}
