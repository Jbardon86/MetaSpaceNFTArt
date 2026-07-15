// Endless Fun Orders — backend
//
// Responsibilities:
//   1. Send the customer an order confirmation from order@endlessfun.biz
//   2. (Phase 2) Create the order in Salesforce
//
// This is a starting point. To go live you need to:
//   - set the environment variables in .env (see .env.example)
//   - host this somewhere (Render, Railway, Fly.io, a small VM, etc.)
//   - point the app's RestSalesforceAdapter BACKEND_URL at it
//
// Microsoft 365 note: order@endlessfun.biz must have SMTP AUTH enabled, or use
// an app password. If your tenant blocks SMTP basic auth, switch to Microsoft
// Graph sendMail (see README).

const express = require('express');
const nodemailer = require('nodemailer');
const sos = require('./sos');

const app = express();
app.use(express.json({ limit: '5mb' }));

const {
  PORT = 8787,
  SMTP_HOST = 'smtp.office365.com',
  SMTP_PORT = 587,
  SMTP_USER = 'order@endlessfun.biz',
  SMTP_PASS = '',
  MAIL_FROM = 'Endless Fun <order@endlessfun.biz>',
} = process.env;

const transporter = nodemailer.createTransport({
  host: SMTP_HOST,
  port: Number(SMTP_PORT),
  secure: false, // 587 uses STARTTLS
  auth: SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
});

// --- Confirmation email content (kept in sync with the app's template) ---
function money(n) {
  return `$${Number(n).toFixed(2)}`;
}
function formatShipTo(a) {
  if (!a || !(a.street || a.city || a.zip)) return '';
  const line2 = [a.city, a.state].filter(Boolean).join(', ');
  const addr = [a.street, [line2, a.zip].filter(Boolean).join(' ')].filter(Boolean).join('<br>');
  return `<p style="font-weight:700;margin:0 0 4px">Ship to</p><p style="margin:0 0 16px">${addr}</p>`;
}
function buildConfirmationEmail(order) {
  const total = order.lines.reduce((s, l) => s + l.lineTotal, 0);
  const firstName = (order.contact?.name || 'there').split(' ')[0];
  const shortId = (order.id || '').slice(-6).toUpperCase();
  const rows = order.lines
    .map(
      (l) =>
        `<tr><td style="padding:8px 0">${l.quantity} × ${l.name}</td>` +
        `<td style="padding:8px 0;text-align:right">${money(l.lineTotal)}</td></tr>`
    )
    .join('');
  const html = `
    <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px">
      <h1 style="color:#0091D5;font-size:22px;margin:0 0 4px">Endless Fun</h1>
      <p style="color:#8E8E93;margin:0 0 16px">Order confirmation · #${shortId}</p>
      <p>Hi ${firstName}, thanks for your order! Here's your confirmation.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">${rows}
        <tr><td style="padding:12px 0 0;border-top:1px solid #E5E5EA;font-weight:700">Total</td>
        <td style="padding:12px 0 0;border-top:1px solid #E5E5EA;text-align:right;font-weight:700">${money(total)}</td></tr>
      </table>
      ${formatShipTo(order.shippingAddress)}
      <p>A team member will follow up to finalize the details.</p>
    </div>`;
  return {
    from: MAIL_FROM,
    to: order.contact.email,
    subject: `Your Endless Fun order confirmation (#${shortId})`,
    html,
  };
}

app.get('/health', (_req, res) => res.json({ ok: true }));

// The app fetches the shared product catalog from SOS Inventory here.
app.get('/api/catalog', async (req, res) => {
  if (!process.env.SOS_REFRESH_TOKEN) {
    return res.status(503).json({
      error: 'SOS not configured yet. Set SOS_* env vars (see README).',
      items: [],
    });
  }
  try {
    const items = await sos.getCatalog({ force: req.query.force === '1' });
    res.json({ items });
  } catch (err) {
    console.error('Catalog fetch failed:', err);
    res.status(502).json({ error: String(err && err.message ? err.message : err), items: [] });
  }
});

// The app POSTs an order here (payload shape from restAdapter.toSalesforceOrderPayload).
app.post('/api/orders', async (req, res) => {
  const order = req.body;
  try {
    // 1) Send the confirmation email (if requested + we have an address)
    if (order.emailConfirmation && order.contact?.email) {
      await transporter.sendMail(buildConfirmationEmail(order));
    }

    // 2) TODO (Phase 2): create the order in Salesforce with jsforce and return
    //    the real Salesforce Order Id here.
    const salesforceId = 'TODO-salesforce-id';

    res.json({ salesforceId });
  } catch (err) {
    console.error('Order handling failed:', err);
    res.status(500).json({ error: String(err && err.message ? err.message : err) });
  }
});

app.listen(PORT, () => console.log(`Endless Fun backend listening on :${PORT}`));
