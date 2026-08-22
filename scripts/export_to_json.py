#!/usr/bin/env python3
"""
Export SQLite database to JSON files for API use
"""

import sqlite3
import json
from pathlib import Path

DB_PATH = Path("/Volumes/AI_DATA/git/datamatter/database/dod_budget.db")
OUTPUT_DIR = Path("/Volumes/AI_DATA/git/datamatter/app/api/data")

def export_table(table_name, output_file):
    """Export a table to JSON"""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()

    cursor.execute(f"SELECT * FROM {table_name}")
    columns = [description[0] for description in cursor.description]
    rows = cursor.fetchall()

    data = []
    for row in rows:
        record = dict(zip(columns, row))
        data.append(record)

    conn.close()

    # Write to file
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    with open(output_file, 'w') as f:
        json.dump(data, f, indent=2, default=str)

    print(f"Exported {table_name} to {output_file}")

def main():
    print("Exporting database to JSON...")

    # Export all tables
    export_table("budget_functions", OUTPUT_DIR / "budget_by_function.json")
    export_table("budget_agencies", OUTPUT_DIR / "budget_by_agency.json")
    export_table("ppbe_compliance", OUTPUT_DIR / "ppbe_compliance.json")
    export_table("gao_findings", OUTPUT_DIR / "gao_audit.json")
    export_table("congressional_requests", OUTPUT_DIR / "congressional_tracking.json")

    print("\nExport complete!")

if __name__ == "__main__":
    main()