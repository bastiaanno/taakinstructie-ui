import { parse } from "csv-parse";
import type { NextApiRequest, NextApiResponse } from "next";
import fs from "fs";
import { IncomingForm, File } from "formidable";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { extractPages, layoutFourPerSheet } from "taakinstructies";

// Disable the default body parser
export const config = {
  api: {
    bodyParser: false,
    sizeLimit: "10mb", // Adjust as needed
  },
};

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Parse the multipart form data
  const form = new IncomingForm();

  form.parse(req, async (err, fields, files) => {
    if (err) {
      res.status(500).json({ error: "Error parsing form data" });
      return;
    }

    // Read CSV file
    const csvFile = (files as Record<string, File | File[] | undefined>)
      .csvData;
    const pdfFile = (files as Record<string, File | File[] | undefined>)
      .pdfData;

    if (!csvFile || !pdfFile) {
      res.status(400).json({ error: "Both CSV and PDF files are required." });
      return;
    }

    // Read CSV content
    const csvBuffer = fs.readFileSync(
      Array.isArray(csvFile) ? csvFile[0].filepath : csvFile.filepath
    );
    const csvData = csvBuffer.toString("utf-8");

    // Parse CSV
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
            delimiter: ";",
          },
          (err, output) => {
            if (err) reject(err);
            else resolve(output as CsvRow[]);
          }
        );
      }
    );

    // Read PDF file as buffer
    const pdfBuffer = fs.readFileSync(
      Array.isArray(pdfFile) ? pdfFile[0].filepath : pdfFile.filepath
    );

    // Prepare an array to hold each laid out PDF and its name
    const laidOutPDFsWithNames = await Promise.all(
      records.map(async (row) => {
        const name = row.name;
        const numbers = row.pages
          .split(",")
          .map((s: string) => parseInt(s.trim(), 10))
          .filter((n: number) => !isNaN(n));

        // Use your PDF extraction logic
        const extracted = await extractPages(pdfBuffer, numbers);
        const laidOut = await layoutFourPerSheet(extracted, name);
        const outBytes = await laidOut.save();
        return { outBytes, name };
      })
    );

    // Merge all PDFs using pdf-lib
    const mergedPdf = await PDFDocument.create();
    // Load all PDFs and copy their pages in parallel for faster merging
    const loadedPdfs = await Promise.all(
      laidOutPDFsWithNames.map(({ outBytes }) => PDFDocument.load(outBytes))
    );
    const allCopiedPages = await Promise.all(
      loadedPdfs.map((pdf) => mergedPdf.copyPages(pdf, pdf.getPageIndices()))
    );
    allCopiedPages.forEach((copiedPages) => {
      copiedPages.forEach((page) => mergedPdf.addPage(page));
    });
    const mergedBytes = await mergedPdf.save();

    // Create a zip with all PDFs and the merged PDF
    const zip = new JSZip();
    // Add individual PDFs
    laidOutPDFsWithNames.forEach(({ outBytes, name }, idx) => {
      // Sanitize name for filename
      const safeName = name.replace(/[^a-z0-9_\-]/gi, " ");
      zip.file(`${idx + 1} ${safeName || "file"}.pdf`, outBytes);
    });
    // Add merged PDF
    zip.file("bundled.pdf", mergedBytes);

    const zipContent = await zip.generateAsync({ type: "nodebuffer" });

    res.setHeader("Content-Type", "application/zip");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=taakinstructies.zip"
    );
    res.status(200).send(zipContent);
  });
}
