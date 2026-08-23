import { NextResponse } from "next/server";
import { getDetail, EXHIBITS } from "@/lib/fy27-data";
import type { ExhibitCode } from "@/lib/fy27-data";

/**
 * GET /api/budget-fy27/detail
 *
 * Paginated, sortable, filterable line items for a single exhibit
 * (de-duplicated to the canonical sheet). All client-supplied values are
 * bound as parameters or validated against an allowlist — never interpolated.
 *
 * Query params:
 *   exhibit   (required) c1|m1|o1|p1|p1r|r1|rf1
 *   fy        (optional) 2025|2026|2027  (metadata only; rows are FY2027)
 *   org       (optional) service code, e.g. "A" / "OSD"  ("all" = none)
 *   activity  (optional) substring of Budget Activity Title  ("all" = none)
 *   search    (optional) substring of account / account title
 *   sort      (optional) fy2027|account|accountTitle|organization  (default fy2027)
 *   order     (optional) asc|desc  (default desc)
 *   page      (optional) 1-based  (default 1)
 *   pageSize  (optional) 1..200  (default 50)
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  const exhibit = (searchParams.get("exhibit") || "").trim();
  if (!EXHIBITS.includes(exhibit as ExhibitCode)) {
    return NextResponse.json(
       { error: `exhibit must be one of: ${EXHIBITS.join(", ")}` },
       { status: 400 }
      );
    }

  const sortRaw = (searchParams.get("sort") || "fy2027").trim();
  const sort =
     ["fy2027", "account", "accountTitle", "organization"].includes(sortRaw)
        ? (sortRaw as "fy2027" | "account" | "accountTitle" | "organization")
        : "fy2027";
  const orderRaw = (searchParams.get("order") || "desc").trim().toLowerCase();
  const order: "asc" | "desc" = orderRaw === "asc" ? "asc" : "desc";

  const fy = parseInt(searchParams.get("fy") || "2027", 10) || 2027;
  const org = searchParams.get("org") || "all";
  const activity = searchParams.get("activity") || "all";
  const search = searchParams.get("search") || "";
  const page = parseInt(searchParams.get("page") || "1", 10) || 1;
  const pageSize = parseInt(searchParams.get("pageSize") || "50", 10) || 50;

  try {
    const result = await getDetail({
      exhibit: exhibit as ExhibitCode,
      fy,
      org,
      activity,
      search,
      sort,
      order,
      page,
      pageSize,
    });
    return NextResponse.json(result);
    } catch (error) {
    console.error("Error fetching FY2027 detail:", error);
    return NextResponse.json(
       { error: "Failed to fetch FY2027 detail" },
       { status: 500 }
      );
    }
}

export const dynamic = "force-dynamic";
export const revalidate = false;
