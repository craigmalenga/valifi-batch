#!/usr/bin/env python
"""
Setup script for Vehicle Finance Claims application
Run with: python setup.py
"""

import os
import sys

print("Vehicle Finance Claims - Setup Script")
print("="*50)

# Check environment variables
print("\n1. Checking environment variables...")
required_vars = [
    "VALIFI_API_URL",
    "VALIFI_API_USER", 
    "VALIFI_API_PASS",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "AWS_S3_BUCKET",
    "FLG_API_KEY",
    "REDIS_URL"
]

missing_vars = []
for var in required_vars:
    if os.getenv(var):
        print(f"✓ {var} is set")
    else:
        print(f"✗ {var} is MISSING")
        missing_vars.append(var)

if missing_vars:
    print(f"\n⚠️  Missing environment variables: {', '.join(missing_vars)}")
    print("Please set these in Railway dashboard before continuing.")
    sys.exit(1)

# Initialize database
print("\n2. Initializing database...")
try:
    from app import app, db
    
    with app.app_context():
        # Create all tables
        db.create_all()
        print("✓ Database tables created")
        
        # Test database connection
        result = db.session.execute('SELECT 1').scalar()
        print(f"✓ Database connection test: {result}")
        
        # Count existing leads
        from app import Lead
        lead_count = Lead.query.count()
        print(f"✓ Existing leads in database: {lead_count}")
        
except Exception as e:
    print(f"✗ Database initialization failed: {e}")
    sys.exit(1)

# Test Redis connection
print("\n3. Testing Redis connection...")
try:
    import redis
    from app import REDIS_URL
    
    r = redis.from_url(REDIS_URL)
    ping = r.ping()
    print(f"✓ Redis PING successful: {ping}")
    
except Exception as e:
    print(f"✗ Redis connection failed: {e}")

# Test S3 connection
print("\n4. Testing S3 connection...")
try:
    from app import s3_client, Config
    
    if s3_client:
        # List buckets to test connection
        response = s3_client.list_buckets()
        print(f"✓ S3 connection successful")
        
        # Check if our bucket exists
        bucket_name = Config.AWS_S3_BUCKET
        bucket_exists = any(b['Name'] == bucket_name for b in response['Buckets'])
        
        if bucket_exists:
            print(f"✓ S3 bucket '{bucket_name}' exists")
        else:
            print(f"⚠️  S3 bucket '{bucket_name}' not found - please create it")
    else:
        print("✗ S3 client not initialized")
        
except Exception as e:
    print(f"✗ S3 test failed: {e}")

# Test Valifi connection
print("\n5. Testing Valifi API connection...")
try:
    from app import valifi_client
    
    token = valifi_client.get_token()
    if token:
        print(f"✓ Valifi authentication successful")
        print(f"  Token: {token[:20]}...")
    else:
        print("✗ Failed to get Valifi token")
        
except Exception as e:
    print(f"✗ Valifi connection failed: {e}")

# Check lenders.csv
print("\n6. Checking lenders data...")
try:
    import csv
    if os.path.exists('lenders.csv'):
        with open('lenders.csv', 'r') as f:
            reader = csv.reader(f)
            lender_count = sum(1 for row in reader if len(row) >= 2)
        print(f"✓ Found {lender_count} lenders in lenders.csv")
    else:
        print("✗ lenders.csv not found")
        
except Exception as e:
    print(f"✗ Failed to read lenders.csv: {e}")

# Summary
print("\n" + "="*50)
print("Setup Summary")
print("="*50)

if not missing_vars:
    print("✓ All environment variables are set")
    print("✓ Database is initialized")
    print("✓ Ready for deployment!")
    print("\nNext steps:")
    print("1. Deploy to Railway: railway up")
    print("2. Deploy worker service separately")
    print("3. Visit /health to verify all services")
    print("4. Complete a test submission")
else:
    print("✗ Setup incomplete - please fix issues above")

print("\nFor batch processing setup, see: batch processing guide.docx")
print("For Railway Redis setup, see: Railway Redis Setup Guide")