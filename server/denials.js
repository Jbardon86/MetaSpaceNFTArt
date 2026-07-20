'use strict';

// Stage 6 — denial follow-up.
//
// The APDP import (stage 5) records Walmart's ruling per dispute line, kept
// separate from our own claim.status. This module reads those denials for the
// claims WE track, works out why each was denied and whether it's recoverable,
// drafts an appeal, and produces the follow-up worklist. The re-file action
// itself lives in a route (it moves claim.status back to 'ready'); this module
// is the read-only "what should we do about each denial" brain.
//
// Scope: denials of disputes we filed and track. Walmart's ~94% denial pile is
// overwhelmingly STAT's filings on invoices we never recorded — those aren't
// claims here, so they don't appear. Pursuing them would mean adopting them as
// claims first (a separate "denial mining" step, deliberately not done here).

function round2(n) {
  return Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;
}
function money(n) {
  return `$${round2(n).toFixed(2)}`;
}

/**
 * Why was this dispute line denied? Buckets drive whether it's worth re-filing.
 * A shortage denial almost always means "prove you delivered it" — so unless the
 * reason is clearly a dead end, we default to the recoverable "proof" path.
 */
function categorize(line) {
  const text = `${(line && line.denialComment) || ''} ${(line && line.reasonCategory) || ''}`.toLowerCase();
  if (/duplicate|already\s*(paid|disputed|submitted|processed)/.test(text)) return 'duplicate';
  if (/expired|deadline|past\s*due|too\s*late|\bwindow\b|time\s*limit|no\s*longer\s*eligible/.test(text)) return 'expired';
  if (/valid|as\s*documented|no\s*discrepancy|justified|substantiated|upheld/.test(text)) return 'upheld';
  return 'proof';
}

/** The suggested next step for a denied line. */
function action(category, hasPod) {
  if (category === 'proof') return hasPod ? 're-file' : 'attach-pod';
  if (category === 'duplicate') return 'duplicate';
  if (category === 'expired') return 'expired';
  if (category === 'upheld') return 'upheld';
  return 'review';
}

const RECOVERABLE = new Set(['re-file', 'attach-pod']);

/** A short appeal note the user can paste when re-submitting. */
function draftAppeal(claim, line) {
  const amt = money((line.amounts && line.amounts.dispAmount) || claim.amount);
  const ev = line.denialEvidence || {};
  const cited = line.denialComment
    ? `Walmart's denial stated: "${String(line.denialComment).trim()}".`
    : ev.rcvDate
    ? `Walmart's denial references a receipt dated ${ev.rcvDate}${ev.proNbr ? ` (PRO ${ev.proNbr})` : ''}.`
    : `Walmart denied without citing a documented receipt discrepancy.`;
  return (
    `Appeal of dispute ${line.disputeNbr} — ${amt} shortage on invoice ${claim.invoice} (code ${claim.code}). ` +
    `${cited} We are re-submitting with our signed proof of delivery confirming the full quantity billed was ` +
    `shipped and received. Request: reverse the deduction and issue the credit.`
  );
}

/**
 * Build the denial follow-up worklist from our tracked claims and their APDP
 * status history.
 * @param claims          store.getClaims().claims
 * @param historyByClaim  Map(claimId -> history entries)  [store.statusHistoryByClaim()]
 * @param rollUp          apdp.rollUp
 */
function buildWorklist(claims, historyByClaim, rollUp) {
  const items = [];
  for (const claim of claims) {
    const entries = historyByClaim.get(claim.id) || [];
    if (!entries.length) continue;
    const rolled = rollUp(entries);
    if (!rolled) continue;
    const deniedLines = rolled.lines.filter((l) => l.bucket === 'denied');
    if (!deniedLines.length) continue;

    const hasPod = !!(claim.docs && claim.docs.pod && claim.docs.pod.have);
    for (const line of deniedLines) {
      const category = categorize(line);
      const act = action(category, hasPod);
      items.push({
        claimId: claim.id,
        invoice: claim.invoice,
        code: claim.code,
        amount: round2((line.amounts && line.amounts.dispAmount) || claim.amount),
        disputeNbr: line.disputeNbr,
        denialComment: line.denialComment || '',
        deniedCategory: line.reasonCategory || '',
        evidence: line.denialEvidence || {},
        category,
        action: act,
        recoverable: RECOVERABLE.has(act),
        hasPod,
        refileCount: claim.refileCount || 0,
        claimStatus: claim.status,
        appeal: draftAppeal(claim, line),
      });
    }
  }

  // Sort: actionable first (re-file, then attach-pod), then the rest.
  const order = { 're-file': 0, 'attach-pod': 1, review: 2, duplicate: 3, expired: 4, upheld: 5 };
  items.sort((a, b) => (order[a.action] ?? 9) - (order[b.action] ?? 9) || b.amount - a.amount);

  const recoverable = items.filter((i) => i.recoverable);
  return {
    items,
    totals: {
      count: items.length,
      recoverableCount: recoverable.length,
      recoverableAmount: round2(recoverable.reduce((s, i) => s + i.amount, 0)),
      readyToRefile: items.filter((i) => i.action === 're-file').length,
      needPod: items.filter((i) => i.action === 'attach-pod').length,
    },
  };
}

module.exports = { buildWorklist, categorize, action, draftAppeal };
