#!/usr/bin/env python3
"""
Backfill the FLG "credit_report_reference" field for existing batch leads.

For every row in lead_ids_tracking whose claim_id is in CLAIM_MIN..CLAIM_MAX:
    - DCA leads  -> FLG field data32
    - IRL leads  -> FLG field data36
The value written is the CLAIM-LEVEL reference JSON, identical in shape to what
app.store_valifi_json_to_s3() produces live:

    {"type":"credit_report_reference","claim_id":N,"s3_url":"...",
     "cmc_search_found":"valifi, valid8"|false,
     "lenders_found":[...],"lender_count":N}

cmc_search_found is computed by FETCHING the stored credit-report JSON for the
claim (claims_tracking.credit_report_s3_url) and searching it case-insensitively
for: valifi, valid8, checkboard. (Comma-joined list of those found, or False.)

Output: flg_references.csv  ->  columns: claim_id, lead_id, lead_type, flg_field, value
(You can then bulk-load that into FLG, or feed it to your FLG update process.)

Run from the repo with the same env the app uses (DATABASE_URL + AWS_* set):
    python backfill_flg_references.py
"""

import os
import csv
import json
from urllib.parse import urlparse

import psycopg2
import boto3
import requests

# ---------------------------------------------------------------- CONFIG -----
DATABASE_URL = os.environ["DATABASE_URL"]
AWS_REGION   = os.getenv("AWS_REGION", "eu-north-1")
CLAIM_MIN, CLAIM_MAX = 1320, 2054
CMC_TERMS = ["valifi", "valid8", "checkboard"]   # searched in the report JSON
OUTPUT_CSV = "flg_references.csv"

# Which lender name to list in "lenders_found":
#   "raw" -> bureau name from the account (e.g. "FCE Bank PLC", "BLACK HORSE LTD")
#   "flg" -> normalised lender_name column (e.g. "FCE Bank plc", "MotoNovo Finance")
LENDER_NAME_SOURCE = "raw"
# -----------------------------------------------------------------------------

s3 = boto3.client(
    "s3",
    region_name=AWS_REGION,
    aws_access_key_id=os.getenv("AWS_ACCESS_KEY_ID"),
    aws_secret_access_key=os.getenv("AWS_SECRET_ACCESS_KEY"),
)


def fetch_report_text(s3_url):
    """Return the raw credit-report JSON text for a claim, or '' if unavailable."""
    if not s3_url or s3_url == "S3_STORAGE_FAILED":
        return ""
    # Try authenticated S3 get_object first (works for private buckets).
    try:
        p = urlparse(s3_url)
        host, key = p.netloc, p.path.lstrip("/")
        if host.startswith("s3.") or host.startswith("s3-"):   # s3.region.amazonaws.com/bucket/key
            bucket, key = key.split("/", 1)
        else:                                                   # bucket.s3.region.amazonaws.com/key
            bucket = host.split(".s3")[0]
        obj = s3.get_object(Bucket=bucket, Key=key)
        return obj["Body"].read().decode("utf-8", "ignore")
    except Exception as e:
        # Fall back to a plain HTTP GET (works if the object/URL is reachable).
        try:
            r = requests.get(s3_url, timeout=30)
            if r.ok:
                return r.text
        except Exception:
            pass
        print(f"    ! could not fetch report JSON: {e}")
        return ""


def cmc_search(text):
    """Comma-joined list of CMC terms present in the report, or False if none."""
    low = (text or "").lower()
    found = [t for t in CMC_TERMS if t in low]
    return ", ".join(found) if found else False


def lender_from_lead(row):
    """Extract a lender name from a lead_ids_tracking row (dict)."""
    if LENDER_NAME_SOURCE == "flg":
        return row.get("lender_name")
    # raw bureau name lives inside lender_data_json
    try:
        ld = json.loads(row.get("lender_data_json") or "{}")
        return ld.get("lenderName") or row.get("lender_name")
    except Exception:
        return row.get("lender_name")


def main():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    # 1) s3_url per claim
    cur.execute(
        "SELECT id, credit_report_s3_url FROM claims_tracking "
        "WHERE id BETWEEN %s AND %s",
        (CLAIM_MIN, CLAIM_MAX),
    )
    s3_url_by_claim = {cid: url for cid, url in cur.fetchall()}

    # 2) all leads in range
    cur.execute(
        "SELECT claim_id, lead_id, lead_type, lender_name, lender_data_json "
        "FROM lead_ids_tracking WHERE claim_id BETWEEN %s AND %s ORDER BY claim_id, id",
        (CLAIM_MIN, CLAIM_MAX),
    )
    leads_by_claim = {}
    for claim_id, lead_id, lead_type, lender_name, lender_data_json in cur.fetchall():
        leads_by_claim.setdefault(claim_id, []).append({
            "lead_id": lead_id,
            "lead_type": (lead_type or "").upper(),
            "lender_name": lender_name,
            "lender_data_json": lender_data_json,
        })

    out_rows = []
    report_cache = {}  # claim_id -> (cmc_search_found, lenders_found)

    for claim_id, leads in sorted(leads_by_claim.items()):
        s3_url = s3_url_by_claim.get(claim_id) or "S3_STORAGE_FAILED"

        # distinct lenders for this claim (order preserved)
        lenders = []
        for lead in leads:
            name = lender_from_lead(lead)
            if name and name not in lenders:
                lenders.append(name)

        cmc = cmc_search(fetch_report_text(s3_url))

        reference = {
            "type": "credit_report_reference",
            "claim_id": claim_id,
            "s3_url": s3_url,
            "cmc_search_found": cmc,
            "lenders_found": lenders,
            "lender_count": len(lenders),
        }
        reference_json = json.dumps(reference)

        for lead in leads:
            lt = lead["lead_type"]
            flg_field = "data32" if lt == "DCA" else "data36" if lt == "IRL" else ""
            if not flg_field:
                print(f"    ? claim {claim_id} lead {lead['lead_id']}: unknown type '{lt}', skipped")
                continue
            out_rows.append({
                "claim_id": claim_id,
                "lead_id": lead["lead_id"],
                "lead_type": lt,
                "flg_field": flg_field,
                "value": reference_json,
            })

        print(f"claim {claim_id}: {len(leads)} leads | cmc={cmc} | lenders={lenders}")

    with open(OUTPUT_CSV, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["claim_id", "lead_id", "lead_type", "flg_field", "value"])
        w.writeheader()
        w.writerows(out_rows)

    print(f"\nDone. {len(out_rows)} lead rows across {len(leads_by_claim)} claims -> {OUTPUT_CSV}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
