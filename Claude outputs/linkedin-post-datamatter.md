A budget number is only as good as the rule that produced it.

Three weeks, 50 commits and 47 data controls later, here's what it took to turn 49 million public spending records into a Department of War (DoD) budget execution tool I'd trust in a review.

WHAT GOES IN
• 48.9M contract and assistance records, FY2021–26, two monthly snapshots (4.7 GB of USAspending data)
• 12.0M award-to-account rows (File C), plus the File A and File B account submissions
• 8 President's Budget books of P-1/P-1R/R-1 exhibits (50,619 lines), 160 weapon systems, 540 R-2 justification exhibits
• A 10,534-document DoD financial management knowledge bank

WHAT COMES OUT
• 260,360 published rows across 16 datasets and 69 tables
• 18 pages and 8 APIs across formulation (budget exhibits, J-books), execution (resources to obligations to outlays, drill-downs, contract timing, year-end signals) and oversight (reconciliation, traceability, audit posture)
• Every figure names its source and vintage

THE PROCESS THAT MATTERED MORE THAN THE CODE
1. Scope before sums. One non-DoD agency code overstated FY2025 obligations by $108.7B (7.0%).
2. Fix the grain, not the total. FY2026 File B repeats figures across reporting keys; summed as published it runs 34.9% high.
3. Memo rows are traps. $30.1B double-counted in one budget table; $14.4B of advance procurement counted twice in PB2026.
4. Know where the data ends. DoD contract data publishes on a 90-day delay. Reading the last date as the end made every organization look behind (68–99% of normal pace) when they were ahead (104–127%).
5. Controls run inside the load. 20 of 47 block publication, and every new one was deliberately broken to prove it catches something.
6. Release order is a control too: migrate, refresh, then deploy.

LATEST: EXECUTION BY PROGRAM YEAR
A fiscal year's execution isn't that year's money. Of $1.36T obligated in FY2026 through July, $864.4B is FY2026 money (75.1% of what's available to it) and $186.8B is FY2025 money still executing. You can now filter to current-year or any then-year funds and drill from component to object class.

The hard part was never the chart. It was knowing which number is allowed on it.

Public data only. No CUI.

#FederalFinance #PPBE #BudgetExecution #DataEngineering #OpenData
