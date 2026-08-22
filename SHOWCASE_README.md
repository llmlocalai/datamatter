# DoD Budget & Audit Showcases

Enterprise-grade production-ready showcases for senior budget analysts at the Office of the Under Secretary of Defense for Comptroller (OUSD(C)).

## Overview

This showcase demonstrates AI and data engineering solutions for:

- **PPBE Process** (Planning, Programming, Budgeting, Execution)
- **OMB 30/130** compliance tracking
- **GAO audit findings** management
- **Congressional oversight** coordination

## Available Showcases

### 1. Budget Analysis Dashboard (`/budget`)

**Purpose:** Enterprise-grade budget analysis for senior budget analysts.

**Features:**
- Budget function analysis (Personnel, O&M, Procurement, R&D)
- Agency allocation tracking
- Fiscal year trends
- Real-time data from USASpending

**Data Sources:**
- USASpending API
- DoD Financial Management Regulations (FMR)
- OMB Circulars
- Congressional Research Service reports

### 2. PPBE Compliance Tracker (`/ppbe`)

**Purpose:** Track program compliance with Planning, Programming, and Budgeting System requirements.

**Features:**
- Program compliance rates
- OMB Circular A-30 tracking
- Budget justification quality scoring
- Automated alerts for non-compliance

**Compliance Metrics:**
- Overall compliance rate: 89.6%
- Total programs tracked: 1,250
- Non-compliant programs: 130

### 3. GAO Audit Findings (`/gao`)

**Purpose:** Track Government Accountability Office findings and material weaknesses.

**Features:**
- Year-over-year trend analysis
- Finding categorization
- Material weakness tracking
- Compliance reporting

**Data Sources:**
- GAO Red Book standards
- DoD-wide and Service AFRs
- Audit findings database

### 4. Congressional Oversight (`/congressional`)

**Purpose:** Track congressional requests, testimony schedules, and response rates.

**Features:**
- Request tracking by committee
- Response rate metrics
- Testimony scheduling
- Committee coordination tools

## Technology Stack

### Data Engineering
- **Data Sources:** USASpending, FMR, OMB Circulars, CRS Reports, GAO Reports
- **Storage:** Parquet files, SQLite database
- **Processing:** Python (Pandas, PyArrow)
- **Pipeline:** Apache Airflow (planned)

### Machine Learning & AI
- **Models:** Scikit-learn, XGBoost
- **NLP:** Hugging Face Transformers, LangChain
- **Use Cases:** Budget estimation, justification analysis, compliance scoring

### Visualization
- **Libraries:** Plotly, D3.js
- **Dashboards:** Custom React components with Tailwind CSS
- **Reporting:** Power BI integration (planned)

### Infrastructure
- **Frontend:** Next.js 14, React, TypeScript
- **Styling:** Tailwind CSS
- **Deployment:** Vercel
- **Database:** SQLite (local), PostgreSQL (planned)

## API Endpoints

### Budget API
- `GET /api/budget` - Budget overview
- `GET /api/budget?type=functions` - Budget by function
- `GET /api/budget?type=agencies` - Budget by agency
- `GET /api/budget?type=fiscal-year` - Budget by fiscal year

### PPBE API
- `GET /api/ppbe` - PPBE compliance data

### GAO API
- `GET /api/gao` - GAO audit findings

### Congressional API
- `GET /api/congressional` - Congressional oversight data

## Data Flow

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   USASpending   │────▶│   Processing    │────▶│   Database      │
│     Data        │     │     Pipeline    │     │   (SQLite)      │
└─────────────────┘     └─────────────────┘     └─────────────────┘
        ▲                                               │
        │                                               ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   FMR/OCB/GS    │────▶│   Knowledge     │────▶│   API Layer     │
│   Documents     │     │   Bank          │     │   (Next.js)     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                                                       │
                                                       ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Analytics     │◀───▶│   Dashboard     │◀───▶│   Frontend      │
│   & ML Models   │     │   Components    │     │   (React)       │
└─────────────────┘     └─────────────────┘     └─────────────────┘
```

## Getting Started

1. Clone the repository:
   ```bash
   git clone <repo-url>
   cd datamatter
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

4. Open http://localhost:3000 in your browser

## Available Scripts

- `npm run dev` - Start development server
- `npm run build` - Build production
- `npm run start` - Start production server
- `npm run lint` - Run linter

## Project Structure

```
datamatter/
├── app/
│   ├── budget/           # Budget analysis page
│   ├── ppbe/            # PPBE compliance page
│   ├── gao/             # GAO audit findings page
│   ├── congressional/   # Congressional oversight page
│   ├── showcase/        # Showcase landing page
│   ├── api/
│   │   ├── budget/      # Budget API
│   │   ├── ppbe/      # PPBE API
│   │   ├── gao/       # GAO API
│   │   └── congressional/  # Congressional API
│   └── page.tsx       # Home page
├── components/         # React components
├── database/          # Database schema and scripts
├── scripts/           # Data processing scripts
└── public/            # Static assets
```

## Data Sources Reference

### USASpending
- URL: https://www.usaspending.gov
- Agency Code: 097 (DoD)
- Data Types: Awards, Contracts, Assistance

### DoD Financial Management Regulations (FMR)
- Version: DoD 7000.14-R
- Volumes: Budget Execution, Accounting Policy, Disbursing Policy, etc.

### OMB Circulars
- A-11: Budget Preparation and Execution
- A-123: Internal Controls
- A-136: Financial Report Requirements

### Congressional Research Service
- Reports on defense budget and appropriations
- Historical analysis and policy briefs

### Government Accountability Office
- Audit reports and findings
- Red Book standards for financial statements

## License

This project is for internal DoD use only.

## Contact

For questions or issues, contact the AI Solutions team at OUSD(C).