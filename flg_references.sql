-- =============================================================================
-- FLG credit_report_reference backfill — pure SQL (run in DBeaver, export grid)
--
-- One row per lead created in the DB for claims 1320..2054:
--   DCA -> flg_field 'data32', IRL -> 'data36'
--   value = the claim-level reference JSON, same shape as the live code
--           (app.store_valifi_json_to_s3).
--
-- Right-click the result grid -> Export resultset -> XLSX to hand to the FLG team.
--
-- NOTE on cmc_search_found: the live code searches the FULL credit-report JSON
-- (stored in S3, NOT in the DB) for valifi/valid8/checkboard. SQL can't read S3,
-- so this uses the already-stored claims_tracking.cmc_in_credit_report flag:
--   'No'  -> false   (the common case — exact)
--   else  -> 'valifi'(CMC was detected; for the exact valid8/checkboard breakdown
--                     run backfill_flg_references.py, which reads the S3 JSON).
-- =============================================================================

WITH claim_lenders AS (
    SELECT
        s.claim_id,
        json_agg(DISTINCT s.ln)  AS lenders,
        count(DISTINCT s.ln)     AS lender_count
    FROM (
        SELECT
            claim_id,
            (lender_data_json::jsonb ->> 'lenderName') AS ln
        FROM lead_ids_tracking
        WHERE claim_id BETWEEN 1320 AND 2054
          AND lender_data_json IS NOT NULL
    ) s
    WHERE s.ln IS NOT NULL AND s.ln <> ''
    GROUP BY s.claim_id
)
SELECT
    lit.claim_id,
    lit.lead_id,
    lit.lead_type,
    CASE upper(lit.lead_type)
        WHEN 'DCA' THEN 'data32'
        WHEN 'IRL' THEN 'data36'
    END AS flg_field,
    json_build_object(
        'type',             'credit_report_reference',
        'claim_id',         lit.claim_id,
        's3_url',           COALESCE(ct.credit_report_s3_url, 'S3_STORAGE_FAILED'),
        'cmc_search_found', CASE
                                WHEN COALESCE(ct.cmc_in_credit_report, 'No') ILIKE 'no'
                                    THEN to_json(false)
                                ELSE to_json('valifi'::text)
                            END,
        'lenders_found',    COALESCE(cl.lenders, '[]'::json),
        'lender_count',     COALESCE(cl.lender_count, 0)
    )::text AS value
FROM lead_ids_tracking lit
JOIN claims_tracking ct       ON ct.id = lit.claim_id
LEFT JOIN claim_lenders cl    ON cl.claim_id = lit.claim_id
WHERE lit.claim_id BETWEEN 1320 AND 2054
  AND upper(lit.lead_type) IN ('DCA', 'IRL')
ORDER BY lit.claim_id, lit.lead_id;
