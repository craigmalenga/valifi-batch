#!/usr/bin/env python
"""
Script to import lenders from Excel file to database.
Run this once to populate the lenders table.

Usage: python import_lenders.py <excel_file>
"""

import sys
import os
import openpyxl
from datetime import datetime
from sqlalchemy import create_engine, Column, Integer, String, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker

# Database configuration - use same as app.py
DATABASE_URL = os.getenv("DATABASE_URL", "")

# Handle Railway's DATABASE_URL which might be in postgres:// format
if DATABASE_URL.startswith("postgres://"):
    DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)

# If no DATABASE_URL, use MySQL configuration
if not DATABASE_URL:
    MYSQL_HOST = os.getenv("MYSQLHOST", "localhost")
    MYSQL_PORT = os.getenv("MYSQLPORT", "3306")
    MYSQL_USER = os.getenv("MYSQLUSER", "root")
    MYSQL_PASSWORD = os.getenv("MYSQLPASSWORD", "")
    MYSQL_DATABASE = os.getenv("MYSQLDATABASE", "vehicle_finance_claims")
    
    # Construct MySQL URL
    if MYSQL_PASSWORD:
        DATABASE_URL = f"mysql+pymysql://{MYSQL_USER}:{MYSQL_PASSWORD}@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}"
    else:
        DATABASE_URL = f"mysql+pymysql://{MYSQL_USER}@{MYSQL_HOST}:{MYSQL_PORT}/{MYSQL_DATABASE}"

# Database Models
Base = declarative_base()

class Lender(Base):
    __tablename__ = 'lenders'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False, unique=True)
    filename = Column(String(255))
    eligible_or_not = Column(String(10), default='Yes')
    irl_or_not = Column(String(10), default='Yes')
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

def import_lenders(excel_file):
    """Import lenders from Excel file to database"""
    print(f"Loading Excel file: {excel_file}")
    
    # Load the workbook
    wb = openpyxl.load_workbook(excel_file)
    ws = wb.active
    
    print(f"Connecting to database...")
    
    # Create database engine and session
    engine = create_engine(DATABASE_URL)
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    
    imported = 0
    updated = 0
    errors = 0
    
    print("Processing rows...")
    
    # Skip header row, start from row 2
    for row_num, row in enumerate(ws.iter_rows(min_row=2, values_only=True), start=2):
        if not row[0]:  # Skip empty rows
            continue
        
        try:
            name = str(row[0]).strip()
            filename = str(row[1]).strip() if len(row) > 1 and row[1] else None
            eligible_or_not = str(row[2]).strip() if len(row) > 2 and row[2] else 'Yes'
            irl_or_not = str(row[3]).strip() if len(row) > 3 and row[3] else 'Yes'
            
            # Validate values
            if eligible_or_not not in ['Yes', 'No', '']:
                eligible_or_not = 'Yes'
            if irl_or_not not in ['Yes', 'No', '']:
                irl_or_not = 'Yes'
            
            # Check if lender already exists
            existing = session.query(Lender).filter_by(name=name).first()
            
            if existing:
                # Update existing lender
                existing.filename = filename
                existing.eligible_or_not = eligible_or_not
                existing.irl_or_not = irl_or_not
                existing.updated_at = datetime.utcnow()
                updated += 1
                print(f"  Updated: {name}")
            else:
                # Create new lender
                lender = Lender(
                    name=name,
                    filename=filename,
                    eligible_or_not=eligible_or_not,
                    irl_or_not=irl_or_not
                )
                session.add(lender)
                imported += 1
                print(f"  Imported: {name}")
                
        except Exception as e:
            errors += 1
            print(f"  ERROR on row {row_num}: {e}")
            continue
    
    # Commit all changes
    try:
        session.commit()
        print("\n✅ Import completed successfully!")
        print(f"  - Imported: {imported} new lenders")
        print(f"  - Updated: {updated} existing lenders")
        if errors:
            print(f"  - Errors: {errors} rows skipped")
    except Exception as e:
        session.rollback()
        print(f"\n❌ Failed to commit changes: {e}")
    finally:
        session.close()

def main():
    if len(sys.argv) < 2:
        print("Usage: python import_lenders.py <excel_file>")
        print("\nExample: python import_lenders.py 'lenders new version.xlsm'")
        sys.exit(1)
    
    excel_file = sys.argv[1]
    
    if not os.path.exists(excel_file):
        print(f"Error: File '{excel_file}' not found")
        sys.exit(1)
    
    if not excel_file.endswith(('.xlsx', '.xlsm')):
        print("Error: File must be in Excel format (.xlsx or .xlsm)")
        sys.exit(1)
    
    import_lenders(excel_file)

if __name__ == "__main__":
    main()