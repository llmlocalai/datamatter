/**
 * Data Service for DoD Budget Showcase
 * Provides access to budget, PPBE, GAO, and congressional data
 */

import fs from 'fs';
import path from 'path';

const DATA_PATH = path.join(process.cwd(), 'app', 'api', 'data');

export interface BudgetFunction {
  name: string;
  amount: number;
  fiscal_year: number;
}

export interface AgencyData {
  name: string;
  amount: number;
  fiscal_year: number;
}

export interface PPBECompliance {
  program_name: string;
  status: string;
  review_date: string;
}

export interface GAOFinding {
  finding_type: string;
  year: number;
  description: string;
  status: string;
}

export interface CongressionalRequest {
  committee: string;
  request_date: string;
  response_date: string | null;
  status: string;
}

function readJsonFile(filename: string) {
  const filePath = path.join(DATA_PATH, filename);
  if (fs.existsSync(filePath)) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return JSON.parse(content);
  }
  return [];
}

export async function getBudgetFunctions(): Promise<BudgetFunction[]> {
  return readJsonFile('budget_by_function.json');
}

export async function getBudgetAgencies(): Promise<AgencyData[]> {
  return readJsonFile('budget_by_agency.json');
}

export async function getPPBECompliance(): Promise<PPBECompliance[]> {
  return readJsonFile('ppbe_compliance.json');
}

export async function getGAOFindings(): Promise<GAOFinding[]> {
  return readJsonFile('gao_audit.json');
}

export async function getCongressionalRequests(): Promise<CongressionalRequest[]> {
  return readJsonFile('congressional_tracking.json');
}

// Aggregate statistics
export async function getBudgetStatistics() {
  const functions = await getBudgetFunctions();
  const agencies = await getBudgetAgencies();

  const totalBudget = functions.reduce(
    (sum, fn) => sum + (fn.amount || 0),
    0
  );

  const totalByAgency = agencies.reduce(
    (sum, ag) => sum + (ag.amount || 0),
    0
  );

  return {
    totalBudget,
    totalByAgency,
    functionCount: functions.length,
    agencyCount: agencies.length,
  };
}

export async function getPPBEStatistics() {
  const compliance = await getPPBECompliance();

  const total = compliance.length;
  const compliant = compliance.filter(c => c.status === 'Compliant').length;
  const nonCompliant = compliance.filter(c => c.status !== 'Compliant').length;

  return {
    total,
    compliant,
    nonCompliant,
    complianceRate: total > 0 ? (compliant / total) * 100 : 0,
  };
}

export async function getGAOStatistics() {
  const findings = await getGAOFindings();

  const total = findings.length;
  const open = findings.filter(f => f.status === 'Open').length;
  const closed = findings.filter(f => f.status !== 'Open').length;

  const byType = findings.reduce((acc, finding) => {
    const type = finding.finding_type;
    acc[type] = (acc[type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return {
    total,
    open,
    closed,
    byType,
  };
}

export async function getCongressionalStatistics() {
  const requests = await getCongressionalRequests();

  const total = requests.length;
  const open = requests.filter(r => r.status === 'Open').length;
  const closed = requests.filter(r => r.status !== 'Open').length;
  const responded = requests.filter(r => r.response_date).length;

  return {
    total,
    open,
    closed,
    responded,
    responseRate: total > 0 ? (responded / total) * 100 : 0,
  };
}

export default {
  getBudgetFunctions,
  getBudgetAgencies,
  getPPBECompliance,
  getGAOFindings,
  getCongressionalRequests,
  getBudgetStatistics,
  getPPBEStatistics,
  getGAOStatistics,
  getCongressionalStatistics,
};