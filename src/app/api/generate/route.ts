import { parse } from "csv-parse";
import { PDFDocument } from "pdf-lib";
import JSZip from "jszip";
import { extractPages, layoutFourPerSheet } from "taakinstructies";

export const runtime = "nodejs";

const applyTemplate = (
  template: string,
  values: Record<string, string>,
): string =>
  template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value ?? "";
  });

const wrapBase64 = (input: string): string => {
  const chunkSize = 76;
  let out = "";
  for (let i = 0; i < input.length; i += chunkSize) {
    out += `${input.slice(i, i + chunkSize)}\r\n`;
  }
  return out.trimEnd();
};

const encodeHeaderValue = (value: string): string => {
  if (/^[\x20-\x7E]*$/.test(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
};

const toEml = (params: {
  from: string;
  to: string;
  subject: string;
  body: string;
  attachments: Array<{
    filename: string;
    bytes: Uint8Array;
    contentType: string;
  }>;
}): string => {
  const boundary = `----=_Part_${Math.random().toString(36).slice(2)}`;
  const body = params.body.replace(/\r?\n/g, "\r\n");
  const attachmentParts = params.attachments.flatMap((attachment) => {
    const attachmentBase64 = wrapBase64(
      Buffer.from(attachment.bytes).toString("base64"),
    );
    const safeAttachmentFilename = attachment.filename.replace(/"/g, "");
    const safeContentType =
      attachment.contentType || "application/octet-stream";

    return [
      `--${boundary}`,
      `Content-Type: ${safeContentType}; name="${safeAttachmentFilename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${safeAttachmentFilename}"`,
      "",
      attachmentBase64,
    ];
  });

  return [
    `From: ${params.from}`,
    `To: ${params.to}`,
    `Subject: ${encodeHeaderValue(params.subject)}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/mixed; boundary=\"${boundary}\"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset=\"utf-8\"',
    "Content-Transfer-Encoding: 8bit",
    "",
    body,
    "",
    ...attachmentParts,
    `--${boundary}--`,
    "",
  ].join("\r\n");
};

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
  const emailColumn = (formData.get("emailColumn") as string | null) ?? "email";
  const outputMode = (formData.get("outputMode") as string | null) ?? "zip";
  const fromAddress =
    (formData.get("fromAddress") as string | null) ??
    "noreply@taakinstructie.local";
  const mailSubjectTemplate =
    (formData.get("mailSubjectTemplate") as string | null) ??
    "Taakinstructie voor {{name}}";
  const mailBodyTemplate =
    (formData.get("mailBodyTemplate") as string | null) ??
    "Beste {{name}},\n\nIn de bijlage vind je je taakinstructie.\n\nMet vriendelijke groet,";
  const commonAttachments = formData
    .getAll("commonAttachments")
    .filter((file): file is File => file instanceof File);

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
      const email = resolveColumn(row, emailColumn);
      const numbers = resolveColumn(row, pagesColumn)
        .split(/[,;\s]+/)
        .map((s: string) => parseInt(s.trim(), 10))
        .filter((n: number) => !isNaN(n));

      const extracted = await extractPages(pdfBuffer, numbers);
      const laidOut = await layoutFourPerSheet(extracted, name);
      const outBytes = await laidOut.save();
      return { outBytes, name, email };
    }),
  );

  if (outputMode === "eml") {
    const commonAttachmentData = await Promise.all(
      commonAttachments.map(async (file) => ({
        filename: file.name,
        bytes: new Uint8Array(await file.arrayBuffer()),
        contentType: file.type || "application/octet-stream",
      })),
    );

    const withEmails = laidOutPDFsWithNames.filter(({ email }) =>
      Boolean(email),
    );
    const skipped = laidOutPDFsWithNames
      .filter(({ email }) => !email)
      .map(({ name }) => name || "(zonder naam)");

    if (withEmails.length === 0) {
      return Response.json(
        { error: "Geen records met e-mailadres gevonden." },
        { status: 400 },
      );
    }

    const emlZip = new JSZip();
    withEmails.forEach(({ outBytes, name, email }, idx) => {
      const safeName = name.replace(/[^a-z0-9_\-]/gi, " ").trim();
      const attachmentFilename = `${idx + 1} ${safeName || "file"}.pdf`;
      const emlFilename = `${idx + 1} ${safeName || "mail"}.eml`;
      const subject = applyTemplate(mailSubjectTemplate, { name, email });
      const body = applyTemplate(mailBodyTemplate, { name, email });
      const eml = toEml({
        from: fromAddress,
        to: email,
        subject,
        body,
        attachments: [
          {
            filename: attachmentFilename,
            bytes: outBytes,
            contentType: "application/pdf",
          },
          ...commonAttachmentData,
        ],
      });
      emlZip.file(emlFilename, eml);
    });

    if (skipped.length > 0) {
      emlZip.file(
        "overgeslagen-zonder-email.txt",
        skipped.map((name) => `- ${name}`).join("\n"),
      );
    }

    const emlZipContent = await emlZip.generateAsync({ type: "nodebuffer" });

    return new Response(emlZipContent as BodyInit, {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": "attachment; filename=taakinstructies-eml.zip",
      },
    });
  }

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

  return new Response(zipContent as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": "attachment; filename=taakinstructies.zip",
    },
  });
}
