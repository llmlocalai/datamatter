#!/usr/bin/env python3
"""
Database population script for DoD Budget showcase
"""

import sqlite3
import json
from pathlib import Path

# Paths
DB_PATH = Path("/Users/llmpowerhouse/ai_data/git/datamatter/database/dod_budget.db")
DATA_PATH = Path("/Users/llmpowerhouse/ai_data/git/datamatter/app/api/data")

def main():
    print("Populating database...")
    
    # Create database directory
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    
    # Connect to database
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Create tables
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS budget_functions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            function_name TEXT,
            amount REAL,
            fiscal_year INTEGER
        )
    """)
    
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ppbe_compliance (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            program_name TEXT,
            status TEXT
        )
    """)
    
    # Insert sample data
    cursor.execute("""
        INSERT INTO budget_functions (function_name, amount, fiscal_year)
        VALUES ('Personnel', 350000000000, 2026)
    """)
    
    cursor.execute("""
        INSERT INTO budget_functions (function_name, amount, fiscal_year)
        VALUES ('Operations & Maintenance', 250000000000, 2026)
    """)
    
    cursor.execute("""
        INSERT INTO ppbe_compliance (program_name, status)
        VALUES ('Army Procurement', 'Compliant')
    """)
    
    cursor.execute("""
        INSERT INTO ppbe_compliance (program_name, status)
        VALUES ('Navy Acquisition', 'Compliant')
    """)
    
    conn.commit()
    conn.close()
    
    print("Database populated successfully!")

if __name__ == "__main__":
    main()
