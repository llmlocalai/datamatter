import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');

export async function GET(request: Request) {
  try {
    const data = JSON.parse(
      fs.readFileSync(path.join(DATA_PATH, 'congressional_tracking.json'), 'utf-8')
    );
    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching congressional data:', error);
    return NextResponse.json(
      { error: 'Failed to fetch congressional data' },
      { status: 500 }
    );
  }
}

export const dynamic = 'force-dynamic';
export const revalidate = false;
