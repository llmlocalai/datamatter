-- DoD Budget Database Schema
-- For enterprise-grade production showcase

-- Budget Functions Table
CREATE TABLE IF NOT EXISTS budget_functions (
    id SERIAL PRIMARY KEY,
    function_code VARCHAR(10) NOT NULL,
    function_name VARCHAR(255) NOT NULL,
    description TEXT,
    total_obligations DECIMAL(18,2),
    total_outlays DECIMAL(18,2),
    fiscal_year INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Agencies Table
CREATE TABLE IF NOT EXISTS agencies (
    id SERIAL PRIMARY KEY,
    agency_code VARCHAR(10) NOT NULL,
    agency_name VARCHAR(255) NOT NULL,
    agency_abbreviation VARCHAR(10),
    total_obligations DECIMAL(18,2),
    total_outlays DECIMAL(18,2),
    fiscal_year INTEGER,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- PPBE Compliance Table
CREATE TABLE IF NOT EXISTS ppbe_compliance (
    id SERIAL PRIMARY KEY,
    program_id VARCHAR(50) NOT NULL,
    program_name VARCHAR(255) NOT NULL,
    compliance_status VARCHAR(50),
    last_review_date DATE,
    next_review_date DATE,
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- OMB 30 Submissions Table
CREATE TABLE IF NOT EXISTS omb30_submissions (
    id SERIAL PRIMARY KEY,
    submission_id VARCHAR(50) PRIMARY KEY,
    program_id VARCHAR(50) NOT NULL,
    submission_date DATE,
    status VARCHAR(50),
    approver VARCHAR(255),
    approval_date DATE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- GAO Audit Findings Table
CREATE TABLE IF NOT EXISTS gao_findings (
    id SERIAL PRIMARY KEY,
    finding_id VARCHAR(50) PRIMARY KEY,
    finding_type VARCHAR(100) NOT NULL,
    year INTEGER NOT NULL,
    description TEXT,
    recommendation TEXT,
    status VARCHAR(50),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Congressional Oversight Table
CREATE TABLE IF NOT EXISTS congressional_oversight (
    id SERIAL PRIMARY KEY,
    request_id VARCHAR(50) PRIMARY KEY,
    committee VARCHAR(255) NOT NULL,
    request_date DATE,
    response_date DATE,
    status VARCHAR(50),
    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_budget_functions_year ON budget_functions(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_agencies_year ON agencies(fiscal_year);
CREATE INDEX IF NOT EXISTS idx_ppbe_program ON ppbe_compliance(program_id);
CREATE INDEX IF NOT EXISTS idx_gao_findings_year ON gao_findings(year);
CREATE INDEX IF NOT EXISTS idx_congressional_year ON congressional_oversight(request_date);