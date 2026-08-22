/**
 * Database connection layer for DoD Budget showcase
 * Provides access to SQLite database with budget and audit data
 */

import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import { Path } from 'node:path';

let db: Database<sqlite3.Database> | null = null;

export async function getDb() {
  if (db) {
    return db;
  }

  const dbPath = process.env.DATABASE_PATH || '/Users/llmpowerhouse/ai_data/git/datamatter/database/dod_budget.db';

  db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  return db;
}

// Budget functions queries
export async function getBudgetFunctions() {
  const db = await getDb();
  return db.all(`
    SELECT
      function_name as name,
      amount,
      fiscal_year
    FROM budget_functions
    ORDER BY amount DESC
  `);
}

// Budget agencies queries
export async function getBudgetAgencies() {
  const db = await getDb();
  return db.all(`
    SELECT
      agency_name as name,
      amount,
      fiscal_year
    FROM budget_agencies
    ORDER BY amount DESC
  `);
}

// PPBE compliance queries
export async function getPPBECompliance() {
  const db = await getDb();
  return db.all(`
    SELECT
      program_name,
      status,
      review_date
    FROM ppbe_compliance
  `);
}

// GAO findings queries
export async function getGAOFindings() {
  const db = await getDb();
  return db.all(`
    SELECT
      finding_type,
      year,
      description,
      status
    FROM gao_findings
    ORDER BY year DESC
  `);
}

// Congressional requests queries
export async function getCongressionalRequests() {
  const db = await getDb();
  return db.all(`
    SELECT
      committee,
      request_date,
      response_date,
      status
    FROM congressional_requests
    ORDER BY request_date DESC
  `);
}

export default {
  getBudgetFunctions,
  getBudgetAgencies,
  getPPBECompliance,
  getGAOFindings,
  getCongressionalRequests,
};