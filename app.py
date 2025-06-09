import os
from flask import Flask, render_template, request, jsonify
import requests

app = Flask(__name__)

# ─── 1) Load credentials from environment ────────────────────────────────────────
VALIFI_API_URL  = os.getenv("VALIFI_API_URL", "").rstrip("/")   # e.g. "https://staging-app.valifi.click"
VALIFI_API_USER = os.getenv("VALIFI_API_USER", "")               # e.g. "belmondclaims-api"
VALIFI_API_PASS = os.getenv("VALIFI_API_PASS", "")               # e.g. "!jdu6Rdnmh9b3"


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
    if resp.status_code != 200:
        return jsonify(error=resp.text), resp.status_code
    return jsonify(resp.json()), 200


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
    # Required fields from form
    data = request.json
    for k in ("firstName","lastName","dateOfBirth","flat","street","postTown","postCode"):
        if not data.get(k):
            return jsonify(error=f"{k} is required"), 400

    payload = {
        "includeJsonReport":    True,
        "includePdfReport":     False,
        "includeSummaryReport": True,
        "clientReference":      data.get("clientReference","report"),
        "title":                data.get("title",""),
        "forename":             data["firstName"],
        "middleName":           data.get("middleName",""),
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

    token = get_valifi_token()
    headers = {"Authorization": f"Bearer {token}", "Content-Type":"application/json"}
    resp = requests.post(
        f"{VALIFI_API_URL}/bureau/v1/tu/report",
        json=payload,
        headers=headers,
        timeout=30
    )
    return jsonify(resp.json()), resp.status_code


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
