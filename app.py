import os
import logging

from flask import Flask, render_template, request, jsonify, send_file, Response
import requests
import io
import xml.etree.ElementTree as ET
import csv
import uuid

import boto3
import botocore
import base64
from datetime import datetime


# ─── App & Logging setup ───────────────────────────────────────────────────────
app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
app.logger.setLevel(logging.INFO)

# ─── New endpoint: serve lenders.csv ─────────────────────────────
@app.route("/lenders", methods=["GET"])
def get_lenders():
    lenders = []
    with open("lenders.csv", newline="", encoding="utf-8") as f:
        reader = csv.reader(f)
        for row in reader:
            if len(row) >= 2:
                lenders.append({ "name": row[0], "filename": row[1] })
    return jsonify(lenders), 200

# ─── 1) Load credentials from environment ────────────────────────────────────────
VALIFI_API_URL  = os.getenv("VALIFI_API_URL", "").rstrip("/")   # e.g. "https://staging-app.valifi.click"
VALIFI_API_USER = os.getenv("VALIFI_API_USER", "")               # e.g. "belmondclaims-api"
VALIFI_API_PASS = os.getenv("VALIFI_API_PASS", "")               # e.g. "!jdu6Rdnmh9b3"


# Still near the top of app.py, below your other os.getenv() calls:
AWS_ACCESS_KEY_ID     = os.getenv("AWS_ACCESS_KEY_ID")
AWS_SECRET_ACCESS_KEY = os.getenv("AWS_SECRET_ACCESS_KEY")
AWS_REGION            = os.getenv("AWS_REGION")
AWS_S3_BUCKET         = os.getenv("AWS_S3_BUCKET")

s3 = boto3.client(
    "s3",
    aws_access_key_id=AWS_ACCESS_KEY_ID,
    aws_secret_access_key=AWS_SECRET_ACCESS_KEY,
    region_name=AWS_REGION,
)

# ─── FLG API configuration ────────────────────────────────────────────
FLG_API_URL      = os.getenv(
    "FLG_API_URL",
    "https://cars.flg360.co.uk/api/APILeadCreateUpdate.php"
)
FLG_API_KEY      = os.getenv(
    "FLG_API_KEY",
    "T9jrI9IdgOlnODCEuziNDcn5Vt7m4sgA"   # your FLG key
)
FLG_LEADGROUP_ID = os.getenv("FLG_LEADGROUP_ID", "57862")

# ─── 2) Helper: Authenticate via Basic Auth to get a Bearer token ──────────────
def get_valifi_token():
    resp = requests.post(
        f"{VALIFI_API_URL}/basic-auth",
        auth=(VALIFI_API_USER, VALIFI_API_PASS),
        timeout=15
    )
    if resp.status_code != 200:
        raise RuntimeError(f"Auth failed: {resp.status_code} {resp.text}")
    token = resp.json().get("data", {}).get("token")
    if not token:
        raise RuntimeError("No token in auth response")
    return token

def build_flg_lead_xml(lead: dict) -> bytes:
    """
    Build the XML payload for FLG APILeadCreateUpdate.php
    """
    import xml.etree.ElementTree as ET

    root   = ET.Element("data")
    lead_el = ET.SubElement(root, "lead")
    ET.SubElement(lead_el, "key").text       = FLG_API_KEY
    ET.SubElement(lead_el, "leadgroup").text = str(FLG_LEADGROUP_ID)
    ET.SubElement(lead_el, "site").text      = lead.get("site", "0")

    # Standard fields
    for f in ("source","medium","term","title",
              "firstname","lastname",
              "phone1","phone2","email",
              "address","address2","address3",
              "towncity","postcode"):
        if lead.get(f):
            ET.SubElement(lead_el, f).text = str(lead[f])

    # Date of birth
    dob = lead.get("dateOfBirth","")
    if dob:
        day, mon, year = dob.split("-")
        ET.SubElement(lead_el, "dobday").text   = day
        ET.SubElement(lead_el, "dobmonth").text = mon
        ET.SubElement(lead_el, "dobyear").text  = year

    # Contact prefs
    for pref in ("contactphone","contactsms","contactemail",
                 "contactmail","contactfax"):
        ET.SubElement(lead_el, pref).text = lead.get(pref, "Unknown")

    # Extra data fields
    for extra in ("data1","data5","data7","data25",
                  "data29","data32","data33","data37"):
        if lead.get(extra):
            ET.SubElement(lead_el, extra).text = str(lead[extra])

    xml_body = ET.tostring(root, encoding="utf-8", method="xml")
    return b'<?xml version="1.0" encoding="UTF-8"?>' + xml_body

def flg_send_lead(xml_payload: bytes) -> requests.Response:
    """
    Post XML to the FLG endpoint and return the Response.
    """
    return requests.post(
        FLG_API_URL,
        data=xml_payload,
        headers={"Content-Type": "application/xml"},
        timeout=30
    )



# ─── 3) Postcode → address lookup ───────────────────────────────────────────────
@app.route("/lookup-address", methods=["POST"])

def lookup_address():
    postcode = request.json.get("postCode", "").strip()
    if not postcode:
        return jsonify(error="postCode is required"), 400

    token = get_valifi_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json"
    }
    resp = requests.post(
        f"{VALIFI_API_URL}/bureau/v1/equifax/postcode-lookup",
        json={"clientReference": "lookup", "postCode": postcode},
        headers=headers,
        timeout=15
    )
    # drill into the Valifi response and return just the addresses array
    addresses = (
        resp.json()
            .get("data", {})
            .get("listAddressByPostcodeResponse", {})
            .get("matchedStructuredAddress", [])
    )
    return jsonify(addresses=addresses), 200


# ─── 4) OTP request & verify ───────────────────────────────────────────────────
@app.route("/otp/request", methods=["POST"])
def otp_request():
    mobile = request.json.get("mobile", "").strip()
    if not mobile:
        return jsonify(error="mobile is required"), 400

    token = get_valifi_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    resp = requests.post(
        f"{VALIFI_API_URL}/otp/v1/request",
        json={"mobile": mobile},
        headers=headers,
        timeout=15
    )
    return jsonify(resp.json()), resp.status_code


@app.route("/otp/verify", methods=["POST"])
def otp_verify():
    mobile = request.json.get("mobile", "").strip()
    code   = request.json.get("code", "").strip()
    if not (mobile and code):
        return jsonify(error="mobile and code are required"), 400

    token = get_valifi_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json"
    }
    resp = requests.post(
        f"{VALIFI_API_URL}/otp/v1/verify",
        json={"mobile": mobile, "code": code},
        headers=headers,
        timeout=15
    )
    return jsonify(resp.json()), resp.status_code


# ─── 5) Render the HTML form ────────────────────────────────────────────────────
@app.route("/", methods=["GET"])
def index():
    return render_template("index.html")



# ─── /query endpoint ────────────────────────────────────────────────
@app.route("/query", methods=["POST"])
def query_valifi():
    data = request.json or {}

    # 1) Validate
    for k in ("firstName", "lastName", "dateOfBirth", "flat", "street", "postTown", "postCode"):
        if not data.get(k):
            return jsonify(error=f"{k} is required"), 400

    # 2) Build Valifi payload
    payload = {
        "includeJsonReport":    True,
        "includePdfReport":     True,
        "includeSummaryReport": True,
        "title":                data.get("title", "") or "",
        "clientReference":      data.get("clientReference", "report"),
        "forename":             data["firstName"],
        "middleName":           data.get("middleName", ""),
        "surname":              data["lastName"],
        "dateOfBirth":          data["dateOfBirth"],
        "currentAddress": {
            "flat":     data["flat"],
            "street":   data["street"],
            "postTown": data["postTown"],
            "postCode": data["postCode"]
        },
        "previousAddress":         None,
        "previousPreviousAddress": None
    }

    if payload["title"].lower() == "other":
        payload["title"] = ""

    # 3) Fetch Bearer token
    token = get_valifi_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json"
    }

    # 4) Request the TU report
    resp = requests.post(
        f"{VALIFI_API_URL}/bureau/v1/tu/report",
        json=payload,
        headers=headers,
        timeout=60
    )

    # 5) Propagate errors
    if resp.status_code != 200:
        return jsonify(resp.json()), resp.status_code

    # 6) Decode, upload PDF, attach S3 URL
    result = resp.json()
    rpt = result.get("data", {})
    b64  = rpt.get("pdfReport")
    if b64:
        pdf_bytes = base64.b64decode(b64)
        filename = f"{uuid.uuid4().hex}.pdf"
        key = f"reports/{filename}"

        app.logger.info("Uploading PDF to S3 → bucket=%s key=%s", AWS_S3_BUCKET, key)
        try:
            s3.put_object(
                Bucket=AWS_S3_BUCKET,
                Key=key,
                Body=pdf_bytes,
                ContentType="application/pdf"
            )
            app.logger.info("✅ S3 upload succeeded")
        except botocore.exceptions.ClientError as e:
            app.logger.error("❌ S3 upload failed: %s", e)
            return jsonify(
                error="Could not upload PDF to S3",
                details=str(e)
            ), 500

        rpt["pdfUrl"] = f"https://{AWS_S3_BUCKET}.s3.{AWS_REGION}.amazonaws.com/{key}"

    # 7) Return the full JSON + pdfS3Url
    return jsonify(result), 200

@app.route("/upload_summary", methods=["POST"])
def upload_summary():
    # 0. Parse JSON body (fallback to empty dict)
    summary = request.json or {}

    # 1. Extract the PDF URL robustly (top-level or nested under "data")
    pdf_url = (
        summary.get("pdfUrl")
        or summary.get("data", {}).get("pdfUrl", "")
    )
    if not pdf_url:
        app.logger.warning("upload_summary: no pdfUrl provided in request JSON")

    # 2. Extract & split full name
    full_name = (summary.get("name") or "").strip()
    parts     = full_name.split(" ", 1)
    title     = parts[0] if len(parts) > 1 else ""
    if title.lower() == "other":
        title = ""
    rest      = parts[1] if len(parts) > 1 else parts[0]
    first, last = (rest.split(" ", 1) + [""])[:2]

    # 3. Parse DD/MM/YYYY → ISO for FLG XML
    dob_raw = summary.get("dateOfBirth", "")
    dob_iso = ""
    if dob_raw:
        d, m, y = dob_raw.split("/")
        dob_iso = f"{y}-{m.zfill(2)}-{d.zfill(2)}"

    # 4. Build data32
    accounts     = summary.get("accounts", [])
    data32_elems = []
    for acc in accounts:
        data32_elems.extend([
            acc.get("accountNumber",""), acc.get("accountType",""),
            acc.get("accountTypeName",""), acc.get("address",""),
            acc.get("currentBalance",""), acc.get("currentStatus",""),
            acc.get("defaultBalance",""),
            (acc.get("dob","")       or "").split("T")[0],
            (acc.get("startDate","") or "").split("T")[0],
            (acc.get("endDate","")   or "").split("T")[0],
            acc.get("lenderName",""), acc.get("monthlyPayment","")
        ])
    data32_str = ",".join(elem if elem is not None else "" for elem in data32_elems)

    # 5. Build FLG XML, **using pdf_url** in <data31>

    dd, mm, yy = dob_iso.split("-")[2], dob_iso.split("-")[1], dob_iso.split("-")[0]

    flg_lead_xml = f'''<?xml version="1.0" encoding="ISO-8859-1"?>
<data>
  <lead>
    <leadgroup>{FLG_LEADGROUP_ID}</leadgroup>
    <title>{title}</title>
    <firstname>{first}</firstname>
    <lastname>{last}</lastname>
    <dobday>{dd}</dobday>
    <dobmonth>{mm}</dobmonth>
    <dobyear>{yy}</dobyear>
    <phone1>{summary.get("phone1","")}</phone1>
    <email>{summary.get("email","")}</email>
    <address>{summary.get("address","")}</address>
    <towncity>{summary.get("towncity","")}</towncity>
    <postcode>{summary.get("postcode","")}</postcode>
    <data31>{pdf_url}</data31>
    <data32>{data32_str}</data32>
  </lead>
</data>'''.encode("ISO-8859-1")

    app.logger.debug("FLG XML payload:\n%s", flg_lead_xml.decode("ISO-8859-1"))

    # 6. Send to FLG...
    flg_url = os.getenv("FLG_UPDATE_URL")
    flg_key = os.getenv("FLG_API_KEY")
    flg_resp = requests.post(
        flg_url,
        headers={"Content-Type":"application/xml","x-api-key":flg_key},
        data=flg_lead_xml,
        timeout=30
    )
    app.logger.info("FLG XML response (status %s):\n%s", flg_resp.status_code, flg_resp.text)

    # 7. Parse XML result
    try:
        root      = ET.fromstring(flg_resp.text)
        status    = root.findtext("status")
        record_id = root.findtext("item/id")
    except Exception as e:
        app.logger.error("Failed parsing FLG XML: %s", e)
        return jsonify(error="Failed to parse FLG response", details=str(e)), 500

    if flg_resp.status_code != 200 or status != "0":
        app.logger.error("FLG upload failed: %s", flg_resp.text)

        return jsonify(
            error="FLG upload failed",
            flg_status=status,
            flg_body=flg_resp.text,
            debug_data32=data32_str,
            debug_lenders=",".join(acc.get("lenderName","") for acc in accounts),
            debug_flg_xml=flg_lead_xml.decode("ISO-8859-1")
        ), flg_resp.status_code or 500


    # 8. Success
    return jsonify({
        "success": True,
        "flg_status": status,
        "flg_id": record_id,
        "debug_data32": data32_str,
        "debug_lenders": ",".join(acc.get("lenderName","") for acc in accounts),
        "debug_flg_xml": flg_lead_xml.decode("ISO-8859-1")
    }), 200



@app.route("/flg/lead", methods=["POST"])
def create_flg_lead():
    """Create or update a lead in FLG."""
    lead = request.json or {}
    xml  = build_flg_lead_xml(lead)
    resp = flg_send_lead(xml)
    return jsonify(response=resp.text), resp.status_code

@app.route("/flg/lead/<lead_id>", methods=["PUT"])
def update_flg_lead(lead_id):
    """Update an existing FLG lead by ID."""
    lead          = request.json or {}
    lead["leadid"] = lead_id
    xml           = build_flg_lead_xml(lead)
    resp          = flg_send_lead(xml)
    if resp.status_code != 200:
        return jsonify(error="FLG update failed", details=resp.text), resp.status_code
    return jsonify(success=True), 200

@app.route("/flg/lead/<lead_id>", methods=["DELETE"])
def delete_flg_lead(lead_id):
    """Delete a lead in FLG by ID."""
    xml = f"""<?xml version="1.0" encoding="UTF-8"?>
    <data>
    <lead>
        <key>{FLG_API_KEY}</key>
        <leadgroup>{FLG_LEADGROUP_ID}</leadgroup>
        <leadid>{lead_id}</leadid>
        <action>delete</action>
    </lead>
    </data>
    """
    resp = requests.post(
        FLG_API_URL,
        data=xml,
        headers={"Content-Type": "application/xml"},
        timeout=30
    )
    if resp.status_code != 200:
        return jsonify(error="Delete failed", details=resp.text), resp.status_code
    return jsonify(success=True), 200



if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
