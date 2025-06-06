import os
from flask import Flask, render_template, request, jsonify
import requests
from dotenv import load_dotenv

# Load environment variables from .env in development.
# In production (Railway), you can set these ENV variables in the Railway dashboard
load_dotenv()

app = Flask(__name__)

# Grab API credentials and base URL from environment variables
VALIFI_API_URL = os.getenv("VALIFI_API_URL", "").rstrip("/")  # e.g. "https://staging-app.valifi.click"
VALIFI_API_USER = os.getenv("VALIFI_API_USER", "")
VALIFI_API_PASS = os.getenv("VALIFI_API_PASS", "")

@app.route("/", methods=["GET"])
def index():
    """
    Renders the front-end HTML form where the user can enter:
      - first_name
      - last_name
      - date_of_birth (YYYY-MM-DD)
    """
    return render_template("index.html")


@app.route("/query", methods=["POST"])
def query_valifi():
    """
    Receives form-data (JSON or form-encoded) with:
      - first_name
      - last_name
      - date_of_birth
    Then calls the Valifi live API endpoint (e.g. VALIFI_API_URL + '/your/endpoint')
    using HTTP Basic Auth (API_USER / API_PASS). Returns the JSON response back to the client.
    """
    # 1) Extract form fields (you can change keys to match what your front-end sends)
    first_name = request.form.get("first_name", "").strip()
    last_name = request.form.get("last_name", "").strip()
    date_of_birth = request.form.get("date_of_birth", "").strip()  # expect “YYYY-MM-DD”

    if not (first_name and last_name and date_of_birth):
        return jsonify({"error": "first_name, last_name, and date_of_birth are all required."}), 400

    # 2) Build the Valifi API payload.
    #    **NOTE**: Adjust the keys below to match exactly what Valifi’s “live” JSON API expects.
    payload = {
        "firstName": first_name,
        "lastName": last_name,
        "dateOfBirth": date_of_birth
        # … add any other required fields (e.g. SSN, address, etc.) per your integration spec …
    }

    # 3) Make the HTTP request to Valifi
    #    Assume Valifi’s “live” endpoint is something like: /v1/search or /v1/credit‐agreements
    #    Replace “/v1/search” below with the correct path from your integration docs/Postman collection.
    api_endpoint = f"{VALIFI_API_URL}/v1/search"  # ← ADJUST THIS PATH if needed

    try:
        resp = requests.post(
            api_endpoint,
            json=payload,
            auth=(VALIFI_API_USER, VALIFI_API_PASS),
            timeout=30
        )
    except requests.RequestException as e:
        return jsonify({"error": f"Failed to connect to Valifi API: {e}"}), 502

    # 4) If Valifi returns a non-200 status, pass that along
    if resp.status_code != 200:
        return (
            jsonify({
                "error": "Valifi API returned an error",
                "status_code": resp.status_code,
                "details": resp.text
            }),
            resp.status_code
        )

    # 5) Otherwise, return the JSON from Valifi directly to the front end
    try:
        data = resp.json()
    except ValueError:
        return jsonify({"error": "Valifi API did not return valid JSON."}), 502

    return jsonify(data)


if __name__ == "__main__":
    # In dev: flask runs on port 5000 by default; Railway will override via $PORT if provided.
    port = int(os.environ.get("PORT", 5000))
    app.run(host="0.0.0.0", port=port, debug=True)
