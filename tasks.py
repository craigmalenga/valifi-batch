"""
Celery tasks for background FLG lead processing
Platform-agnostic: Works on Railway Redis AND AWS SQS
"""
from celery import Celery
import os
import logging
from datetime import datetime

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ============================================================================
# PLATFORM-AGNOSTIC BROKER CONFIGURATION
# Auto-detects Railway Redis or AWS SQS based on environment variables
# ============================================================================

REDIS_URL = os.getenv('REDIS_URL')  # Railway provides this
AWS_REGION = os.getenv('AWS_REGION')  # AWS provides this
AWS_SQS_QUEUE_PREFIX = os.getenv('AWS_SQS_QUEUE_PREFIX', 'belmond-')

# Determine broker based on available environment variables
if REDIS_URL:
    # Railway configuration (current)
    broker_url = REDIS_URL
    backend_url = REDIS_URL
    broker_transport_options = {}
    logger.info("✓ Celery configured for Railway Redis")
elif AWS_REGION:
    # AWS configuration (future migration)
    broker_url = 'sqs://'
    backend_url = 'rpc://'
    broker_transport_options = {
        'region': AWS_REGION,
        'queue_name_prefix': AWS_SQS_QUEUE_PREFIX,
        'visibility_timeout': 3600,
        'polling_interval': 1,
    }
    logger.info("✓ Celery configured for AWS SQS")
else:
    # Local development fallback
    broker_url = 'redis://localhost:6379/0'
    backend_url = 'redis://localhost:6379/0'
    broker_transport_options = {}
    logger.info("✓ Celery configured for local Redis (development)")

# Initialize Celery
celery_app = Celery(
    'flg_processor',
    broker=broker_url,
    backend=backend_url
)

# ============================================================================
# CELERY CONFIGURATION - Optimized for High Volume Processing
# ============================================================================

celery_app.conf.update(
    # Serialization
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    
    # Timezone
    timezone='Europe/London',
    enable_utc=True,
    
    # Task execution settings
    task_acks_late=True,  # Only acknowledge after task completes successfully
    task_reject_on_worker_lost=True,  # Requeue tasks if worker dies
    worker_prefetch_multiplier=1,  # Process one task at a time per worker (prevents overload)
    
    # Timeouts
    task_time_limit=600,  # 10 minutes hard limit (kills task)
    task_soft_time_limit=540,  # 9 minutes soft limit (gives time for cleanup)
    
    # Results
    result_expires=3600,  # Keep task results for 1 hour
    
    # Broker settings
    broker_connection_retry_on_startup=True,
    broker_connection_retry=True,
    broker_connection_max_retries=10,
    broker_transport_options=broker_transport_options,
    
    # Task routing
    task_default_queue='flg_processing',
    task_default_exchange='flg_processing',
    task_default_routing_key='flg.process',
    
    # Worker settings
    worker_max_tasks_per_child=100,  # Restart worker after 100 tasks (memory cleanup)
    worker_disable_rate_limits=True,  # We handle rate limiting in application logic
)

# ============================================================================
# CELERY TASK: FLG Lead Processing
# ============================================================================

@celery_app.task(
    bind=True,
    name='tasks.process_flg_leads_async',
    autoretry_for=(Exception,),
    retry_kwargs={
        'max_retries': 3,
        'countdown': 60  # Wait 60 seconds before first retry
    },
    retry_backoff=True,  # Exponential backoff: 60s, 120s, 240s
    retry_backoff_max=600,  # Max 10 minutes between retries
    retry_jitter=True,  # Add randomness to prevent thundering herd
    acks_late=True,
    reject_on_worker_lost=True,
    time_limit=600,
    soft_time_limit=540
)
def process_flg_leads_async(self, claim_id, summary, accounts, found_lenders, additional_lenders):
    """
    Celery task for asynchronous FLG lead processing.
    
    This task:
    - Creates DCA (motor finance) leads in FLG
    - Creates IRL (irresponsible lending) leads in FLG
    - Updates claim records with lead IDs
    - Sends webhook notifications
    - Automatically retries on failure with exponential backoff
    
    Args:
        claim_id (int): ID of the claim in database
        summary (dict): Full summary data from frontend
        accounts (list): List of all accounts (Valifi found + manual)
        found_lenders (list): List of Valifi-found lenders
        additional_lenders (list): List of manually-added lenders
    
    Returns:
        dict: Results summary with lead IDs, success/fail counts
        
    Raises:
        Exception: Re-raised for Celery retry mechanism
    """

    try:
        retry_info = f"(attempt {self.request.retries + 1}/{self.max_retries + 1})"
        logger.info(f"[CELERY-{claim_id}] ▶ Starting FLG processing {retry_info}")
        
        # Import app function here to avoid circular imports
        # Fix import path for Railway deployment
        import sys
        import os
        app_path = os.path.dirname(os.path.abspath(__file__))
        if app_path not in sys.path:
            sys.path.insert(0, app_path)
        
        from app import process_flg_leads_background


        # Execute the background processing function
        result = process_flg_leads_background(
            claim_id=claim_id,
            summary=summary,
            accounts=accounts,
            found_lenders=found_lenders,
            additional_lenders=additional_lenders
        )
        
        # Log success
        successful = result.get('successful_leads', 0)
        failed = result.get('failed_leads', 0)
        logger.info(f"[CELERY-{claim_id}] ✓ Processing complete: {successful} successful, {failed} failed")
        
        return result
        
    except Exception as e:
        # Log the error
        logger.error(f"[CELERY-{claim_id}] ✗ Task failed: {str(e)}")
        
        # Log retry information
        if self.request.retries < self.max_retries:
            next_retry_seconds = 60 * (2 ** self.request.retries)  # Exponential backoff
            logger.warning(f"[CELERY-{claim_id}] ⟳ Will retry in {next_retry_seconds} seconds")
        else:
            logger.error(f"[CELERY-{claim_id}] ✗ Max retries ({self.max_retries}) reached. Task permanently failed.")
        
        # Re-raise exception for Celery to handle retry
        raise


# ============================================================================
# HEALTH CHECK TASK (for monitoring)
# ============================================================================

@celery_app.task(name='tasks.health_check')
def health_check():
    """
    Simple health check task for monitoring worker availability.
    Can be called periodically to ensure workers are responsive.
    """
    logger.info("Health check task executed successfully")
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat(),
        "broker": "Redis" if REDIS_URL else ("SQS" if AWS_REGION else "Local")
    }


# ============================================================================
# WORKER MAIN (for direct execution during development/testing)
# ============================================================================

if __name__ == '__main__':
    # Allow running worker directly: python tasks.py
    celery_app.worker_main([
        'worker',
        '--loglevel=info',
        '--concurrency=4',
        '--max-tasks-per-child=100'
    ])