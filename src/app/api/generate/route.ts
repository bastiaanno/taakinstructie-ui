import { parse } from "csv-parse";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { extractPages, layoutFourPerSheet } from "taakinstructies";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Error parsing form data" }, { status: 500 });
  }

  const csvFile = formData.get("csvData");
  const pdfFile = formData.get("pdfData");

  if (!(csvFile instanceof File) || !(pdfFile instanceof File)) {
    return Response.json(
      { error: "Both CSV and PDF files are required." },
      { status: 400 },
    );
  }

  const delimiter = (formData.get("delimiter") as string | null) ?? ";";
  const nameColumn = (formData.get("nameColumn") as string | null) ?? "name";
  const pagesColumn = (formData.get("pagesColumn") as string | null) ?? "pages";

  const csvData = await csvFile.text();

  interface CsvRow {
    name: string;
    pages: string;
    [key: string]: string;
  }

  const records: CsvRow[] = await new Promise(
    (resolve: (value: CsvRow[]) => void, reject) => {
      parse(
        csvData,
        {
          columns: true,
          skip_empty_lines: true,
          delimiter,
        },
        (err, output) => {
          if (err) reject(err);
          else resolve(output as CsvRow[]);
        },
      );
    },
  );

  if (records.length > 0) {
    console.log("CSV columns:", Object.keys(records[0]));
    console.log("First row raw:", records[0]);
  }

  const resolveColumn = (row: CsvRow, column: string): string => {
    const key = Object.keys(row).find(
      (k) => k.trim().toLowerCase() === column.trim().toLowerCase(),
    );
    return key ? row[key] : "";
  };

  const pdfBuffer = Buffer.from(await pdfFile.arrayBuffer());

  const laidOutPDFsWithNames = await Promise.all(
    records.map(async (row) => {
      const name = resolveColumn(row, nameColumn);
      const numbers = resolveColumn(row, pagesColumn)
        .split(/[,;\s]+/)
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !isNaN(n));

      const extracted = await extractPages(pdfBuffer, numbers);
      const laidOut = await layoutFourPerSheet(extracted, name);
      const outBytes = await laidOut.save();
      console.log(`Processed ${name} with pages ${numbers.join(", ")}`);
      return { outBytes, name };
    }),
  );

  const mergedPdf = await PDFDocument.create();
  const loadedPdfs = await Promise.all(
    laidOutPDFsWithNames.map(({ outBytes }) => PDFDocument.load(outBytes)),
  );
  const allCopiedPages = await Promise.all(
    loadedPdfs.map((pdf) => mergedPdf.copyPages(pdf, pdf.getPageIndices())),
  );
  allCopiedPages.forEach((copiedPages) => {
    copiedPages.forEach((page) => mergedPdf.addPage(page));
  });
  const mergedBytes = await mergedPdf.save();

  const zip = new JSZip();
  laidOutPDFsWithNames.forEach(({ outBytes, name }, idx) => {
    const safeName = name.replace(/[^a-z0-9_\-]/gi, " ");
    zip.file(`${idx + 1} ${safeName || "file"}.pdf`, outBytes);
  });
  zip.file("bundled.pdf", mergedBytes);

  const zipContent = await zip.generateAsync({ type: "nodebuffer" });

  return new Response(zipContent, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=taakinstructies.zip",
    },
  });
}
