'use strict';

// Imports Walmart's APDP dispute export (Retail Link -> "Disputes" CSV, 69
// columns) so every claim reflects Walmart's ACTUAL adjudication instead of
// just what we deducted and filed.
//
// Grain, confirmed against a real 5,019-row export (vendor 540153, Feb-Jul 2026):
//
//   * One row = one dispute LINE, identified by DisputeNbr. An invoice routinely
//     carries several (worst case in the real file: 18 rows on invoice 43543).
//     So a claim maps to MANY rows, and the roll-up to a single claim-level
//     status has to tolerate lines disagreeing with each other.
//   * InvoiceNbr holds the ORIGINAL invoice number, zero-padded to 15 AND
//     right-padded with spaces ("000000000045211       "). Only ~1.5% of rows
//     carry a STAT rebill number (8974xxx) instead.
//   * PoNbr is 1:1 with InvoiceNbr across all 3,227 invoices in the real file,
//     so it adds no discriminating power to the match key. It is compared only
//     as a sanity check, never relied on to disambiguate.
//   * ClaimNbr is NOT a case identifier — it is the zero-padded invoice number
//     again. Only DisputeNbr and CaseNbr are real Walmart keys worth storing.
//   * ClaimCode is bare ("22"), while our claims carry Retail Link's form
//     ("0022" / "[0022]"). Both are normalized before comparison.

const { parseCsv, parseAmount, normalizeDate } = require('./csvParser');

// Walmart's real Status values, from the confirmed export. Note there is no
// "Approved" and no "Pending" — the win state is "Sent For Payment".
const STATUS_BUCKETS = {
  'sent for payment': 'approved',
  denied: 'denied',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  submitted: 'pending',
  'sent for revision': 'pending',
};

/** Bucket a raw Walmart status into one of approved|denied|cancelled|pending|unknown. */
function statusBucket(status) {
  return STATUS_BUCKETS[String(status || '').trim().toLowerCase()] || 'unknown';
}

/** Trim, then strip zero-padding on all-digit values (matches store.normInv). */
function normInv(v) {
  const s = String(v == null ? '' : v).trim();
  return /^\d+$/.test(s) ? s.replace(/^0+/, '') || '0' : s;
}

/**
 * Canonical deduction code. Walmart's export says "22"; our claims say "0022"
 * or "[0022]" depending on where they came from. Compare on the bare number.
 */
function normCode(v) {
  const s = String(v == null ? '' : v).trim().replace(/[[\]]/g, '');
  if (!s) return '';
  return /^\d+$/.test(s) ? s.replace(/^0+/, '') || '0' : s.toLowerCase();
}

const REQUIRED_HEADERS = ['DisputeNbr', 'Status', 'InvoiceNbr', 'PoNbr'];

/**
 * Parse an APDP export buffer into normalized dispute rows.
 * Returns { rows, headers, warnings }.
 */
function parseApdp(buffer) {
  const { headers, rows: raw } = parseCsv(buffer.toString('utf8'));
  const warnings = [];

  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length) {
    const e = new Error(
      `This does not look like a Walmart APDP dispute export — missing column(s): ${missing.join(', ')}.`
    );
    e.status = 400;
    throw e;
  }

  const get = (row, key) => String(row[key] == null ? '' : row[key]).trim();

  const rows = raw.map((row, i) => {
    const status = get(row, 'Status');
    return {
      rowNumber: i + 2, // +1 for zero-index, +1 for the header line
      vendorNumber: get(row, 'VendorNumber'),
      disputeNbr: get(row, 'DisputeNbr'),
      caseNbr: get(row, 'CaseNbr'),
      // Deliberately normalized: ClaimNbr is the padded invoice number, not a key.
      claimNbr: normInv(get(row, 'ClaimNbr')),
      claimLineNbr: get(row, 'ClaimLineNbr'),
      invoice: normInv(get(row, 'InvoiceNbr')),
      invoiceRaw: get(row, 'InvoiceNbr'),
      po: get(row, 'PoNbr'),
      locationNbr: get(row, 'LocationNbr'),
      status,
      bucket: statusBucket(status),
      disputeType: get(row, 'DisputeType'),
      code: normCode(get(row, 'ClaimCode')),
      approvedClaimCode: normCode(get(row, 'ApprovedClaimCode')),
      approvedSeq: get(row, 'ApprovedSeq'),
      approvedPoNbr: get(row, 'ApprovedPoNbr'),
      approvedTotalCostAmt: parseAmount(get(row, 'ApprovedTotalCostAmt')),
      deniedDeductionCode: normCode(get(row, 'DeniedDeductionCode')),
      deniedDeductionCategory: get(row, 'DeniedDeductionCategory'),
      amounts: {
        claimAmt: parseAmount(get(row, 'ClaimAmt')),
        dispAmount: parseAmount(get(row, 'DispAmount')),
        invoiceAmt: parseAmount(get(row, 'InvoiceAmt')),
        deniedDenialAmt: parseAmount(get(row, 'DeniedDenialAmt')),
        deniedAllowanceAmt: parseAmount(get(row, 'DeniedAllowanceAmt')),
        deniedChrgBackAmt: parseAmount(get(row, 'DeniedChrgBackAmt')),
      },
      // Evidence Walmart cited when denying — what a future appeal has to rebut.
      denial: {
        comments: get(row, 'DeniedUserComments'),
        bolNbr: get(row, 'DeniedBolNbr'),
        freightCarrier: get(row, 'DeniedFreightCarrier'),
        proNbr: get(row, 'DeniedProNbr'),
        rcvDate: normalizeDate(get(row, 'DeniedRcvDate')),
      },
      createdDt: normalizeDate(get(row, 'CreatedDt')),
      lastUpdatedDt: normalizeDate(get(row, 'LastUpdatedDt')),
    };
  });

  const noDispute = rows.filter((r) => !r.disputeNbr).length;
  if (noDispute) warnings.push(`${noDispute} row(s) have no DisputeNbr and cannot be tracked; they were skipped.`);

  const { merged, conflicts, collapsed } = mergeApprovalDetail(rows.filter((r) => r.disputeNbr));
  if (collapsed) {
    warnings.push(
      `${collapsed} row(s) were approval detail for a dispute already listed (same DisputeNbr and status, broken out by ApprovedSeq/PO) and were folded into one entry each.`
    );
  }
  for (const c of conflicts) {
    warnings.push(`DisputeNbr ${c.disputeNbr} appears with conflicting statuses (${c.statuses.join(', ')}); newest kept.`);
  }

  const unknown = [...new Set(rows.filter((r) => r.bucket === 'unknown' && r.status).map((r) => r.status))];
  if (unknown.length) {
    warnings.push(`Unrecognized Status value(s), imported as-is: ${unknown.join(', ')}.`);
  }

  const vendors = [...new Set(rows.map((r) => r.vendorNumber).filter(Boolean))];
  if (vendors.length > 1) warnings.push(`File mixes vendor numbers: ${vendors.join(', ')}.`);

  return { rows: merged, headers, warnings, vendors };
}

/**
 * Fold approval-detail rows into one row per dispute line.
 *
 * When Walmart approves a dispute across several POs/receipts it emits one row
 * per ApprovedSeq — same DisputeNbr, same status, same DispAmount, differing
 * only in ApprovedSeq/ApprovedPoNbr/ApprovedTotalCostAmt. In the real export
 * that's 19 extra rows across 4 disputes (one approved over 11 receipt lines).
 * These are NOT duplicates and must not land in the manual-review pile; they
 * collapse to a single entry carrying the approval breakdown.
 *
 * A genuine conflict — the same DisputeNbr with two different statuses — is
 * kept as a conflict and reported, since that means the export is inconsistent.
 */
function mergeApprovalDetail(rows) {
  const byDispute = new Map();
  const conflicts = [];
  let collapsed = 0;

  for (const row of rows) {
    const prev = byDispute.get(row.disputeNbr);
    if (!prev) {
      byDispute.set(row.disputeNbr, {
        ...row,
        approvals: row.approvedSeq ? [approvalOf(row)] : [],
      });
      continue;
    }

    if (prev.status !== row.status) {
      const existing = conflicts.find((c) => c.disputeNbr === row.disputeNbr);
      const statuses = existing ? existing.statuses : [prev.status];
      if (!statuses.includes(row.status)) statuses.push(row.status);
      if (!existing) conflicts.push({ disputeNbr: row.disputeNbr, statuses });
      // Keep whichever was updated most recently.
      if (String(row.lastUpdatedDt) > String(prev.lastUpdatedDt)) {
        byDispute.set(row.disputeNbr, { ...row, approvals: prev.approvals });
      }
      continue;
    }

    collapsed += 1;
    if (row.approvedSeq) prev.approvals.push(approvalOf(row));
  }

  for (const r of byDispute.values()) {
    r.approvedLineCount = r.approvals.length;
    r.approvedTotal = round2(r.approvals.reduce((s, a) => s + (a.totalCostAmt || 0), 0));
  }

  return { merged: [...byDispute.values()], conflicts, collapsed };
}

function approvalOf(row) {
  return { seq: row.approvedSeq, poNbr: row.approvedPoNbr, totalCostAmt: row.approvedTotalCostAmt };
}

/**
 * Find the claim an APDP row belongs to.
 *
 * Order of preference:
 *   1. DisputeNbr already recorded on a claim (set by a previous import) —
 *      exact, and survives any invoice-number weirdness.
 *   2. Original invoice number, narrowed by deduction code when that
 *      disambiguates. PO is checked for agreement but never used to pick a
 *      winner, since it is 1:1 with the invoice.
 *
 * Returns { claim } on success or { reason } when the row can't be placed.
 * Zero or ambiguous matches are always reported, never guessed.
 */
function matchRow(row, claims, byDisputeNbr) {
  const known = byDisputeNbr.get(row.disputeNbr);
  if (known) return { claim: known, matchedBy: 'disputeNbr' };

  const onInvoice = claims.filter((c) => normInv(c.invoice) === row.invoice);
  if (!onInvoice.length) {
    return { reason: `No claim for invoice ${row.invoice}` };
  }

  // Deduction codes must AGREE — never fall back to "there's only one claim on
  // this invoice, so it must be that one". 135 invoices in the real export carry
  // more than one code, and an invoice we disputed for a shortage (22) routinely
  // also carries Walmart's pricing disputes (10/24/25) that are not our claim.
  // Attaching those would poison the denial-follow-up data with other people's
  // cases, so a code that doesn't line up is reported instead of guessed.
  let candidates = onInvoice;
  if (row.code) {
    candidates = onInvoice.filter((c) => !c.code || normCode(c.code) === row.code);
    if (!candidates.length) {
      return {
        reason: `Invoice ${row.invoice} has ${onInvoice.length} claim(s), but none with deduction code ${row.code} (ours: ${[
          ...new Set(onInvoice.map((c) => normCode(c.code) || '?')),
        ].join(', ')})`,
      };
    }
  }

  if (candidates.length > 1) {
    return {
      reason: `Ambiguous — invoice ${row.invoice} code ${row.code || '?'} matches ${candidates.length} claims (${candidates
        .map((c) => c.id)
        .join(', ')})`,
    };
  }

  const claim = candidates[0];
  // PO disagreement doesn't block the match (invoice is the stronger key), but
  // it's surfaced so a genuine mismatch isn't silently absorbed.
  const poMismatch = row.po && claim.po && normInv(claim.po) !== normInv(row.po);
  return { claim, matchedBy: 'invoice', poMismatch };
}

/**
 * Build the import preview. Writes nothing.
 *
 * `history` is the existing status history (append-only), used to decide which
 * rows are genuinely new: a row whose status already matches the latest recorded
 * entry for that DisputeNbr is a no-op and will be skipped on confirm, which is
 * what makes re-uploading an overlapping export safe.
 */
function buildPreview(rows, claims, history, options = {}) {
  const { fileName = '', batchId = '' } = options;

  const byDisputeNbr = new Map();
  for (const c of claims) {
    for (const d of c.apdpDisputeNbrs || []) byDisputeNbr.set(String(d), c);
  }

  // Latest recorded status per dispute line.
  const latest = new Map();
  for (const e of history) {
    const prev = latest.get(e.disputeNbr);
    if (!prev || String(e.importedAt) >= String(prev.importedAt)) latest.set(e.disputeNbr, e);
  }

  const matched = [];
  const unmatched = [];
  const statusCounts = {};
  const seenInFile = new Set();

  for (const row of rows) {
    statusCounts[row.status] = (statusCounts[row.status] || 0) + 1;

    if (seenInFile.has(row.disputeNbr)) {
      unmatched.push({ ...rowBrief(row), reason: `Duplicate DisputeNbr ${row.disputeNbr} within this file` });
      continue;
    }
    seenInFile.add(row.disputeNbr);

    const result = matchRow(row, claims, byDisputeNbr);
    if (!result.claim) {
      unmatched.push({ ...rowBrief(row), reason: result.reason });
      continue;
    }

    const prior = latest.get(row.disputeNbr);
    const prevStatus = prior ? prior.status : null;
    const change = !prior ? 'new' : prior.status === row.status ? 'noop' : 'changed';

    matched.push({
      ...rowBrief(row),
      claimId: result.claim.id,
      claimAmount: result.claim.amount,
      matchedBy: result.matchedBy,
      poMismatch: !!result.poMismatch,
      prevStatus,
      change,
    });
  }

  const willWrite = matched.filter((m) => m.change !== 'noop');
  return {
    batchId,
    fileName,
    rowCount: rows.length,
    statusCounts,
    matched,
    unmatched,
    summary: {
      matchedRows: matched.length,
      unmatchedRows: unmatched.length,
      willWrite: willWrite.length,
      noops: matched.length - willWrite.length,
      claimsAffected: new Set(willWrite.map((m) => m.claimId)).size,
      poMismatches: matched.filter((m) => m.poMismatch).length,
    },
  };
}

function rowBrief(row) {
  return {
    rowNumber: row.rowNumber,
    disputeNbr: row.disputeNbr,
    caseNbr: row.caseNbr,
    invoice: row.invoice,
    po: row.po,
    code: row.code,
    status: row.status,
    bucket: row.bucket,
    amount: row.amounts.dispAmount,
    deniedCategory: row.deniedDeductionCategory,
  };
}

/**
 * Turn the preview's writable matches back into full history entries, ready to
 * append. Pairs each preview row with its parsed source row.
 */
function historyEntries(preview, rows, batchId, importedAt) {
  const byDispute = new Map(rows.map((r) => [r.disputeNbr, r]));
  return preview.matched
    .filter((m) => m.change !== 'noop')
    .map((m) => {
      const row = byDispute.get(m.disputeNbr);
      return {
        claimId: m.claimId,
        disputeNbr: row.disputeNbr,
        caseNbr: row.caseNbr,
        claimLineNbr: row.claimLineNbr,
        status: row.status,
        bucket: row.bucket,
        statusDate: row.lastUpdatedDt || row.createdDt || '',
        reasonCode: row.deniedDeductionCode || row.approvedClaimCode || row.code || '',
        reasonCategory: row.deniedDeductionCategory || '',
        denialComment: row.denial.comments || '',
        denialEvidence: row.denial,
        // Present when Walmart approved the dispute across several POs/receipts.
        approvals: row.approvals && row.approvals.length ? row.approvals : undefined,
        amounts: row.amounts,
        invoice: row.invoice,
        po: row.po,
        source: 'apdp_import',
        importBatchId: batchId,
        importedAt,
      };
    });
}

/**
 * Roll a claim's dispute lines up to one claim-level status. Lines under an
 * invoice can disagree (Walmart adjudicates each separately), so a claim whose
 * lines split is reported as 'mixed' rather than picking a winner.
 */
function rollUp(entriesForClaim) {
  const latest = new Map();
  for (const e of entriesForClaim) {
    const prev = latest.get(e.disputeNbr);
    if (!prev || String(e.importedAt) >= String(prev.importedAt)) latest.set(e.disputeNbr, e);
  }
  const lines = [...latest.values()];
  if (!lines.length) return null;

  const buckets = [...new Set(lines.map((l) => l.bucket))];
  const counts = {};
  for (const l of lines) counts[l.bucket] = (counts[l.bucket] || 0) + 1;

  return {
    status: buckets.length === 1 ? buckets[0] : 'mixed',
    lineCount: lines.length,
    counts,
    deniedAmount: round2(lines.filter((l) => l.bucket === 'denied').reduce((s, l) => s + (l.amounts.dispAmount || 0), 0)),
    approvedAmount: round2(
      lines.filter((l) => l.bucket === 'approved').reduce((s, l) => s + (l.amounts.dispAmount || 0), 0)
    ),
    lines,
  };
}

function round2(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}

module.exports = {
  parseApdp,
  buildPreview,
  historyEntries,
  rollUp,
  matchRow,
  statusBucket,
  normCode,
  normInv,
  STATUS_BUCKETS,
};
