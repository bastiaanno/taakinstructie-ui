"use client";
import Image from "next/image";
import { useState } from "react";

export default function Home() {
  const [loading, setLoading] = useState(false);
  const [output, setOutput] = useState<string | null>(null);

  const [csvFile, setCsvFile] = useState<File | null>(null);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [commonFiles, setCommonFiles] = useState<File[]>([]);
  const [delimiter, setDelimiter] = useState<string>(";");
  const [nameColumn, setNameColumn] = useState<string>("name");
  const [pagesColumn, setPagesColumn] = useState<string>("pages");
  const [emailColumn, setEmailColumn] = useState<string>("email");
  const [fromAddress, setFromAddress] = useState<string>(
    "noreply@taakinstructie.local",
  );
  const [mailSubjectTemplate, setMailSubjectTemplate] = useState<string>(
    "Taakinstructie voor {{name}}",
  );
  const [mailBodyTemplate, setMailBodyTemplate] = useState<string>(
    "Beste {{name}},\n\nIn de bijlage vind je je taakinstructie.\n\nMet vriendelijke groet,",
  );

  const handleCsvChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCsvFile(e.target.files?.[0] || null);
  };

  const handlePdfChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setPdfFile(e.target.files?.[0] || null);
  };

  const handleCommonFilesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setCommonFiles(Array.from(e.target.files || []));
  };

  const handleGenerate = async (outputMode: "zip" | "eml") => {
    if (!csvFile || !pdfFile) {
      setOutput("Upload een CSV- en een PDF-bestand.");
      return;
    }
    setLoading(true);
    setOutput(null);

    const formData = new FormData();
    formData.append("csvData", csvFile);
    formData.append("pdfData", pdfFile);
    formData.append("delimiter", delimiter);
    formData.append("nameColumn", nameColumn);
    formData.append("pagesColumn", pagesColumn);
    formData.append("emailColumn", emailColumn);
    formData.append("outputMode", outputMode);
    formData.append("fromAddress", fromAddress);
    formData.append("mailSubjectTemplate", mailSubjectTemplate);
    formData.append("mailBodyTemplate", mailBodyTemplate);
    commonFiles.forEach((file) => formData.append("commonAttachments", file));

    const res = await fetch("/api/generate", {
      method: "POST",
      body: formData,
    });

    if (!res.ok) {
      setOutput("Er is een fout opgetreden bij het genereren.");
      setLoading(false);
      return;
    }

    const data = await res.arrayBuffer();
    setLoading(false);

    // Download the output zip
    if (data) {
      const blob = new Blob([data], { type: "application/zip" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        outputMode === "eml"
          ? "taakinstructies-eml.zip"
          : "taakinstructies.zip";
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      if (outputMode === "eml") {
        setOutput(
          `EML mail merge gegenereerd. ${commonFiles.length} algemene bijlage(n) toegevoegd aan elke e-mail.`,
        );
      }
    }
  };

  return (
    <div className="flex flex-col items-center justify-between min-h-screen p-8 gap-16 sm:p-20 font-[family-name:var(--font-geist-sans)]">
      <main className="flex flex-col gap-8 row-start-2 items-center sm:items-start">
        <h1 className="text-4xl sm:text-5xl font-bold text-center sm:text-left">
          Taakinstructiedocument generator
        </h1>
        <label className="flex flex-col gap-2 w-full max-w-md">
          <span className="font-medium">Upload csv</span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={handleCsvChange}
            required
            className="file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </label>
        <div className="flex flex-col gap-2 w-full max-w-md">
          <span className="font-medium">CSV-scheidingsteken</span>
          <select
            value={delimiter}
            onChange={(e) => setDelimiter(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          >
            <option value=";">Puntkomma ( ; )</option>
            <option value=",">Komma ( , )</option>
            <option value="\t">Tab</option>
            <option value="|">Pipe ( | )</option>
          </select>
        </div>
        <div className="flex gap-4 w-full max-w-md">
          <label className="flex flex-col gap-2 flex-1">
            <span className="font-medium">Naamkolom</span>
            <input
              type="text"
              value={nameColumn}
              onChange={(e) => setNameColumn(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-2 flex-1">
            <span className="font-medium">Paginakolom</span>
            <input
              type="text"
              value={pagesColumn}
              onChange={(e) => setPagesColumn(e.target.value)}
              className="border border-gray-300 rounded px-3 py-2 text-sm"
            />
          </label>
        </div>
        <label className="flex flex-col gap-2 w-full max-w-md">
          <span className="font-medium">E-mailkolom</span>
          <input
            type="text"
            value={emailColumn}
            onChange={(e) => setEmailColumn(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-2 w-full max-w-md">
          <span className="font-medium">Afzender</span>
          <input
            type="text"
            value={fromAddress}
            onChange={(e) => setFromAddress(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-2 w-full max-w-md">
          <span className="font-medium">Onderwerp template</span>
          <input
            type="text"
            value={mailSubjectTemplate}
            onChange={(e) => setMailSubjectTemplate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm"
          />
        </label>
        <label className="flex flex-col gap-2 w-full max-w-md">
          <span className="font-medium">Bericht template</span>
          <textarea
            value={mailBodyTemplate}
            onChange={(e) => setMailBodyTemplate(e.target.value)}
            className="border border-gray-300 rounded px-3 py-2 text-sm min-h-28"
          />
        </label>
        <label className="flex flex-col gap-2 w-full max-w-md">
          <span className="font-medium">Upload pdf</span>
          <input
            type="file"
            accept=".pdf,application/pdf"
            onChange={handlePdfChange}
            required
            className="file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
        </label>
        <label className="flex flex-col gap-2 w-full max-w-md">
          <span className="font-medium">
            Algemene bijlagen (voor elke mail)
          </span>
          <input
            type="file"
            multiple
            onChange={handleCommonFilesChange}
            className="file:mr-4 file:py-2 file:px-4 file:rounded file:border-0 file:text-sm file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100"
          />
          {commonFiles.length > 0 && (
            <span className="text-xs text-gray-600">
              Geselecteerd: {commonFiles.map((f) => f.name).join(", ")}
            </span>
          )}
        </label>
        <div className="w-full max-w-md flex flex-col sm:flex-row gap-3">
          <button
            className="flex-1 bg-blue-600 text-white py-2 px-4 rounded hover:bg-blue-700 transition-colors"
            onClick={() => handleGenerate("zip")}
            disabled={loading}
          >
            {loading ? "Bezig..." : "Genereer instructies (ZIP)"}
          </button>
          <button
            className="flex-1 bg-emerald-600 text-white py-2 px-4 rounded hover:bg-emerald-700 transition-colors"
            onClick={() => handleGenerate("eml")}
            disabled={loading}
          >
            {loading ? "Bezig..." : "Genereer .eml mail merge"}
          </button>
        </div>
        {output && (
          <pre className="w-full max-w-md bg-gray-100 p-4 rounded mt-4 overflow-x-auto">
            {output}
          </pre>
        )}
      </main>
      <footer className="flex flex-row flex-wrap items-center justify-center">
        <a
          className="flex items-center gap-2 hover:underline hover:underline-offset-4"
          href="https://bnws.nl"
          target="_blank"
          rel="noopener noreferrer"
        >
          Site door{" "}
          <Image
            aria-hidden
            src="/logo-black.png"
            alt="bnws logo"
            width={200}
            height={50}
          />
        </a>
      </footer>
    </div>
  );
}
