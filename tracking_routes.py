
from flask import Blueprint, request, jsonify
from datetime import datetime
import pytz
import json
import logging
from sqlalchemy.exc import SQLAlchemyError
import hashlib
import user_agents
import re
import secrets

from tracking_models import VisitorSession, OfflineCampaign, TrafficSpike

logger = logging.getLogger(__name__)

from sqlalchemy.orm import scoped_session  # ADD THIS IMPORT

def safe_db_operation(func):
    """Decorator to ensure proper session cleanup"""
    def wrapper(*args, **kwargs):
        from app import db_session
        session = None
        try:
            session = db_session()
            result = func(session, *args, **kwargs)
            session.commit()
            return result
        except Exception as e:
            if session:
                session.rollback()
            logger.error(f"Database error in {func.__name__}: {e}")
            raise
        finally:
            if session:
                session.close()
            db_session.remove()  # Critical: remove scoped session
    return wrapper


# Create Blueprint
tracking_bp = Blueprint('tracking', __name__)

def validate_tracking_request(request):
    """Validate tracking requests for security"""
    # Check origin
    origin = request.headers.get('Origin', '')
    referer = request.headers.get('Referer', '')
    
    # Allow only your domain
    allowed_domains = [
        'localhost',
        '127.0.0.1',
        'belmondpcp.co.uk',
        'www.belmondpcp.co.uk',
        'belmondpcp.com',
        'www.belmondpcp.com',
        'testing-bemondpcp.up.railway.app',
        'valifi-batch.up.railway.app'  # Your mirror site
    ]

    # Check if request is from allowed domain
    origin_valid = any(domain in origin for domain in allowed_domains) if origin else False
    referer_valid = any(domain in referer for domain in allowed_domains) if referer else True
    
    if not (origin_valid or referer_valid):
        logger.warning(f"Tracking request from unauthorized origin: {origin or referer}")
        return False
    
    # Validate payload size (max 10KB)
    if request.content_length and request.content_length > 10240:
        logger.warning(f"Tracking payload too large: {request.content_length}")
        return False
    
    return True

def validate_tracking_payload(data, endpoint_type):
    """Validate tracking payload structure and content"""
    if not isinstance(data, dict):
        return False, "Invalid JSON structure"
    
    # Define required fields per endpoint
    required_fields = {
        'visitor': ['session_id'],
        'form_event': ['session_id', 'event_type'],
        'conversion': ['session_id', 'lead_ids'],
        'detailed_event': ['session_id', 'event_type'],
        'bulk_events': ['session_id', 'events']
    }
    
    # Check required fields
    for field in required_fields.get(endpoint_type, []):
        if field not in data:
            return False, f"Missing required field: {field}"
    
    # Validate string lengths (max 255 chars for most fields)
    string_fields = ['session_id', 'visitor_id', 'source', 'medium', 'campaign', 
                    'term', 'content', 'fb_campaign_id', 'fb_adset_id', 'gclid']
    for field in string_fields:
        if field in data and len(str(data[field])) > 255:
            return False, f"Field {field} exceeds maximum length"
    
    # Validate session_id format (UUID or custom format)
    if 'session_id' in data:
        session_id = str(data['session_id'])
        # Allow UUID format or custom formats like clone-timestamp-random
        if not re.match(r'^[a-zA-Z0-9-_]{8,64}$', session_id):
            return False, "Invalid session_id format"
    
    # Validate arrays
    if 'events' in data and endpoint_type == 'bulk_events':
        if not isinstance(data['events'], list):
            return False, "Events must be an array"
        if len(data['events']) > 100:  # Max 100 events per bulk request
            return False, "Too many events in bulk request (max 100)"
    
    return True, "Valid"

def get_uk_time():
    """Get current UK time (handles BST/GMT automatically)"""
    uk_tz = pytz.timezone('Europe/London')
    return datetime.now(uk_tz)

def parse_user_agent(ua_string):
    """Parse user agent to get device and browser info"""
    user_agent = user_agents.parse(ua_string)
    
    device_type = 'desktop'
    if user_agent.is_mobile:
        device_type = 'mobile'
    elif user_agent.is_tablet:
        device_type = 'tablet'
    
    browser = f"{user_agent.browser.family} {user_agent.browser.version_string}"
    
    return device_type, browser

def get_or_create_visitor_id(request):
    """Get visitor ID from cookie or create new one"""
    visitor_id = request.cookies.get('visitor_id')
    if not visitor_id:
        # Use UUID instead of fingerprinting
        import uuid
        visitor_id = uuid.uuid4().hex
    return visitor_id

@tracking_bp.route("/track-detailed-event", methods=["POST"])
def track_detailed_event():
    """Track detailed form events with comprehensive data"""
    # First check: validate request origin/size
    if not validate_tracking_request(request):
        return jsonify({"error": "Invalid request"}), 403
    
    data = request.json or {}
    
    # Second check: validate JSON payload structure
    is_valid, message = validate_tracking_payload(data, 'detailed_event')
    if not is_valid:
        return jsonify({"error": message}), 400
    
    session = None  # ADDED
    try:
        from app import db_session
        session = db_session()
        
        # Find or create visitor session
        visitor_session = session.query(VisitorSession).filter_by(
            session_id=data.get('session_id')
        ).first()
        
        if not visitor_session:
            visitor_session = VisitorSession(
                session_id=data.get('session_id'),
                visitor_id=data.get('visitor_id', 'unknown')
            )
            session.add(visitor_session)
        
        event_type = data.get('event_type')
        
        # Handle different event types (keeping all your existing logic)
        if event_type == 'step_view':
            step_name = data.get('step_name')
            if step_name:
                visitor_session.last_completed_step = data.get('previous_step')
                
        elif event_type == 'step_complete':
            step_name = data.get('step_name')
            if step_name:
                visitor_session.last_completed_step = step_name
                
        elif event_type == 'field_interaction':
            field_name = data.get('field_name')
            if field_name:
                visitor_session.last_active_field = field_name
                visitor_session.total_interactions = (visitor_session.total_interactions or 0) + 1
                
        elif event_type == 'consent_change':
            consent_type = data.get('consent_type')
            consent_value = data.get('consent_value')
                    
        elif event_type == 'identity_verification':
            status = data.get('status')
            if status == 'completed':
                visitor_session.identity_verified = True
                visitor_session.identity_verification_timestamp = datetime.utcnow()
                
        elif event_type == 'otp_status':
            status = data.get('status')
            if status == 'sent':
                visitor_session.otp_sent = True
            elif status == 'verified':
                visitor_session.otp_verified = True
                
        elif event_type == 'credit_check':
            status = data.get('status')
            if status == 'initiated':
                visitor_session.credit_check_initiated = True
            elif status == 'completed':
                visitor_session.valifi_response_received = True
                visitor_session.lenders_found_count = data.get('lenders_count', 0)
                visitor_session.cmc_detected = data.get('cmc_detected', False)
            elif status == 'stored':
                visitor_session.credit_report_stored = True
                visitor_session.credit_report_s3_url = data.get('s3_url')
                
        elif event_type == 'signature':
            if data.get('status') == 'provided':
                visitor_session.signature_provided = True
                visitor_session.signature_timestamp = datetime.utcnow()
                
        elif event_type == 'terms':
            action = data.get('action')
            if action == 'scrolled_to_bottom':
                visitor_session.terms_scrolled_to_bottom = True
            elif action == 'accepted':
                visitor_session.terms_accepted = True
                
        elif event_type == 'fca_disclosure':
            action = data.get('action')
            if action == 'viewed':
                visitor_session.fca_disclosure_viewed = True
                visitor_session.fca_disclosure_version = data.get('version')
            elif action == 'choice_selected':
                visitor_session.fca_reason_selected = data.get('reason')
                visitor_session.fca_has_other_reason = data.get('has_other', False)
        
        # Update last activity
        visitor_session.last_activity = datetime.utcnow()
        
        # Calculate total time on site
        if visitor_session.first_visit:
            time_diff = datetime.utcnow() - visitor_session.first_visit
            visitor_session.time_on_site = int(time_diff.total_seconds())
        
        session.commit()  # REMOVED session.close()
        
        return jsonify({"tracked": True}), 200
        
    except Exception as e:
        logger.error(f"Error tracking detailed event: {e}")
        if session:  # CHANGED
            session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:  # ADDED
        if session:
            session.close()
        from app import db_session
        db_session.remove()

@tracking_bp.route("/track-bulk-events", methods=["POST"])
def track_bulk_events():
    """Handle bulk event updates for performance"""
    # First check: validate request origin/size
    if not validate_tracking_request(request):
        return jsonify({"error": "Invalid request"}), 403
    
    data = request.json or {}
    
    # Second check: validate JSON payload structure
    is_valid, message = validate_tracking_payload(data, 'bulk_events')
    if not is_valid:
        return jsonify({"error": message}), 400
    
    session = None  # ADDED
    try:
        from app import db_session
        session = db_session()
        
        visitor_session = session.query(VisitorSession).filter_by(
            session_id=data.get('session_id')
        ).first()
        
        if not visitor_session:
            visitor_session = VisitorSession(
                session_id=data.get('session_id'),
                visitor_id=data.get('visitor_id', 'unknown')
            )
            session.add(visitor_session)
        
        events = data.get('events', [])
        
        for event in events:
            event_type = event.get('event_type')
            
            if event_type == 'step_complete':
                visitor_session.last_completed_step = event.get('step_name')
            elif event_type == 'field_interaction':
                visitor_session.last_active_field = event.get('field_name')
                visitor_session.total_interactions = (visitor_session.total_interactions or 0) + 1
        
        # Update last activity
        visitor_session.last_activity = datetime.utcnow()
        
        session.commit()  # REMOVED session.close()
        
        return jsonify({"tracked": True, "events_processed": len(events)}), 200
        
    except Exception as e:
        logger.error(f"Error tracking bulk events: {e}")
        if session:  # CHANGED
            session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:  # ADDED
        if session:
            session.close()
        from app import db_session
        db_session.remove()

@tracking_bp.route("/track-visitor", methods=["POST"])
def track_visitor():
    """Track visitor and update if session already exists"""
    # First check: validate request origin/size
    if not validate_tracking_request(request):
        return jsonify({"error": "Invalid request"}), 403
    
    data = request.json or {}
    
    # Second check: validate JSON payload structure
    is_valid, message = validate_tracking_payload(data, 'visitor')
    if not is_valid:
        return jsonify({"error": message}), 400
    
    session = None
    try:
        from app import db_session
        session = db_session()
        
        # Get UK time details
        uk_time = get_uk_time()
        
        # Parse user agent
        ua_string = request.headers.get('User-Agent', '')
        device_type, browser = parse_user_agent(ua_string)
        
        # Get visitor ID
        visitor_id = data.get('visitor_id') or get_or_create_visitor_id(request)
        
        # Hash IP for privacy
        ip_address = request.remote_addr
        if ip_address:
            ip_address = hashlib.sha256(ip_address.encode()).hexdigest()[:16]
        
        # Check if session already exists
        session_id = data.get('session_id')
        visitor_session = session.query(VisitorSession).filter_by(
            session_id=session_id
        ).first()
        
        if visitor_session:
            # UPDATE existing session - only update fields that should change
            visitor_session.last_activity = datetime.utcnow()
            
            # Only update these fields if they're provided and currently empty
            if data.get('source') and not visitor_session.source:
                visitor_session.source = data.get('source')
            if data.get('medium') and not visitor_session.medium:
                visitor_session.medium = data.get('medium')
            if data.get('campaign') and not visitor_session.campaign:
                visitor_session.campaign = data.get('campaign')
            if data.get('landing_page') and not visitor_session.landing_page:
                visitor_session.landing_page = data.get('landing_page')
            if data.get('referrer') and not visitor_session.referrer:
                visitor_session.referrer = data.get('referrer')
            
            # Facebook params - update if provided and empty
            if data.get('fb_campaign_id') and not visitor_session.fb_campaign_id:
                visitor_session.fb_campaign_id = data.get('fb_campaign_id')
            if data.get('fb_campaign_name') and not visitor_session.fb_campaign_name:
                visitor_session.fb_campaign_name = data.get('fb_campaign_name')
            if data.get('fb_adset_id') and not visitor_session.fb_adset_id:
                visitor_session.fb_adset_id = data.get('fb_adset_id')
            if data.get('fb_adset_name') and not visitor_session.fb_adset_name:
                visitor_session.fb_adset_name = data.get('fb_adset_name')
            if data.get('fb_ad_id') and not visitor_session.fb_ad_id:
                visitor_session.fb_ad_id = data.get('fb_ad_id')
            if data.get('fb_ad_name') and not visitor_session.fb_ad_name:
                visitor_session.fb_ad_name = data.get('fb_ad_name')
            if data.get('fb_placement') and not visitor_session.fb_placement:
                visitor_session.fb_placement = data.get('fb_placement')
            if data.get('fb_platform') and not visitor_session.fb_platform:
                visitor_session.fb_platform = data.get('fb_platform')
                
            # Google params - update if provided and empty
            if data.get('gclid') and not visitor_session.gclid:
                visitor_session.gclid = data.get('gclid')
            if data.get('google_keyword') and not visitor_session.google_keyword:
                visitor_session.google_keyword = data.get('google_keyword')
            
            # Update device info in case it changed
            visitor_session.device_type = device_type
            visitor_session.browser = browser
            visitor_session.ip_address = ip_address
            
            logger.info(f"Updated existing visitor session: {session_id}")
            
        else:
            # CREATE new session only if it doesn't exist
            visitor_session = VisitorSession(
                session_id=session_id,
                visitor_id=visitor_id,
                first_visit=datetime.utcnow(),
                last_activity=datetime.utcnow(),
                uk_hour=uk_time.hour,
                uk_day_of_week=uk_time.weekday(),
                uk_date=uk_time.date(),
                
                # Attribution
                source=data.get('source', 'direct'),
                medium=data.get('medium', ''),
                campaign=data.get('campaign', ''),
                term=data.get('term', ''),
                content=data.get('content', ''),
                
                # Facebook
                fb_campaign_id=data.get('fb_campaign_id', ''),
                fb_campaign_name=data.get('fb_campaign_name', ''),
                fb_adset_id=data.get('fb_adset_id', ''),
                fb_adset_name=data.get('fb_adset_name', ''),
                fb_ad_id=data.get('fb_ad_id', ''),
                fb_ad_name=data.get('fb_ad_name', ''),
                fb_placement=data.get('fb_placement', ''),
                fb_platform=data.get('fb_platform', ''),
                
                # Google
                gclid=data.get('gclid', ''),
                google_keyword=data.get('google_keyword', ''),
                
                # User journey
                landing_page=data.get('landing_page', ''),
                referrer=data.get('referrer', ''),
                device_type=device_type,
                browser=browser,
                ip_address=ip_address
            )
            session.add(visitor_session)
            logger.info(f"Created new visitor session: {session_id}")
        
        session.commit()
        
        return jsonify({
            "tracked": True,
            "session_id": visitor_session.session_id,
            "visitor_id": visitor_session.visitor_id
        }), 200
        
    except SQLAlchemyError as e:
        logger.error(f"Database error tracking visitor: {e}")
        if session:
            session.rollback()
        return jsonify({"error": "Database error"}), 500
    except Exception as e:
        logger.error(f"Error tracking visitor: {e}")
        return jsonify({"error": str(e)}), 500
    finally:
        if session:
            session.close()
        from app import db_session
        db_session.remove()

        

@tracking_bp.route("/track-form-event", methods=["POST"])
def track_form_event():
    """Track form interaction events"""
    # First check: validate request origin/size
    if not validate_tracking_request(request):
        return jsonify({"error": "Invalid request"}), 403
    
    data = request.json or {}
    
    # Second check: validate JSON payload structure
    is_valid, message = validate_tracking_payload(data, 'form_event')
    if not is_valid:
        return jsonify({"error": message}), 400
    
    session = None  # ADDED
    try:
        from app import db_session
        session = db_session()
        
        # Find the visitor session
        visitor_session = session.query(VisitorSession).filter_by(
            session_id=data.get('session_id')
        ).first()
        
        if visitor_session:
            event_type = data.get('event_type')
            form_stage = data.get('form_stage', '')
            
            if event_type == 'start':
                visitor_session.form_started = True
            elif event_type == 'complete':
                visitor_session.form_completed = True
                visitor_session.conversion_timestamp = datetime.utcnow()
                visitor_session.lead_ids = data.get('lead_ids', [])
            elif event_type == 'abandon':
                visitor_session.form_abandonment_stage = form_stage
            
            # Update time on site
            if visitor_session.first_visit:
                time_diff = datetime.utcnow() - visitor_session.first_visit
                visitor_session.time_on_site = int(time_diff.total_seconds())
            
            visitor_session.last_activity = datetime.utcnow()
            session.commit()  # REMOVED session.close()
            
            logger.info(f"Tracked form event: {event_type} at {form_stage}")
        
        return jsonify({"tracked": True}), 200
        
    except Exception as e:
        logger.error(f"Error tracking form event: {e}")
        if session:  # CHANGED
            session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:  # ADDED
        if session:
            session.close()
        from app import db_session
        db_session.remove()

@tracking_bp.route("/track-conversion", methods=["POST"])
def track_conversion():
    """Update session when conversion happens"""
    # First check: validate request origin/size
    if not validate_tracking_request(request):
        return jsonify({"error": "Invalid request"}), 403
    
    data = request.json or {}
    
    # Second check: validate JSON payload structure
    is_valid, message = validate_tracking_payload(data, 'conversion')
    if not is_valid:
        return jsonify({"error": message}), 400
    
    session = None  # ADDED
    try:
        from app import db_session
        session = db_session()
        
        visitor_session = session.query(VisitorSession).filter_by(
            session_id=data.get('session_id')
        ).first()
        
        if visitor_session:
            visitor_session.form_completed = True
            visitor_session.conversion_timestamp = datetime.utcnow()
            visitor_session.lead_ids = data.get('lead_ids', [])
            
            # Calculate time to convert
            if visitor_session.first_visit:
                time_diff = datetime.utcnow() - visitor_session.first_visit
                visitor_session.time_on_site = int(time_diff.total_seconds())
            
            session.commit()  # REMOVED session.close()
            logger.info(f"Tracked conversion for session: {visitor_session.session_id}")
        
        return jsonify({"tracked": True}), 200
        
    except Exception as e:
        logger.error(f"Error tracking conversion: {e}")
        if session:  # CHANGED
            session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:  # ADDED
        if session:
            session.close()
        from app import db_session
        db_session.remove()

@tracking_bp.route("/update-visitor-data", methods=["POST"])
def update_visitor_data():
    """Progressively update visitor session with form data"""
    if not validate_tracking_request(request):
        return jsonify({"error": "Invalid request"}), 403

    data = request.json or {}
    session_id = data.get("session_id")
    if not session_id:
        return jsonify({"error": "Missing session_id"}), 400

    from app import db_session
    session = db_session()

    try:
        # Fetch existing session
        visitor_session = session.query(VisitorSession).filter_by(
            session_id=session_id
        ).first()

        if not visitor_session:
            # Create new session if not found (defensive programming)
            visitor_session = VisitorSession(
                session_id=session_id,
                visitor_id=data.get("visitor_id", "unknown"),
                first_visit=datetime.utcnow(),
                last_activity=datetime.utcnow()
            )
            session.add(visitor_session)
            logger.info(f"Created new session in update-visitor-data: {session_id}")
        else:
            # Update last activity for existing session
            visitor_session.last_activity = datetime.utcnow()

        # --- PERSONAL FIELDS ---
        if "first_name" in data:
            visitor_session.first_name = data["first_name"]

        if "last_name" in data:
            visitor_session.last_name = data["last_name"]

        if "email" in data:
            visitor_session.email = data["email"]

        if "mobile" in data:
            visitor_session.mobile = data["mobile"]

        if "title" in data:
            visitor_session.title = data["title"]

        if "date_of_birth" in data:
            try:
                visitor_session.date_of_birth = datetime.strptime(
                    data["date_of_birth"], "%Y-%m-%d"
                ).date()
            except:
                pass  # ignore invalid date formats

        # --- ADDRESS FIELDS ---
        address_fields = [
            "building_number", "building_name", "flat", "street",
            "district", "post_town", "county", "post_code"
        ]
        for f in address_fields:
            if f in data:
                setattr(visitor_session, f, data[f])

        # --- PREVIOUS ADDRESSES ---
        if "previous_addresses" in data:
            visitor_session.previous_addresses = json.dumps(
                data["previous_addresses"]
            )

        # --- FORM PROGRESSION ---
        if "form_progress_percent" in data:
            visitor_session.form_progress_percent = data["form_progress_percent"]

        if "last_saved_step" in data:
            visitor_session.last_saved_step = data["last_saved_step"]

        # --- RESUME TOKEN FIELDS ---
        if "resume_token" in data:
            visitor_session.resume_token = data["resume_token"]
            visitor_session.resume_token_created = datetime.utcnow()

        if "resume_link_sent" in data:
            visitor_session.resume_link_sent = data["resume_link_sent"]
            if data["resume_link_sent"]:
                visitor_session.resume_link_sent_at = datetime.utcnow()

        # --- RAW SNAPSHOT ---
        if "form_data_snapshot" in data:
            # Handle both dict and string formats
            if isinstance(data["form_data_snapshot"], dict):
                visitor_session.form_data_snapshot = json.dumps(data["form_data_snapshot"])
            else:
                visitor_session.form_data_snapshot = data["form_data_snapshot"]

        # Always update last_activity
        visitor_session.last_activity = datetime.utcnow()

        session.commit()
        return jsonify({"updated": True}), 200

    except Exception as e:
        session.rollback()
        logger.error(f"Error updating visitor data: {e}")
        return jsonify({"error": str(e)}), 500

    finally:
        session.close()
        from app import db_session
        db_session.remove()


@tracking_bp.route("/send-resume-link", methods=["POST"])
def send_resume_link():
    """Mark that resume link has been sent via SMS"""
    if not validate_tracking_request(request):
        return jsonify({"error": "Invalid request"}), 403
    
    data = request.json or {}
    session_id = data.get("session_id")
    
    if not session_id:
        return jsonify({"error": "Missing session_id"}), 400
    
    from app import db_session
    session = db_session()
    
    try:
        visitor_session = session.query(VisitorSession).filter_by(
            session_id=session_id
        ).first()
        
        if visitor_session:
            visitor_session.resume_link_sent = True
            visitor_session.resume_link_sent_at = datetime.utcnow()
            session.commit()
            
            return jsonify({
                "success": True,
                "resume_token": visitor_session.resume_token,
                "mobile": visitor_session.mobile
            }), 200
        
        return jsonify({"error": "Session not found"}), 404
        
    except Exception as e:
        session.rollback()
        return jsonify({"error": str(e)}), 500
    finally:
        session.close()
        db_session.remove()