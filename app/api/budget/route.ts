import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type') || 'overview';

  try {
    switch (type) {
      case 'functions':
        const functionsData = JSON.parse(
          fs.readFileSync(path.join(DATA_PATH, 'budget_by_function.json'), 'utf-8')
        );
        return NextResponse.json(functionsData);

      case 'agencies':
        const agenciesData = JSON.parse(
          fs.readFileSync(path.join(DATA_PATH, 'budget_by_agency.json'), 'utf-8')
        );
        return NextResponse.json(agenciesData);

      case 'fiscal-year':
        const fyData = JSON.parse(
          fs.readFileSync(path.join(DATA_PATH, 'budget_by_fiscal_year.json'), 'utf-8')
        );
        return NextResponse.json(fyData);

      case 'overview':
      default:
        const functions = JSON.parse(
          fs.readFileSync(path.join(DATA_PATH, 'budget_by_function.json'), 'utf-8')
        );
        const agencies = JSON.parse(
          fs.readFileSync(path.join(DATA_PATH, 'budget_by_agency.json'), 'utf-8')
        );
        const totalBudget = functions.reduce(
          (sum: number, fn: any) => sum + (fn.amount || 0),
           0
        );
        return NextResponse.json({
          totalBudget,
          budgetFunctions: functions,
          agencies,
        });
    }
  } catch (error) {
    console.error('Error fetching budget data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch budget data' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = false;
