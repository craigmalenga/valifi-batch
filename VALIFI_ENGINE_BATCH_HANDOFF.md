# Handoff — Batch-run ~450+ applicants through the Valifi engine (Equifax-first, TU-fallback)

> **For:** the agent working on the **live Valifi backend** (belmondpcp / real engine — the one that now has **Kount coded**).
> **From:** the agent on `valifi-batch` (the mirror). This doc carries every gotcha we already hit and fixed on the mirror so you don't repeat them.
> **Goal:** run the "not-run" applicant list (~451 in the CSV `valifi_batch_TORUN.csv`; the operator referenced ~541 — reconcile the exact count from source) through the credit engine, **Equifax first** (richer data), **TransUnion as fallback**, and store the results the same way a normal organic claim is stored.

---

## 0. TL;DR of the flow (per applicant)

```
1. EQUIFAX  POST /bureau/v1/equifax/cz
     ├─ 200 + accounts .............. STORE (Equifax). DONE.
     ├─ 200 + 0 accounts ............ fall through to TU (step 2)
     ├─ 403 "Kount check failed" that is a CHALLENGE / needs OTP
     │                              .. status = RESIDUAL_KOUNT_OTP → log, DO NOT fall back, move on
     │                                 (operator re-runs these later through the OTP flow)
     └─ other 4xx / no-profile ...... fall through to TU (step 2)

2. TRANSUNION  POST /bureau/v1/tu/report   (only if Equifax gave nothing usable)
     ├─ 200 + accounts .............. STORE (TransUnion). DONE.
     ├─ 400 "Customer profile not found with TransUnion" .. status = NO_DATA
     └─ any error ................... status = ERROR (log)
```

**Equifax is preferred** because it returns *much* richer data (summaryReportV2, CZ + AUTO_API sources, history back to 2007). **TransUnion only has a ~6-year live window** and misses older agreements — it's the fallback, not the primary.

Residuals (Kount challenge / OTP-required) are **expected for some** — flag them clearly and keep going; the operator will re-run that subset later with the OTP step. Don't let a residual abort the batch.

---

## 1. Input

CSV/XLSX, one applicant per row. Columns (friendly headers OK — normalise them):

```
title, first_name, middle_name, last_name, dob_day, dob_month, dob_year,
email, mobile, building_number, building_name, flat, street, district, county,
post_town, post_code,
prev1_* , prev2_*   (optional previous addresses, same sub-fields)
```

Notes:
- `title` may be blank. **Equifax accepts blank; TransUnion does NOT** (see §4).
- DOB is split day/month/year → build `YYYY-MM-DD`.
- Address is **required** by the engine (`street`, `post_town`, `post_code` at minimum).

---

## 2. Auth

```
POST {BASE}/basic-auth        (HTTP Basic: VALIFI_API_USER / VALIFI_API_PASS)
→ {"data": {"token": "..."}}  # cache ~1 hour; on 401 from a report call, drop token & re-auth
BASE = https://api.valifi.co.uk
```

Send report calls with a `requests.Session` + Postman-style headers (Valifi's WAF/CDN 403s bare `python-requests/x` UAs):
```
Authorization: Bearer <token>
Content-Type: application/json
Accept: */*
Accept-Encoding: gzip, deflate, br
User-Agent: PostmanRuntime/7.50.0
Cache-Control: no-cache
Connection: keep-alive
```

---

## 3. Endpoints & payload (IDENTICAL body for both bureaus — only the URL differs)

- Equifax: `POST {BASE}/bureau/v1/equifax/cz`
- TransUnion: `POST {BASE}/bureau/v1/tu/report`

```json
{
  "includeJsonReport": true,
  "includePdfReport": true,
  "includePdfSummaryReport": false,     // Equifax-only flags; TU ignores extras
  "includeSummaryReport": true,
  "includeSummaryReportV2": true,       // Equifax-only; TU has no V2

  "clientReference": "Firstname_Lastname_YYYY-MM-DD",
  "title": "Mr",
  "forename": "Firstname",
  "middleName": "",
  "surname": "Lastname",
  "dateOfBirth": "1975-08-01",

  "currentAddress": {
    "flat": null, "houseName": null, "houseNumber": "11",
    "street": "SKERRITT WAY", "street2": null, "district": "PURLEY ON THAMES",
    "postTown": "READING", "county": null, "postCode": "RG8 8DD"
  },
  "previousAddress": null,
  "previousPreviousAddress": null
}
```

---

## 4. Gotchas we already hit on the mirror — bake these in

1. **`clientReference` MUST match `^[A-Za-z0-9_-]*$`.** Names like `O'Hare` produce `Firstname_O'Hare_...` → TU returns `400 Invalid Payload: data/clientReference must match pattern`. **Strip every char outside `[A-Za-z0-9_-]`** (e.g. `re.sub(r'[^A-Za-z0-9_-]','',ref)`). Must not be empty — fall back to `"web_form"`.

2. **`title` for TransUnion:**
   - TU rejects empty: `400 Invalid Payload: data/title must NOT have fewer than 2 characters`.
   - **TU uses the title's GENDER in identity matching.** A wrong-gender title returns `Customer profile not found` even for someone who *is* on file (proven: "Mr Elizabeth Austin" → not found; "Ms" → found).
   - So for TU: if title blank/invalid, **try `Mr`, and on `profile not found` retry once with `Ms`** (Ms/Mrs/Miss all read as female — one female alternate is enough). Equifax doesn't care; leave its title as-supplied (blank OK).

3. **Address text fields** (`street`, `district`, `postTown`, `houseName`) — **letters + spaces only** for Equifax (it rejects punctuation/digits, e.g. `Purley-on-Thames`). Sanitize: `re.sub(r'[^A-Za-z ]',' ',v).strip() or None`. **`houseNumber` stays a string** (`"11"`, and TU-style `"20786320 0"` sub-numbers exist). **`postCode` keeps its space** (`RG8 8DD`), untouched.

4. **Do NOT retry a 4xx.** A `403 Kount check failed` / `400` is deterministic; retrying just adds to Valifi/Equifax **Kount velocity** scoring and can make borderline applicants fail. **One attempt per bureau per applicant.** (A `requests.Response` is falsy for non-2xx — use `resp is not None`, not truthiness, in any retry/skip guard.)

5. **`raise` on DB-connect-at-import will crash the whole app** — don't gate the batch behind a hard DB connection at boot (the mirror is down right now for exactly this reason).

---

## 5. Reading results (bureau-agnostic)

- **Equifax**: accounts at `data.summaryReportV2.accounts[]` (fields: `lenderName, accountNumber, accountType(hp/lease), startDate, currentBalance(int), startBalance, monthlyPayment, currentStatus(ZERO/S...), forename/surname, addressStreet1/addressPostCode..., sourcedFrom(CZ/AUTO_API)`). Falls back to `data.summaryReport.accounts[]`.
- **TransUnion**: accounts at `data.summaryReport.accounts[]` (fields: `lenderName, accountNumber(may have trailing " 0"), accountType(HP)+accountTypeName, name(single string), address(single string), startDate("...T00:00:00"), currentBalance("17978" string), currentStatus("Up to date"), sourcedFrom("API")`). **No `summaryReportV2`.**
- Coerce types on store: TU balances are **strings**, Equifax **ints**; TU dates carry a `T00:00:00` suffix — strip to `YYYY-MM-DD`.

---

## 6. What to store (same as an organic claim)

For each applicant that returns data, persist exactly like the live single-claim path:
- `claims_tracking` row (+ `credit_report_s3_url`, `cmc_in_credit_report`, `pdf_url`).
- `lead_ids_tracking` rows (one per account → DCA + IRL lead).
- Full raw response JSON → S3 (`credit-reports/claim_<id>_...json`).
- `pdfReport` (base64) → S3.
- **`credit_report_reference`** (the value that goes into FLG **data32 (DCA)** / **data36 (IRL)**):
  ```json
  {"type":"credit_report_reference","claim_id":N,"s3_url":"<credit_report_s3_url>",
   "cmc_search_found":"valifi, valid8"|false,"lenders_found":[...],"lender_count":N}
  ```
  `cmc_search_found` = case-insensitive search of the report JSON for **valifi / valid8 / checkboard** (comma-joined found terms, else `false`). `lenders_found` = the report's `lenderName`s.
- Tag which **bureau** produced it (Equifax vs TransUnion), and record the **matched title** if the TU Mr→Ms fallback fired.

---

## 7. Batch harness + residual capture

- Iterate the CSV, ~1–1.5s spacing between applicants (be gentle — velocity).
- Track per applicant a **status**:
  `EQUIFAX_HIT | TU_HIT | NO_DATA | RESIDUAL_KOUNT_OTP | ERROR`.
- **RESIDUAL_KOUNT_OTP**: capture full identity + which bureau + the raw Kount/OTP response, into a residuals list/table so the operator can re-run just those through the OTP/challenge flow later. Do **not** TU-fallback a Kount-OTP challenge and do **not** abort the batch.
- Emit an **Excel/CSV summary** at the end: total processed, Equifax hits, TU-fallback hits, no-data, residuals (with reasons), avg lenders per hit — and the residuals as their own sheet.

---

## 8. Simplest path (consider before writing new code)

The mirror already has a **backend-agnostic batch GUI** (`templates/batch.html`) with a "Backend Base URL" field and a **bureau selector**. If the live backend exposes the same `/query` + `/upload_summary` contract, the operator can point that GUI at the live backend and run — no new batch endpoint required. If you build server-side batching instead, mirror the `/query` behaviour (bureau routing, the §4 fixes, single-attempt) and add the Equifax→TU fallback + residual capture from §7.

---

## 9. Reference

Working, battle-tested versions of every helper above (clientReference sanitiser, title/Mr→Ms fallback, address sanitiser, single-attempt call, bureau-agnostic account extraction, S3 storage, the data32/data36 reference builder) live in the `valifi-batch` repo (`app.py`) on branch `claude/intelligent-johnson-caULT`. Copy from there rather than rebuilding.
