import os
import logging
import uuid
import base64
from datetime import datetime, timedelta
from functools import wraps
import xml.etree.ElementTree as ET
import csv

from flask import Flask, render_template, request, jsonify, send_file, Response
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
    
    # AWS
    AWS_ACCESS_KEY_ID = os.getenv("AWS_ACCESS_KEY_ID")
    AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
    AWS_REGION = os.getenv("AWS_REGION", "eu-west-2")
    AWS_S3_BUCKET = os.getenv("AWS_S3_BUCKET")
    
    # FLG API
    FLG_API_URL = os.getenv("FLG_API_URL", "https://cars.flg360.co.uk/api/APILeadCreateUpdate.php")
    FLG_API_KEY = os.getenv("FLG_API_KEY", "T9jrI9IdgOlnODCEuziNDcn5Vt7m4sgA")
    FLG_LEADGROUP_ID = os.getenv("FLG_LEADGROUP_ID", "57862")
    FLG_UPDATE_URL = os.getenv("FLG_UPDATE_URL")
    
    # App settings
    LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
    DEBUG = os.getenv("FLASK_DEBUG", "False").lower() == "true"

# ─── App Initialization ────────────────────────────────────────────────────────
app = Flask(__name__)
app.config.from_object(Config)

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

# ─── Trust Analysis Functions ─────────────────────────────────────────────────
def analyze_mobile_trust(mobile_id_data):
    """
    Analyze MobileID data to determine trust level
    Returns a trust assessment with score and recommendation
    """
    trust_score = 0
    flags = []
    recommendation = "NEUTRAL"
    
    # Check for positive matches
    identity_matches = mobile_id_data.get("identityMatch", {})
    linked_matches = mobile_id_data.get("linkedIdentityMatch", {})
    address_matches = mobile_id_data.get("addressMatch", {})
    unknown_matches = mobile_id_data.get("unknownMatches", {})
    
    # Calculate positive indicators
    if identity_matches.get("numberOfMatches", 0) > 0:
        trust_score += 50
        flags.append("DIRECT_IDENTITY_MATCH")
    
    if linked_matches.get("numberOfMatches", 0) > 0:
        trust_score += 30
        flags.append("LINKED_IDENTITY_MATCH")
    
    if address_matches.get("numberOfMatches", 0) > 0:
        trust_score += 20
        flags.append("ADDRESS_MATCH")
    
    # Check negative indicators
    unknown_identities = unknown_matches.get("uniqueUnknownIdentities", 0)
    unknown_addresses = unknown_matches.get("uniqueUnknownAddresses", 0)
    
    if unknown_identities > 0:
        trust_score -= (unknown_identities * 15)
        flags.append(f"UNKNOWN_IDENTITIES_{unknown_identities}")
    
    if unknown_addresses > 0:
        trust_score -= (unknown_addresses * 10)
        flags.append(f"UNKNOWN_ADDRESSES_{unknown_addresses}")
    
    # Determine recommendation
    if trust_score >= 50:
        recommendation = "POSITIVE"
        description = "Mobile number strongly associated with provided identity"
    elif trust_score >= 20:
        recommendation = "NEUTRAL"
        description = "Mobile number has some association with provided identity"
    else:
        recommendation = "NEGATIVE"
        description = "Mobile number associated with different identities - potential fraud risk"
    
    return {
        "trustScore": trust_score,
        "recommendation": recommendation,
        "description": description,
        "flags": flags,
        "details": {
            "identityMatches": identity_matches.get("numberOfMatches", 0),
            "linkedMatches": linked_matches.get("numberOfMatches", 0),
            "addressMatches": address_matches.get("numberOfMatches", 0),
            "unknownIdentities": unknown_identities,
            "unknownAddresses": unknown_addresses,
            "totalPositiveMatches": mobile_id_data.get("totalPositiveMatches", 0)
        }
    }

def analyze_email_trust(email_id_data):
    """Analyze EmailID data similarly to MobileID"""
    # Similar logic to mobile trust
    trust_score = 0
    flags = []
    
    identity_matches = email_id_data.get("identityMatch", {})
    if identity_matches.get("numberOfMatches", 0) > 0:
        trust_score += 40
        flags.append("EMAIL_IDENTITY_MATCH")
    
    return {
        "trustScore": trust_score,
        "flags": flags
    }

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
    
    def check_mobile_id(self, payload):
        """
        Check MobileID trust assessment
        Returns detailed trust information about mobile number associations
        """
        resp = requests.post(
            f"{self.base_url}/bureau/v1/tu/mobile-id",
            json=payload,
            headers=self._get_headers(),
            timeout=30
        )
        return resp.json(), resp.status_code
    
    def check_email_id(self, payload):
        """Check EmailID trust assessment"""
        resp = requests.post(
            f"{self.base_url}/bureau/v1/tu/email-id",
            json=payload,
            headers=self._get_headers(),
            timeout=30
        )
        return resp.json(), resp.status_code
    
    def validate_identity(self, payload):
        """Validate identity via Mobile ID"""
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
        
        # Date of birth parsing
        dob = lead.get("dateOfBirth", "")
        if dob and "-" in dob:
            day, mon, year = dob.split("-")
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
    return jsonify({"addresses": addresses}), 200

@app.route("/otp/request", methods=["POST"])
@handle_errors
def otp_request():
    """Request OTP for mobile verification"""
    mobile = request.json.get("mobile", "").strip()
    if not mobile:
        return jsonify({"error": "mobile is required"}), 400
    
    logger.info(f"OTP request for mobile: {mobile}")
    result, status = valifi_client.request_otp(mobile)
    return jsonify(result), status

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

@app.route("/mobile-id/check", methods=["POST"])
@handle_errors
def check_mobile_id():
    """
    Perform MobileID trust assessment after OTP verification
    This checks if the mobile number is genuinely associated with the person
    """
    data = request.json or {}
    
    # Build payload for MobileID check
    payload = {
        "includeJsonReport": True,
        "clientReference": data.get("clientReference", "mobileIdCheck"),
        "title": data.get("title", ""),
        "forename": data.get("firstName", ""),
        "middleName": data.get("middleName", ""),
        "surname": data.get("lastName", ""),
        "dateOfBirth": data.get("dateOfBirth"),  # Format: YYYY-MM-DD
        "mobileNumber": data.get("mobile"),
        "emailAddress": data.get("email"),  # Include for EmailID check if available
        "currentAddress": {
            "flat": data.get("flat", ""),
            "street": data.get("street", ""),
            "postTown": data.get("postTown", ""),
            "postCode": data.get("postCode", "")
        }
    }
    
    logger.info(f"MobileID check for: {payload['forename']} {payload['surname']} - Mobile: {payload['mobileNumber']}")
    
    result, status = valifi_client.check_mobile_id(payload)
    
    if status != 200:
        logger.error(f"MobileID check failed with status {status}: {result}")
        return jsonify(result), status
    
    # Parse the MobileID results
    mobile_id_data = result.get("data", {}).get("mobileId", {})
    email_id_data = result.get("data", {}).get("emailId", {})
    
    # Analyze trust level based on matches
    trust_analysis = analyze_mobile_trust(mobile_id_data)
    
    # Add email trust if available
    if email_id_data:
        email_trust = analyze_email_trust(email_id_data)
        trust_analysis["emailTrust"] = email_trust
    
    # Return comprehensive trust assessment
    response = {
        "success": True,
        "trustAssessment": trust_analysis,
        "rawData": {
            "mobileId": mobile_id_data,
            "emailId": email_id_data
        }
    }
    
    logger.info(f"MobileID trust assessment: {trust_analysis['recommendation']} (score: {trust_analysis['trustScore']})")
    
    return jsonify(response), 200

@app.route("/validate-identity", methods=["POST"])
@handle_errors
def validate_identity():
    """Validate user identity"""
    data = request.json or {}
    
    # Build payload for Mobile ID
    payload = {
        "includeJsonReport": True,
        "includeMobileKYC": True,
        "clientReference": data.get("clientReference", "identityCheck"),
        "title": data.get("title", ""),
        "forename": data.get("firstName", ""),
        "middleName": data.get("middleName", ""),
        "surname": data.get("lastName", ""),
        "dateOfBirth": data.get("dateOfBirth"),
        "mobileNumber": data.get("mobile"),
        "emailAddress": data.get("email"),
        "currentAddress": {
            "flat": data.get("flat", ""),
            "street": data.get("street", ""),
            "postTown": data.get("postTown", ""),
            "postCode": data.get("postCode", "")
        }
    }
    
    logger.info(f"Identity validation for: {payload['forename']} {payload['surname']}")
    result, status = valifi_client.validate_identity(payload)
    return jsonify(result), status

@app.route("/query", methods=["POST"])
@handle_errors
def query_valifi():
    """Get credit report and upload to S3"""
    data = request.json or {}
    
    # Validate required fields
    required_fields = ["firstName", "lastName", "dateOfBirth", "flat", "street", "postTown", "postCode"]
    for field in required_fields:
        if not data.get(field):
            return jsonify({"error": f"{field} is required"}), 400
    
    # Build payload
    payload = {
        "includeJsonReport": True,
        "includePdfReport": True,
        "includeSummaryReport": True,
        "title": data.get("title", "") or "",
        "clientReference": data.get("clientReference", "report"),
        "forename": data["firstName"],
        "middleName": data.get("middleName", ""),
        "surname": data["lastName"],
        "dateOfBirth": data["dateOfBirth"],
        "currentAddress": {
            "flat": data["flat"],
            "street": data["street"],
            "postTown": data["postTown"],
            "postCode": data["postCode"]
        },
        "previousAddress": None,
        "previousPreviousAddress": None
    }
    
    if payload["title"].lower() == "other":
        payload["title"] = ""
    
    # Get credit report
    logger.info(f"Requesting credit report for: {payload['forename']} {payload['surname']}")
    result = valifi_client.get_credit_report(payload)
    
    # Upload PDF to S3 if present
    report_data = result.get("data", {})
    pdf_base64 = report_data.get("pdfReport")
    
    if pdf_base64 and s3_client:
        try:
            pdf_bytes = base64.b64decode(pdf_base64)
            filename = f"{uuid.uuid4().hex}.pdf"
            key = f"reports/{filename}"
            
            logger.info(f"Uploading PDF to S3: bucket={Config.AWS_S3_BUCKET}, key={key}")
            s3_client.put_object(
                Bucket=Config.AWS_S3_BUCKET,
                Key=key,
                Body=pdf_bytes,
                ContentType="application/pdf"
            )
            
            # Add S3 URL to response
            report_data["pdfUrl"] = f"https://{Config.AWS_S3_BUCKET}.s3.{Config.AWS_REGION}.amazonaws.com/{key}"
            logger.info("PDF uploaded successfully")
            
        except Exception as e:
            logger.error(f"S3 upload failed: {e}")
            return jsonify({"error": "Could not upload PDF to S3", "details": str(e)}), 500
    
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
    
    # Parse date
    dob_raw = summary.get("dateOfBirth", "")
    dob_iso = ""
    if dob_raw and "/" in dob_raw:
        try:
            d, m, y = dob_raw.split("/")
            dob_iso = f"{y}-{m.zfill(2)}-{d.zfill(2)}"
        except ValueError:
            logger.error(f"Invalid date format: {dob_raw}")
    
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
        "dateOfBirth": dob_iso,
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
        return jsonify({"error": "Failed to parse FLG response", "details": str(e)}), 500
    
    if response.status_code != 200 or status != "0":
        logger.error(f"FLG upload failed: {response.text}")
        return jsonify({
            "error": "FLG upload failed",
            "flg_status": status,
            "flg_body": response.text,
            "debug_data32": data32_str,
            "debug_lenders": ",".join(acc.get("lenderName", "") for acc in accounts)
        }), response.status_code or 500
    
    # Success
    return jsonify({
        "success": True,
        "flg_status": status,
        "flg_id": record_id,
        "debug_data32": data32_str,
        "debug_lenders": ",".join(acc.get("lenderName", "") for acc in accounts)
    }), 200

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