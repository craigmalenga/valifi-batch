from gevent import monkey
monkey.patch_all()

import os
import logging
import uuid
import base64
import json
from datetime import datetime, timedelta
from functools import wraps
import xml.etree.ElementTree as ET
import csv
import threading
import time
import secrets

from tracking_models import VisitorSession, OfflineCampaign, TrafficSpike
from tracking_routes import tracking_bp
import pytz
import user_agents 

from psycogreen.gevent import patch_psycopg
patch_psycopg()


from flask import Flask, render_template, request, jsonify, send_file, Response, send_from_directory, session
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

import requests
import boto3
import botocore
import hashlib
import re
import hmac
from collections import Counter

from sqlalchemy import create_engine, Column, Integer, String, Boolean, DateTime, Date, Text, Float, ForeignKey, Index, func, or_, and_, Enum, DECIMAL, text
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import sessionmaker, relationship, scoped_session, joinedload
from sqlalchemy.exc import SQLAlchemyError
from dateutil import parser as date_parser

def format_addresses_for_flg(previous_address, previous_previous_address):
    """Stub function - just returns empty string"""
    return ""

def format_single_address_for_flg(address):
    """Stub function - just returns empty string"""
    return ""

def get_client_ip():
    """Simple function to get client IP"""
    return request.remote_addr or "127.0.0.1"

# Mapping for disengagement reasons (Section B - Existing Representation)
DISENGAGEMENT_REASON_MAP = {
    "poor_communication": "Poor communication",
    "no_progress": "No progress on my claim",
    "high_fees": "High fees", 
    "lost_confidence": "Lost confidence in their service",
    "better_service": "Found better service with Belmond",
    "other": "Other reason"
}

# Note: Choice reasons (Section A) already come as full text from the frontend
CHOICE_REASON_MAP = {
    "Time Saving": "I want to save time and effort",
    "Expertise": "I want expert guidance",
    "Comprehensive": "I want all potential claim types investigated",
    "Support": "I want dedicated support throughout",
    "Other": "Other reason"
}



# === SECTION SEPARATOR ===

class Config:
    """Centralized configuration management"""
    # Valifi API
    VALIFI_API_URL = os.getenv("VALIFI_API_URL", "").rstrip("/")
    VALIFI_API_USER = os.getenv("VALIFI_API_USER", "")
    VALIFI_API_PASS = os.getenv("VALIFI_API_PASS", "")
    VALIFI_MIN_ID_SCORE = int(os.getenv("VALIFI_MIN_ID_SCORE", "40"))
    
    # AWS
    AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
    AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
    AWS_REGION = os.getenv("AWS_REGION", "eu-west-2")
    AWS_S3_BUCKET = os.getenv("AWS_S3_BUCKET")
    
    # META PIXEL LOG IN
    META_PIXEL_ID = os.getenv("META_PIXEL_ID", "")

    # FLG API
    FLG_API_URL = os.getenv("FLG_API_URL", "")
    FLG_API_KEY = os.getenv("FLG_API_KEY", "")
    FLG_LEADGROUP_ID = os.getenv("FLG_LEADGROUP_ID", "")  # DCA claims
    FLG_IRL_LEADGROUP_ID = os.getenv("FLG_IRL_LEADGROUP_ID", "")  # Irresponsible claims
    FLG_UPDATE_URL = os.getenv("FLG_UPDATE_URL")
    
    # Webhook configuration - Now split into base URL and secret
    WEBHOOK_BASE_URL = os.getenv("webhook_update_form", "")
    WEBHOOK_SECRET = os.getenv("WEBHOOK_SECRET", "")
    
    # Combine them to form full webhook URL
    @property
    def WEBHOOK_URL(self):
        if self.WEBHOOK_BASE_URL and self.WEBHOOK_SECRET:
            separator = "&" if "?" in self.WEBHOOK_BASE_URL else "?"
            return f"{self.WEBHOOK_BASE_URL}{separator}secret={self.WEBHOOK_SECRET}"
        return self.WEBHOOK_BASE_URL
    
    # Webhook configuration for receiving updates
    WEBHOOK_API_KEY = os.getenv("WEBHOOK_API_KEY", "")
    if not WEBHOOK_API_KEY:
        print("WARNING: WEBHOOK_API_KEY not set in environment! Webhook authentication will fail!")
        WEBHOOK_API_KEY = "WEBHOOK_KEY_NOT_SET"  # Obvious placeholder instead of random
    
    FLG_STATUS_UPDATE_ENABLED = os.getenv("FLG_STATUS_UPDATE_ENABLED", "false").lower() == "true"
    WEBHOOK_IP_WHITELIST = os.getenv("WEBHOOK_IP_WHITELIST", "").split(",") if os.getenv("WEBHOOK_IP_WHITELIST") else []
    
    # Database
    DATABASE_URL = os.getenv("DATABASE_URL")
    if DATABASE_URL and DATABASE_URL.startswith("postgres://"):
        DATABASE_URL = DATABASE_URL.replace("postgres://", "postgresql://", 1)
    
    # Application settings
    SECRET_KEY = os.getenv("SECRET_KEY", os.urandom(32).hex())
    DEBUG = os.getenv("DEBUG", "false").lower() == "true"
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    
    # Google Analytics
    GOOGLE_ANALYTICS_ID = os.getenv("GOOGLE_ANALYTICS_ID", "")
    
    # NEW: Cookie tracking configuration
    COOKIE_DAYS = int(os.getenv("COOKIE_DAYS", "30"))
    
    # NEW: Test Mode configuration
    TEST_MODE = os.getenv("TEST_MODE", "no").lower() == "yes"

    # Claims are eligible if agreement started between these dates
    DATE_START = os.getenv("DATE_START", "2007-04-06")  # 6 April 2007
    DATE_END = os.getenv("DATE_END", "2024-11-01")      # 28 January 2021

    # Special date range for different tagging
    SPECIAL_DATE_START = os.getenv("SPECIAL_DATE_START", "2021-01-28")  # 28 January 2021
    SPECIAL_DATE_END = os.getenv("SPECIAL_DATE_END", "2024-11-01")     # 1 November 2024

    # Parse to date objects for claim tracking
    try:
        from dateutil import parser as date_parser
        DATE_START_OBJ = date_parser.parse(DATE_START).date()
        DATE_END_OBJ = date_parser.parse(DATE_END).date()
    except Exception:
        DATE_START_OBJ = DATE_END_OBJ = None

    # Timezone configuration
    TIMEZONE = 'Europe/London'
    
    # Analytics configuration
    ENABLE_VISITOR_TRACKING = os.getenv("ENABLE_VISITOR_TRACKING", "true").lower() == "true"

    # Landing page configuration
    SHOW_LANDING_PAGE = os.getenv("LANDING", "true").lower() == "true"

    # New: Drawdown values for cost field
    DRAWDOWN_ELIGIBLE_1 = float(os.getenv("DRAWDOWN_ELIGIBLE_1", "41.00"))
    DRAWDOWN_ELIGIBLE_2 = float(os.getenv("DRAWDOWN_ELIGIBLE_2", "10.00"))
    DRAWDOWN_ELIGIBLE_3 = float(os.getenv("DRAWDOWN_ELIGIBLE_3", "0.00"))

    # Fuzzy matching thresholds
    LENDER_FUZZY_MATCH_THRESHOLD = int(os.getenv("LENDER_FUZZY_MATCH_THRESHOLD", "80"))


# === SECTION SEPARATOR ===
app = Flask(__name__, 
            static_folder='static',
            static_url_path='/static')

def get_ipaddr():
    """Get client IP address from request headers"""
    # Check X-Forwarded-For header first (for proxies/load balancers)
    if request.headers.get('X-Forwarded-For'):
        # Take the first IP if multiple are present
        ip = request.headers.get('X-Forwarded-For').split(',')[0].strip()
    elif request.headers.get('X-Real-IP'):
        ip = request.headers.get('X-Real-IP')
    else:
        ip = request.remote_addr
    return ip or '0.0.0.0'

def get_rate_limit_key():
    """Custom rate limit key including session ID"""
    # Use IP + session_id for more granular limiting
    ip = get_ipaddr()
    
    # Safely get session_id only from JSON requests
    session_id = ''
    try:
        if request.is_json and request.json:
            session_id = request.json.get('session_id', '')
    except Exception:
        pass  # Not a JSON request, just use IP
    
    return f"{ip}:{session_id}" if session_id else ip

limiter = Limiter(
    app=app,
    key_func=get_rate_limit_key,
    default_limits=["500 per hour"],
    storage_uri="memory://",
    swallow_errors=True  # Don't crash on limiter errors
)

app.config.from_object(Config)
app.register_blueprint(tracking_bp, url_prefix='/tracking')

# Security headers - add after app.register_blueprint(tracking_bp)
# CORS approved origins for cross-domain API access
CORS_ALLOWED_ORIGINS = ['*']

@app.after_request
def add_security_headers(response):
    """Add security headers to all responses"""
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['X-Frame-Options'] = 'DENY'
    response.headers['X-XSS-Protection'] = '1; mode=block'
    response.headers['Strict-Transport-Security'] = 'max-age=31536000; includeSubDomains; preload'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'geolocation=(), microphone=(), camera=()'
    
    # CORS handling for approved origins
    origin = request.headers.get('Origin')
    if '*' in CORS_ALLOWED_ORIGINS:
        response.headers['Access-Control-Allow-Origin'] = '*'
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-API-Key, X-Request-Timestamp, X-Request-Signature'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
    elif origin in CORS_ALLOWED_ORIGINS:
        response.headers['Access-Control-Allow-Origin'] = origin
        response.headers['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-API-Key, X-Request-Timestamp, X-Request-Signature'
        response.headers['Access-Control-Allow-Methods'] = 'GET, POST, PUT, DELETE, OPTIONS'
        response.headers['Access-Control-Allow-Credentials'] = 'true'

    # More restrictive CSP with necessary exceptions for analytics and fonts
    csp_directives = [
        "default-src 'self'",
        # Allow Google Tag Manager, Analytics, Facebook, and ContentSquare
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.googletagmanager.com https://www.google-analytics.com https://*.google-analytics.com https://connect.facebook.net https://*.contentsquare.net https://*.contentsquare.com",
        # Allow own styles, inline styles, Google Fonts, and Adobe Typekit
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://use.typekit.net https://p.typekit.net",
        # Allow images from any HTTPS source
        "img-src 'self' data: https: blob:",
        # Allow Google Fonts and Adobe Typekit fonts
        "font-src 'self' data: https://fonts.gstatic.com https://use.typekit.net https://p.typekit.net",
        # Allow connections to Google Analytics, Facebook (including CAPI), and ContentSquare
        "connect-src 'self' https://www.google-analytics.com https://analytics.google.com https://*.google-analytics.com https://region1.google-analytics.com https://www.facebook.com https://*.facebook.com https://capig.datah04.com https://*.contentsquare.net https://*.contentsquare.com",
        # Allow web workers for ContentSquare
        "worker-src 'self' blob:",
        # Prevent framing (clickjacking protection)
        "frame-ancestors 'none'",
        # Only allow base tags to reference own origin
        "base-uri 'self'",
        # Only allow form submissions to own origin
        "form-action 'self'",
        # Upgrade all HTTP requests to HTTPS
        "upgrade-insecure-requests"
    ]
    response.headers['Content-Security-Policy'] = "; ".join(csp_directives)
    
    return response


# Enable debug mode for static files in development
if Config.DEBUG:
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# === SECTION SEPARATOR ===
logging.basicConfig(
    level=getattr(logging, Config.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Celery configuration - detects if Celery should be used
USE_CELERY = os.getenv("USE_CELERY", "false").lower() == "true"

# Import Celery task only if enabled
if USE_CELERY:
    try:
        from tasks import process_flg_leads_async
        logger.info("✓ Celery enabled - background tasks will use Celery workers")
    except ImportError as e:
        logger.warning(f"⚠ Celery import failed: {e}. Falling back to direct processing.")
        USE_CELERY = False
else:
    logger.info("✓ Celery disabled - background tasks will process synchronously")

# === SECTION SEPARATOR ===
Base = declarative_base()

# Database Models
# app.py (Lender model)
class Lender(Base):
    __tablename__ = 'lenders'

    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False, unique=True)
    matching_names = Column(Text)
    fortress_name = Column(String(255))    
    filename = Column(String(255))
    # NEW  - maps your existing DB column:
    flg_lender_name = Column(String(255), name='flg_lender_name')
    eligible_or_not = Column(String(10), default='Yes')
    irl_or_not = Column(String(10), default='Yes')
    DCA_cost_order = Column(Integer, default=999)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)



class ClaimTracking(Base):
    __tablename__ = 'claims_tracking'
    
    id = Column(Integer, primary_key=True)
    # Personal Information
    lead_ids = Column(Text)  # JSON array
    first_name = Column(String(100))
    last_name = Column(String(100))
    email = Column(String(255))
    mobile = Column(String(20))
    date_of_birth = Column(Date)
    
    # Address Information
    current_address = Column(Text)  # JSON
    previous_addresses = Column(Text)  # JSON
    
    # Identity Verification
    identity_score = Column(Integer)
    identity_verified = Column(Boolean, default=False)
    valifi_response_stored = Column(Boolean, default=False)
    
    # Lenders Information
    lenders_found = Column(Integer, default=0)
    lenders_found_list = Column(Text)  # JSON
    lenders_manual = Column(Integer, default=0)
    lenders_manual_list = Column(Text)  # JSON
    lenders_eligible = Column(Integer, default=0)
    lenders_ineligible = Column(Integer, default=0)
    
    # Eligibility Information
    all_within_date_range = Column(Boolean, default=False)
    date_range_start = Column(Date)
    date_range_end = Column(Date)
    ineligible_reason = Column(Text)  # JSON
    
    # Claim Types
    motor_finance_consent = Column(Boolean, default=False)
    irresponsible_lending_consent = Column(Boolean, default=False)
    
    # NEW FCA Choice Fields
    belmond_choice_consent = Column(Boolean, default=False)
    choice_reason = Column(String(255))
    other_reason_text = Column(String(120))
    disengagement_reason = Column(String(255))  # NEW - Full text reason for changing representation
    disengagement_other_text = Column(String(255))  # NEW - Custom text if "other" selected

    # Campaign and Source
    campaign = Column(Text)  # Changed to Text to store full URL parameters
    client_ip = Column(String(45))
    
    # Status and Outcomes
    claim_submitted = Column(Boolean, default=False)
    submission_datetime = Column(DateTime)
    leads_created_count = Column(Integer, default=0)
    pdf_url = Column(Text)
    signature_provided = Column(Boolean, default=False)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationships
    lender_matches = relationship('ClaimLenderMatch', back_populates='claim', cascade='all, delete-orphan')

    existing_representation_consent = Column(String(10), default=None)  # 'No' or 'Yes'
    existing_representation_details = Column(Text)  # JSON array of selected firm IDs
    mammoth_promotions_consent = Column(Boolean, default=False)
    
    # Relationship to professional representatives
    professional_representatives = relationship('ClaimProfessionalRepresentative', 
                                               back_populates='claim', 
                                               cascade='all, delete-orphan')


    cmc_in_credit_report = Column(String(3))  # 'Yes' or 'No'
    credit_report_s3_url = Column(Text)
    user_agent = Column(String(255))
    signature_submitted = Column(Boolean, default=False)
    claim_status = Column(String(50), default='pending')
    lead_source = Column(String(50), default='api')


class ProfessionalRepresentative(Base):
    __tablename__ = 'professional_representatives'
    
    id = Column(Integer, primary_key=True)
    name = Column(String(255), nullable=False, unique=True)

    type = Column(Enum('CMC', 'SRA', 'Both', name='rep_type_enum'), default='CMC')

    active = Column(Boolean, default=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # Relationship
    claim_associations = relationship('ClaimProfessionalRepresentative', 
                                     back_populates='representative')

class ClaimProfessionalRepresentative(Base):
    __tablename__ = 'claim_professional_representatives'
    
    id = Column(Integer, primary_key=True)
    claim_id = Column(Integer, ForeignKey('claims_tracking.id'))
    representative_id = Column(Integer, ForeignKey('professional_representatives.id'))
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    claim = relationship('ClaimTracking', back_populates='professional_representatives')
    representative = relationship('ProfessionalRepresentative', back_populates='claim_associations')


# Model for lead_ids_tracking table (add to your models section)
class LeadIDTracking(Base):
    __tablename__ = 'lead_ids_tracking'
    
    id = Column(Integer, primary_key=True)
    claim_id = Column(Integer, ForeignKey('claims_tracking.id'))
    lead_id = Column(String(50), nullable=False, unique=True)
    lead_group = Column(String(20))
    lead_type = Column(String(50))
    lender_name = Column(String(255))
    reference = Column(String(100))
    cost = Column(DECIMAL(10,2))
    
    # Applicant info (denormalized)
    applicant_id = Column(Integer)
    first_name = Column(String(100))
    last_name = Column(String(100))
    email = Column(String(255))
    mobile = Column(String(20))
    date_of_birth = Column(Date)
    post_code = Column(String(20))
    
    # Lender details
    account_number = Column(String(100))
    start_date = Column(Date)
    outstanding_balance = Column(DECIMAL(10,2))
    monthly_payment = Column(DECIMAL(10,2))
    lender_data_json = Column(Text)  # NEW: JSON data for the specific lender account from Valifi
    
    # Eligibility
    is_eligible = Column(Boolean, default=True)
    ineligible_reason = Column(String(255))
    is_manual = Column(Boolean, default=False)
    within_date_range = Column(Boolean, default=True)
    
    # Consents
    motor_finance_consent = Column(Boolean, default=False)
    irresponsible_lending_consent = Column(Boolean, default=False)
    
    # Campaign
    campaign = Column(Text)  # Changed to Text to store full URL parameters
    client_ip = Column(String(45))
    
    # Status
    claim_submitted = Column(Boolean, default=False)
    submission_datetime = Column(DateTime)
    signature_provided = Column(Boolean, default=False)
    
    # FLG status tracking
    current_status = Column(String(100))
    current_introducer = Column(String(100))
    last_status_update = Column(DateTime)
    
    # Metadata
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

class ClaimLenderMatch(Base):
    __tablename__ = 'claim_lender_matches'
    
    id = Column(Integer, primary_key=True)
    claim_id = Column(Integer, ForeignKey('claims_tracking.id'))
    lender_id = Column(Integer, ForeignKey('lenders.id', ondelete='SET NULL'))
    lender_name = Column(String(255))
    account_number = Column(String(100))
    start_date = Column(Date)
    outstanding_balance = Column(Float)
    monthly_payment = Column(Float)
    is_eligible = Column(Boolean, default=True)
    ineligible_reason = Column(String(255))
    is_manual = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    # Relationships
    claim = relationship('ClaimTracking', back_populates='lender_matches')
    lender = relationship('Lender')

class FLGStatusMapping(Base):
    __tablename__ = 'flg_status_mappings'
    
    id = Column(Integer, primary_key=True)
    lead_group = Column(String(10))
    status_received = Column(String(100))
    introducer_received = Column(String(100))
    data35_received = Column(String(100))
    action = Column(String(50), nullable=False)
    new_status = Column(String(100))
    new_introducer = Column(String(100))
    new_cost = Column(Float)
    priority = Column(Integer, default=0)
    active = Column(Boolean, default=True)
    notes = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

class WebhookLog(Base):
    __tablename__ = 'webhook_logs'
    
    id = Column(Integer, primary_key=True)
    lead_id = Column(String(50))
    lead_group = Column(String(10))
    status_received = Column(String(100))
    introducer_received = Column(String(100))
    data35_received = Column(String(100))
    action_taken = Column(String(50))
    request_body = Column(Text)
    response_body = Column(Text)
    ip_address = Column(String(45))
    api_key_used = Column(String(100))
    success = Column(Boolean, default=False)
    error_message = Column(Text)
    created_at = Column(DateTime, default=datetime.utcnow)

class LeadLenderTracking(Base):
    __tablename__ = 'lead_lender_tracking'
    
    id = Column(Integer, primary_key=True)
    claim_id = Column(Integer, ForeignKey('claims_tracking.id'))
    lead_id = Column(String(50))
    lender_name = Column(String(255))
    source = Column(String(20), default='api')  # 'api' or 'manual'
    is_eligible = Column(Boolean, default=True)
    eligibility_reason = Column(Text)
    introducer = Column(String(50))
    cost = Column(Float)
    position_in_claim = Column(Integer)
    created_at = Column(DateTime, default=datetime.utcnow)

# PRODUCTION DATABASE CONFIG - READY FOR LAUNCH
try:
    import os
    
    db_url = Config.DATABASE_URL
    if db_url and db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql://", 1)
    
    if "?" in db_url:
        db_url = db_url.split("?")[0]
    
    db_url = f"{db_url}?sslmode=disable"
    
    # IMPORTANT: Add psycogreen patch at top of file
    # from psycogreen.gevent import patch_psycopg
    # patch_psycopg()
    
    from sqlalchemy.pool import NullPool
    
    engine = create_engine(
        db_url,
        poolclass=NullPool,  # Let PostgreSQL handle ALL pooling
        
        connect_args={
            "connect_timeout": 10,
            "options": "-c statement_timeout=30000"
        }
    )
    
    # Quick test
    with engine.connect() as conn:
        conn.execute(text("SELECT 1")).scalar()
    
    Base.metadata.create_all(engine)
    
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    db_session = scoped_session(SessionLocal)
    
    logger.info("Database ready for production launch - using PostgreSQL native pooling")
    
    # Fix any sequence issues on startup
    try:
        sequence_result = fix_database_sequences()
        if sequence_result.get("fixed"):
            logger.info(f"Startup sequence fix: {sequence_result['fixed']}")
    except Exception as e:
        logger.warning(f"Could not fix sequences on startup: {e}")


except Exception as e:
    logger.error(f"Database init failed: {e}")
    raise




except Exception as e:
    logger.error(f"Database initialization failed: {e}")
    # Try one more time with minimal config
    try:
        logger.info("Retrying with minimal configuration...")
        simple_url = Config.DATABASE_URL.replace("postgres://", "postgresql://")
        if "?" in simple_url:
            simple_url = simple_url.split("?")[0]
        simple_url = f"{simple_url}?sslmode=disable"
        
        engine = create_engine(simple_url, pool_pre_ping=True)
        Base.metadata.create_all(engine)
        SessionLocal = sessionmaker(bind=engine)
        db_session = scoped_session(SessionLocal)
        logger.info("Database connected with fallback configuration")
    except:
        raise



# === SECTION SEPARATOR ===
try:
    # S3 client - keep in eu-north-1 (where bucket exists)
    s3_client = boto3.client(
        "s3",
        aws_access_key_id=Config.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=Config.AWS_SECRET_ACCESS_KEY,
        region_name="eu-north-1",  # Hardcoded to Stockholm where bucket is
    )
    logger.info("S3 client initialized successfully (eu-north-1)")
except Exception as e:
    logger.error(f"Failed to initialize S3 client: {e}")
    s3_client = None

# SNS client - use eu-west-2 for UK SMS
try:
    sns_client = boto3.client(
        "sns",
        aws_access_key_id=Config.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=Config.AWS_SECRET_ACCESS_KEY,
        region_name="eu-west-2",  # London region for SMS
    )
    logger.info("SNS client initialized successfully (eu-west-2)")
except Exception as e:
    logger.error(f"Failed to initialize SNS client: {e}")
    sns_client = None


# === SECTION SEPARATOR ===
def handle_errors(f):
    """Decorator for consistent error handling"""
    @wraps(f)
    def decorated_function(*args, **kwargs):
        try:
            return f(*args, **kwargs)
        except requests.RequestException as e:
            logger.error(f"Request error in {f.__name__}: {str(e)}")
            return jsonify({"error": "External service error", "details": str(e)}), 503
        except Exception as e:
            logger.error(f"Unexpected error in {f.__name__}: {str(e)}")
            return jsonify({"error": "Internal server error", "details": str(e)}), 500
    return decorated_function

def get_uk_time():
    """Get current UK time (handles BST/GMT automatically)"""
    uk_tz = pytz.timezone(Config.TIMEZONE)
    return datetime.now(uk_tz)



# === SECTION SEPARATOR ===
def get_client_ip():
    """Get the real client IP address, considering proxy headers"""
    if request.environ.get('HTTP_X_FORWARDED_FOR'):
        # Behind proxy
        ip = request.environ['HTTP_X_FORWARDED_FOR'].split(',')[0].strip()
    elif request.environ.get('HTTP_X_REAL_IP'):
        # Alternative proxy header
        ip = request.environ['HTTP_X_REAL_IP']
    else:
        # Direct connection
        ip = request.environ.get('REMOTE_ADDR', '')
    return ip

# === SECTION SEPARATOR ===
def check_date_eligibility(date_str):
    """Check if a date falls within the configured eligibility range"""
    if not date_str:
        return False, "No date provided"
    
    try:
        # Parse the date string
        if isinstance(date_str, str):
            check_date = date_parser.parse(date_str).date()
        else:
            check_date = date_str
        
        # Parse the configuration dates
        start_date = date_parser.parse(Config.DATE_START).date()
        end_date = date_parser.parse(Config.DATE_END).date()
        
        # Check if date is within range
        if check_date < start_date:
            return False, f"Date {check_date} is before eligible period (starts {start_date})"
        elif check_date > end_date:
            return False, f"Date {check_date} is after eligible period (ends {end_date})"
        else:
            return True, "Date is within eligible range"
            
    except Exception as e:
        logger.error(f"Error checking date eligibility: {e}")
        return False, f"Error parsing date: {str(e)}"

# === SECTION SEPARATOR ===
def format_address_for_valifi(address_data):
    """Format an address dictionary into Valifi's expected structure"""
    if not address_data or not address_data.get('post_code'):
        return None
        
    return {
        "flat": address_data.get("flat", "") or None,
        "houseName": address_data.get("building_name", "") or None,
        "houseNumber": address_data.get("building_number", "") or None,
        "street": address_data.get("street", "") or None,
        "street2": None,
        "district": address_data.get("district", "") or None,
        "postTown": address_data.get("post_town", "") or None,
        "county": address_data.get("county", "") or None,
        "postCode": address_data.get("post_code", "") or None
    }

# === SECTION SEPARATOR ===
def format_previous_addresses_for_data14(summary):
    """Format previous addresses only (no current) for data14 field - semicolon separated"""
    addresses = []
    
    # Previous address 1
    prev1 = summary.get("previousAddress", {})
    if prev1 and prev1.get("post_code"):
        prev1_parts = []
        if prev1.get("building_number"):
            prev1_parts.append(prev1.get("building_number"))
        if prev1.get("building_name"):
            prev1_parts.append(prev1.get("building_name"))
        if prev1.get("flat"):
            prev1_parts.append(prev1.get("flat"))
        if prev1.get("street"):
            prev1_parts.append(prev1.get("street"))
        if prev1.get("post_town"):
            prev1_parts.append(prev1.get("post_town"))
        if prev1.get("post_code"):
            prev1_parts.append(prev1.get("post_code"))
        
        if prev1_parts:
            addresses.append(", ".join(prev1_parts))
    
    # Previous address 2
    prev2 = summary.get("previousPreviousAddress", {})
    if prev2 and prev2.get("post_code"):
        prev2_parts = []
        if prev2.get("building_number"):
            prev2_parts.append(prev2.get("building_number"))
        if prev2.get("building_name"):
            prev2_parts.append(prev2.get("building_name"))
        if prev2.get("flat"):
            prev2_parts.append(prev2.get("flat"))
        if prev2.get("street"):
            prev2_parts.append(prev2.get("street"))
        if prev2.get("post_town"):
            prev2_parts.append(prev2.get("post_town"))
        if prev2.get("post_code"):
            prev2_parts.append(prev2.get("post_code"))
        
        if prev2_parts:
            addresses.append(", ".join(prev2_parts))
    
    # Return semicolon-separated list of previous addresses only
    return "; ".join(addresses) if addresses else ""

def format_address_2_for_data38(summary):
    """Format only address 2 (first previous address) for data38 field"""
    prev1 = summary.get("previousAddress", {})
    if prev1 and prev1.get("post_code"):
        prev1_parts = []
        if prev1.get("building_number"):
            prev1_parts.append(prev1.get("building_number"))
        if prev1.get("building_name"):
            prev1_parts.append(prev1.get("building_name"))
        if prev1.get("flat"):
            prev1_parts.append(prev1.get("flat"))
        if prev1.get("street"):
            prev1_parts.append(prev1.get("street"))
        if prev1.get("post_town"):
            prev1_parts.append(prev1.get("post_town"))
        if prev1.get("post_code"):
            prev1_parts.append(prev1.get("post_code"))
        
        if prev1_parts:
            return ", ".join(prev1_parts)
    
    return ""

def format_address_3_onwards_for_data39(summary):
    """Format address 3 onwards (second previous address and beyond) for data39 field"""
    addresses = []
    
    # Previous address 2 (which is address 3 overall)
    prev2 = summary.get("previousPreviousAddress", {})
    if prev2 and prev2.get("post_code"):
        prev2_parts = []
        if prev2.get("building_number"):
            prev2_parts.append(prev2.get("building_number"))
        if prev2.get("building_name"):
            prev2_parts.append(prev2.get("building_name"))
        if prev2.get("flat"):
            prev2_parts.append(prev2.get("flat"))
        if prev2.get("street"):
            prev2_parts.append(prev2.get("street"))
        if prev2.get("post_town"):
            prev2_parts.append(prev2.get("post_town"))
        if prev2.get("post_code"):
            prev2_parts.append(prev2.get("post_code"))
        
        if prev2_parts:
            addresses.append(", ".join(prev2_parts))
    
    # If system expands to support more addresses in future, they would be added here
    
    return "; ".join(addresses) if addresses else ""

def retry_with_backoff(max_retries=3, initial_delay=0.5, max_delay=5, backoff_factor=2):
    """
    Decorator for retrying operations with exponential backoff
    """
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            delay = initial_delay
            last_exception = None
            
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except requests.exceptions.Timeout as e:
                    last_exception = e
                    logger.warning(f"{func.__name__} timeout (attempt {attempt + 1}/{max_retries}): {e}")
                except requests.exceptions.ConnectionError as e:
                    last_exception = e
                    logger.warning(f"{func.__name__} connection error (attempt {attempt + 1}/{max_retries}): {e}")
                except Exception as e:
                    last_exception = e
                    # Don't retry on 4xx errors (client errors)
                    if hasattr(e, 'response') and e.response and 400 <= e.response.status_code < 500:
                        logger.error(f"{func.__name__} client error: {e}")
                        raise
                    logger.warning(f"{func.__name__} failed (attempt {attempt + 1}/{max_retries}): {e}")
                
                if attempt < max_retries - 1:
                    sleep_time = min(delay, max_delay)
                    logger.info(f"Retrying {func.__name__} in {sleep_time} seconds...")
                    time.sleep(sleep_time)
                    delay *= backoff_factor
                    
            logger.error(f"{func.__name__} failed after {max_retries} attempts")
            raise last_exception
        return wrapper
    return decorator



# === SECTION SEPARATOR ===
class ValifiClient:
    """Valifi API client with robust retry logic"""
    
    def __init__(self):
        self.base_url = Config.VALIFI_BASE_URL
        self.username = Config.VALIFI_USERNAME
        self.password = Config.VALIFI_PASSWORD
        self._token = None
        self._token_expiry = None
        
    @retry_with_backoff(max_retries=3)
    def get_token(self):
        """Get authentication token with caching and retry"""
        if self._token and self._token_expiry and datetime.now() < self._token_expiry:
            return self._token
            
        logger.info("Fetching new Valifi token")
        
        try:
            resp = requests.post(
                f"{self.base_url}/basic-auth",
                auth=(self.username, self.password),
                timeout=15
            )
            resp.raise_for_status()
            
            data = resp.json()
            self._token = data.get("data", {}).get("token")
            if not self._token:
                raise RuntimeError("No token in auth response")
            
            # Token valid for 1 hour
            self._token_expiry = datetime.now() + timedelta(hours=1)
            logger.info("Successfully obtained Valifi token")
            return self._token
            
        except requests.exceptions.RequestException as e:
            logger.error(f"Failed to get Valifi token: {e}")
            self._token = None
            self._token_expiry = None
            raise
    
    def _get_headers(self):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {self.get_token()}",
            "Content-Type": "application/json"
        }
    
    @retry_with_backoff(max_retries=3, initial_delay=1)
    def lookup_address(self, postcode):
        """Lookup addresses by postcode with retry logic"""
        try:
            logger.info(f"Looking up addresses for postcode: {postcode}")
            
            resp = requests.post(
                f"{self.base_url}/bureau/v1/equifax/postcode-lookup",
                json={"clientReference": "lookup", "postCode": postcode},
                headers=self._get_headers(),
                timeout=20  # Increased timeout for address lookup
            )
            resp.raise_for_status()
            
            result = resp.json()
            logger.info(f"Address lookup successful for {postcode}")
            return result
            
        except requests.exceptions.Timeout:
            logger.error(f"Address lookup timeout for postcode: {postcode}")
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Address lookup failed for {postcode}: {e}")
            # If token might be expired, clear it
            if hasattr(e, 'response') and e.response and e.response.status_code == 401:
                self._token = None
                self._token_expiry = None
            raise
    
    @retry_with_backoff(max_retries=3)
    def request_otp(self, mobile):
        """Request OTP with retry logic"""
        try:
            logger.info(f"Requesting OTP for mobile: {mobile}")
            
            resp = requests.post(
                f"{self.base_url}/bureau/v1/sms/send-sms",
                json={"mobileNumber": mobile},
                headers=self._get_headers(),
                timeout=15
            )
            resp.raise_for_status()
            
            result = resp.json()
            logger.info(f"OTP request successful for {mobile}")
            return result, resp.status_code
            
        except requests.exceptions.RequestException as e:
            logger.error(f"OTP request failed for {mobile}: {e}")
            # Clear token on auth errors
            if hasattr(e, 'response') and e.response and e.response.status_code == 401:
                self._token = None
                self._token_expiry = None
            raise
    
    @retry_with_backoff(max_retries=3)
    def verify_otp(self, mobile, otp):
        """Verify OTP with retry logic"""
        try:
            logger.info(f"Verifying OTP for mobile: {mobile}")
            
            resp = requests.post(
                f"{self.base_url}/bureau/v1/sms/verify-sms",
                json={"mobileNumber": mobile, "otp": otp},
                headers=self._get_headers(),
                timeout=15
            )
            resp.raise_for_status()
            
            result = resp.json()
            logger.info(f"OTP verification successful for {mobile}")
            return result
            
        except requests.exceptions.RequestException as e:
            logger.error(f"OTP verification failed for {mobile}: {e}")
            if hasattr(e, 'response') and e.response and e.response.status_code == 401:
                self._token = None
                self._token_expiry = None
            raise
    
    @retry_with_backoff(max_retries=3, initial_delay=1)
    def validate_identity(self, data):
        """Validate identity with retry logic"""
        try:
            logger.info(f"Validating identity for: {data.get('firstName')} {data.get('lastName')}")
            
            # Add default client reference if not provided
            if 'clientReference' not in data:
                data['clientReference'] = 'validation'
                
            resp = requests.post(
                f"{self.base_url}/bureau/v1/equifax/cz",
                json=data,
                headers=self._get_headers(),
                timeout=30  # Longer timeout for identity validation
            )
            resp.raise_for_status()
            
            result = resp.json()
            logger.info(f"Identity validation completed")
            return result
            
        except requests.exceptions.Timeout:
            logger.error("Identity validation timeout")
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Identity validation failed: {e}")
            if hasattr(e, 'response') and e.response and e.response.status_code == 401:
                self._token = None
                self._token_expiry = None
            raise
    
    @retry_with_backoff(max_retries=3, initial_delay=2)
    def get_credit_report(self, data):
        """Get credit report with enhanced logging and session support"""
        # Use session to maintain cookies like Postman
        session = requests.Session()
        
        # Add all headers that Postman sends
        headers = self._get_headers()
        headers.update({
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br",
            "User-Agent": "PostmanRuntime/7.50.0",
            "Cache-Control": "no-cache",
            "Connection": "keep-alive"
        })
        session.headers.update(headers)
        
        try:
            logger.info(f"Getting credit report for: {data.get('firstName')} {data.get('lastName')}")
            
            resp = session.post(
                f"{self.base_url}/bureau/v1/equifax/cz",
                json=data,
                timeout=60
            )
            
            # DEBUG: Log the raw response before any processing
            logger.info("="*80)
            logger.info("VALIFI RAW RESPONSE DEBUG START")
            logger.info(f"Status Code: {resp.status_code}")
            logger.info(f"Response Headers: {dict(resp.headers)}")
            logger.info(f"Response Size: {len(resp.text)} characters")
            
            # Log if we see the missing sections in raw text
            logger.info(f"Contains 'consumerCreditSearchResponse': {'consumerCreditSearchResponse' in resp.text}")
            logger.info(f"Contains 'pdfReport': {'pdfReport' in resp.text}")
            logger.info(f"Contains 'summaryReportV2': {'summaryReportV2' in resp.text}")
            
            # Log first and last 1000 chars to see structure
            logger.info(f"First 1000 chars: {resp.text[:1000]}")
            logger.info(f"Last 1000 chars: {resp.text[-1000:]}")
            
            # If response is small enough, log it all
            if len(resp.text) < 10000:
                logger.info(f"COMPLETE RAW RESPONSE: {resp.text}")
            else:
                logger.info(f"Response too large ({len(resp.text)} chars), check Railway logs for details")
            
            logger.info("VALIFI RAW RESPONSE DEBUG END")
            logger.info("="*80)
            
            resp.raise_for_status()
            result = resp.json()
            logger.info("Credit report retrieved successfully")
            return result
            
        except requests.exceptions.Timeout:
            logger.error("Credit report timeout")
            raise
        except requests.exceptions.RequestException as e:
            logger.error(f"Credit report failed: {e}")
            if hasattr(e, 'response') and e.response and e.response.status_code == 401:
                self._token = None
                self._token_expiry = None
            raise
    """Encapsulates all Valifi API interactions"""
    
    def __init__(self):
        self.base_url = Config.VALIFI_API_URL
        self.username = Config.VALIFI_API_USER
        self.password = Config.VALIFI_API_PASS
        self._token = None
        self._token_expiry = None
    
    def get_token(self):
        """Get authentication token with caching"""
        if self._token and self._token_expiry and datetime.now() < self._token_expiry:
            return self._token
            
        logger.info("Fetching new Valifi token")
        resp = requests.post(
            f"{self.base_url}/basic-auth",
            auth=(self.username, self.password),
            timeout=15
        )
        resp.raise_for_status()
        
        data = resp.json()
        self._token = data.get("data", {}).get("token")
        if not self._token:
            raise RuntimeError("No token in auth response")
        
        # Assume token valid for 1 hour
        self._token_expiry = datetime.now() + timedelta(hours=1)
        return self._token
    
    def _get_headers(self):
        """Get headers with auth token"""
        return {
            "Authorization": f"Bearer {self.get_token()}",
            "Content-Type": "application/json"
        }
    
    def lookup_address(self, postcode):
        """Lookup addresses by postcode"""
        resp = requests.post(
            f"{self.base_url}/bureau/v1/equifax/postcode-lookup",
            json={"clientReference": "lookup", "postCode": postcode},
            headers=self._get_headers(),
            timeout=15
        )
        resp.raise_for_status()
        return resp.json()
    
    def request_otp(self, mobile):
        """Request OTP for mobile number"""
        resp = requests.post(
            f"{self.base_url}/otp/v1/request",
            json={"mobile": mobile},
            headers=self._get_headers(),
            timeout=15
        )
        return resp.json(), resp.status_code
    
    def verify_otp(self, mobile, code):
        """Verify OTP code"""
        resp = requests.post(
            f"{self.base_url}/otp/v1/verify",
            json={"mobile": mobile, "code": code},
            headers=self._get_headers(),
            timeout=15
        )
        return resp.json(), resp.status_code
    
    def validate_identity_with_mobileid(self, payload):
        """
        Validate identity using the tu/validate endpoint which includes MobileID
        This replaces the separate mobile-id and validate endpoints
        """
        resp = requests.post(
            f"{self.base_url}/bureau/v1/tu/validate",
            json=payload,
            headers=self._get_headers(),
            timeout=30
        )
        return resp.json(), resp.status_code
def store_valifi_json_to_s3(valifi_response, claim_id, session_db=None):
    """
    Store the full Valifi JSON response in S3 and return a searchable reference string
    with CMC detection flag
    Returns: (reference_json_string, cmc_detected_bool)
    """
    try:
        # Convert response to JSON string
        if isinstance(valifi_response, str):
            full_json = valifi_response
        else:
            full_json = json.dumps(valifi_response)
        
        # CRITICAL FIX: Case-insensitive search for Valifi/CMC
        # Check for "valifi" in the JSON (case-insensitive)
        valifi_found = "valifi" in full_json.lower()
        
        if valifi_found:
            logger.info(f"Checking for 'valifi' in {len(full_json)} chars of JSON: Found=True")
        else:
            logger.info(f"Checking for 'valifi' in {len(full_json)} chars of JSON: Found=False")

        # Extract searchable lender names
        searchable_lenders = []
        if isinstance(valifi_response, dict):
            summary_v2 = valifi_response.get("data", {}).get("summaryReportV2", {})
            for acc in summary_v2.get("accounts", []):
                lender = acc.get("lenderName", "")
                if lender and lender not in searchable_lenders:
                    searchable_lenders.append(lender)
        
        # Store in S3
        s3_url = None
        if s3_client:
            try:
                filename = f"claim_{claim_id}_credit_report_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
                key = f"credit-reports/{filename}"
                
                s3_client.put_object(
                    Bucket=Config.AWS_S3_BUCKET,
                    Key=key,
                    Body=full_json.encode('utf-8'),
                    ContentType="application/json",
                    Metadata={
                        'claim_id': str(claim_id),
                        'cmc_found': str(valifi_found)
                    }
                )
                
                s3_url = f"https://{Config.AWS_S3_BUCKET}.s3.{Config.AWS_REGION}.amazonaws.com/{key}"
                logger.info(f"Stored full credit report in S3: {key} ({len(full_json)} chars)")
                
                # CRITICAL FIX: Store S3 URL in database - use existing session if provided
                if claim_id and s3_url:
                    own_session = False
                    try:
                        # Use provided session or create new one
                        if not session_db:
                            session_db = db_session()
                            own_session = True
                            logger.info("Created new database session for S3 URL update")
                        else:
                            logger.info("Using existing database session for S3 URL update")
                        
                        claim = session_db.query(ClaimTracking).filter_by(id=claim_id).first()
                        if claim:
                            claim.credit_report_s3_url = s3_url
                            claim.cmc_in_credit_report = "Yes" if valifi_found else "No"
                            
                            # Only commit if we created our own session
                            if own_session:
                                session_db.commit()
                                logger.info(f"Committed S3 URL and CMC status to database for claim {claim_id}")
                            else:
                                # Just flush to ensure it's in the session
                                session_db.flush()
                                logger.info(f"Flushed S3 URL and CMC status to session for claim {claim_id}")
                            
                            logger.info(f"Successfully stored S3 URL and CMC status in database for claim {claim_id}")
                        else:
                            logger.error(f"Claim {claim_id} not found in database")
                    except Exception as e:
                        logger.error(f"Failed to store S3 URL in database: {e}")
                        import traceback
                        logger.error(traceback.format_exc())
                        if own_session and session_db:
                            session_db.rollback()
                    finally:
                        # Only close if we created the session
                        if own_session and session_db:
                            session_db.close()
                
            except Exception as e:
                logger.error(f"Failed to store in S3: {e}")
                import traceback
                logger.error(traceback.format_exc())

        # Create reference JSON with the word "valifi" ONLY when found
        reference_data = {
            "type": "credit_report_reference",
            "claim_id": claim_id,
            "s3_url": s3_url if s3_url else "S3_STORAGE_FAILED",
            "cmc_search_found": "valifi" if valifi_found else False,  # "valifi" or False
            "lenders_found": searchable_lenders,
            "lender_count": len(searchable_lenders)
        }
        
        reference_json = json.dumps(reference_data)
        logger.info(f"Reference JSON created - CMC search found: {valifi_found}")
        logger.info(f"Reference JSON content: {reference_json}")
        
        return reference_json, valifi_found
        
    except Exception as e:
        logger.error(f"Failed to process credit report: {e}")
        import traceback
        logger.error(traceback.format_exc())
        fallback = json.dumps({
            "type": "credit_report_reference", 
            "error": str(e),
            "cmc_search_found": False  # No "valifi" word when error
        })
        return fallback, False
    
class FLGClient:
    """Encapsulates FLG API interactions"""
    
    @staticmethod
    def build_lead_xml(lead):
        """Build XML payload for FLG API"""
        root = ET.Element("data")
        lead_el = ET.SubElement(root, "lead")
        
        # Required fields
        ET.SubElement(lead_el, "key").text = Config.FLG_API_KEY
        ET.SubElement(lead_el, "leadgroup").text = str(lead.get("leadgroup", Config.FLG_LEADGROUP_ID))
        ET.SubElement(lead_el, "site").text = lead.get("site", "0")
        
        # Include optional primary fields used by create/update
        if lead.get("id") is not None:
            ET.SubElement(lead_el, "id").text = str(lead["id"])

        # Reference field (text)
        if lead.get("reference") is not None:
            ET.SubElement(lead_el, "reference").text = str(lead["reference"])

        # DCA: decimal cost (format to 2dp)
        if lead.get("cost") is not None:
            ET.SubElement(lead_el, "cost").text = f"{float(lead['cost']):.2f}"
        
        # ADD COMPANY FIELD WITH APPLICANT_ID
        if lead.get("applicant_id") is not None:
            ET.SubElement(lead_el, "company").text = f"<company>{lead['applicant_id']}</company>"
        
        # Standard fields - NOW INCLUDING introducer
        standard_fields = [
            "source", "medium", "term", "introducer", "title", "firstname", "lastname",
            "phone1", "phone2", "email", "address", "address2", "address3",
            "towncity", "postcode"
        ]
        
        for field in standard_fields:
            if lead.get(field):
                ET.SubElement(lead_el, field).text = str(lead[field])
        
        # Date of birth parsing - MUST SEND BOTH dob (YYYY-MM-DD) AND separate fields
        dob_input = lead.get("dateOfBirth", "")
        logger.info(f"DOB INPUT: '{dob_input}'")  # DEBUG
        
        if dob_input:
            dob_formatted = None
            day = mon = year = None
            
            # Parse based on format
            if "/" in dob_input:
                # DD/MM/YYYY format from frontend
                try:
                    parts = dob_input.split("/")
                    if len(parts) == 3:
                        day, mon, year = parts
                        # Create YYYY-MM-DD format for dob field
                        dob_formatted = f"{year}-{mon.zfill(2)}-{day.zfill(2)}"
                except Exception as e:
                    logger.error(f"Failed to parse DD/MM/YYYY date: {dob_input} - {e}")
                    
            elif "-" in dob_input:
                # Already in YYYY-MM-DD format
                try:
                    parts = dob_input.split("-")
                    if len(parts) == 3:
                        year, mon, day = parts
                        dob_formatted = dob_input
                except Exception as e:
                    logger.error(f"Failed to parse YYYY-MM-DD date: {dob_input} - {e}")
            else:
                # Unknown format, log it
                logger.error(f"Unknown date format: {dob_input}")
            
            # Add the main dob field in YYYY-MM-DD format (required by FLG)
            if dob_formatted:
                logger.info(f"Adding DOB to XML: {dob_formatted}")  # DEBUG
                ET.SubElement(lead_el, "dob").text = dob_formatted
                
            # Also add the separate fields (also required by FLG)
            if day and mon and year:
                logger.info(f"Adding DOB components: day={day}, month={mon}, year={year}")  # DEBUG
                ET.SubElement(lead_el, "dobday").text = day.lstrip('0') or day  # Remove leading zeros
                ET.SubElement(lead_el, "dobmonth").text = mon.lstrip('0') or mon  # Remove leading zeros
                ET.SubElement(lead_el, "dobyear").text = year
        else:
            logger.warning("No DOB provided in lead data")
        
        # Contact preferences - SET TO YES/NO AS REQUESTED
        ET.SubElement(lead_el, "contactphone").text = "Yes"
        ET.SubElement(lead_el, "contactsms").text = "Yes"
        ET.SubElement(lead_el, "contactemail").text = "Yes"
        ET.SubElement(lead_el, "contactmail").text = "Yes"
        ET.SubElement(lead_el, "contactfax").text = "No"

        # Extra data fields - Complete list data1 to data55 for future-proofing
        extra_fields = [
            "data1", "data2", "data3", "data4", "data5", "data6", "data7", "data8", "data9", "data10",
            "data11", "data12", "data13", "data14", "data15", "data16", "data17", "data18", "data19", "data20",
            "data21", "data22", "data23", "data24", "data25", "data26", "data27", "data28", "data29", "data30",
            "data31", "data32", "data33", "data34", "data35", "data36", "data37", "data38", "data39", "data40",
            "data41", "data42", "data43", "data44", "data45", "data46", "data47", "data48", "data49", "data50",
            "data51", "data52", "data53", "data54", "data55"
        ]
        
        for field in extra_fields:
            if lead.get(field):
                ET.SubElement(lead_el, field).text = str(lead[field])
        
        xml_body = ET.tostring(root, encoding="utf-8", method="xml")
        return b'<?xml version="1.0" encoding="UTF-8"?>' + xml_body

    @staticmethod
    def send_lead(xml_payload):
        """Send lead data to FLG"""
        # DEBUG: Log the full XML being sent
        logger.info("=" * 80)
        logger.info("SENDING XML TO FLG:")
        logger.info(xml_payload.decode('utf-8'))
        logger.info("=" * 80)
        
        response = requests.post(
            Config.FLG_API_URL,
            data=xml_payload,
            headers={"Content-Type": "application/xml"},
            timeout=30
        )
        
        # DEBUG: Log the response
        logger.info("FLG RESPONSE:")
        logger.info(f"Status: {response.status_code}")
        logger.info(f"Body: {response.text}")
        logger.info("=" * 80)
        
        return response
        
    @staticmethod
    def parse_lead_id(response_text):
        """Extract lead ID from FLG response - FIXED TO LOOK FOR 'id' TAG"""
        try:
            root = ET.fromstring(response_text)
            # FIXED: Changed from "leadid" to "id" based on actual response format
            # First try to find id in item element
            item = root.find(".//item")
            if item is not None:
                lead_id = item.findtext("id")
                if lead_id:
                    return lead_id
            
            # Fallback to direct search for id element
            lead_id = root.findtext(".//id")
            return lead_id
        except Exception as e:
            logger.error(f"Failed to parse lead ID from response: {e}")
            logger.error(f"Response text was: {response_text}")
            return None


# ======================================================================================== Webhook Client ========================================================================================
def _send_webhook_async(webhook_url, payload):
    """Internal function to send webhook in background thread with shorter timeout"""
    try:
        logger.info(f"[Async] Sending webhook to {webhook_url}")
        logger.info(f"[Async] Webhook payload: {json.dumps(payload)}")
        
        # Use a shorter timeout to prevent blocking
        response = requests.post(
            webhook_url,
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10  # Reduced from 30 to 10 seconds
        )
        
        logger.info(f"[Async] Webhook response status: {response.status_code}")
        logger.info(f"[Async] Webhook response body: {response.text}")
        
        if response.status_code != 200:
            logger.error(f"[Async] Webhook failed with status {response.status_code}: {response.text}")
        else:
            logger.info(f"[Async] Webhook sent successfully")
            
    except requests.exceptions.Timeout:
        logger.warning("[Async] Webhook request timed out after 10 seconds (continuing in background)")
    except Exception as e:
        logger.error(f"[Async] Failed to send webhook: {e}")


def send_lead_ids_to_webhook(lead_ids):
    """Send only lead ID numbers to webhook asynchronously (non-blocking)"""
    try:
        config = Config()
        webhook_url = config.WEBHOOK_URL
        
        if not webhook_url:
            logger.warning("No webhook URL configured, skipping webhook send")
            return True  # Don't fail if webhook not configured
        
        # Extract ONLY the lead_id strings from the detailed objects
        lead_ids_only = []
        for lead in lead_ids:
            if isinstance(lead, dict):
                lead_ids_only.append(str(lead.get('lead_id')))
            else:
                # Backward compatibility for old string format
                lead_ids_only.append(str(lead))
        
        payload = {"leads": lead_ids_only}
        
        logger.info(f"Sending {len(lead_ids_only)} lead IDs to webhook: {webhook_url}")
        
        # Start webhook send in background thread (non-blocking)
        webhook_thread = threading.Thread(
            target=_send_webhook_async,
            args=(webhook_url, payload),
            daemon=True  # Daemon thread will not block application shutdown
        )
        webhook_thread.start()
        
        logger.info("Webhook request initiated in background thread (non-blocking)")
        
        # Return True immediately - we don't wait for the webhook to complete
        return True
        
    except Exception as e:
        logger.error(f"Failed to initiate webhook send: {e}")
        return True  # Return True to not fail the main request





# === SECTION SEPARATOR ===
def levenshtein_distance(s1, s2):
    """Calculate the Levenshtein edit distance between two strings"""
    if len(s1) < len(s2):
        return levenshtein_distance(s2, s1)
    
    if len(s2) == 0:
        return len(s1)
    
    previous_row = range(len(s2) + 1)
    for i, c1 in enumerate(s1):
        current_row = [i + 1]
        for j, c2 in enumerate(s2):
            # Cost of insertions, deletions, or substitutions
            insertions = previous_row[j + 1] + 1
            deletions = current_row[j] + 1
            substitutions = previous_row[j] + (c1 != c2)
            current_row.append(min(insertions, deletions, substitutions))
        previous_row = current_row
    
    return previous_row[-1]


def calculate_similarity(str1, str2):
    """Calculate similarity ratio between two strings (0.0 to 1.0)"""
    if not str1 or not str2:
        return 0.0
    
    # Make comparison case-insensitive
    s1 = str1.lower()
    s2 = str2.lower()
    
    # If strings are identical, return 1.0
    if s1 == s2:
        return 1.0
    
    # Calculate edit distance
    distance = levenshtein_distance(s1, s2)
    max_len = max(len(s1), len(s2))
    
    # Return similarity ratio
    if max_len == 0:
        return 0.0
    
    return (max_len - distance) / max_len


def find_best_lender_match(search_name, all_lenders, threshold=0.8):
    """
    Find the best matching lender using fuzzy matching algorithm with matching_names support
    NOW WITH DETAILED TRACKING FOR DATABASE AUDITING
    
    Args:
        search_name: Name from Valifi/user input to search for
        all_lenders: List of lender dictionaries from database
        threshold: Minimum similarity score (0.0-1.0) to accept a match (default 0.8)
    
    Returns:
        Best matching lender dict with tracking fields or None if no good match found
        Returns dict with: id, name, score, matched_via, fortress_name, flg_name, eligible_or_not, irl_or_not
    """
    if not search_name or not all_lenders:
        return None
    
    search_lower = search_name.lower().strip()
    best_match = None
    best_similarity = 0.0
    best_match_name = None
    
    logger.info(f"Fuzzy matching '{search_name}' against {len(all_lenders)} lenders...")
    
    for lender in all_lenders:
        # Get all possible names to match against
        names_to_check = []
        
        # 1. Always include the main name
        main_name = lender.get('name', '').strip()
        if main_name:
            names_to_check.append(main_name)
        
        # 2. Add matching_names variations if present
        matching_names = lender.get('matching_names', '').strip()
        if matching_names:
            # Split by comma and clean each variant
            variants = [v.strip() for v in matching_names.split(',') if v.strip()]
            names_to_check.extend(variants)
        
        # Log what we're checking (only if multiple variants)
        if len(names_to_check) > 1:
            logger.info(f"  Checking lender '{main_name}' with {len(names_to_check)} name variants")
        
        # Check each name variant
        for check_name in names_to_check:
            check_name_lower = check_name.lower().strip()
            
            if not check_name_lower:
                continue
            
            # 1. EXACT MATCH - highest priority
            if search_lower == check_name_lower:
                logger.info(f"✅ EXACT MATCH: '{search_name}' → '{main_name}' (matched via '{check_name}', similarity: 1.0)")
                # Return with full tracking info
                return {
                    **lender, 
                    'score': 1.00, 
                    'matched_via': check_name,
                    'match_type': 'exact_match'
                }
            
            # 2. SUBSTRING MATCH - second priority
            if search_lower in check_name_lower or check_name_lower in search_lower:
                similarity = 0.90  # High confidence for substring matches
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_match = lender
                    best_match_name = check_name
                    logger.info(f"  Substring match: '{main_name}' via '{check_name}' (similarity: {similarity:.2f})")
            else:
                # 3. FUZZY MATCH - fallback
                similarity = calculate_similarity(search_lower, check_name_lower)
                if similarity > best_similarity:
                    best_similarity = similarity
                    best_match = lender
                    best_match_name = check_name
                    logger.info(f"  Fuzzy match: '{main_name}' via '{check_name}' (similarity: {similarity:.2f})")
    
    # Only return match if it meets the threshold (0.8)
    if best_similarity >= threshold:
        match_type = 'fuzzy_match' if best_similarity < 1.0 else 'exact_match'
        logger.info(f"✅ Best match for '{search_name}': '{best_match.get('name')}' (matched via '{best_match_name}', similarity: {best_similarity:.2f})")
        return {
            **best_match, 
            'score': round(best_similarity, 2), 
            'matched_via': best_match_name,
            'match_type': match_type
        }
    else:
        logger.info(f"❌ No match found for '{search_name}' (best similarity: {best_similarity:.2f}, threshold: {threshold})")
        return None

# === SECTION SEPARATOR ===
class LendersService:
    """Lender service with fuzzy matching support"""
    
    def __init__(self):
        # Cache all lenders on initialization for fuzzy matching
        self._all_lenders_cache = None
        self._cache_time = None
        self._cache_ttl = 300  # 5 minutes
    

    def _get_all_lenders_cached(self):
        """Get all lenders - optimized for high traffic"""
        current_time = datetime.now()
        
        # Return cache if fresh (5 minutes)
        if (self._all_lenders_cache is not None and 
            self._cache_time is not None and 
            (current_time - self._cache_time).total_seconds() < self._cache_ttl):
            return self._all_lenders_cache
        
        # Refresh cache
        session = None
        try:
            # Don't call remove() - let connection pool manage it
            session = db_session()
            
            # Get lenders directly - no test query needed
            lenders = session.query(Lender).all()
            
            # Convert immediately to avoid lazy loading
            self._all_lenders_cache = [{
                "id": l.id,
                "name": l.name,
                "display_name": l.name,
                "matching_names": l.matching_names or "",
                "fortress_name": l.fortress_name or "",                
                "filename": l.filename or "",
                "flg_name": (l.flg_lender_name or l.name),
                "eligible_or_not": l.eligible_or_not or "Yes",
                "irl_or_not": l.irl_or_not or "Yes",
                "created_at": l.created_at.isoformat() if l.created_at else None
            } for l in lenders]
            
            self._cache_time = current_time
            logger.info(f"Refreshed lenders cache: {len(self._all_lenders_cache)} lenders loaded")
            return self._all_lenders_cache
            
        except Exception as e:
            logger.error(f"Database error getting lenders: {e}")
            # Return cached data if available
            if self._all_lenders_cache:
                logger.warning("Using stale lender cache due to database error")
                return self._all_lenders_cache
            return []
        finally:
            if session:
                session.close()

    def get_all(self):
        """Get all lenders (returns cached list)"""
        return self._get_all_lenders_cached()

    def get_by_name(self, name, threshold=0.7):
        """
        Get a lender by name using fuzzy matching
        
        Args:
            name: Lender name to search for (from Valifi or user input)
            threshold: Minimum similarity score (0.0-1.0) to accept match
        
        Returns:
            Lender dict if match found, None otherwise
        """
        if not name:
            return None
        
        try:
            # Get all lenders for fuzzy matching
            all_lenders = self._get_all_lenders_cached()
            logger.info(f"[LENDER SERVICE] Searching for '{name}' among {len(all_lenders)} lenders")
            
            if not all_lenders:
                logger.error("[LENDER SERVICE] No lenders in cache! Loading from DB...")
                # Force refresh
                self._lenders_cache = None
                self._cache_time = None
                all_lenders = self._get_all_lenders_cached()
            
            # Use fuzzy matching to find best match
            best_match = find_best_lender_match(name, all_lenders, threshold)
            
            if not best_match:
                # Try exact match as fallback
                for lender in all_lenders:
                    if lender.get('name', '').lower() == name.lower():
                        logger.info(f"[LENDER SERVICE] Found exact match (case-insensitive): {lender['name']}")
                        return lender
                    # Also check display_name
                    if lender.get('display_name', '').lower() == name.lower():
                        logger.info(f"[LENDER SERVICE] Found exact match on display_name: {lender['display_name']}")
                        return lender
            
            if best_match:
                # Return in expected format
                return {
                    "id": best_match["id"],
                    "name": best_match["name"],
                    "filename": best_match["filename"],
                    "flg_name": best_match.get("flg_name", best_match["name"]),  # Add FLG name
                    "eligible_or_not": best_match["eligible_or_not"],
                    "irl_or_not": best_match["irl_or_not"]
                }
            
            return None
            
        except Exception as e:
            logger.error(f"Failed to get lender by name with fuzzy matching: {e}")
            import traceback
            logger.error(traceback.format_exc())
            return None
    
    def invalidate_cache(self):
        """Clear the lenders cache to force refresh"""
        self._all_lenders_cache = None
        self._cache_time = None
        logger.info("Lenders cache invalidated")


# === SECTION SEPARATOR ===
valifi_client = ValifiClient()
flg_client = FLGClient()
lenders_service = LendersService()

# === SECTION SEPARATOR ===
# Background FLG Lead Processing Function
# === SECTION SEPARATOR ===

def process_flg_leads_background(claim_id, summary, accounts, found_lenders, additional_lenders):
    """
    Background function to process FLG lead creation.
    Called by either Celery worker or directly in upload_summary.
    
    Args:
        claim_id (int): ID of the claim in database
        summary (dict): Full summary data from frontend
        accounts (list): List of all accounts (found + manual)
        found_lenders (list): List of Valifi-found lenders
        additional_lenders (list): List of manually-added lenders
        
    Returns:
        dict: Results with lead_ids list, successful_leads count, failed_leads count
    """
    logger.info(f"[BG-{claim_id}] Starting background FLG processing")
    session_db = None
    
    try:
        # Get Valifi response from summary if available
        valifi_response = summary.get('valifiResponse', None)
        if not valifi_response:
            # Try to get from database if not in summary
            session_db = db_session()
            claim = session_db.query(ClaimTracking).get(claim_id)
            if claim and claim.valifi_response:
                valifi_response = claim.valifi_response
            session_db.close()
            session_db = None

        # Check if FLG submission should be skipped (for batch imports)
        skip_flg = summary.get("skipFLG", False) or summary.get("skip_flg", False)
        if skip_flg:
            logger.info(f"[BG-{claim_id}] skipFLG=true - Will generate fake Lead IDs without FLG API calls")

        # ===================================================================
        # PREPARE SHARED DATA FOR FLG
        # ===================================================================
        first = summary.get("firstName", "").strip()
        last = summary.get("lastName", "").strip()
        title = summary.get("title", "")
        campaign = summary.get("campaign", "Unknown")
        client_ip = summary.get("clientIp", "")
        current_datetime = datetime.now().strftime("%d/%m/%Y %H:%M:%S")

        # DOB formatting
        dob_raw = summary.get("dateOfBirth", "")
        dob_formatted = ""
        if dob_raw:
            if "T" in dob_raw:
                dob_formatted = dob_raw.split("T")[0]
            elif "/" in dob_raw:
                try:
                    d, m, y = dob_raw.split("/")
                    dob_formatted = f"{y}-{m.zfill(2)}-{d.zfill(2)}"
                except ValueError:
                    logger.error(f"[BG-{claim_id}] Invalid date format: {dob_raw}")
                    dob_formatted = dob_raw
            else:
                dob_formatted = dob_raw
        
        # PDF URL, addresses, signature
        pdf_url = summary.get("pdfUrl", "")
        addresses_for_data14 = format_previous_addresses_for_data14(summary)
        address_2_for_data38 = format_address_2_for_data38(summary)
        address_3_onwards_for_data39 = format_address_3_onwards_for_data39(summary)
        
        signature_base64 = summary.get("signatureBase64", "")
        if signature_base64 and not str(signature_base64).startswith("data:"):
            signature_base64 = f"data:image/png;base64,{signature_base64}"
        
        # Valifi JSON for data32
        valifi_json = ""
        cmc_detected = False
        full_credit_report = summary.get("valifiResponse", {})
        if full_credit_report:
            valifi_json, cmc_detected = store_valifi_json_to_s3(full_credit_report, claim_id, None)
        
        # Base lead data
        # Construct combined address for FLG from individual address components
        address_parts = []
        if summary.get("building_number"):
            address_parts.append(summary.get("building_number"))
        if summary.get("building_name"):
            address_parts.append(summary.get("building_name"))
        if summary.get("flat"):
            address_parts.append("Flat " + summary.get("flat"))
        if summary.get("street"):
            address_parts.append(summary.get("street"))
        combined_address = " ".join(address_parts) if address_parts else summary.get("address", "")
        
        base_lead_data = {
            "medium": campaign,
            "title": title,
            "firstname": first,
            "lastname": last,
            "dateOfBirth": dob_formatted,
            "phone1": summary.get("phone1", ""),
            "email": summary.get("email", ""),
            "address": combined_address,
            "towncity": summary.get("towncity", ""),
            "postcode": summary.get("postcode", ""),
            "introducer": "61445",
            "applicant_id": str(claim_id),
            "data25": signature_base64,
            "data28": current_datetime,
            "data29": client_ip,
            "data31": pdf_url
        }
        
        # Tracking
        all_lead_ids = []
        successful_leads = 0
        failed_leads = 0
        eligible_dca_count = 0  # Only FA Eligible - for cost calculation
        total_dca_count = 0  # All DCAs - for Lead ID numbering
        category_1_accounts = []
        category_2_accounts = []
        category_3_accounts = []
        
        # Check for TLW Solicitors selection
        tlw_selected = summary.get("tlwSolicitorsSelected", False)
        if not tlw_selected and summary.get("selectedProfessionalReps"):
            for rep in summary.get("selectedProfessionalReps", []):
                if rep and "tlw solicitors" in str(rep.get("name", "")).lower():
                    tlw_selected = True
                    logger.info(f"[BG-{claim_id}] TLW Solicitors detected - will skip DCA lead creation")
                    break
        
        # ===================================================================
        # PRE-SORT ACCOUNTS BY DCA COST PRIORITY
        # ===================================================================
        session_db = db_session()
        
        logger.info(f"[BG-{claim_id}] Pre-sorting {len(accounts)} accounts by DCA cost priority...")
        
        # Look up each lender and add their dca_cost_order
        for account in accounts:
            lender_name = account.get("displayName") or account.get("lenderName", "Unknown Lender")
            
            # Perform fuzzy match lookup for this lender to get DCA cost order
            presort_matched_lender = lenders_service.get_by_name(lender_name, threshold=Config.LENDER_FUZZY_MATCH_THRESHOLD / 100.0)
            
            if presort_matched_lender:
                db_lender = session_db.query(Lender).filter_by(id=presort_matched_lender['id']).first()
                if db_lender:
                    # Add dca_cost_order to account for sorting (default to 0 if None)
                    account['dca_cost_order'] = db_lender.DCA_cost_order if db_lender.DCA_cost_order is not None else 0
                    logger.info(f"[BG-{claim_id}] {lender_name} -> DCA cost order: {account['dca_cost_order']}")
                else:
                    account['dca_cost_order'] = 0
            else:
                # No match - default to 0 (lowest priority)
                account['dca_cost_order'] = 0
                logger.info(f"[BG-{claim_id}] {lender_name} -> No match, DCA cost order: 0")

        # Sort accounts by dca_cost_order (highest first)
        sorted_accounts = sorted(accounts, key=lambda x: x.get('dca_cost_order', 0), reverse=True)
        
        logger.info(f"[BG-{claim_id}] Accounts sorted by priority:")
        for idx, account in enumerate(sorted_accounts, 1):
            lender_name = account.get("displayName") or account.get("lenderName", "Unknown Lender")
            logger.info(f"[BG-{claim_id}]   {idx}. {lender_name} (priority: {account.get('dca_cost_order', 0)})")
        
        # ===================================================================
        # PROCESS EACH ACCOUNT (NOW IN PRIORITY ORDER)
        # ===================================================================
        
        for account in sorted_accounts:
            lender_name = account.get("displayName") or account.get("lenderName", "Unknown Lender")
            account_number = account.get("accountNumber", "")
            outstanding_balance = account.get("currentBalance", "")
            monthly_payment = account.get("monthlyPayment", "")
            
            # Manual vs Valifi
            is_manual = not account.get("startDate")
            
            # === NEW: CAPTURE DETAILED LENDER MATCHING INFO ===
            valifi_original_name = lender_name  # Store original name from Valifi
            matched_lender_details = None
            fuzzy_score_value = None
            match_type_value = "manual" if is_manual else "no_match"
            matched_via_value = "manual_entry" if is_manual else "no_match"
            matched_db_lender_id = None
            matched_db_lender_name = None
            fortress_name_value = None
            gui_display_name = lender_name  # Default to original name
            flg_sent_name = lender_name  # Default to original name
            
            if not is_manual:
                # Perform fuzzy matching with full tracking
                matched_lender_details = lenders_service.get_by_name(lender_name, threshold=Config.LENDER_FUZZY_MATCH_THRESHOLD / 100.0)
                
                if matched_lender_details:
                    # Extract all matching details
                    matched_db_lender_id = matched_lender_details.get('id')
                    matched_db_lender_name = matched_lender_details.get('name')
                    fortress_name_value = matched_lender_details.get('fortress_name') or matched_lender_details.get('name')
                    fuzzy_score_value = matched_lender_details.get('score', 0.0)
                    match_type_value = matched_lender_details.get('match_type', 'fuzzy_match')
                    matched_via_value = matched_lender_details.get('matched_via', matched_db_lender_name)
                    
                    # Determine names to use
                    flg_sent_name = matched_lender_details.get('flg_name') or matched_db_lender_name
                    gui_display_name = fortress_name_value or matched_db_lender_name
                    
                    logger.info(f"[BG-{claim_id}] [MATCH TRACKING]:")
                    logger.info(f"  Valifi Original: {valifi_original_name}")
                    logger.info(f"  Matched DB ID: {matched_db_lender_id}")
                    logger.info(f"  Matched DB Name: {matched_db_lender_name}")
                    logger.info(f"  Fortress Name: {fortress_name_value}")
                    logger.info(f"  Fuzzy Score: {fuzzy_score_value:.2f}")
                    logger.info(f"  Match Type: {match_type_value}")
                    logger.info(f"  Matched Via: {matched_via_value}")
                    logger.info(f"  FLG Sent Name: {flg_sent_name}")
                    logger.info(f"  GUI Display Name: {gui_display_name}")
                else:
                    logger.info(f"[BG-{claim_id}] [MATCH TRACKING]: No match found for '{valifi_original_name}'")
                    fuzzy_score_value = 0.0
                    match_type_value = "no_match"
                    matched_via_value = "no_match"

            # Re-validate date eligibility
            start_date = account.get("startDate")
            if start_date and not is_manual:
                is_date_eligible, eligibility_reason = check_date_eligibility(start_date)
                account["dateEligible"] = is_date_eligible
                account["eligibilityReason"] = eligibility_reason
            else:
                is_date_eligible = True
                eligibility_reason = "Manual entry - no date to check"
            
            # Format start date
            start_date_formatted = ""
            if start_date:
                if "T" in start_date:
                    start_date_formatted = start_date.split("T")[0]
                else:
                    start_date_formatted = start_date

            # Find lender in DB using fuzzy matching with configurable threshold
            matched_lender = lenders_service.get_by_name(lender_name, threshold=Config.LENDER_FUZZY_MATCH_THRESHOLD / 100.0)
            db_lender = None
            fuzzy_match_score = 0
            match_method = "none"
            
            if matched_lender:
                fuzzy_match_score = int(matched_lender.get('score', 0) * 100)  # Convert to percentage
                db_lender = session_db.query(Lender).filter_by(id=matched_lender['id']).first()
                match_method = "fuzzy"
                logger.info(f"[BG-{claim_id}] Fuzzy match: '{lender_name}' -> '{db_lender.name}' (score: {fuzzy_match_score}%)")
            else:
                # Try exact match as fallback
                db_lender = session_db.query(Lender).filter_by(name=lender_name).first()
                if db_lender:
                    fuzzy_match_score = 100
                    match_method = "exact"
                    logger.info(f"[BG-{claim_id}] Exact match: '{lender_name}' -> '{db_lender.name}' (score: 100%)")
            
            # Get the FLG lender name to send to FLG
            flg_lender_name = lender_name  # Default to original name
            
            # Determine lender eligibility flags based on match status
            if db_lender:
                # Matched lender - use database flags
                flg_lender_name = db_lender.flg_lender_name or db_lender.name or lender_name
                lender_eligible_flag = db_lender.eligible_or_not or "Yes"
                lender_irl_flag = db_lender.irl_or_not or "Yes"
                logger.info(f"[BG-{claim_id}] Using DB lender '{db_lender.name}' (ID: {db_lender.id}, Eligible: {lender_eligible_flag}, IRL: {lender_irl_flag})")
            else:
                # No match - still process but with conservative settings
                fuzzy_match_score = 0
                match_method = "none"
                lender_eligible_flag = "Unknown"  # Will trigger "FA Unknown" reference
                lender_irl_flag = "No"  # Will skip IRL lead creation
                logger.warning(f"[BG-{claim_id}] No match for '{lender_name}' (score < {Config.LENDER_FUZZY_MATCH_THRESHOLD}%) - Processing as UNKNOWN lender")
                logger.info(f"[BG-{claim_id}]    -> DCA Reference will be: FA Unknown")
                logger.info(f"[BG-{claim_id}]    -> IRL Lead: Will NOT be created")
                
                # Track in Category 3 for reporting but DON'T skip processing
                category_3_accounts.append({
                    "name": lender_name,
                    "source": "Manual" if is_manual else "Valifi",
                    "startDate": account.get("startDate"),
                    "fuzzy_match_score": fuzzy_match_score,
                    "processed_as": "unknown"
                })
                # NOTE: No 'continue' statement - we process this lender!
            
            # Category 2: Outside date range (only skip if date is ineligible)
            if not is_manual and not is_date_eligible:
                logger.info(f"[BG-{claim_id}] Category 2: {lender_name} - {eligibility_reason}")
                category_2_accounts.append({
                    "name": lender_name,
                    "reason": eligibility_reason,
                    "startDate": account.get("startDate")
                })
                continue
            
            # Category 1: Proceeding (includes matched AND unmatched lenders)
            logger.info(f"[BG-{claim_id}] Category 1: {lender_name} - Proceeding with claims (Match: {match_method}, Score: {fuzzy_match_score}%)")

            # Read from database instead of summary dict to ensure we have latest data
            try:
                temp_session = db_session()
                claim_record = temp_session.query(ClaimTracking).filter_by(id=claim_id).first()
                existing_rep_consent = claim_record.existing_representation_consent if claim_record else None
                temp_session.close()
                logger.info(f"[BG-{claim_id}] existing_rep_consent from DB: {existing_rep_consent}")
            except Exception as e:
                logger.error(f"[BG-{claim_id}] Failed to read existing_rep_consent from DB: {e}")
                existing_rep_consent = summary.get("existingRepresentationConsent")
                logger.info(f"[BG-{claim_id}] Fallback to summary dict: {existing_rep_consent}")

            # Check if date is in special range
            special_date_range = False
            if start_date_formatted:
                try:
                    if "/" in start_date_formatted:
                        day, month, year = start_date_formatted.split("/")
                        start_date_obj = datetime(int(year), int(month), int(day)).date()
                    else:
                        start_date_obj = datetime.strptime(start_date_formatted, "%Y-%m-%d").date()
                    
                    special_start = datetime.strptime(Config.SPECIAL_DATE_START, "%Y-%m-%d").date()
                    special_end = datetime.strptime(Config.SPECIAL_DATE_END, "%Y-%m-%d").date()
                    special_date_range = special_start <= start_date_obj <= special_end
                    
                    if special_date_range:
                        logger.info(f"[BG-{claim_id}] Lender {lender_name} date {start_date_formatted} in special range")
                except Exception as e:
                    logger.error(f"[BG-{claim_id}] Failed to parse date for special range check: {start_date_formatted} - {e}")
            
            # DCA reference logic
            if special_date_range:
                dca_reference_value = "FA Non Eligible"
            elif is_manual:
                dca_reference_value = "FA Unknown"
            elif lender_eligible_flag == "Unknown":
                # Unmatched lender from Valifi - conservative approach
                dca_reference_value = "FA Unknown"
            else:
                dca_reference_value = "FA Eligible" if lender_eligible_flag == "Yes" else "FA Non Eligible"

            # NEW: Check for CMC/Valifi or prior CMC checkbox - append " - pending" suffix
            cmc_or_prior_rep = False
            if cmc_detected:
                cmc_or_prior_rep = True
                logger.info(f"[BG-{claim_id}] CMC detected in credit report - will add pending suffix")
            if existing_rep_consent == "Yes":
                cmc_or_prior_rep = True
                logger.info(f"[BG-{claim_id}] User confirmed prior CMC representation - will add pending suffix")

            if cmc_or_prior_rep:
                dca_reference_value = dca_reference_value + " - pending"
                logger.info(f"[BG-{claim_id}] Final DCA reference with pending: {dca_reference_value}")

            # IRL reference logic - check BOTH IRL flag AND DCA flag
            if special_date_range:
                irl_reference_value = "IRL Suspense"
            elif lender_irl_flag == "Yes" and lender_eligible_flag == "Yes":
                # IRL=Yes AND DCA=Yes -> Verified IRL Portfolio
                irl_reference_value = "Verified IRL Portfolio"
            elif lender_irl_flag == "Yes" and lender_eligible_flag != "Yes":
                # IRL=Yes AND DCA=No -> IRL Suspense
                irl_reference_value = "IRL Suspense"
            else:
                # IRL=No -> IRL Suspense (but won't create lead anyway)
                irl_reference_value = "IRL Suspense"

            # === DCA LEAD CREATION ===
            if (summary.get("motorFinanceConsent") or summary.get("motor_finance_consent")) and not tlw_selected:
                total_dca_count += 1  # Increment for ALL DCAs (for Lead ID numbering)
                
                # Determine cost based on reference type - ONLY FA Eligible (without pending) gets tiered costs
                if dca_reference_value == "FA Eligible":
                    # Only pure "FA Eligible" (no pending suffix) gets tiered costs
                    eligible_dca_count += 1
                    if eligible_dca_count == 1:
                        cost_value = Config.DRAWDOWN_ELIGIBLE_1  # £41
                    elif eligible_dca_count == 2:
                        cost_value = Config.DRAWDOWN_ELIGIBLE_2  # £10
                    else:
                        cost_value = Config.DRAWDOWN_ELIGIBLE_3  # £0
                    logger.info(f"[BG-{claim_id}] FA Eligible lender #{eligible_dca_count} - Cost: £{cost_value}")
                else:
                    # FA Eligible - pending, FA Non Eligible, FA Unknown, or special range - always £0
                    cost_value = 0.0
                    logger.info(f"[BG-{claim_id}] Non-eligible lender (or pending) - Cost: £0")

                logger.info(f"[BG-{claim_id}] Creating DCA lead for {lender_name} | Ref={dca_reference_value} | Cost={cost_value}")
                
                # Build data47 for CMC information
                data47_content = ""
                selected_reps = summary.get("selectedProfessionalReps", []) or []
                disengagement_reason = summary.get("disengagementReason", "")
                disengagement_other = summary.get("disengagementOtherText", "")
                existing_rep_consent = summary.get("existingRepresentationConsent")
                
                has_valifi = "valifi" in valifi_json.lower() if valifi_json else False
                
                if existing_rep_consent == "Yes" and selected_reps:
                    cmc_parts = []
                    for idx, rep in enumerate(selected_reps, 1):
                        if isinstance(rep, dict):
                            rep_name = rep.get("name", "Unknown")
                            if rep.get("id") == "unknown_cmc":
                                rep_name = "Unknown (Credit Report Indicated)"
                        else:
                            rep_name = str(rep)
                        cmc_parts.append(f"CMC{idx}={rep_name}")
                    
                    reason_text = ""
                    if disengagement_reason == "other" and disengagement_other:
                        reason_text = disengagement_other
                    elif disengagement_reason in DISENGAGEMENT_REASON_MAP:
                        reason_text = DISENGAGEMENT_REASON_MAP[disengagement_reason]
                    elif disengagement_reason:
                        reason_text = disengagement_reason
                    else:
                        reason_text = "User wishes to change representation"
                    
                    cmc_parts.append(f"REASON = {reason_text}")
                    data47_content = ", ".join(cmc_parts)
                elif existing_rep_consent == "No" and has_valifi and not summary.get("cmcModalHandled"):
                    data47_content = "CMC1=Unknown via Valifi, REASON = Valifi search indicates CMC activity"
                
                # Extract the specific account data for this lender
                account_json_data = None
                if valifi_response and not is_manual:
                    try:
                        valifi_data = json.loads(valifi_response) if isinstance(valifi_response, str) else valifi_response
                        if valifi_data and 'data' in valifi_data and 'accounts' in valifi_data['data']:
                            # Find the matching account by account number
                            for acc in valifi_data['data']['accounts']:
                                if acc.get('accountNumber') == account_number:
                                    account_json_data = json.dumps(acc)
                                    break
                    except Exception as e:
                        logger.warning(f"[BG-{claim_id}] Could not extract account JSON for {account_number}: {e}")
                
                # Check if we should skip FLG API call (for batch imports)
                if skip_flg:
                    # Generate fake lead ID for batch processing
                    lead_id = f"{claim_id}_DCA_{total_dca_count}"
                    logger.info(f"[BG-{claim_id}] skipFLG=true - Generated fake Lead ID: {lead_id} (no FLG API call)")
                    
                    all_lead_ids.append({
                        "lead_id": lead_id,
                        "lead_group": Config.FLG_LEADGROUP_ID,
                        "lead_type": "DCA",
                        "reference": dca_reference_value,
                        "cost": str(cost_value),
                        "lender_name": flg_sent_name,
                        "account_number": account_number,
                        "start_date": start_date_formatted,
                        "outstanding_balance": outstanding_balance,
                        "monthly_payment": monthly_payment,
                        "lender_data": account,
                        "is_eligible": is_date_eligible,
                        "ineligible_reason": eligibility_reason if not is_date_eligible else None,
                        "is_manual": is_manual,
                        "within_date_range": is_date_eligible if start_date else True,
                        "lender_data_json": account_json_data,
                        "valifi_original_name": valifi_original_name,
                        "match_info": {
                            "lender_id": matched_db_lender_id,
                            "lender_name": matched_db_lender_name,
                            "fortress_name": fortress_name_value,
                            "flg_lender_name": flg_sent_name,
                            "fuzzy_score": fuzzy_score_value,
                            "match_type": match_type_value,
                            "matched_via": matched_via_value,
                            "matching_column_value": matched_via_value
                        }
                    })
                    successful_leads += 1
                else:
                    # Normal FLG API call
                    dca_lead_data = {
                        **base_lead_data,
                        "leadgroup": Config.FLG_LEADGROUP_ID,
                        "source": "Belmondclaims.com",
                        "reference": dca_reference_value,
                        "cost": str(cost_value) if cost_value is not None else "",
                        "data2": flg_lender_name,
                        "data5": outstanding_balance,
                        "data9": account_number,
                        "data12": start_date_formatted,
                        "data14": addresses_for_data14,
                        "data32": valifi_json,
                        "data34": account_json_data if account_json_data else "",
                        "data47": data47_content
                    }
                    
                    try:
                        xml_payload = flg_client.build_lead_xml(dca_lead_data)
                        response = flg_client.send_lead(xml_payload)
                        
                        if response.status_code == 200:
                            root = ET.fromstring(response.text)
                            status = root.findtext("status")
                            if status == "0":
                                lead_id = flg_client.parse_lead_id(response.text)
                                if lead_id:
                                    all_lead_ids.append({
                                        "lead_id": lead_id,
                                        "lead_group": Config.FLG_LEADGROUP_ID,
                                        "lead_type": "DCA",
                                        "reference": dca_reference_value,
                                        "cost": str(cost_value),
                                        "lender_name": flg_sent_name,
                                        "account_number": account_number,
                                        "start_date": start_date_formatted,
                                        "outstanding_balance": outstanding_balance,
                                        "monthly_payment": monthly_payment,
                                        "lender_data": account,
                                        "is_eligible": is_date_eligible,
                                        "ineligible_reason": eligibility_reason if not is_date_eligible else None,
                                        "is_manual": is_manual,
                                        "within_date_range": is_date_eligible if start_date else True,
                                        "lender_data_json": account_json_data,
                                        "valifi_original_name": valifi_original_name,
                                        "match_info": {
                                            "lender_id": matched_db_lender_id,
                                            "lender_name": matched_db_lender_name,
                                            "fortress_name": fortress_name_value,
                                            "flg_lender_name": flg_sent_name,
                                            "fuzzy_score": fuzzy_score_value,
                                            "match_type": match_type_value,
                                            "matched_via": matched_via_value,
                                            "matching_column_value": matched_via_value
                                        }
                                    })
                                    successful_leads += 1
                                    logger.info(f"[BG-{claim_id}] DCA Lead created: {lead_id}")
                            else:
                                error_msg = root.findtext("message", "Unknown error")
                                logger.error(f"[BG-{claim_id}] DCA Lead creation failed: {error_msg}")
                                failed_leads += 1
                        else:
                            logger.error(f"[BG-{claim_id}] DCA Lead HTTP error: {response.status_code}")
                            failed_leads += 1

                    except Exception as e:
                        logger.error(f"[BG-{claim_id}] Failed to create DCA lead for {lender_name}: {e}")
                        failed_leads += 1

            # === IRL LEAD CREATION ===
            if (summary.get("irresponsibleLendingConsent") or summary.get("irresponsible_lending_consent")) and lender_irl_flag == "Yes":
                logger.info(f"[BG-{claim_id}] Creating IRL lead for {lender_name} | Ref={irl_reference_value}")
                
                # Extract the specific account data for this lender (same as DCA)
                account_json_data = None
                if valifi_response and not is_manual:
                    try:
                        valifi_data = json.loads(valifi_response) if isinstance(valifi_response, str) else valifi_response
                        if valifi_data and 'data' in valifi_data and 'accounts' in valifi_data['data']:
                            # Find the matching account by account number
                            for acc in valifi_data['data']['accounts']:
                                if acc.get('accountNumber') == account_number:
                                    account_json_data = json.dumps(acc)
                                    break
                    except Exception as e:
                        logger.warning(f"[BG-{claim_id}] Could not extract account JSON for {account_number}: {e}")
                
                # Check if we should skip FLG API call (for batch imports)
                if skip_flg:
                    # Count IRL leads for numbering
                    irl_lead_count = len([lid for lid in all_lead_ids if lid["lead_type"] == "IRL"]) + 1
                    lead_id = f"{claim_id}_IRL_{irl_lead_count}"
                    logger.info(f"[BG-{claim_id}] skipFLG=true - Generated fake Lead ID: {lead_id} (no FLG API call)")
                    
                    all_lead_ids.append({
                        "lead_id": lead_id,
                        "lead_group": Config.FLG_IRL_LEADGROUP_ID,
                        "lead_type": "IRL",
                        "reference": irl_reference_value,
                        "cost": "",
                        "lender_name": flg_sent_name,
                        "account_number": account_number,
                        "start_date": start_date_formatted,
                        "outstanding_balance": outstanding_balance,
                        "monthly_payment": monthly_payment,
                        "lender_data": account,
                        "is_eligible": is_date_eligible,
                        "ineligible_reason": eligibility_reason if not is_date_eligible else None,
                        "is_manual": is_manual,
                        "within_date_range": is_date_eligible if start_date else True,
                        "lender_data_json": account_json_data,
                        "valifi_original_name": valifi_original_name,
                        "match_info": {
                            "lender_id": matched_db_lender_id,
                            "lender_name": matched_db_lender_name,
                            "fortress_name": fortress_name_value,
                            "flg_lender_name": flg_sent_name,
                            "fuzzy_score": fuzzy_score_value,
                            "match_type": match_type_value,
                            "matched_via": matched_via_value,
                            "matching_column_value": matched_via_value
                        }
                    })
                    successful_leads += 1
                else:
                    # Normal FLG API call
                    irl_lead_data = {
                        **base_lead_data,
                        "leadgroup": Config.FLG_IRL_LEADGROUP_ID,
                        "reference": irl_reference_value,
                        "data1": flg_lender_name,
                        "data5": account_number,
                        "data36": valifi_json,
                        "data33": monthly_payment,
                        "data37": start_date_formatted,
                        "data38": address_2_for_data38,
                        "data39": address_3_onwards_for_data39,
                        "data48": account_json_data if account_json_data else pdf_url
                    }
                    
                    # Remove data31 (PDF) as we use data48 for IRL
                    if "data31" in irl_lead_data:
                        del irl_lead_data["data31"]
                    
                    try:
                        xml_payload = flg_client.build_lead_xml(irl_lead_data)
                        response = flg_client.send_lead(xml_payload)
                        
                        if response.status_code == 200:
                            root = ET.fromstring(response.text)
                            status = root.findtext("status")
                            if status == "0":
                                lead_id = flg_client.parse_lead_id(response.text)
                                if lead_id:
                                    all_lead_ids.append({
                                        "lead_id": lead_id,
                                        "lead_group": Config.FLG_IRL_LEADGROUP_ID,
                                        "lead_type": "IRL",
                                        "reference": irl_reference_value,
                                        "cost": "",
                                        "lender_name": flg_sent_name,
                                        "account_number": account_number,
                                        "start_date": start_date_formatted,
                                        "outstanding_balance": outstanding_balance,
                                        "monthly_payment": monthly_payment,
                                        "lender_data": account,
                                        "is_eligible": is_date_eligible,
                                        "ineligible_reason": eligibility_reason if not is_date_eligible else None,
                                        "is_manual": is_manual,
                                        "within_date_range": is_date_eligible if start_date else True,
                                        "lender_data_json": account_json_data,
                                        "valifi_original_name": valifi_original_name,
                                        "match_info": {
                                            "lender_id": matched_db_lender_id,
                                            "lender_name": matched_db_lender_name,
                                            "fortress_name": fortress_name_value,
                                            "flg_lender_name": flg_sent_name,
                                            "fuzzy_score": fuzzy_score_value,
                                            "match_type": match_type_value,
                                            "matched_via": matched_via_value,
                                            "matching_column_value": matched_via_value
                                        }
                                    })
                                    successful_leads += 1
                                    logger.info(f"[BG-{claim_id}] IRL Lead created: {lead_id}")
                            else:
                                error_msg = root.findtext("message", "Unknown error")
                                logger.error(f"[BG-{claim_id}] IRL Lead creation failed: {error_msg}")
                                failed_leads += 1
                        else:
                            logger.error(f"[BG-{claim_id}] IRL Lead HTTP error: {response.status_code}")
                            failed_leads += 1

                    except Exception as e:
                        logger.error(f"[BG-{claim_id}] Failed to create IRL lead for {lender_name}: {e}")
                        failed_leads += 1

            # Track Category 1 account
            category_1_accounts.append({
                "name": lender_name,
                "source": "Manual" if is_manual else "Valifi",
                "dca_reference": dca_reference_value if (summary.get("motorFinanceConsent") or summary.get("motor_finance_consent")) else None,
                "irl_created": (summary.get("irresponsibleLendingConsent") or summary.get("irresponsible_lending_consent")) and lender_irl_flag == "Yes",
                "startDate": start_date_formatted
            })
        
        session_db.close()
        session_db = None

        # Log summary
        logger.info(f"[BG-{claim_id}] Lead creation complete: {successful_leads} successful, {failed_leads} failed")
        
        # Send webhook (skip if using fake lead IDs)
        if all_lead_ids and not skip_flg:
            try:
                send_lead_ids_to_webhook(all_lead_ids)
            except Exception as e:
                logger.warning(f"[BG-{claim_id}] Webhook send failed: {e}")
        elif skip_flg:
            logger.info(f"[BG-{claim_id}] skipFLG=true - Skipping webhook (fake lead IDs)")
        
        # Update claim with results
        session_db = db_session()
        claim = session_db.query(ClaimTracking).get(claim_id)
        if claim:
            claim.lead_ids = json.dumps(all_lead_ids) if all_lead_ids else None
            claim.leads_created_count = len(all_lead_ids)
            claim.lenders_eligible = eligible_dca_count
            claim.lenders_ineligible = len(category_2_accounts) + len(category_3_accounts)
            
            # Populate lead_ids_tracking
            if all_lead_ids:
                populate_lead_ids_tracking(claim_id, all_lead_ids)
            
            session_db.commit()
            logger.info(f"[BG-{claim_id}] Claim updated with lead results")
        
        session_db.close()
        
        # Return results
        return {
            "claim_id": claim_id,
            "all_lead_ids": all_lead_ids,
            "successful_leads": successful_leads,
            "failed_leads": failed_leads,
            "eligible_dca_count": eligible_dca_count,
            "category_1_count": len(category_1_accounts),
            "category_2_count": len(category_2_accounts),
            "category_3_count": len(category_3_accounts)
        }
        
    except Exception as e:
        logger.error(f"[BG-{claim_id}] Background FLG processing failed: {e}")
        import traceback
        logger.error(traceback.format_exc())
        if session_db:
            try:
                session_db.rollback()
                session_db.close()
            except:
                pass
        
        # Return error results
        return {
            "claim_id": claim_id,
            "all_lead_ids": [],
            "successful_leads": 0,
            "failed_leads": 0,
            "error": str(e)
        }
    
# === SECTION SEPARATOR ===
# Database Sequence Health Check
# === SECTION SEPARATOR ===

def fix_database_sequences():
    """
    Fix PostgreSQL sequences to prevent duplicate key errors.
    Safe to run multiple times - only updates if needed.
    """
    session = None
    try:
        session = db_session()
        
        # Tables with auto-increment IDs
        tables = [
            'flg_status_mappings',
            'lenders',
            'claims_tracking',
            'lead_ids_tracking',
            'webhook_logs',
            'claim_lender_matches',
            'professional_representatives',
            'claim_professional_representatives',
            'visitor_sessions',
            'offline_campaigns',
            'traffic_spikes'
        ]
        
        fixed = []
        for table_name in tables:
            try:
                # Get max ID
                result = session.execute(
                    text(f"SELECT COALESCE(MAX(id), 0) as max_id FROM {table_name}")
                ).fetchone()
                max_id = result[0] if result else 0
                
                # Get current sequence value
                seq_name = f"{table_name}_id_seq"
                try:
                    seq_result = session.execute(
                        text(f"SELECT last_value FROM {seq_name}")
                    ).fetchone()
                    current_seq = seq_result[0] if seq_result else 0
                    
                    # Fix if sequence is behind
                    if current_seq <= max_id:
                        session.execute(
                            text(f"SELECT setval('{seq_name}', :next_val, false)"),
                            {"next_val": max_id + 1}
                        )
                        fixed.append(f"{table_name}: {current_seq} → {max_id + 1}")
                        logger.info(f"Fixed sequence for {table_name}: set to {max_id + 1}")
                except Exception as e:
                    # Sequence might not exist for this table
                    pass
                    
            except Exception as e:
                logger.warning(f"Could not check sequence for {table_name}: {e}")
        
        session.commit()
        
        if fixed:
            logger.info(f"Fixed {len(fixed)} sequences: {', '.join(fixed)}")
        else:
            logger.info("All database sequences are healthy")
            
        return {"success": True, "fixed": fixed}
        
    except Exception as e:
        logger.error(f"Error fixing sequences: {e}")
        if session:
            session.rollback()
        return {"success": False, "error": str(e)}
    finally:
        if session:
            session.close()

# ========================================
# Helper Function: Auto-populate lead_ids_tracking on claim submission
# ========================================

def populate_lead_ids_tracking(claim_id, lead_ids_data):
    """
    Populate lead_ids_tracking table when a claim is submitted.
    
    Args:
        claim_id: ID of the claim in claims_tracking
        lead_ids_data: List of dicts with lead information
                      [{"lead_id": "123", "lead_type": "DCA", "lender_name": "...", ...}, ...]
    
    Returns:
        bool: True if successful, False otherwise
    """
    try:
        session = db_session()
        claim = session.query(ClaimTracking).filter_by(id=claim_id).first()
        
        if not claim:
            logger.error(f"Claim {claim_id} not found for lead_ids_tracking population")
            return False
        
        # Get post_code if it exists
        post_code = getattr(claim, 'post_code', None)
        
        # Process each lead ID
        for lead_data in lead_ids_data:
            # Skip if lead_id is missing
            if not lead_data.get('lead_id'):
                logger.warning(f"Skipping lead with no lead_id: {lead_data}")
                continue
            
            # Create lead_ids_tracking record
            # Note: We get lender details directly from lead_data (which comes from all_lead_ids)
            # We don't need to look them up from claim_lender_matches
            
            # Fix cost field - convert empty string to None for database
            cost_value = lead_data.get('cost')
            if cost_value == '' or cost_value is None:
                cost_value = None
            else:
                try:
                    cost_value = float(cost_value)
                except (ValueError, TypeError):
                    cost_value = None
            
            lead_record = LeadIDTracking(
                claim_id=claim_id,
                lead_id=str(lead_data.get('lead_id')),
                lead_group=lead_data.get('lead_group'),
                lead_type=lead_data.get('lead_type'),
                lender_name=lead_data.get('lender_name'),
                reference=lead_data.get('reference'),
                cost=cost_value,
                
                # Applicant info from claim
                applicant_id=claim_id,
                first_name=claim.first_name,
                last_name=claim.last_name,
                email=claim.email,
                mobile=claim.mobile,
                date_of_birth=claim.date_of_birth,
                post_code=post_code,
                
                # Lender details - can be added from lead_data if available
                account_number=lead_data.get('account_number'),
                start_date=lead_data.get('start_date'),
                outstanding_balance=lead_data.get('outstanding_balance'),
                monthly_payment=lead_data.get('monthly_payment'),
                lender_data_json=lead_data.get('lender_data_json'),
                
                # Eligibility
                is_eligible=lead_data.get('is_eligible', True),
                ineligible_reason=lead_data.get('ineligible_reason'),
                is_manual=lead_data.get('is_manual', False),
                within_date_range=lead_data.get('within_date_range', True),
                
                # Consents from claim
                motor_finance_consent=claim.motor_finance_consent,
                irresponsible_lending_consent=claim.irresponsible_lending_consent,
                
                # Campaign from claim
                campaign=claim.campaign,
                client_ip=claim.client_ip,
                
                # Status from claim
                claim_submitted=claim.claim_submitted,
                submission_datetime=claim.submission_datetime,
                signature_provided=claim.signature_provided,
                
                # Metadata
                created_at=claim.created_at or datetime.utcnow(),
                updated_at=datetime.utcnow()
            )
            
            try:
                session.add(lead_record)
            except Exception as e:
                logger.error(f"Error adding lead_id {lead_data.get('lead_id')} to tracking: {e}")
                continue
        
        session.commit()
        logger.info(f"Populated {len(lead_ids_data)} lead IDs to tracking table for claim {claim_id}")
        return True
        
    except Exception as e:
        logger.error(f"Error populating lead_ids_tracking for claim {claim_id}: {e}")
        session.rollback()
        return False
    finally:
        session.close()

@app.route("/professional-representatives", methods=["GET"])
@handle_errors
def get_professional_representatives():
    """Get all active professional representatives for the dropdown"""
    session = db_session()
    try:
        reps = session.query(ProfessionalRepresentative).filter_by(active=True).order_by(ProfessionalRepresentative.name).all()
        result = []
        for rep in reps:
            result.append({
                "id": rep.id,
                "name": rep.name,
                "type": rep.type
            })
        session.close()
        return jsonify(result), 200
    except Exception as e:
        logger.error(f"Error fetching professional representatives: {e}")
        if session:
            session.close()
        return jsonify({"error": "Failed to load professional representatives"}), 500

@app.route("/admin/send-resume-sms", methods=["POST"])
@handle_errors
def send_resume_sms():
    """Admin endpoint to send SMS with resume link to incomplete forms"""
    data = request.json or {}
    
    # Get incomplete sessions (e.g., form started but not completed in last 7 days)
    session_db = db_session()
    try:
        cutoff_date = datetime.utcnow() - timedelta(days=7)
        
        # Find sessions that:
        # - Have mobile number
        # - Started form but didn't complete
        # - Haven't been sent resume link yet (or sent more than 48h ago)
        # - Last activity within last 7 days
        from sqlalchemy import or_
        incomplete_sessions = session_db.query(VisitorSession).filter(
            VisitorSession.mobile.isnot(None),
            VisitorSession.form_started == True,
            VisitorSession.form_completed == False,
            VisitorSession.last_activity >= cutoff_date,
            or_(
                VisitorSession.resume_link_sent == False,
                VisitorSession.resume_link_sent.is_(None),
                VisitorSession.resume_link_sent_at < datetime.utcnow() - timedelta(hours=48)
            )
        ).limit(data.get('limit', 100)).all()
        
        sent_count = 0
        failed_count = 0
        
        for visitor in incomplete_sessions:
            # Generate resume token if doesn't exist
            if not visitor.resume_token:
                import secrets
                visitor.resume_token = secrets.token_urlsafe(32)
                visitor.resume_token_created = datetime.utcnow()
            
            # Build resume link
            resume_url = f"https://belmondpcp.co.uk/resume/{visitor.resume_token}"
            
            # SMS message
            first_name = visitor.first_name or "there"
            sms_message = (
                f"Hi {first_name}, you started a claim with Belmond PCP. "
                f"Continue where you left off: {resume_url}"
            )
            
            # Send SMS via your SMS provider (e.g., Twilio, AWS SNS, etc.)
            try:
                # Example with Twilio (you'd need to set this up):
                # from twilio.rest import Client
                # client = Client(account_sid, auth_token)
                # client.messages.create(
                #     to=visitor.mobile,
                #     from_=your_twilio_number,
                #     body=sms_message
                # )
                
                # For now, just log it
                logger.info(f"Would send SMS to {visitor.mobile}: {sms_message}")
                
                # Mark as sent
                visitor.resume_link_sent = True
                visitor.resume_link_sent_at = datetime.utcnow()
                sent_count += 1
                
            except Exception as e:
                logger.error(f"Failed to send SMS to {visitor.mobile}: {e}")
                failed_count += 1
        
        session_db.commit()
        
        return jsonify({
            "success": True,
            "sent": sent_count,
            "failed": failed_count,
            "message": f"Sent {sent_count} SMS messages"
        }), 200
        
    except Exception as e:
        logger.error(f"Error sending resume SMS: {e}")
        session_db.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session_db.close()


@app.route("/api/resume-session/<token>", methods=["GET"])
@handle_errors
def get_resume_session(token):
    """Fetch session data by resume token"""
    if not token:
        return jsonify({"error": "Token required"}), 400
    
    session_db = db_session()
    try:
        # Import the model
        from tracking_models import VisitorSession
        
        # Find session by resume token
        visitor_session = session_db.query(VisitorSession).filter_by(
            resume_token=token
        ).first()
        
        if not visitor_session:
            return jsonify({"error": "Session not found"}), 404
        
        # Return session data
        return jsonify({
            "session_id": visitor_session.session_id,
            "visitor_id": visitor_session.visitor_id,
            "first_name": visitor_session.first_name or "",
            "last_name": visitor_session.last_name or "",
            "email": visitor_session.email or "",
            "mobile": visitor_session.mobile or "",
            "title": visitor_session.title or "",
            "form_progress_percent": visitor_session.form_progress_percent or 0,
            "last_saved_step": visitor_session.last_saved_step or "step1",
            "form_data_snapshot": visitor_session.form_data_snapshot or "{}",
            "created_at": visitor_session.created_at.isoformat() if visitor_session.created_at else None,
            "last_activity": visitor_session.last_activity.isoformat() if visitor_session.last_activity else None,
            # Address fields
            "building_number": visitor_session.building_number or "",
            "building_name": visitor_session.building_name or "",
            "flat": visitor_session.flat or "",
            "street": visitor_session.street or "",
            "district": visitor_session.district or "",
            "post_town": visitor_session.post_town or "",
            "county": visitor_session.county or "",
            "post_code": visitor_session.post_code or "",
            "previous_addresses": visitor_session.previous_addresses or "{}",
            "date_of_birth": visitor_session.date_of_birth.isoformat() if visitor_session.date_of_birth else None
        }), 200
        
    except Exception as e:
        logger.error(f"Error fetching resume session: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        session_db.close()


@app.route("/resume/<token>", methods=["GET"])
def resume_form_page(token):
    """Resume form page - redirects to main form with token"""
    # Store token in session for the form to pick up
    session['resume_token'] = token
    # Redirect to main form with token as parameter
    return redirect(f"/?resume={token}#step1")


@app.route("/detect-tv-spikes", methods=["POST"])
@handle_errors
def detect_tv_spikes():
    """Detect traffic spikes from TV ads - run every 5 minutes via cron"""
    if not Config.ENABLE_VISITOR_TRACKING:
        return jsonify({"message": "Tracking disabled"}), 200
    
    try:
        session = db_session()
        
        # Get traffic for last 5 minutes vs previous hour
        from sqlalchemy import func, text
        
        query = text("""
        WITH baseline AS (
            SELECT COUNT(*) / 12.0 as avg_5min_traffic
            FROM visitor_sessions
            WHERE first_visit BETWEEN NOW() - INTERVAL '75 minutes' 
                                  AND NOW() - INTERVAL '15 minutes'
        ),
        current AS (
            SELECT COUNT(*) as current_traffic
            FROM visitor_sessions
            WHERE first_visit >= NOW() - INTERVAL '5 minutes'
        )
        SELECT 
            b.avg_5min_traffic,
            c.current_traffic,
            CASE 
                WHEN b.avg_5min_traffic > 0 
                THEN c.current_traffic / b.avg_5min_traffic 
                ELSE 0 
            END as spike_ratio
        FROM baseline b, current c
        """)
        
        result = session.execute(query).fetchone()
        
        if result and result.spike_ratio > 3.0:  # 3x normal traffic
            # Check if TV ad was scheduled
            uk_now = get_uk_time()
            tv_ad = session.query(OfflineCampaign).filter(
                OfflineCampaign.air_date == uk_now.date(),
                OfflineCampaign.air_time <= uk_now.time(),
                OfflineCampaign.end_time >= uk_now.time()
            ).first()
            
            if tv_ad:
                # Create spike record
                spike = TrafficSpike(
                    baseline_traffic=int(result.avg_5min_traffic),
                    spike_traffic=int(result.current_traffic),
                    spike_multiplier=float(result.spike_ratio),
                    attributed_campaign_id=tv_ad.campaign_id,
                    confidence_score=min(0.9, result.spike_ratio / 5.0)  # Max 90% confidence
                )
                session.add(spike)
                session.commit()
                
                logger.info(f"Detected spike attributed to {tv_ad.channel} - {tv_ad.program}")
        
        session.close()
        return jsonify({"checked": True}), 200
        
    except Exception as e:
        logger.error(f"Error detecting spikes: {e}")
        return jsonify({"error": str(e)}), 500

@app.route("/")
def index():
    """Render the main form with tracking configuration"""
    return render_template(
        "index.html", 
        google_analytics_id=Config.GOOGLE_ANALYTICS_ID,
        meta_pixel_id=Config.META_PIXEL_ID,  
        cookie_days=Config.COOKIE_DAYS,
        enable_tracking=Config.ENABLE_VISITOR_TRACKING,
        test_mode_enabled=Config.TEST_MODE,
        show_landing_page=Config.SHOW_LANDING_PAGE  # Pass landing page configuration
    )

@app.route("/thankyou")
def thankyou():
    """Render the thank you page after form submission"""
    return render_template(
        "thankyou.html",
        google_analytics_id=Config.GOOGLE_ANALYTICS_ID,
        meta_pixel_id=Config.META_PIXEL_ID
    )

@app.route('/js/<path:filename>')
def serve_js(filename):
    """Serve JavaScript files from js directory"""
    import os
    js_dir = os.path.join(app.root_path, 'js')
    return send_from_directory(js_dir, filename)

@app.route('/static/<path:filename>')
def serve_static(filename):
    """Serve static files with proper MIME types"""
    import os
    
    static_dir = os.path.join(app.root_path, 'static')
    
    # MIME type mapping
    mime_types = {
        '.css': 'text/css',
        '.js': 'application/javascript',
        '.json': 'application/json',
        '.png': 'image/png',
        '.jpg': 'image/jpeg',
        '.svg': 'image/svg+xml',
        '.ico': 'image/x-icon',
        '.woff': 'font/woff',
        '.woff2': 'font/woff2'
    }
    
    # Get MIME type from extension
    mimetype = None
    if '.' in filename:
        ext = '.' + filename.rsplit('.', 1)[1].lower()
        mimetype = mime_types.get(ext)
    
    # Serve with explicit MIME type
    if mimetype:
        return send_from_directory(static_dir, filename, mimetype=mimetype)
    else:
        return send_from_directory(static_dir, filename)

@app.route('/static/favicon/<path:filename>')
def serve_favicon(filename):
    """Serve favicon files with proper MIME types"""
    import os
    favicons_dir = os.path.join(app.root_path, 'static', 'favicon')
    
    # Define MIME types for different favicon files
    mime_types = {
        'site.webmanifest': 'application/manifest+json',
        'browserconfig.xml': 'application/xml',
        '.svg': 'image/svg+xml',
        '.png': 'image/png',
        '.ico': 'image/x-icon',
        'favicon.ico': 'image/x-icon'
    }
    
    # Determine the MIME type
    mimetype = None
    for ext, mime in mime_types.items():
        if filename.endswith(ext) or filename == ext:
            mimetype = mime
            break
    
    # Default MIME type if not found
    if not mimetype:
        if '.' in filename:
            ext = filename.split('.')[-1].lower()
            if ext == 'xml':
                mimetype = 'application/xml'
            elif ext == 'json':
                mimetype = 'application/json'
    
    # Log favicon request for debugging
    logger.debug(f"Favicon requested: {filename}, MIME type: {mimetype}")
    
    return send_from_directory(favicons_dir, filename, mimetype=mimetype)



@app.route("/lenders", methods=["GET"])
@handle_errors
def get_lenders():
    """Get all lenders from database"""
    return jsonify(lenders_service.get_all()), 200

@app.route("/config/dates", methods=["GET"])
@handle_errors
def get_date_config():
    """Get the configured date range for eligibility"""
    return jsonify({
        "date_start": Config.DATE_START,
        "date_end": Config.DATE_END
    }), 200

@app.route("/lookup-address", methods=["POST"])
@handle_errors
def lookup_address():
    """Lookup addresses by postcode"""
    postcode = request.json.get("postCode", "").strip()
    if not postcode:
        return jsonify({"error": "postCode is required"}), 400
    
    result = valifi_client.lookup_address(postcode)
    addresses = (
        result.get("data", {})
        .get("listAddressByPostcodeResponse", {})
        .get("matchedStructuredAddress", [])
    )
    
    # Sort addresses by building number/name for better UX
    def address_sort_key(addr):
        # Try to extract building number for sorting
        building = addr.get("number", "") or addr.get("house", "") or addr.get("name", "") or addr.get("flat", "") or ""
        # Try to convert to int if it's a number
        try:
            return (0, int(building))
        except ValueError:
            return (1, building)
    
    sorted_addresses = sorted(addresses, key=address_sort_key)
    
    return jsonify({"addresses": sorted_addresses}), 200



@app.route("/otp/request", methods=["POST"])
@handle_errors
def otp_request():
    """Request OTP for mobile verification"""
    mobile = request.json.get("mobile", "").strip()
    if not mobile:
        return jsonify({"error": "mobile is required"}), 400
    
    logger.info(f"OTP request for mobile: {mobile}")
    
    try:
        result, status = valifi_client.request_otp(mobile)
        logger.info(f"OTP response status: {status}, result: {result}")
        
        # Always return success with status true if we got a 200 response
        if status == 200:
            # Ensure we always have a status field
            if "status" not in result:
                result["status"] = True
            return jsonify(result), 200
        else:
            logger.error(f"OTP request failed with status {status}: {result}")
            return jsonify({"error": "OTP request failed", "details": result}), status
    except Exception as e:
        logger.error(f"OTP request exception: {str(e)}")
        return jsonify({"error": "OTP request failed", "details": str(e)}), 500

@app.route("/otp/verify", methods=["POST"])
@handle_errors
def otp_verify():
    """Verify OTP code"""
    mobile = request.json.get("mobile", "").strip()
    code = request.json.get("code", "").strip()
    
    if not (mobile and code):
        return jsonify({"error": "mobile and code are required"}), 400
    
    logger.info(f"OTP verification for mobile: {mobile}")
    result, status = valifi_client.verify_otp(mobile, code)
    return jsonify(result), status

@app.route("/validate-identity", methods=["POST"])
@handle_errors
def validate_identity():
    """
    Validate identity with MobileID included
    Uses the tu/validate endpoint which returns identity score
    """
    data = request.json or {}
    
    # CRITICAL: Trim all name fields to remove leading/trailing spaces
    first_name = (data.get("firstName", "") or "").strip()
    middle_name = (data.get("middleName", "") or "").strip()
    last_name = (data.get("lastName", "") or "").strip()
    
    # Build client reference from trimmed names
    client_ref = f"{first_name}_{last_name}" if first_name and last_name else "identityCheck"
    
    # Build current address
    current_address = {
        "flat": data.get("flat", "") or None,
        "houseName": data.get("building_name", "") or None,
        "houseNumber": data.get("building_number", "") or None,
        "street": data.get("street", "") or None,
        "street2": None,
        "district": data.get("district", "") or None,
        "postTown": data.get("post_town", "") or None,
        "county": data.get("county", "") or None,
        "postCode": data.get("post_code", "") or None,
        "addressID": None
    }
    
    # Handle previous addresses
    previous_address = None
    previous_previous_address = None
    
    if data.get("previousAddress") and data["previousAddress"].get("post_code"):
        previous_address = format_address_for_valifi(data["previousAddress"])
    
    if data.get("previousPreviousAddress") and data["previousPreviousAddress"].get("post_code"):
        previous_previous_address = format_address_for_valifi(data["previousPreviousAddress"])
    
    # Build payload matching the exact format from documentation
    # Using trimmed names in payload
    payload = {
        "includeJsonReport": True,
        "includePdfReport": False,
        "includeMobileId": True,
        "includeEmailId": True,
        "clientReference": client_ref,
        "title": data.get("title", ""),
        "forename": first_name,
        "middleName": middle_name,
        "surname": last_name,
        "emailAddress": data.get("email", ""),
        "mobileNumber": data.get("mobile", ""),
        "dateOfBirth": data.get("dateOfBirth"),
        "currentAddress": current_address,
        "previousAddress": previous_address,
        "previousPreviousAddress": previous_previous_address
    }
    
    logger.info(f"Identity validation for: {payload['forename']} {payload['surname']}")
    if previous_address:
        logger.info(f"Including previous address: {previous_address.get('postCode')}")
    if previous_previous_address:
        logger.info(f"Including previous previous address: {previous_previous_address.get('postCode')}")
    
    result, status = valifi_client.validate_identity_with_mobileid(payload)
    
    if status != 200:
        logger.error(f"Validation failed with status {status}: {result}")
        return jsonify(result), status
    
    # Extract identity score from the response
    try:
        # Try multiple paths where the score might be
        score_paths = [
            lambda r: int(r.get("data", {}).get("jsonReport", {}).get("data", {}).get("OtherChecks", {}).get("IdentityScore", "0")),
            lambda r: int(r.get("data", {}).get("summaryReport", {}).get("data", {}).get("OtherChecks", {}).get("IdentityScore", "0")),
            lambda r: int(r.get("jsonReport", {}).get("data", {}).get("OtherChecks", {}).get("IdentityScore", "0"))
        ]
        
        
        identity_score = 0
        for path in score_paths:
            try:
                score = path(result)
                if score > 0:
                    identity_score = score
                    break
            except:
                continue
        
        # Check if identity score meets minimum requirement
        passed = identity_score >= Config.VALIFI_MIN_ID_SCORE
        
        logger.info(f"Identity validation result: Score={identity_score}, Passed={passed}")
        
        # Include the full Valifi response in the return
        response = {
            "success": True,
            "passed": passed,
            "identityScore": identity_score,
            "minimumScore": Config.VALIFI_MIN_ID_SCORE,
            "valifiResponse": result  # Include full response for frontend storage
        }
        
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error parsing validation response: {e}")
        return jsonify({
            "error": "Failed to parse validation response",
            "details": str(e)
        }), 500

@app.route("/query", methods=["POST"])
@handle_errors
def query_valifi():
    client_ip = get_client_ip()
    logger.info(f"✅ Authorized /query from whitelisted IP: {client_ip}")
    
    data = request.json or {}

    # Required fields as you already enforce
    required_fields = ["firstName", "lastName", "dateOfBirth", "street", "post_town", "post_code"]
    for field in required_fields:
        if not data.get(field):
            return jsonify({"error": f"{field} is required"}), 400

    # CRITICAL: Trim all name fields to remove leading/trailing spaces
    first_name = (data.get("firstName", "") or "").strip()
    middle_name = (data.get("middleName", "") or "").strip()
    last_name = (data.get("lastName", "") or "").strip()
    dob = data.get("dateOfBirth", "") or ""  # "YYYY-MM-DD"
    
    # Deterministic client reference helps support/debug
    client_reference = f"{first_name}_{last_name}_{dob}" if (first_name and last_name and dob) else "web_form"

    # Build current address
    current_address = {
        "flat": data.get("flat", "") or None,
        "houseName": data.get("building_name", "") or None,
        "houseNumber": data.get("building_number", "") or None,
        "street": data.get("street", "") or None,
        "street2": None,
        "district": data.get("district", "") or None,
        "postTown": data.get("post_town", "") or None,
        "county": data.get("county", "") or None,
        "postCode": data.get("post_code", "") or None
    }
    
    # Handle previous addresses
    previous_address = None
    previous_previous_address = None
    
    if data.get("previousAddress") and data["previousAddress"].get("post_code"):
        previous_address = format_address_for_valifi(data["previousAddress"])
        logger.info(f"Including previous address in credit report: {previous_address.get('postCode')}")
    
    if data.get("previousPreviousAddress") and data["previousPreviousAddress"].get("post_code"):
        previous_previous_address = format_address_for_valifi(data["previousPreviousAddress"])
        logger.info(f"Including previous previous address in credit report: {previous_previous_address.get('postCode')}")

    # Build payload with trimmed names
    payload = {
        "includeJsonReport": True,
        "includePdfReport": True,
        "includePdfSummaryReport": False,
        "includeSummaryReport": False,
        "includeSummaryReportV2": True,

        "clientReference": client_reference,
        "title": data.get("title", "") or "",
        "forename": first_name,
        "middleName": middle_name,
        "surname": last_name,
        "dateOfBirth": dob,

        "currentAddress": current_address,
        "previousAddress": previous_address,
        "previousPreviousAddress": previous_previous_address
    }

    logger.info(f"Requesting Equifax report for {first_name} {last_name}")

    # DEBUG: Log exactly what we're sending to Valifi
    import json
    logger.info(f"Sending to Valifi: {json.dumps(payload, indent=2)[:500]}")
    
    result = valifi_client.get_credit_report(payload)
    
    # Store the full credit report in MEMORY (not session - too large for cookies!)
    # We'll pass it through the frontend instead
    
    # DEBUG: Log what Valifi actually returned
    logger.info(f"Valifi API response status: {result.get('status')}")
    logger.info(f"Valifi response has data: {'data' in result}")
    if 'data' in result:
        logger.info(f"Data keys: {list(result['data'].keys())}")
        logger.info(f"Has jsonReport: {'jsonReport' in result.get('data', {})}")
        logger.info(f"Has summaryReportV2: {'summaryReportV2' in result.get('data', {})}")
        
        # If summaryReportV2 is missing, log the first 500 chars to see structure
        if 'summaryReportV2' not in result.get('data', {}):
            import json
            logger.warning(f"summaryReportV2 MISSING! Response structure: {json.dumps(result, indent=2)[:500]}...")


    # If result["data"]["pdfReport"] exists, upload to S3 and attach pdfUrl
    report_data = result.get("data", {})
    pdf_b64 = report_data.get("pdfReport")
    if pdf_b64 and s3_client:
        try:
            pdf_bytes = base64.b64decode(pdf_b64)
            filename = f"{uuid.uuid4().hex}.pdf"
            key = f"reports/{filename}"
            s3_client.put_object(
                Bucket=Config.AWS_S3_BUCKET,
                Key=key,
                Body=pdf_bytes,
                ContentType="application/pdf"
            )
            report_data["pdfUrl"] = f"https://{Config.AWS_S3_BUCKET}.s3.{Config.AWS_REGION}.amazonaws.com/{key}"
            logger.info(f"Uploaded PDF report to S3: {key}")
        except Exception as e:
            logger.error(f"Failed to upload PDF to S3: {e}")

    # Process summaryReportV2 if present
    if report_data and report_data.get('summaryReportV2'):
        summaryV2 = report_data['summaryReportV2']
        if summaryV2.get('accounts'):
            report_data['accounts'] = summaryV2['accounts']

    accounts = report_data.get('accounts', [])
    
    # Check eligibility for each account
    eligible_accounts = []
    for account in accounts:
        if account.get('startDate'):
            is_eligible, reason = check_date_eligibility(account['startDate'])
            account['dateEligible'] = is_eligible
            account['eligibilityReason'] = reason
            if is_eligible:
                eligible_accounts.append(account)
        else:
            # If no start date, assume eligible (will be caught by manual check later)
            account['dateEligible'] = True
            eligible_accounts.append(account)

    logger.info(f"Found {len(accounts)} accounts ({len(eligible_accounts)} date-eligible)")

    return jsonify(result), 200

@app.route("/resume/<resume_token>", methods=["GET"])
def resume_form(resume_token):
    """Allow user to resume their form using a unique token"""
    session_db = None
    try:
        session_db = db_session()
        
        visitor_session = session_db.query(VisitorSession).filter_by(
            resume_token=resume_token
        ).first()
        
        if not visitor_session:
            return render_template('index.html', error="Invalid or expired resume link")
        
        # Check if token is too old (e.g., 30 days)
        if visitor_session.resume_token_created:
            token_age = datetime.utcnow() - visitor_session.resume_token_created
            if token_age.days > 30:
                return render_template('index.html', error="This resume link has expired")
        
        # Parse saved form data
        form_data = {}
        if visitor_session.form_data_snapshot:
            try:
                form_data = json.loads(visitor_session.form_data_snapshot)
            except:
                pass
        
        # Add personal info to form data if not in snapshot
        if not form_data.get('firstName') and visitor_session.first_name:
            form_data['firstName'] = visitor_session.first_name
        if not form_data.get('lastName') and visitor_session.last_name:
            form_data['lastName'] = visitor_session.last_name
        if not form_data.get('email') and visitor_session.email:
            form_data['email'] = visitor_session.email
        if not form_data.get('mobile') and visitor_session.mobile:
            form_data['mobile'] = visitor_session.mobile
        if visitor_session.date_of_birth:
            form_data['dateOfBirth'] = visitor_session.date_of_birth.isoformat()
        
        # Update last activity
        visitor_session.last_activity = datetime.utcnow()
        session_db.commit()
        
        # Render form with pre-filled data
        return render_template(
            'index.html',
            resume_mode=True,
            session_id=visitor_session.session_id,
            form_data=json.dumps(form_data),
            last_step=visitor_session.last_saved_step,
            progress=visitor_session.form_progress_percent
        )
        
    except Exception as e:
        logger.error(f"Error resuming form: {e}")
        return render_template('index.html', error="Unable to resume form")
    finally:
        if session_db:
            session_db.close()


@app.route("/api/get-resume-data/<session_id>", methods=["GET"])
def get_resume_data(session_id):
    """API endpoint for frontend to fetch saved form data"""
    session_db = None
    try:
        session_db = db_session()
        
        visitor_session = session_db.query(VisitorSession).filter_by(
            session_id=session_id
        ).first()
        
        if not visitor_session:
            return jsonify({"error": "Session not found"}), 404
        
        # Build response with saved data
        saved_data = {}
        
        if visitor_session.form_data_snapshot:
            try:
                saved_data = json.loads(visitor_session.form_data_snapshot)
            except:
                pass
        
        # Merge with individual fields (individual fields take precedence)
        if visitor_session.first_name:
            saved_data['firstName'] = visitor_session.first_name
        if visitor_session.last_name:
            saved_data['lastName'] = visitor_session.last_name
        if visitor_session.email:
            saved_data['email'] = visitor_session.email
        if visitor_session.mobile:
            saved_data['mobile'] = visitor_session.mobile
        if visitor_session.date_of_birth:
            saved_data['dateOfBirth'] = visitor_session.date_of_birth.isoformat()
        if visitor_session.title:
            saved_data['title'] = visitor_session.title
        
        # Address
        if visitor_session.building_number:
            saved_data['building_number'] = visitor_session.building_number
        if visitor_session.building_name:
            saved_data['building_name'] = visitor_session.building_name
        if visitor_session.street:
            saved_data['street'] = visitor_session.street
        if visitor_session.post_town:
            saved_data['post_town'] = visitor_session.post_town
        if visitor_session.post_code:
            saved_data['post_code'] = visitor_session.post_code
        if visitor_session.county:
            saved_data['county'] = visitor_session.county
        if visitor_session.district:
            saved_data['district'] = visitor_session.district
        if visitor_session.flat:
            saved_data['flat'] = visitor_session.flat
        
        response = {
            "success": True,
            "formData": saved_data,
            "lastStep": visitor_session.last_saved_step,
            "progress": visitor_session.form_progress_percent,
            "sessionId": visitor_session.session_id
        }
        
        return jsonify(response), 200
        
    except Exception as e:
        logger.error(f"Error getting resume data: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if session_db:
            session_db.close()

@app.route("/upload_summary", methods=["POST"])
@handle_errors
def upload_summary():
    """
    Handle final summary submission:
    - Create one ClaimTracking row (plus professional rep junctions)
    - Create DCA/IRL FLG leads using the ORIGINAL XML flow (flg_client)
    - Update ClaimTracking with results
    """
    session = None
    claim_id = None

    try:
        summary = request.json or {}
        logger.info("Received summary submission")
        logger.info(f"[DEBUG] session_id value: '{summary.get('session_id')}'")
        logger.info(f"[DEBUG] sessionId value: '{summary.get('sessionId')}'")  

        # INITIALIZE THESE AT THE TOP SCOPE OF TRY BLOCK
        valifi_json = ""
        cmc_detected = False


        # === SECTION SEPARATOR ===
        # 1) CREATE SINGLE CLAIMTRACKING ROW (with consents & Valifi snapshot)
        # === SECTION SEPARATOR ===
        session_db = db_session()
        claim = ClaimTracking()

        # Get the full credit report from the summary (frontend sends it as valifiResponse)
        full_credit_report = summary.get("valifiResponse", {})
        if full_credit_report:
            logger.info(f"Retrieved full credit report from summary (size: {len(json.dumps(full_credit_report))} chars)")
        else:
            logger.warning("No valifiResponse found in summary")

        # Personal & contact
        claim.first_name = summary.get("firstName", "")
        claim.last_name = summary.get("lastName", "")
        claim.email = summary.get("email", "")
        claim.mobile = summary.get("mobile") or summary.get("phone1", "")

        # Postcode (multiple keys)
        claim.post_code = summary.get("postcode") or summary.get("post_code") or summary.get("postCode", "")

        # Date of birth - store as date (flex parsing; UI sends yyyy-mm-dd or dd/mm/yyyy)
        dob_raw = summary.get("dateOfBirth", "")
        logger.info(f"[DOB DEBUG] Raw DOB from frontend: '{dob_raw}'")
        if dob_raw:
            try:
                if "T" in dob_raw:
                    claim.date_of_birth = datetime.strptime(dob_raw.split("T")[0], "%Y-%m-%d").date()
                elif "/" in dob_raw:
                    d, m, y = dob_raw.split("/")
                    claim.date_of_birth = datetime.strptime(f"{y}-{m}-{d}", "%Y-%m-%d").date()
                else:
                    claim.date_of_birth = datetime.strptime(dob_raw, "%Y-%m-%d").date()
            except Exception as e:
                logger.error(f"Failed to parse DOB '{dob_raw}': {e}")
        
        # Log what was saved to database
        if hasattr(claim, 'date_of_birth') and claim.date_of_birth:
            logger.info(f"[DOB DEBUG] Saved to DB: {claim.date_of_birth}")
        else:
            logger.warning("[DOB DEBUG] No DOB saved to database")

        # Current address as JSON snapshot (match your model)
        current_address = {
            "building_number": summary.get("building_number", ""),
            "building_name": summary.get("building_name", ""),
            "flat": summary.get("flat", ""),
            "street": summary.get("street", ""),
            "post_town": summary.get("towncity") or summary.get("post_town", ""),
            "post_code": summary.get("postcode") or summary.get("post_code", ""),
        }
        claim.current_address = json.dumps(current_address)

        # Previous addresses array snapshot
        prev_addresses = []
        if summary.get("previousAddress"):
            prev_addresses.append(summary.get("previousAddress"))
        if summary.get("previousPreviousAddress"):
            prev_addresses.append(summary.get("previousPreviousAddress"))
        if prev_addresses:
            claim.previous_addresses = json.dumps(prev_addresses)

        # Identity / Valifi
        claim.identity_score = summary.get("identityScore") or 0
        min_score = int(os.getenv("VALIFI_MIN_ID_SCORE", "40"))
        claim.identity_verified = (claim.identity_score or 0) >= min_score

        valifi_response = summary.get("valifiResponse")
        claim.valifi_response_stored = bool(valifi_response)
        
        # Process Valifi response and detect CMC
        cmc_in_report = "No"
        if valifi_response:
            # Check for Valifi in the response (Valifi = CMC activity)
            response_str = str(valifi_response).lower()
            if "valifi" in response_str:
                cmc_in_report = "Yes"
                logger.info(f"Valifi detected in credit report for claim {claim_id}")
            else:
                logger.info(f"No Valifi detected in credit report for claim {claim_id}")
        
        # Store the CMC detection result
        claim.cmc_in_credit_report = cmc_in_report

        # Consents (incl. FCA choice)
        claim.belmond_choice_consent = summary.get("belmondChoiceConsent", False)
        
        # Map choice reason to full text
        raw_choice_reason = summary.get("choiceReason", "")
        if raw_choice_reason in CHOICE_REASON_MAP:
            claim.choice_reason = CHOICE_REASON_MAP[raw_choice_reason]
        else:
            # Already full text or custom reason
            claim.choice_reason = raw_choice_reason
            
        claim.other_reason_text = summary.get("otherReasonText", "")
        
        # Store disengagement reason with full text mapping
        disengagement_reason_raw = summary.get("disengagementReason", "")
        disengagement_other = summary.get("disengagementOtherText", "")
        
        if disengagement_reason_raw == "other" and disengagement_other:
            claim.disengagement_reason = disengagement_other
        elif disengagement_reason_raw in DISENGAGEMENT_REASON_MAP:
            claim.disengagement_reason = DISENGAGEMENT_REASON_MAP[disengagement_reason_raw]
        else:
            claim.disengagement_reason = disengagement_reason_raw
            
        claim.disengagement_other_text = disengagement_other
        
        claim.existing_representation_consent = summary.get("existingRepresentationConsent")
        selected_reps = summary.get("selectedProfessionalReps", []) or []
        if selected_reps:
            claim.existing_representation_details = json.dumps(selected_reps)
        claim.mammoth_promotions_consent = summary.get("mammothPromotionsConsent", False)
        claim.motor_finance_consent = summary.get("motorFinanceConsent", False)
        claim.irresponsible_lending_consent = summary.get("irresponsibleLendingConsent", False)

        # Campaign / tracking / UA
        claim.campaign = summary.get("campaign", "Unknown")
        claim.client_ip = summary.get("clientIp") or request.remote_addr
        claim.user_agent = request.headers.get("User-Agent", "")[:255]

        # Signature flags
        signature_base64 = summary.get("signatureBase64")
        claim.signature_provided = bool(signature_base64)
        claim.signature_submitted = bool(signature_base64)

        # PDF URL (store immediately; client may send "TEST_MODE_NO_PDF" in test mode)
        claim.pdf_url = summary.get('pdfUrl') or claim.pdf_url
        pdf_url = claim.pdf_url  # Make pdf_url available for FLG lead creation


        # Eligibility window (stored on the record for transparency)
        claim.date_range_start = datetime.strptime(os.getenv("DATE_START", "2007-01-01"), "%Y-%m-%d").date()
        claim.date_range_end = datetime.strptime(os.getenv("DATE_END", "2021-01-28"), "%Y-%m-%d").date()


        # Initial counts
        claim.lenders_found = 0
        claim.lenders_manual = 0
        claim.lenders_eligible = 0
        claim.lenders_ineligible = 0
        claim.leads_created_count = 0
        claim.all_within_date_range = False
        claim.claim_submitted = False
        claim.claim_status = "pending"
        claim.lead_source = "api"

        session_db.add(claim)
        session_db.flush()
        claim_id = claim.id
        logger.info(f"Created ClaimTracking id={claim_id}")

        # Update visitor session with fortress_id (claim_id)
        session_id_from_frontend = summary.get("session_id")
        logger.info(f"[FORTRESS_ID DEBUG] session_id from frontend: {session_id_from_frontend}")

        if session_id_from_frontend:
            try:
                from tracking_models import VisitorSession
                logger.info(f"[FORTRESS_ID DEBUG] Looking up visitor session: {session_id_from_frontend}")
                
                visitor_session = session_db.query(VisitorSession).filter_by(
                    session_id=session_id_from_frontend
                ).first()
                
                if visitor_session:
                    logger.info(f"[FORTRESS_ID DEBUG] Found visitor session, updating with fortress_id={claim_id}")
                    visitor_session.fortress_id = claim_id
                    visitor_session.form_completed = True
                    visitor_session.conversion_timestamp = datetime.utcnow()
                    session_db.flush()
                    logger.info(f"✅ FORTRESS_ID: Updated session {session_id_from_frontend} with fortress_id={claim_id}")
                else:
                    logger.warning(f"⚠️ FORTRESS_ID: Visitor session NOT FOUND for session_id: {session_id_from_frontend}")
                    
                    # Debug: Check what sessions exist
                    all_sessions = session_db.query(VisitorSession).limit(5).all()
                    logger.info(f"[FORTRESS_ID DEBUG] Recent sessions in DB: {[s.session_id for s in all_sessions]}")
                    
            except Exception as e:
                logger.error(f"❌ FORTRESS_ID: Failed to update visitor session: {e}")
                import traceback
                logger.error(f"[FORTRESS_ID DEBUG] Traceback: {traceback.format_exc()}")
        else:
            logger.warning(f"⚠️ FORTRESS_ID: No session_id in summary data")
            logger.info(f"[FORTRESS_ID DEBUG] Summary keys: {list(summary.keys())}")


        if full_credit_report:
            valifi_json, cmc_detected = store_valifi_json_to_s3(
                full_credit_report,
                claim_id,
                session_db
            )
            
            # Update the claim with CMC detection result
            session_db = db_session()
            try:
                claim = session_db.query(ClaimTracking).filter_by(id=claim_id).first()
                if claim:
                    claim.cmc_in_credit_report = "Yes" if cmc_detected else "No"
                    session_db.commit()
                    logger.info(f"Updated claim {claim_id} with CMC status: {'Yes' if cmc_detected else 'No'}")
            except Exception as e:
                logger.error(f"Failed to update CMC status: {e}")
                session_db.rollback()
            finally:
                session_db.close()
            
            if cmc_detected:
                logger.info(f"Valifi detected in credit report for claim {claim_id} (CMC activity present)")
            else:
                logger.info(f"No Valifi detected in credit report for claim {claim_id} (no CMC activity)")



        # Link professional reps (junctions)
        for rep in selected_reps:
            rep_id = (rep or {}).get("id")
            # Skip the unknown_cmc placeholder - it's not a real database ID
            if rep_id and rep_id != 'unknown_cmc':
                session_db.add(ClaimProfessionalRepresentative(
                    claim_id=claim_id,
                    representative_id=rep_id
                ))
            elif rep_id == 'unknown_cmc':
                logger.info(f"Skipping unknown_cmc placeholder for claim {claim_id} - kept in JSON but not linked")

        session_db.commit()
        session_db.close()
        session_db = None


        # === SECTION SEPARATOR ===
        # PREPARE VARIABLES FOR BACKGROUND PROCESSING
        # === SECTION SEPARATOR ===
        
        # Extract lenders from summary
        found_lenders = summary.get("foundLenders", []) or []
        additional_lenders = summary.get("additionalLenders", []) or []

        # If neither foundLenders nor additionalLenders exist, fall back to accounts
        if not found_lenders and not additional_lenders:
            accounts = summary.get("accounts", []) or []
            # When only accounts is provided, treat them all as found (Valifi) lenders
            found_lenders = accounts
            additional_lenders = []
        else:
            # Combine them for processing
            accounts = found_lenders + additional_lenders

        logger.info(f"Processing {len(accounts)} lenders (Found: {len(found_lenders)}, Manual: {len(additional_lenders)})...")


        # === SECTION SEPARATOR ===
        # QUEUE BACKGROUND FLG PROCESSING
        # === SECTION SEPARATOR ===
        
        logger.info(f"Claim {claim_id} saved to database. Queuing FLG processing...")
        
        if USE_CELERY:
            # Queue task in Celery for background processing
            try:
                task = process_flg_leads_async.delay(
                    claim_id=claim_id,
                    summary=summary,
                    accounts=accounts,
                    found_lenders=found_lenders,
                    additional_lenders=additional_lenders
                )
                logger.info(f"✓ Claim {claim_id} - FLG processing queued in Celery (task_id: {task.id})")
            except Exception as e:
                logger.error(f"✗ Failed to queue Celery task for claim {claim_id}: {e}")
                # Fallback: process directly if Celery fails
                logger.warning(f"Falling back to direct processing for claim {claim_id}")
                process_flg_leads_background(claim_id, summary, accounts, found_lenders, additional_lenders)



        else:
            # Process directly (synchronous - will block for ~30 seconds)
            logger.info(f"Celery disabled - processing claim {claim_id} synchronously")
            flg_result = process_flg_leads_background(claim_id, summary, accounts, found_lenders, additional_lenders)
        
        # Return success immediately (FLG processing happens in background)
        logger.info(f"Claim {claim_id} submitted successfully. User will see thank you page.")
        
        # Build response
        response_data = {
            "success": True,
            "claim_id": claim_id,
            "message": "Claim submitted successfully",
            "lenders_found": len(found_lenders),
            "lenders_manual": len(additional_lenders),
            "processing_mode": "async" if USE_CELERY else "sync"
        }
        
        # Include lead_ids if processed synchronously (for batch processing)
        if not USE_CELERY and flg_result:
            response_data["lead_ids"] = flg_result.get("all_lead_ids", [])
            response_data["successful_leads"] = flg_result.get("successful_leads", 0)
            response_data["failed_leads"] = flg_result.get("failed_leads", 0)
        
        return jsonify(response_data), 200
    
    

    except Exception as e:
        logger.error(f"Error in upload_summary: {e}")
        import traceback
        logger.error(traceback.format_exc())
        # Clean up any open database sessions
        if 'session_db' in locals() and session_db:
            try:
                session_db.rollback()
                session_db.close()
            except:
                pass
        if 'session_db2' in locals() and session_db2:
            try:
                session_db2.rollback()
                session_db2.close()
            except:
                pass
        return jsonify({"error": str(e)}), 500

# New webhook receiver endpoint
@app.route("/webhook/flg-status-update", methods=["POST"])
@handle_errors
def receive_flg_status_update():
    """Receive status updates from FLG and process accordingly"""
    
    # Check if webhook is enabled (comment out if you want to bypass)
    if not Config.FLG_STATUS_UPDATE_ENABLED:
        return jsonify({"error": "Webhook disabled"}), 503
    
    # Get client IP
    client_ip = get_client_ip()
    
    # Verify API key - Support multiple authentication methods
    # 1. X-API-Key header (preferred)
    # 2. Query string 'secret' parameter (FLG format)
    # 3. Form data 'api_key' parameter (fallback)
    api_key = (
        request.headers.get('X-API-Key') or 
        request.args.get('secret') or 
        request.form.get('api_key', '')
    )
    

    if not api_key or api_key != Config.WEBHOOK_API_KEY:
        logger.warning(f"Invalid API key in webhook request from {client_ip}")
        logger.warning(f"Checked: header={request.headers.get('X-API-Key')}, query={request.args.get('secret')}, form={request.form.get('api_key')}")
        return jsonify({"error": "Invalid API key"}), 401
    
    # Optional: Verify HMAC signature if implemented
    signature = request.headers.get('X-Request-Signature')
    if signature:
        timestamp = request.headers.get('X-Request-Timestamp', '')
        expected_signature = hmac.new(
            Config.WEBHOOK_API_KEY.encode(),
            f"{request.data.decode()}{timestamp}".encode(),
            hashlib.sha256
        ).hexdigest()
        
        if signature != expected_signature:
            logger.warning(f"Invalid signature in webhook request from {client_ip}")
            return jsonify({"error": "Invalid signature"}), 401
    
    # Parse request data - FLG sends URL-encoded form data
    # Support both URL-encoded (production) and JSON (testing)
    content_type = request.headers.get('Content-Type', '')
    
    if 'application/x-www-form-urlencoded' in content_type:
        # Production: FLG sends URL-encoded data
        data = request.form.to_dict()
    else:
        # Testing: Allow JSON for backward compatibility with admin dashboard
        data = request.json or {}
    
    # Parse webhook fields - STRIP WHITESPACE
    # FLG uses 'id' for lead ID (not 'LeadID')
    lead_id = str(data.get('id', '') or data.get('LeadID', '')).strip()
    
    # FLG uses 'leadgroupid' for lead group (not 'LeadGroup')
    lead_group = str(data.get('leadgroupid', '') or data.get('LeadGroup', '')).strip()
    
    # FLG uses 'status' for status
    status = str(data.get('status', '') or data.get('Status', '')).strip()
    
    # FLG uses 'reference' for introducer reference
    reference_text = str(data.get('reference', '') or data.get('Reference', '')).strip() if (data.get('reference') or data.get('Reference')) else None
    
    # FLG uses 'data35' for data35 field
    data35_raw = str(data.get('data35', '')).strip() if data.get('data35') else None
    
    # CRITICAL: IRL Lead Group (59549) special handling
    # Always treat data35 as blank/empty for IRL leads regardless of what FLG sends
    if lead_group == '59549':
        logger.info(f"IRL lead group detected - ignoring received data35 value: '{data35_raw}'")
        data35 = None
    else:
        data35 = data35_raw
    
    # DEBUG LOGGING
    logger.info(f"=== WEBHOOK RECEIVED ===")
    logger.info(f"Content-Type: {content_type}")
    logger.info(f"Lead ID: {lead_id}")
    logger.info(f"Looking for mapping with:")
    logger.info(f"  lead_group: '{lead_group}'")
    logger.info(f"  status_received: '{status}'")
    logger.info(f"  reference (introducer_received): '{reference_text}'")
    logger.info(f"  data35_received (original): '{data35_raw}'")
    logger.info(f"  data35_received (processed): '{data35}'")
    
    # Log the webhook request
    session = db_session()
    
    # Debug: Show all existing mappings
    all_mappings = session.query(FLGStatusMapping).all()
    logger.info(f"Total mappings in database: {len(all_mappings)}")
    for m in all_mappings:
        logger.info(f"  Mapping {m.id}: lg='{m.lead_group}', st='{m.status_received}', ref='{m.introducer_received}', d35='{m.data35_received}', action='{m.action}'")
    
    webhook_log = WebhookLog(
        lead_id=lead_id,
        lead_group=lead_group,
        status_received=status,
        introducer_received=reference_text,  # Store as TEXT
        data35_received=data35,
        request_body=json.dumps(data),
        ip_address=client_ip,
        api_key_used=api_key[:10] + "..." if api_key else None
    )
    
    try:
        # Build filter conditions dynamically to handle None values
        # Base filters that always apply
        base_query = session.query(FLGStatusMapping).filter(
            FLGStatusMapping.lead_group == lead_group,
            FLGStatusMapping.status_received == status
        )
        
        # Add reference filter if provided
        if reference_text:
            base_query = base_query.filter(FLGStatusMapping.introducer_received == reference_text)
        else:
            base_query = base_query.filter(FLGStatusMapping.introducer_received.is_(None))
        
        # CRITICAL FIX: For DCA cases (57862), handle data35 matching NULL or empty string
        # For IRL cases (59549), data35 is always None
        if lead_group == '57862':
            # DCA: Match NULL or empty string for blank data35, or exact value if provided
            if data35:
                base_query = base_query.filter(FLGStatusMapping.data35_received == data35)
            else:
                # Match both NULL and empty string
                base_query = base_query.filter(
                    or_(
                        FLGStatusMapping.data35_received.is_(None),
                        FLGStatusMapping.data35_received == ''
                    )
                )
        elif data35:
            # Other lead groups: Only filter if has a value
            base_query = base_query.filter(FLGStatusMapping.data35_received == data35)
        else:
            # Other lead groups with no data35: match NULL
            base_query = base_query.filter(FLGStatusMapping.data35_received.is_(None))
        
        logger.info(f"Searching with SQL query filters applied")
        
        # Get the best matching mapping
        mapping = base_query.order_by(FLGStatusMapping.priority.desc()).first()
        
        if mapping:
            logger.info(f"Found mapping ID {mapping.id}: action={mapping.action}, new_ref={mapping.new_introducer}, new_cost={mapping.new_cost}")
            
            # Perform the mapped action
            action_result = perform_flg_action(
                lead_id=lead_id,
                action=mapping.action,
                new_status=mapping.new_status,
                new_introducer=mapping.new_introducer,  # This is the new reference value
                new_cost=mapping.new_cost
            )
            
            webhook_log.action_taken = mapping.action
            webhook_log.success = action_result['success']
            webhook_log.response_body = json.dumps(action_result)
            
            if action_result['success']:
                logger.info(f"Successfully processed webhook for lead {lead_id}: {mapping.action}")
                response = jsonify({"success": True, "action": mapping.action}), 200
            else:
                logger.error(f"Failed to process webhook for lead {lead_id}: {action_result.get('error')}")
                webhook_log.error_message = action_result.get('error')
                response = jsonify({"error": action_result.get('error')}), 500
        else:
            # No mapping found
            logger.warning(f"No mapping found for combination: {lead_group}/{status}/{reference_text}/{data35}")
            webhook_log.action_taken = "no_mapping"
            webhook_log.success = False
            webhook_log.error_message = "No mapping found"
            response = jsonify({"error": "No mapping found for this combination"}), 404
        
        # Save webhook log
        session.add(webhook_log)
        session.commit()
        
        return response
    except Exception as e:
        logger.error(f"Error processing webhook: {e}")
        import traceback
        logger.error(traceback.format_exc())
        webhook_log.success = False
        webhook_log.error_message = str(e)
        session.add(webhook_log)
        session.commit()
        return jsonify({"error": "Internal server error"}), 500
    finally:
        session.close()


def perform_flg_action(lead_id, action, new_status=None, new_introducer=None, new_cost=None):
    """Perform the specified action on the FLG lead"""
    try:


        if action == "change_reference":
            # Update the reference field in FLG with TEXT
            update_data = {
                "id": lead_id,
                "leadgroup": Config.FLG_LEADGROUP_ID,
                "reference": new_introducer  # Text value for FLG
            }
            
            if new_cost is not None:
                update_data["cost"] = str(new_cost)
            
            xml_payload = flg_client.build_lead_xml(update_data)
            response = flg_client.send_lead(xml_payload)
            
            if response.status_code == 200:
                root = ET.fromstring(response.text)
                status = root.findtext("status")
                if status == "0":                
                    return {"success": True, "message": f"Updated reference to {new_introducer}"}


                else:
                    return {"success": False, "error": root.findtext("message", "Unknown error")}
            else:
                return {"success": False, "error": f"HTTP {response.status_code}"}
                
        elif action == "update_status":
            # Update the status field in FLG
            update_data = {
                "id": lead_id,
                "leadgroup": Config.FLG_LEADGROUP_ID,
                "status": new_status
            }
            
            xml_payload = flg_client.build_lead_xml(update_data)
            response = flg_client.send_lead(xml_payload)
            
            if response.status_code == 200:
                root = ET.fromstring(response.text)
                status = root.findtext("status")
                if status == "0":
                    return {"success": True, "message": f"Updated status to {new_status}"}
                else:
                    return {"success": False, "error": root.findtext("message", "Unknown error")}
            else:
                return {"success": False, "error": f"HTTP {response.status_code}"}
        
        elif action == "update_cost":
            # Update the cost field in FLG
            update_data = {
                "id": lead_id,
                "leadgroup": Config.FLG_LEADGROUP_ID,
                "cost": str(new_cost)
            }
            
            xml_payload = flg_client.build_lead_xml(update_data)
            response = flg_client.send_lead(xml_payload)
            
            if response.status_code == 200:
                root = ET.fromstring(response.text)
                status = root.findtext("status")
                if status == "0":
                    return {"success": True, "message": f"Updated cost to {new_cost}"}
                else:
                    return {"success": False, "error": root.findtext("message", "Unknown error")}
            else:
                return {"success": False, "error": f"HTTP {response.status_code}"}
        
        else:
            return {"success": False, "error": f"Unknown action: {action}"}
            
    except Exception as e:
        logger.error(f"Error performing FLG action: {e}")
        return {"success": False, "error": str(e)}


def track_lead_lender(claim_id, lead_id, lender_name, source, is_eligible, eligibility_reason, introducer, cost, position):
    """Track individual lead-lender relationship"""
    try:
        session = db_session()
        tracking = LeadLenderTracking(
            claim_id=claim_id,
            lead_id=lead_id,
            lender_name=lender_name,
            source=source,
            is_eligible=is_eligible,
            eligibility_reason=eligibility_reason,
            introducer=introducer,
            cost=cost,
            position_in_claim=position
        )
        session.add(tracking)
        session.commit()
        session.close()
    except Exception as e:
        logger.error(f"Failed to track lead-lender: {e}")

@app.route("/health")
def health():
    """Simple health check"""
    return jsonify({"status": "ok"}), 200

@app.route('/loaderio-dc1a7adfa8d1d95f3b92a11a55224d04/')
@app.route('/loaderio-dc1a7adfa8d1d95f3b92a11a55224d04.txt')
@app.route('/loaderio-dc1a7adfa8d1d95f3b92a11a55224d04.html')
def loaderio_verification():
    """Loader.io verification endpoint for stress testing"""
    return 'loaderio-dc1a7adfa8d1d95f3b92a11a55224d04', 200, {'Content-Type': 'text/plain'}

@app.route("/metrics", methods=["GET"])
def metrics():
    """Expose basic metrics for monitoring"""
    # Simple auth
    if request.headers.get('X-Metrics-Key') != os.getenv('METRICS_KEY', 'default-metrics-key'):
        return jsonify({"error": "Unauthorized"}), 401
    
    try:
        session = db_session()
        
        # Get basic stats
        total_visitors = session.query(VisitorSession).count()
        today_visitors = session.query(VisitorSession).filter(
            VisitorSession.first_visit >= datetime.utcnow().date()
        ).count()
        
        # Get conversions
        total_conversions = session.query(VisitorSession).filter(
            VisitorSession.form_completed == True
        ).count()
        
        conversion_rate = (total_conversions / total_visitors * 100) if total_visitors > 0 else 0
        
        stats = {
            "total_visitors": total_visitors,
            "today_visitors": today_visitors,
            "total_conversions": total_conversions,
            "conversion_rate": round(conversion_rate, 2),
            "timestamp": datetime.utcnow().isoformat()
        }
        
        session.close()
        return jsonify(stats), 200
        
    except Exception as e:
        logger.error(f"Error getting metrics: {e}")
        if session:
            session.close()
        return jsonify({"error": "Failed to get metrics"}), 500

# === SECTION SEPARATOR ===
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {error}")
    return jsonify({"error": "Internal server error"}), 500

# === SECTION SEPARATOR ===
@app.teardown_appcontext
def shutdown_session(exception=None):
    db_session.remove()

# === SECTION SEPARATOR ===
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    logger.info(f"Starting Flask app on port {port}")
    
    # Log webhook configuration at startup
    logger.info(f"WEBHOOK_API_KEY loaded: {Config.WEBHOOK_API_KEY[:10]}... (length: {len(Config.WEBHOOK_API_KEY)})")
    logger.info(f"FLG_STATUS_UPDATE_ENABLED: {Config.FLG_STATUS_UPDATE_ENABLED}")
    
    # FIX: Create instance to access the property
    config = Config()
    logger.info(f"Webhook URL configured as: {config.WEBHOOK_URL}")
    logger.info(f"Google Analytics ID: {Config.GOOGLE_ANALYTICS_ID if Config.GOOGLE_ANALYTICS_ID else 'Not configured'}")
    logger.info(f"Date eligibility range: {Config.DATE_START} to {Config.DATE_END}")
    logger.info(f"Database URL: {'Configured' if Config.DATABASE_URL else 'Not configured'}")
    app.run(host="0.0.0.0", port=port, debug=Config.DEBUG)