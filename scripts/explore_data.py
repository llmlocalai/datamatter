#!/usr/bin/env python3
"""
Data exploration script for DoD Budget Knowledge Bank
Extracts insights from parquet files and generates JSON data for the showcase
"""

import pyarrow.parquet as pq
import pandas as pd
import json
import os
from pathlib import Path

# Paths
DATA_ROOT = Path("/Volumes/AI_DATA/data/usaspending")
OUTPUT_DIR = Path("/Volumes/AI_DATA/git/datamatter/app/api/data")

def explore_account_data():
    """Explore account-level data from parquet files"""
    accounts_path = DATA_ROOT / "warehouse" / "accounts"

    # Load all account data
    all_dfs = []
    for parquet_file in accounts_path.rglob("*.parquet"):
        try:
            df = pq.read_table(str(parquet_file)).to_pandas()
            all_dfs.append(df)
            print(f"Loaded {parquet_file.name}: {len(df)} rows")
        except Exception as e:
            print(f"Error loading {parquet_file}: {e}")

    if not all_dfs:
        print("No data files found!")
        return None

    combined_df = pd.concat(all_dfs, ignore_index=True)
    print(f"\nTotal rows: {len(combined_df)}")
    print(f"Total columns: {len(combined_df.columns)}")

    return combined_df

def generate_insights(df):
    """Generate insights from the dataframe"""
    insights = {}

    # Budget by function
    if 'budget_function' in df.columns:
        budget_by_function = df.groupby('budget_function').agg({
            'obligations_incurred': 'sum',
            'gross_outlay_amount': 'sum'
        }).reset_index()
        insights['budget_by_function'] = budget_by_function.to_dict('records')

    # Budget by fiscal year
    if 'fiscal_year' in df.columns:
        budget_by_fy = df.groupby('fiscal_year').agg({
            'obligations_incurred': 'sum',
            'gross_outlay_amount': 'sum'
        }).reset_index()
        insights['budget_by_fiscal_year'] = budget_by_fy.to_dict('records')

    # Budget by agency
    if 'owning_agency_name' in df.columns:
        budget_by_agency = df.groupby('owning_agency_name').agg({
            'obligations_incurred': 'sum',
            'gross_outlay_amount': 'sum'
        }).reset_index()
        insights['budget_by_agency'] = budget_by_agency.to_dict('records')

    # Top recipients
    if 'recipient_name' in df.columns:
        top_recipients = df.groupby('recipient_name').agg({
            'obligations_incurred': 'sum'
        }).reset_index().nlargest(20, 'obligations_incurred')
        insights['top_recipients'] = top_recipients.to_dict('records')

    return insights

def main():
    print("=" * 60)
    print("DoD Budget Data Explorer")
    print("=" * 60)

    # Explore data
    df = explore_account_data()

    if df is None:
        print("No data to process")
        return

    # Generate insights
    print("\nGenerating insights...")
    insights = generate_insights(df)

    # Save insights
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    for key, data in insights.items():
        output_file = OUTPUT_DIR / f"{key}.json"
        with open(output_file, 'w') as f:
            json.dump(data, f, indent=2, default=str)
        print(f"Saved {output_file}")

    print("\n" + "=" * 60)
    print("Data exploration complete!")
    print("=" * 60)

if __name__ == "__main__":
    main()