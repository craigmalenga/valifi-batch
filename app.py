import os
import logging

from flask import Flask, render_template, request, jsonify, send_file, Response
import requests
import io

# ─── App & Logging setup ───────────────────────────────────────────────────────
app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
app.logger.setLevel(logging.INFO)

# ─── 1) Load credentials from environment ────────────────────────────────────────
VALIFI_API_URL  = os.getenv("VALIFI_API_URL", "").rstrip("/")   # e.g. "https://staging-app.valifi.click"
VALIFI_API_USER = os.getenv("VALIFI_API_USER", "")               # e.g. "belmondclaims-api"
VALIFI_API_PASS = os.getenv("VALIFI_API_PASS", "")               # e.g. "!jdu6Rdnmh9b3"

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
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
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
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
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


# ─── 6) Handle the form POST → TransUnion report ────────────────────────────────


@app.route("/query", methods=["POST"])
def query_valifi():
    # 1) Validate required fields
    data = request.json or {}
    for k in ("firstName","lastName","dateOfBirth","flat","street","postTown","postCode"):
        if not data.get(k):
            return jsonify(error=f"{k} is required"), 400

    # 2) Build the Valifi payload requesting a PDF
    payload = {
        "includeJsonReport":    False,
        "includePdfReport":     True,
        "includeSummaryReport": True,
        "clientReference":      data.get("clientReference", "report"),
        "title":                data.get("title", ""),
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

    # 3) Fetch a fresh Bearer token
    token = get_valifi_token()
    headers = {
        "Authorization": f"Bearer {token}",
        "Content-Type":  "application/json"
    }

    # 4) Request the TU report, streaming the PDF
    resp = requests.post(
        f"{VALIFI_API_URL}/bureau/v1/tu/report",
        json=payload,
        headers=headers,
        timeout=60,
        stream=True
    )

    # 5) If Valifi returns an error, pass it back as JSON
    if resp.status_code != 200:
        return jsonify(resp.json()), resp.status_code

    # 6) Otherwise read the PDF bytes
    pdf_bytes = resp.content

    # 7) Send the PDF back with a Save As dialog
    return send_file(
        io.BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="transunion_report.pdf"
    )

@app.route("/upload_summary", methods=["POST"])
def upload_summary():
    summary = request.json
    if not summary:
        app.logger.warning("upload_summary called with no JSON body")
        return jsonify(error="No summary provided"), 400

    # 1. Extract & split name
    full_name = (summary.get("name") or "").strip()
    parts     = full_name.split(" ", 1)
    title     = parts[0] if len(parts) > 1 else ""
    rest      = parts[1] if len(parts) > 1 else parts[0]
    first, last = (rest.split(" ", 1) + [""])[:2]

    # 2. Get DOB from first account
    dob_iso = ""
    accounts = summary.get("accounts") or []
    if accounts and accounts[0].get("dob"):
        dob_iso = accounts[0]["dob"].split("T")[0]

    # 3. Build FLG-compatible XML (wrapped in <data> per docs)
    flg_lead_xml = f"""<?xml version="1.0" encoding="ISO-8859-1"?>
<data>
  <lead>
    <title>{title}</title>
    <firstname>{first}</firstname>
    <lastname>{last}</lastname>
    <dateOfBirth>{dob_iso}</dateOfBirth>
  </lead>
</data>""".encode("ISO-8859-1")

    app.logger.debug("FLG XML payload:\n%s", flg_lead_xml.decode("ISO-8859-1"))

    # 4. Send to FLG
    flg_url = os.getenv("FLG_UPDATE_URL")
    flg_key = os.getenv("FLG_API_KEY")
    try:
        flg_resp = requests.post(
            flg_url,
            headers={
                "Content-Type": "application/xml",
                "x-api-key": flg_key
            },
            data=flg_lead_xml,
            timeout=30
        )
    except Exception as e:
        app.logger.error("Failed posting to FLG: %s", e)
        return jsonify(error="FLG request failed", details=str(e)), 500

    app.logger.info("FLG XML response (status %s):\n%s",
                    flg_resp.status_code, flg_resp.text)

    # 5. Parse XML result
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
            flg_body=flg_resp.text
        ), flg_resp.status_code or 500

    # 6. Success
    return jsonify(success=True, flg_status=status, flg_id=record_id), 200

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
