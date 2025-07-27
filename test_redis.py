#!/usr/bin/env python
"""
Test Redis connection and Celery setup
Run with: python test_redis.py
"""

import os
import sys
from datetime import datetime

# Test basic Redis connection
print("="*50)
print("Testing Redis Connection")
print("="*50)

try:
    import redis
    
    REDIS_URL = os.getenv("REDIS_URL", "redis://localhost:6379/0")
    print(f"Redis URL: {REDIS_URL}")
    
    # Handle Railway's Redis URL format
    if REDIS_URL.startswith('rediss://'):
        REDIS_URL = REDIS_URL.replace('rediss://', 'redis://')
        print(f"Adjusted URL: {REDIS_URL}")
    
    # Connect to Redis
    r = redis.from_url(REDIS_URL)
    
    # Test basic operations
    print("\nTesting basic Redis operations:")
    
    # PING
    ping_result = r.ping()
    print(f"✓ PING: {ping_result}")
    
    # SET/GET
    test_key = f"test_key_{datetime.now().timestamp()}"
    r.set(test_key, "Hello from VFC!")
    value = r.get(test_key).decode('utf-8')
    print(f"✓ SET/GET: {value}")
    
    # DELETE
    r.delete(test_key)
    print(f"✓ DELETE: Key removed")
    
    # INFO
    info = r.info()
    print(f"✓ Redis Version: {info.get('redis_version', 'Unknown')}")
    print(f"✓ Connected Clients: {info.get('connected_clients', 0)}")
    print(f"✓ Used Memory: {info.get('used_memory_human', 'Unknown')}")
    
except Exception as e:
    print(f"✗ Redis connection failed: {e}")
    sys.exit(1)

# Test Celery setup
print("\n" + "="*50)
print("Testing Celery Setup")
print("="*50)

try:
    from app import celery, app
    
    print("✓ Celery imported successfully")
    
    # Test task definition
    @celery.task
    def test_task(x, y):
        return x + y
    
    print("✓ Test task defined")
    
    # Send test task
    with app.app_context():
        result = test_task.delay(4, 6)
        print(f"✓ Task sent with ID: {result.id}")
        
        # Try to get result (with timeout)
        try:
            task_result = result.get(timeout=5)
            print(f"✓ Task result: {task_result}")
        except Exception as e:
            print(f"! Task result timeout (worker might not be running): {e}")
    
    # Check Celery status
    try:
        stats = celery.control.inspect().stats()
        if stats:
            print(f"✓ Active workers: {len(stats)}")
            for worker, info in stats.items():
                print(f"  - {worker}")
        else:
            print("! No active workers found")
    except:
        print("! Could not inspect workers")
        
except Exception as e:
    print(f"✗ Celery test failed: {e}")
    import traceback
    traceback.print_exc()

print("\n" + "="*50)
print("Test Complete")
print("="*50)