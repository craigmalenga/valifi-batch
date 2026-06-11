#!/usr/bin/env python3
"""
Build the FLG "credit_report_reference" value for every lead created in the DB,
for claims CLAIM_MIN..CLAIM_MAX, so the FLG team can bulk-upload it onto the
matching leads in the CRM.

    - DCA leads -> FLG field data32
    - IRL leads -> FLG field data36
The value is IDENTICAL for both fields (claim-level), and is byte-for-byte the
same shape the live code (app.store_valifi_json_to_s3) writes:

    {"type": "credit_report_reference", "claim_id": N, "s3_url": "...",
     "cmc_search_found": "valifi, valid8" | false,
     "lenders_found": [...], "lender_count": N}

How each part is produced (matching the live "organic" route):
  - s3_url          : claims_tracking.credit_report_s3_url
  - cmc_search_found: fetch that report JSON and search it (case-insensitive)
                      for valifi / valid8 / checkboard -> comma-joined or False
  - lenders_found   : the raw bureau lenderName(s) from the report, exactly as
                      store_valifi_json_to_s3 collects them (summaryReportV2.accounts).

Output: flg_references.xlsx  (cols: claim_id, lead_id, lead_type, flg_field, value)

Run with the app's env (DATABASE_URL + AWS_* set):
    python backfill_flg_references.py
"""

import os
import json
from urllib.parse import urlparse

import psycopg2
import boto3
import requests
from openpyxl import Workbook

# ---------------------------------------------------------------- CONFIG -----
DATABASE_URL = os.environ["DATABASE_URL"]
AWS_REGION   = os.getenv("AWS_REGION", "eu-north-1")
CLAIM_MIN, CLAIM_MAX = 1320, 2054
CMC_TERMS = ["valifi", "valid8", "checkboard"]   # order matches live code
OUTPUT_XLSX = "flg_references.xlsx"

# Live store_valifi_json_to_s3 reads lenders ONLY from summaryReportV2 (Equifax).
# TransUnion reports have no summaryReportV2, so strict-live would give an EMPTY
# lenders_found for every TU claim. Set True to mirror live exactly; leave False
# to also read summaryReport (TU) so TU lenders populate. Format is identical.
STRICT_LIVE_LENDERS = False
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
    try:
        p = urlparse(s3_url)
        host, key = p.netloc, p.path.lstrip("/")
        if host.startswith("s3.") or host.startswith("s3-"):   # s3.region.amazonaws.com/bucket/key
            bucket, key = key.split("/", 1)
        else:                                                  # bucket.s3.region.amazonaws.com/key
            bucket = host.split(".s3")[0]
        return s3.get_object(Bucket=bucket, Key=key)["Body"].read().decode("utf-8", "ignore")
    except Exception as e:
        try:
            r = requests.get(s3_url, timeout=30)
            if r.ok:
                return r.text
        except Exception:
            pass
        print(f"    ! could not fetch report JSON: {e}")
        return ""


def cmc_search(text):
    """Comma-joined list of CMC terms present (lowercased substring), else False."""
    low = (text or "").lower()
    found = [t for t in CMC_TERMS if t in low]
    return ", ".join(found) if found else False


def extract_lenders(report_text):
    """Distinct raw lenderName(s), exactly like store_valifi_json_to_s3."""
    lenders = []
    try:
        obj = json.loads(report_text) if report_text else {}
    except Exception:
        return lenders
    data = obj.get("data", {}) if isinstance(obj, dict) else {}
    accounts = (data.get("summaryReportV2") or {}).get("accounts")
    if not accounts and not STRICT_LIVE_LENDERS:
        accounts = (data.get("summaryReport") or {}).get("accounts")
    for acc in (accounts or []):
        lender = acc.get("lenderName", "")
        if lender and lender not in lenders:
            lenders.append(lender)
    return lenders


def main():
    conn = psycopg2.connect(DATABASE_URL)
    cur = conn.cursor()

    cur.execute(
        "SELECT id, credit_report_s3_url FROM claims_tracking WHERE id BETWEEN %s AND %s",
        (CLAIM_MIN, CLAIM_MAX),
    )
    s3_url_by_claim = {cid: url for cid, url in cur.fetchall()}

    cur.execute(
        "SELECT claim_id, lead_id, lead_type FROM lead_ids_tracking "
        "WHERE claim_id BETWEEN %s AND %s ORDER BY claim_id, id",
        (CLAIM_MIN, CLAIM_MAX),
    )
    leads_by_claim = {}
    for claim_id, lead_id, lead_type in cur.fetchall():
        leads_by_claim.setdefault(claim_id, []).append((lead_id, (lead_type or "").upper()))

    wb = Workbook()
    ws = wb.active
    ws.title = "FLG references"
    ws.append(["claim_id", "lead_id", "lead_type", "flg_field", "value"])

    n_rows = 0
    for claim_id, leads in sorted(leads_by_claim.items()):
        s3_url = s3_url_by_claim.get(claim_id) or "S3_STORAGE_FAILED"
        report_text = fetch_report_text(s3_url)

        reference = {
            "type": "credit_report_reference",
            "claim_id": claim_id,
            "s3_url": s3_url,
            "cmc_search_found": cmc_search(report_text),
            "lenders_found": extract_lenders(report_text),
        }
        reference["lender_count"] = len(reference["lenders_found"])
        value = json.dumps(reference)

        for lead_id, lt in leads:
            flg_field = "data32" if lt == "DCA" else "data36" if lt == "IRL" else ""
            if not flg_field:
                print(f"    ? claim {claim_id} lead {lead_id}: unknown type '{lt}', skipped")
                continue
            ws.append([claim_id, lead_id, lt, flg_field, value])
            n_rows += 1

        print(f"claim {claim_id}: {len(leads)} leads | cmc={reference['cmc_search_found']} | "
              f"lenders={reference['lenders_found']}")

    wb.save(OUTPUT_XLSX)
    print(f"\nDone. {n_rows} lead rows across {len(leads_by_claim)} claims -> {OUTPUT_XLSX}")
    cur.close()
    conn.close()


if __name__ == "__main__":
    main()
