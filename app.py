import os
import logging
import uuid
import base64
import json
from datetime import datetime, timedelta
from functools import wraps
import xml.etree.ElementTree as ET
import csv

from flask import Flask, render_template, request, jsonify, send_file, Response, send_from_directory
import requests
import boto3
import botocore

# ─── Configuration ─────────────────────────────────────────────────────────────
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
    
    # FLG API
    FLG_API_URL = os.getenv("FLG_API_URL", "https://cars.flg360.co.uk/api/APILeadCreateUpdate.php")
    FLG_API_KEY = os.getenv("FLG_API_KEY", "")
    FLG_LEADGROUP_ID = os.getenv("FLG_LEADGROUP_ID", "57862")
    FLG_UPDATE_URL = os.getenv("FLG_UPDATE_URL")
    
    # App settings
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    DEBUG = os.getenv("FLASK_DEBUG", "False").lower() == "true"

# ─── App Initialization ────────────────────────────────────────────────────────
app = Flask(__name__, 
            static_folder='static',
            static_url_path='/static')
app.config.from_object(Config)

# Enable debug mode for static files in development
if Config.DEBUG:
    app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

# ─── Logging Setup ─────────────────────────────────────────────────────────────
logging.basicConfig(
    level=getattr(logging, Config.LOG_LEVEL),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# ─── AWS S3 Client ─────────────────────────────────────────────────────────────
try:
    s3_client = boto3.client(
        "s3",
        aws_access_key_id=Config.AWS_ACCESS_KEY_ID,
        aws_secret_access_key=Config.AWS_SECRET_ACCESS_KEY,
        region_name=Config.AWS_REGION,
    )
    logger.info("S3 client initialized successfully")
except Exception as e:
    logger.error(f"Failed to initialize S3 client: {e}")
    s3_client = None

# ─── Error Handling Decorator ─────────────────────────────────────────────────
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

# ─── Valifi API Client ────────────────────────────────────────────────────────
class ValifiClient:
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
    
    def get_credit_report(self, payload):
        """Get TransUnion credit report"""
        resp = requests.post(
            f"{self.base_url}/bureau/v1/tu/report",
            json=payload,
            headers=self._get_headers(),
            timeout=60
        )
        resp.raise_for_status()
        return resp.json()

# ─── FLG API Client ───────────────────────────────────────────────────────────
class FLGClient:
    """Encapsulates FLG API interactions"""
    
    @staticmethod
    def build_lead_xml(lead):
        """Build XML payload for FLG API"""
        root = ET.Element("data")
        lead_el = ET.SubElement(root, "lead")
        
        # Required fields
        ET.SubElement(lead_el, "key").text = Config.FLG_API_KEY
        ET.SubElement(lead_el, "leadgroup").text = str(Config.FLG_LEADGROUP_ID)
        ET.SubElement(lead_el, "site").text = lead.get("site", "0")
        
        # Standard fields
        standard_fields = [
            "source", "medium", "term", "title", "firstname", "lastname",
            "phone1", "phone2", "email", "address", "address2", "address3",
            "towncity", "postcode"
        ]
        
        for field in standard_fields:
            if lead.get(field):
                ET.SubElement(lead_el, field).text = str(lead[field])
        
        # Date of birth parsing - FIXED TO HANDLE YYYY-MM-DD FORMAT
        dob = lead.get("dateOfBirth", "")
        if dob and "-" in dob:
            year, mon, day = dob.split("-")  # Changed order to handle YYYY-MM-DD
            ET.SubElement(lead_el, "dobday").text = day
            ET.SubElement(lead_el, "dobmonth").text = mon
            ET.SubElement(lead_el, "dobyear").text = year
        
        # Contact preferences
        contact_prefs = ["contactphone", "contactsms", "contactemail", "contactmail", "contactfax"]
        for pref in contact_prefs:
            ET.SubElement(lead_el, pref).text = lead.get(pref, "Unknown")
        
        # Extra data fields
        extra_fields = ["data1", "data5", "data7", "data25", "data29", "data31", "data32", "data33", "data37"]
        for field in extra_fields:
            if lead.get(field):
                ET.SubElement(lead_el, field).text = str(lead[field])
        
        xml_body = ET.tostring(root, encoding="utf-8", method="xml")
        return b'<?xml version="1.0" encoding="UTF-8"?>' + xml_body
    
    @staticmethod
    def send_lead(xml_payload):
        """Send lead data to FLG"""
        return requests.post(
            Config.FLG_API_URL,
            data=xml_payload,
            headers={"Content-Type": "application/xml"},
            timeout=30
        )

# ─── Lenders Service ──────────────────────────────────────────────────────────
class LendersService:
    """Manages lender data and matching"""
    
    def __init__(self):
        self.lenders = self._load_lenders()
    
    def _load_lenders(self):
        """Load lenders from CSV file"""
        lenders = []
        try:
            with open("lenders.csv", newline="", encoding="utf-8") as f:
                reader = csv.reader(f)
                for row in reader:
                    if len(row) >= 2:
                        lenders.append({"name": row[0], "filename": row[1]})
            logger.info(f"Loaded {len(lenders)} lenders from CSV")
        except Exception as e:
            logger.error(f"Failed to load lenders.csv: {e}")
        return lenders
    
    def get_all(self):
        """Get all lenders"""
        return self.lenders

# ─── Initialize Services ──────────────────────────────────────────────────────
valifi_client = ValifiClient()
flg_client = FLGClient()
lenders_service = LendersService()

# ─── Routes ───────────────────────────────────────────────────────────────────
@app.route("/")
def index():
    """Render the main form"""
    return render_template("index.html")

@app.route('/js/<path:filename>')
def serve_js(filename):
    """Serve JavaScript files from js directory"""
    import os
    js_dir = os.path.join(app.root_path, 'js')
    return send_from_directory(js_dir, filename)

@app.route("/test")
def test():
    """Test page for debugging static files"""
    return render_template("test.html")

@app.route("/debug/static")
def debug_static():
    """Debug endpoint to check static files"""
    import os
    static_dir = os.path.join(app.root_path, 'static')
    js_dir = os.path.join(app.root_path, 'js')
    files = {}
    
    # Check static directory
    if os.path.exists(static_dir):
        for root, dirs, filenames in os.walk(static_dir):
            rel_root = os.path.relpath(root, static_dir)
            files[f'static/{rel_root}'] = {
                'dirs': dirs,
                'files': filenames
            }
    else:
        files['static'] = 'Directory not found'
    
    # Check js directory
    if os.path.exists(js_dir):
        for root, dirs, filenames in os.walk(js_dir):
            rel_root = os.path.relpath(root, js_dir)
            files[f'js/{rel_root}'] = {
                'dirs': dirs,
                'files': filenames
            }
    else:
        files['js'] = 'Directory not found'
    
    return jsonify({
        'static_folder': app.static_folder,
        'static_url_path': app.static_url_path,
        'root_path': app.root_path,
        'files': files
    })

@app.route("/lenders", methods=["GET"])
@handle_errors
def get_lenders():
    """Get all lenders from CSV"""
    return jsonify(lenders_service.get_all()), 200

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
    
    # Build client reference from name
    first_name = data.get("firstName", "")
    last_name = data.get("lastName", "")
    client_ref = f"{first_name}_{last_name}" if first_name and last_name else "identityCheck"
    
    # Build payload matching the exact format from documentation
    payload = {
        "includeJsonReport": True,
        "includePdfReport": False,
        "includeMobileId": True,
        "includeEmailId": True,
        "clientReference": client_ref,
        "title": data.get("title", ""),
        "forename": data.get("firstName", ""),
        "middleName": data.get("middleName", ""),
        "surname": data.get("lastName", ""),
        "emailAddress": data.get("email", ""),
        "mobileNumber": data.get("mobile", ""),
        "dateOfBirth": data.get("dateOfBirth"),
        "currentAddress": {
            "flat": data.get("flat", "") or "",
            "houseName": data.get("building_name", "") or "",
            "houseNumber": data.get("building_number", "") or "",
            "street": data.get("street", "") or "",
            "street2": None,
            "district": None,
            "postTown": data.get("post_town", "") or "",
            "county": None,
            "postCode": data.get("post_code", "") or "",
            "addressID": None
        },
        "previousAddress": None,
        "previousPreviousAddress": None
    }
    
    logger.info(f"Identity validation for: {payload['forename']} {payload['surname']}")
    
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
        
        # Don't send the actual score to frontend
        response = {
            "success": True,
            "passed": passed,
            "minimumScore": Config.VALIFI_MIN_ID_SCORE
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
    """Get credit report and upload to S3"""
    data = request.json or {}
    
    # Validate required fields
    required_fields = ["firstName", "lastName", "dateOfBirth", "street", "post_town", "post_code"]
    for field in required_fields:
        if not data.get(field):
            return jsonify({"error": f"{field} is required"}), 400
    
    # Build payload
    payload = {
        "includeJsonReport": True,
        "includePdfReport": True,
        "includeSummaryReport": True,
        "clientReference": "test",
        "title": data.get("title", ""),
        "forename": data.get("firstName", ""),
        "middleName": data.get("middleName", ""),
        "surname": data.get("lastName", ""),
        "dateOfBirth": data.get("dateOfBirth"),
        "currentAddress": {
            "flat": data.get("flat", ""),
            "houseName": data.get("building_name", ""),
            "houseNumber": data.get("building_number", ""),
            "street": data.get("street", ""),
            "street2": None,
            "district": None,
            "postTown": data.get("post_town", ""),
            "county": None,
            "postCode": data.get("post_code", ""),
            "addressID": None
        },
        "previousAddress": None,
        "previousPreviousAddress": None
    }
    
    logger.info(f"Requesting credit report for: {payload['forename']} {payload['surname']}")
    logger.info(f"Report request payload: {json.dumps(payload, indent=2)}")
    
    # Get the report
    result = valifi_client.get_credit_report(payload)
    logger.info("Credit report retrieved successfully")
    
    # Check if we have a PDF to upload
    report_data = result.get("data", {})
    pdf_base64 = report_data.get("pdfReport")
    
    if pdf_base64:
        logger.info("PDF found in response, attempting S3 upload")
        if s3_client:
            try:
                pdf_bytes = base64.b64decode(pdf_base64)
                filename = f"{uuid.uuid4().hex}.pdf"
                key = f"reports/{filename}"
                
                s3_client.put_object(
                    Bucket=Config.AWS_S3_BUCKET,
                    Key=key,
                    Body=pdf_bytes,
                    ContentType="application/pdf"
                )
                
                report_data["pdfUrl"] = f"https://{Config.AWS_S3_BUCKET}.s3.{Config.AWS_REGION}.amazonaws.com/{key}"
                logger.info("PDF uploaded successfully to S3")
                
            except Exception as e:
                logger.error(f"S3 upload failed: {e}")
                report_data["s3_error"] = str(e)
        else:
            logger.warning("S3 client not configured")
    else:
        logger.info("No pdfReport field in response - may need to fetch separately")
        # According to the TransUnion docs, you might need to fetch the PDF separately
        # using the report ID
        if report_data.get("id"):
            logger.info(f"Report ID: {report_data['id']} - PDF may be available via separate endpoint")
    
    # ALWAYS return the result, regardless of PDF status
    return jsonify(result), 200

@app.route("/upload_summary", methods=["POST"])
@handle_errors
def upload_summary():
    """Upload summary data to FLG"""
    summary = request.json or {}
    
    # Extract PDF URL
    pdf_url = summary.get("pdfUrl") or summary.get("data", {}).get("pdfUrl", "")
    if not pdf_url:
        logger.warning("No pdfUrl provided in upload_summary request")
    
    # Parse name
    full_name = (summary.get("name") or "").strip()
    parts = full_name.split(" ", 1)
    title = parts[0] if len(parts) > 1 else ""
    if title.lower() == "other":
        title = ""
    rest = parts[1] if len(parts) > 1 else parts[0]
    first, last = (rest.split(" ", 1) + [""])[:2]
    
    # Parse date - handle ISO format from credit report
    dob_raw = summary.get("dateOfBirth", "")
    dob_formatted = ""
    
    if dob_raw:
        if "T" in dob_raw:  # ISO format like "1975-08-01T00:00:00"
            dob_formatted = dob_raw.split("T")[0]  # Get "1975-08-01"
        elif "/" in dob_raw:  # DD/MM/YYYY format
            try:
                d, m, y = dob_raw.split("/")
                dob_formatted = f"{y}-{m.zfill(2)}-{d.zfill(2)}"
            except ValueError:
                logger.error(f"Invalid date format: {dob_raw}")
        else:
            dob_formatted = dob_raw  # Assume already in correct format
    
    # Build data32 (account information)
    accounts = summary.get("accounts", [])
    data32_elements = []
    
    for acc in accounts:
        elements = [
            acc.get("accountNumber", ""),
            acc.get("accountType", ""),
            acc.get("accountTypeName", ""),
            acc.get("address", ""),
            acc.get("currentBalance", ""),
            acc.get("currentStatus", ""),
            acc.get("defaultBalance", ""),
            (acc.get("dob", "") or "").split("T")[0],
            (acc.get("startDate", "") or "").split("T")[0],
            (acc.get("endDate", "") or "").split("T")[0],
            acc.get("lenderName", ""),
            acc.get("monthlyPayment", "")
        ]
        data32_elements.extend(elements)
    
    data32_str = ",".join(str(elem) if elem is not None else "" for elem in data32_elements)
    
    # Build FLG lead data
    lead_data = {
        "leadgroup": Config.FLG_LEADGROUP_ID,
        "title": title,
        "firstname": first,
        "lastname": last,
        "dateOfBirth": dob_formatted,  # Now in YYYY-MM-DD format
        "phone1": summary.get("phone1", ""),
        "email": summary.get("email", ""),
        "address": summary.get("address", ""),
        "towncity": summary.get("towncity", ""),
        "postcode": summary.get("postcode", ""),
        "data31": pdf_url,
        "data32": data32_str
    }
    
    # Send to FLG
    xml_payload = flg_client.build_lead_xml(lead_data)
    logger.debug(f"FLG XML payload:\n{xml_payload.decode('utf-8')}")
    
    response = flg_client.send_lead(xml_payload)
    logger.info(f"FLG response (status {response.status_code}): {response.text}")
    
    # Parse response
    try:
        root = ET.fromstring(response.text)
        status = root.findtext("status")
        record_id = root.findtext("item/id")
    except Exception as e:
        logger.error(f"Failed parsing FLG XML: {e}")
        return jsonify({"error": "Failed to parse FLG response"}), 500
    
    if response.status_code != 200 or status != "0":
        logger.error(f"FLG upload failed: {response.text}")
        return jsonify({"error": "FLG upload failed"}), response.status_code or 500
    
    # Success - but don't return debug info to frontend
    return jsonify({"success": True}), 200

@app.route("/flg/lead", methods=["POST"])
@handle_errors
def create_flg_lead():
    """Create or update a lead in FLG"""
    lead = request.json or {}
    xml = flg_client.build_lead_xml(lead)
    resp = flg_client.send_lead(xml)
    return jsonify({"response": resp.text}), resp.status_code

@app.route("/flg/lead/<lead_id>", methods=["PUT"])
@handle_errors
def update_flg_lead(lead_id):
    """Update an existing FLG lead by ID"""
    lead = request.json or {}
    lead["leadid"] = lead_id
    xml = flg_client.build_lead_xml(lead)
    resp = flg_client.send_lead(xml)
    
    if resp.status_code != 200:
        return jsonify({"error": "FLG update failed", "details": resp.text}), resp.status_code
    
    return jsonify({"success": True}), 200

@app.route("/flg/lead/<lead_id>", methods=["DELETE"])
@handle_errors
def delete_flg_lead(lead_id):
    """Delete a lead in FLG by ID"""
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <data>
        <lead>
            <key>{Config.FLG_API_KEY}</key>
            <leadgroup>{Config.FLG_LEADGROUP_ID}</leadgroup>
            <leadid>{lead_id}</leadid>
            <action>delete</action>
        </lead>
    </data>
    """
    
    resp = requests.post(
        Config.FLG_API_URL,
        data=xml,
        headers={"Content-Type": "application/xml"},
        timeout=30
    )
    
    if resp.status_code != 200:
        return jsonify({"error": "Delete failed", "details": resp.text}), resp.status_code
    
    return jsonify({"success": True}), 200

# ─── Health Check ─────────────────────────────────────────────────────────────
@app.route("/health")
def health_check():
    """Health check endpoint"""
    health_status = {
        "status": "healthy",
        "timestamp": datetime.utcnow().isoformat(),
        "services": {
            "valifi": "unknown",
            "s3": "healthy" if s3_client else "unavailable",
            "flg": "unknown"
        },
        "config": {
            "min_identity_score": Config.VALIFI_MIN_ID_SCORE
        }
    }
    
    # Test Valifi connection
    try:
        valifi_client.get_token()
        health_status["services"]["valifi"] = "healthy"
    except Exception as e:
        health_status["services"]["valifi"] = f"unhealthy: {str(e)}"
        health_status["status"] = "degraded"
    
    return jsonify(health_status), 200 if health_status["status"] == "healthy" else 503

# ─── Error Handlers ───────────────────────────────────────────────────────────
@app.errorhandler(404)
def not_found(error):
    return jsonify({"error": "Not found"}), 404

@app.errorhandler(500)
def internal_error(error):
    logger.error(f"Internal error: {error}")
    return jsonify({"error": "Internal server error"}), 500

# ─── Main ─────────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    logger.info(f"Starting Flask app on port {port}")
    app.run(host="0.0.0.0", port=port, debug=Config.DEBUG)