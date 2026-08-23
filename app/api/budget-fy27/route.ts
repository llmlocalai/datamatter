import { NextResponse } from "next/server";
import { getOverview } from "@/lib/fy27-data";

/**
 * GET /api/budget-fy27
 *
 * De-duplicated FY2027 budget overview: grand totals, 3-year trend, discretionary
 * vs mandatory, the 7 exhibits, by-service and by-activity breakdowns, and the
 * cataloged source documents. Amounts are in DOLLARS (DB $K x 1000).
 */
export async function GET() {
  try {
    const overview = await getOverview();
    return NextResponse.json(overview);
   } catch (error) {
    console.error("Error fetching FY2027 overview:", error);
    return NextResponse.json(
      { error: "Failed to fetch FY2027 overview" },
      { status: 500 }
     );
   }
}

export const dynamic = "force-dynamic";
export const revalidate = false;
