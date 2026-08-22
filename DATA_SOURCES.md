# Data Sources for DoD Budget Showcase

## Overview

This document describes the data sources used in the DoD Budget & Audit Showcases, including the knowledge bank data, USASpending data, and regulatory documents.

## Data Sources

### 1. USASpending Data

**Location:** `/Volumes/AI_DATA/data/usaspending/`

**Description:** Comprehensive USASpending data for Department of Defense (DoD) agency code 097.

**Data Types:**
- Account-level budget data (Parquet files)
- Contract awards
- Assistance transactions
- Reference data (agency codes, CFDA, NAICS, etc.)

**Files Structure:**
```
warehouse/
├── accounts/
│   ├── file_a/ (account-level data)
│   │   └── fiscal_year=*/data_0.parquet
│   ├── file_b/ (assistance data)
│   └── file_c_contracts/ (contract data)
├── assistance/ (assistance vintage data)
└── contracts/ (contract vintage data)
```

**Database Location:** `/Volumes/AI_DATA/git/datamatter/database/dod_budget.db`

### 2. DoD Financial Management Knowledge Bank

**Location:** `/Volumes/AI_DATA/knowledge-bank/DOD-FM-Knowledge-Bank/`

**Description:** Comprehensive collection of DoD financial management regulations, guidance, and documents.

**Key Folders:**
- `01-Regulations/` - FMR DoD 7000.14-R, OMB Circulars, Treasury USSGL TFM
- `02-DoD-Guidance/` - DFAS, Army, Navy, Air Force FM Regulations
- `08-CRS-Congressional-Research-Service/` - CRS reports on defense budget
- `11-Budget-Justification/` - Budget justification documents and exhibits
- `12-Oversight/` - GAO reports, DoD IG reports
- `04-Reference-Data/` - Master data files

### 3. Budget Data

**Location:** `/Volumes/AI_DATA/git/datamatter/app/api/data/`

**Description:** Processed JSON data files for API consumption.

**Files:**
- `budget_by_function.json` - Budget allocation by function
- `budget_by_agency.json` - Budget allocation by agency
- `budget_by_fiscal_year.json` - Budget trends over fiscal years
- `ppbe_compliance.json` - PPBE compliance data
- `gao_audit.json` - GAO audit findings
- `congressional_tracking.json` - Congressional oversight data

### 4. Regulatory Documents

**DoD Financial Management Regulation (FMR)**
- Version: DoD 7000.14-R (2026)
- Location: `01-Regulations/FMR-DoD-7000.14-R/`
- Key Volumes:
  - Vol 1: General Financial Management Information Systems
  - Vol 2A/B: Budget Formulation and Presentation
  - Vol 3: Budget Execution
  - Vol 6A/B: Reporting and Audited Financial Statements

**OMB Circulars**
- A-11: Budget Preparation and Execution
- A-123: Internal Controls
- A-136: Financial Report Requirements

## Data Processing Pipeline

### 1. Data Ingestion
```
USASpending API → Parquet Files → SQLite Database → JSON Files
```

### 2. Data Processing
```
Parquet Files → Python/Pandas → Analysis → JSON Export
```

### 3. API Layer
```
JSON Files → Next.js API Routes → Frontend Components
```

## Data Dictionary

### Budget Functions
| Field | Type | Description |
|-------|------|-------------|
| function_name | string | Name of the budget function |
| amount | float | Total budget amount in USD |
| fiscal_year | int | Fiscal year |

### Budget Agencies
| Field | Type | Description |
|-------|------|-------------|
| agency_name | string | Name of the agency |
| amount | float | Total budget amount in USD |
| fiscal_year | int | Fiscal year |

### PPBE Compliance
| Field | Type | Description |
|-------|------|-------------|
| program_name | string | Name of the program |
| status | string | Compliance status |
| review_date | string | Date of last review |

### GAO Findings
| Field | Type | Description |
|-------|------|-------------|
| finding_type | string | Type of finding |
| year | int | Year of finding |
| description | string | Finding description |
| status | string | Finding status |

### Congressional Requests
| Field | Type | Description |
|-------|------|-------------|
| committee | string | Congressional committee |
| request_date | string | Date of request |
| response_date | string | Date of response |
| status | string | Request status |

## Usage Examples

### Fetching Budget Functions
```bash
curl http://localhost:3000/api/budget?type=functions
```

### Fetching PPBE Compliance
```bash
curl http://localhost:3000/api/ppbe
```

### Fetching GAO Findings
```bash
curl http://localhost:3000/api/gao
```

### Fetching Congressional Requests
```bash
curl http://localhost:3000/api/congressional
```

## Data Refresh

To refresh data from the knowledge bank:

1. Run the data processor:
   ```bash
   python3 scripts/export_to_json.py
   ```

2. Rebuild the database:
   ```bash
   sqlite3 database/dod_budget.db < database/schema.sql
   ```

3. Restart the development server.

## Compliance Notes

- All data handling complies with DoD data governance policies
- No classified or PII data is stored in this system
- Data is for internal use only at OUSD(C)