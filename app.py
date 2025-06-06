# app.py
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
    """
    Calls Valifi’s Basic-Auth endpoint (POST /basic-auth) with HTTP Basic Auth
    to retrieve a JSON object containing { data: { token: "<bearer_token>" } }.
    Returns the raw token string, or raises an exception on failure.
    """
    basic_auth_url = f"{VALIFI_API_URL}/basic-auth"
    try:
        resp = requests.post(
            basic_auth_url,
            auth=(VALIFI_API_USER, VALIFI_API_PASS),
            timeout=15
        )
    except requests.RequestException as e:
        raise RuntimeError(f"Failed to connect to Valifi Basic-Auth: {e}")

    if resp.status_code != 200:
        raise RuntimeError(f"Valifi Basic-Auth returned {resp.status_code}: {resp.text}")

    body = resp.json()
    # The JSON structure is: { "status": true, "data": { "token": "…" } }
    token = body.get("data", {}).get("token")
    if not token:
        raise RuntimeError("Valifi Basic-Auth did not return a token in data.token")

    return token


# ─── 3) Render the HTML form ─────────────────────────────────────────────────────
@app.route("/", methods=["GET"])
def index():
    """
    Render a form that collects:
      - first_name, last_name, date_of_birth
      - current address (flat, street, postTown, postCode)
      - (optional) previousAddress, previousPreviousAddress
    """
    return render_template("index.html")


# ─── 4) Handle the form POST, call TransUnion endpoint ──────────────────────────
@app.route("/query", methods=["POST"])
def query_valifi():
    """
    1) Extract form fields (name, dob, address).
    2) Authenticate via /basic-auth → get Bearer token.
    3) POST to /bureau/v1/tu/report with that Bearer token and payload.
    4) Return TransUnion’s JSON back to the front end.
    """
    # (A) Required form fields
    first_name   = request.form.get("first_name", "").strip()
    last_name    = request.form.get("last_name", "").strip()
    date_of_birth= request.form.get("date_of_birth", "").strip()    # format: "YYYY-MM-DD"
    flat         = request.form.get("flat", "").strip()
    street       = request.form.get("street", "").strip()
    post_town    = request.form.get("post_town", "").strip()
    post_code    = request.form.get("post_code", "").strip()

    # (B) Basic validation
    if not (first_name and last_name and date_of_birth and flat and street and post_town and post_code):
        return (
            jsonify({"error": "All fields (first_name, last_name, date_of_birth, flat, street, post_town, post_code) are required."}),
            400
        )

    # (C) Build the payload that TransUnion expects
    #     We’ll set `previousAddress` and `previousPreviousAddress` to null for now.
    tu_payload = {
        "includeJsonReport":   True,
        "includePdfReport":    False,
        "includeSummaryReport": True,
        "clientReference":     f"{first_name[:3].upper()}-{last_name[:3].upper()}-{date_of_birth.replace('-', '')}",
        "title":               request.form.get("title", "Mr"),  # default to "Mr" if not provided
        "forename":            first_name,
        "middleName":          request.form.get("middle_name", ""),   # optional
        "surname":             last_name,
        "dateOfBirth":         date_of_birth,
        "currentAddress": {
            "flat":     flat,
            "street":   street,
            "postTown": post_town,
            "postCode": post_code
        },
        "previousAddress":          None,
        "previousPreviousAddress":  None
    }

    # (D) Authenticate to Valifi Basic-Auth, get Bearer token
    try:
        bearer_token = get_valifi_token()
    except RuntimeError as auth_err:
        return jsonify({"error": str(auth_err)}), 502

    # (E) Call TransUnion endpoint with Bearer token
    tu_url = f"{VALIFI_API_URL}/bureau/v1/tu/report"
    headers = {
        "Authorization": f"Bearer {bearer_token}",
        "Content-Type":  "application/json"
    }

    try:
        resp = requests.post(tu_url, json=tu_payload, headers=headers, timeout=30)
    except requests.RequestException as e:
        return jsonify({"error": f"Failed to connect to TransUnion endpoint: {e}"}), 502

    # (F) If TU returns non-200, forward the error
    if resp.status_code != 200:
        return (
            jsonify({
                "error":       "TransUnion API returned an error",
                "status_code": resp.status_code,
                "details":     resp.text
            }),
            resp.status_code
        )

    # (G) Otherwise, parse and return TU’s JSON
    try:
        data = resp.json()
    except ValueError:
        return jsonify({"error": "TransUnion API did not return valid JSON."}), 502

    return jsonify(data)


if __name__ == "__main__":
    # In dev, runs on 5000. In Railway, $PORT will override.
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
