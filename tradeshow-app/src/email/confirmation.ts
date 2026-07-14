import { brand } from '../brand';
import { formatMoney, lineTotal, Order, orderTotal } from '../types';

// Builds the customer order-confirmation email. Shared so the app can preview
// it and the backend can send the exact same content from order@endlessfun.biz.

export const CONFIRMATION_FROM = 'order@endlessfun.biz';

export interface EmailMessage {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export function buildConfirmationEmail(order: Order): EmailMessage {
  const total = orderTotal(order.lines);
  const firstName = order.customer.name?.split(' ')[0] || 'there';
  const shortId = order.id.slice(-6).toUpperCase();

  const lineText = order.lines
    .map((l) => `  • ${l.quantity} × ${l.name} — ${formatMoney(lineTotal(l))}`)
    .join('\n');

  const text = [
    `Hi ${firstName},`,
    ``,
    `Thanks for your order with ${brand.companyName}! Here's your confirmation.`,
    ``,
    `Order #${shortId}`,
    lineText,
    ``,
    `Total: ${formatMoney(total)}`,
    order.notes ? `\nNotes: ${order.notes}` : ``,
    ``,
    `A team member will follow up to finalize the details.`,
    ``,
    `— ${brand.companyName}`,
  ].join('\n');

  const rows = order.lines
    .map(
      (l) => `
      <tr>
        <td style="padding:8px 0;color:#1C1C1E;">${l.quantity} × ${escapeHtml(l.name)}</td>
        <td style="padding:8px 0;text-align:right;color:#1C1C1E;">${formatMoney(lineTotal(l))}</td>
      </tr>`
    )
    .join('');

  const html = `
  <div style="font-family:-apple-system,Segoe UI,Roboto,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#1C1C1E;">
    <h1 style="color:${brand.brandColor};font-size:22px;margin:0 0 4px;">${brand.companyName}</h1>
    <p style="margin:0 0 16px;color:#8E8E93;">Order confirmation · #${shortId}</p>
    <p>Hi ${escapeHtml(firstName)}, thanks for your order! Here's your confirmation.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;">
      ${rows}
      <tr>
        <td style="padding:12px 0 0;border-top:1px solid #E5E5EA;font-weight:700;">Total</td>
        <td style="padding:12px 0 0;border-top:1px solid #E5E5EA;text-align:right;font-weight:700;">${formatMoney(total)}</td>
      </tr>
    </table>
    ${order.notes ? `<p style="color:#8E8E93;">Notes: ${escapeHtml(order.notes)}</p>` : ''}
    <p>A team member will follow up to finalize the details.</p>
    <p style="color:#8E8E93;font-size:13px;margin-top:24px;">Sent by ${brand.companyName} · ${CONFIRMATION_FROM}</p>
  </div>`;

  return {
    from: CONFIRMATION_FROM,
    to: order.customer.email,
    subject: `Your ${brand.companyName} order confirmation (#${shortId})`,
    text,
    html,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
