from sqlalchemy import Column, Integer, String, Boolean, DateTime, Date, Text, Float, ForeignKey, DECIMAL
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.sql import func
from datetime import datetime

Base = declarative_base()

class VisitorSession(Base):
    """Track all website visitors with comprehensive journey analytics"""
    __tablename__ = 'visitor_sessions'
    
    # Core tracking (lines 1-10)
    session_id = Column(String(64), primary_key=True)
    visitor_id = Column(String(64), index=True)
    first_visit = Column(DateTime, default=datetime.utcnow, index=True)
    last_activity = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    uk_hour = Column(Integer)
    uk_day_of_week = Column(Integer)
    uk_date = Column(Date)
    
    # Source Attribution (lines 11-20)
    source = Column(String(100))
    medium = Column(String(255))
    campaign = Column(String(255), index=True)
    term = Column(String(255))
    content = Column(String(255))
    
    # Facebook Specific (lines 21-28)
    fb_campaign_id = Column(String(50))
    fb_campaign_name = Column(String(255))
    fb_adset_id = Column(String(50))
    fb_adset_name = Column(String(255))
    fb_ad_id = Column(String(50))
    fb_ad_name = Column(String(255))
    fb_placement = Column(String(100))
    fb_platform = Column(String(50))
    
    # Google Specific (lines 29-32)
    gclid = Column(String(255))
    google_keyword = Column(String(255))
    google_match_type = Column(String(50))
    google_ad_position = Column(String(20))
    
    # User Journey (lines 33-37)
    landing_page = Column(Text)
    referrer = Column(Text)
    device_type = Column(String(50))
    browser = Column(String(100))
    ip_address = Column(String(45))
    
    # Original Conversion Tracking (lines 38-44)
    form_started = Column(Boolean, default=False)
    form_completed = Column(Boolean, default=False, index=True)
    lead_ids = Column(Text)  # TEXT not JSONB
    conversion_timestamp = Column(DateTime)
    pages_viewed = Column(Integer, default=1)
    time_on_site = Column(Integer)
    form_abandonment_stage = Column(String(50))
    
    # Timestamps (lines 45-46)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
    
    # NEW TRACKING COLUMNS - Step tracking (lines 47-50)
    last_completed_step = Column(String(50), index=True)
    last_active_field = Column(String(100))
    step_times = Column(Text)
    step_completions = Column(Text)
    
    # Field tracking (lines 51-53)
    field_interactions = Column(Text)
    field_completions = Column(Text)
    field_validation_attempts = Column(Text)
    
    # Consent tracking (lines 54-55)
    consent_states = Column(Text)
    consent_timestamps = Column(Text)
    
    # Credit/Valifi tracking (lines 56-61)
    credit_check_initiated = Column(Boolean, default=False)
    credit_report_stored = Column(Boolean, default=False)
    credit_report_s3_url = Column(Text)
    lenders_found_count = Column(Integer, default=0)
    cmc_detected = Column(Boolean, default=False)
    valifi_response_received = Column(Boolean, default=False)
    
    # Engagement metrics (lines 62-67)
    page_events = Column(Text)
    scroll_depths = Column(Text)
    inactive_periods = Column(Text)
    tab_visibility_changes = Column(Integer, default=0)
    total_interactions = Column(Integer, default=0)
    
    # Identity/OTP tracking (lines 68-73)
    identity_verified = Column(Boolean, default=False, index=True)
    identity_verification_timestamp = Column(DateTime)
    otp_sent = Column(Boolean, default=False)
    otp_verified = Column(Boolean, default=False)
    
    # Signature/Terms tracking (lines 74-77)
    signature_provided = Column(Boolean, default=False, index=True)
    signature_timestamp = Column(DateTime)
    terms_accepted = Column(Boolean, default=False)
    terms_scrolled_to_bottom = Column(Boolean, default=False)
    
    # Professional reps tracking (lines 78-79)
    professional_reps_selected = Column(Text)
    disengagement_reason = Column(String(255))
    
    # FCA disclosure tracking (lines 80-83)
    fca_disclosure_viewed = Column(Boolean, default=False)
    fca_disclosure_version = Column(String(50))
    fca_reason_selected = Column(String(100))
    fca_has_other_reason = Column(Boolean, default=False)
    
    # Manual lender tracking (lines 84-85)
    manual_lenders_added = Column(Integer, default=0)
    manual_lender_details = Column(Text)
    # Fortress ID (links to claims_tracking.id)
    fortress_id = Column(Integer, index=True)  # The claim ID from claims_tracking table

    # Personal/contact and address fields (persist form data)
    first_name = Column(String(100))
    last_name = Column(String(100))
    email = Column(String(255))
    mobile = Column(String(50))
    date_of_birth = Column(Date)
    title = Column(String(20))

    building_number = Column(String(50))
    building_name = Column(String(100))
    flat = Column(String(50))
    street = Column(String(255))
    district = Column(String(100))
    post_town = Column(String(100))
    county = Column(String(100))
    post_code = Column(String(20))

    # JSON text of previous addresses
    previous_addresses = Column(Text)

    # Resume / progress tracking
    resume_token = Column(String(255), index=True)
    resume_token_created = Column(DateTime)
    resume_link_sent = Column(Boolean, default=False)
    resume_link_sent_at = Column(DateTime)

    # Snapshot of form data and progress
    form_data_snapshot = Column(Text)
    form_progress_percent = Column(Integer)
    last_saved_step = Column(String(50))




# Keep your other models (lines 87-110+)
class OfflineCampaign(Base):
    __tablename__ = 'offline_campaigns'
    
    campaign_id = Column(Integer, primary_key=True, autoincrement=True)
    channel = Column(String(100))
    program = Column(String(255))
    air_date = Column(Date)
    air_time = Column(DateTime)
    end_time = Column(DateTime)
    day_of_week = Column(String(20))
    campaign_name = Column(String(255))
    creative_version = Column(String(100))
    estimated_reach = Column(Integer)
    cost = Column(DECIMAL(10, 2))
    created_at = Column(DateTime, default=datetime.utcnow)

class TrafficSpike(Base):
    __tablename__ = 'traffic_spikes'
    
    spike_id = Column(Integer, primary_key=True, autoincrement=True)
    detected_at = Column(DateTime, default=datetime.utcnow)
    baseline_traffic = Column(Integer)
    spike_traffic = Column(Integer)
    spike_multiplier = Column(DECIMAL(5, 2))
    attributed_campaign_id = Column(Integer, ForeignKey('offline_campaigns.campaign_id'))
    confidence_score = Column(DECIMAL(3, 2))