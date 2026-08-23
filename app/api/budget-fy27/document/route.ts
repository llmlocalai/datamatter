import { NextResponse } from "next/server";
import { getDocument } from "@/lib/fy27-data";

/**
 * GET /api/budget-fy27/document?id=<id>
 *
 * Streams a stored source document (PDF/XLSX/…) from the Neon `war_budget_file`
 * bytea table as a downloadable attachment. Unknown ids -> 404. The id is bound
 * as a parameter (no interpolation), so it cannot be used for injection.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const idRaw = searchParams.get("id");
  const id = Number(idRaw);
  if (!idRaw || !Number.isInteger(id) || id <= 0) {
    return NextResponse.json({ error: "id must be a positive integer" }, { status: 400 });
   }

  try {
    const file = await getDocument(id);
    if (!file) {
      return NextResponse.json({ error: "document not found" }, { status: 404 });
     }

    const type = contentTypeFor(file.format);
    const headers = new Headers();
    headers.set("Content-Type", type);
    headers.set("Content-Length", String(file.byteSize));
    headers.set("Content-Disposition", `attachment; filename="${safeName(file.filename)}"`);
    headers.set("Cache-Control", "private, max-age=3600");

     // Wrap in a Blob: a Uint8Array body trips the TS 5.9 generic
      // Uint8Array<ArrayBufferLike> vs DOM BodyInit mismatch, and a Blob is
      // an unambiguous BodyInit member.
    const raw = file.data;
    const buf = new ArrayBuffer(raw.length);
    new Uint8Array(buf).set(raw);
    const body = new Blob([buf]);
    return new Response(body, { status: 200, headers });
    } catch (error) {
    console.error("Error fetching FY2027 document:", error);
    return NextResponse.json({ error: "Failed to fetch document" }, { status: 500 });
    }
}

// MIME type by file format.
function contentTypeFor(format: string): string {
  switch ((format || "").toLowerCase()) {
    case "pdf":
      return "application/pdf";
    case "xlsx":
    case "xlsm":
      return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "xls":
      return "application/vnd.ms-excel";
    case "json":
      return "application/json";
    case "zip":
      return "application/zip";
    default:
      return "application/octet-stream";
   }
}

// Sanitize the filename for the Content-Disposition header (strip path/quotes).
function safeName(name: string): string {
  return (name || "document")
     .replace(/[\\/]+/g, "_")
     .replace(/["\r\n]/g, "")
     .trim();
}

export const dynamic = "force-dynamic";
export const revalidate = false;
