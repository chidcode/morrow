const recentByEmail = new Map();

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

module.exports = async function sendConfirmation(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Use POST to request a demo confirmation.' });
  }

  const allowedOrigins = new Set([
    'https://morrow-4wdh.vercel.app',
    'http://localhost:4173'
  ]);
  if (process.env.MORROW_SITE_URL) allowedOrigins.add(process.env.MORROW_SITE_URL.replace(/\/$/, ''));
  if (!req.headers.origin || !allowedOrigins.has(req.headers.origin.replace(/\/$/, ''))) {
    return res.status(403).json({ error: 'This request did not come from the Morrow storefront.' });
  }

  const body = req.body || {};
  if (body.website) return res.status(200).json({ ok: true });
  const email = String(body.email || '').trim().toLowerCase();
  const order = String(body.order || '').trim();
  const firstName = String(body.firstName || 'skin friend').trim().slice(0, 80);
  const items = Array.isArray(body.items) ? body.items.slice(0, 20) : [];
  const totalCents = Number(body.totalCents);

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254 ||
      !/^MRW-\d{6}$/.test(order) || !items.length ||
      !Number.isInteger(totalCents) || totalCents < 0) {
    return res.status(400).json({ error: 'Please check the contact email and order details.' });
  }

  const normalizedItems = [];
  for (const item of items) {
    const name = String(item.name || '').trim().slice(0, 120);
    const quantity = Number(item.quantity);
    const unitPriceCents = Number(item.unitPriceCents);
    if (!name || !Number.isInteger(quantity) || quantity < 1 || quantity > 99 ||
        !Number.isInteger(unitPriceCents) || unitPriceCents < 0) {
      return res.status(400).json({ error: 'One of the order items is invalid.' });
    }
    normalizedItems.push({ name, quantity, unitPriceCents });
  }

  const now = Date.now();
  const lastSent = recentByEmail.get(email) || 0;
  if (now - lastSent < 30000) {
    return res.status(429).json({ error: 'Please wait a moment before requesting another email.' });
  }

  const apiKey = process.env.MAILGUN_API_KEY;
  const domain = process.env.MAILGUN_DOMAIN;
  const from = process.env.MAILGUN_FROM;
  if (!apiKey || !domain || !from) {
    return res.status(503).json({ error: 'Mailgun is not configured on this deployment yet.' });
  }

  const rowsText = normalizedItems.map((item) =>
    item.quantity + ' × ' + item.name + ' — $' + (item.unitPriceCents * item.quantity / 100).toFixed(2)
  ).join('\n');
  const rowsHtml = normalizedItems.map((item) =>
    '<tr><td style="padding:10px 0;border-bottom:1px solid #e9e5dc">' +
    escapeHtml(item.quantity + ' × ' + item.name) +
    '</td><td style="padding:10px 0;border-bottom:1px solid #e9e5dc;text-align:right">$' +
    (item.unitPriceCents * item.quantity / 100).toFixed(2) + '</td></tr>'
  ).join('');
  const total = '$' + (totalCents / 100).toFixed(2);
  const text = 'Hi ' + firstName + ',\n\nThanks for placing demo order ' + order +
    ' with morrow.\n\n' + rowsText + '\n\nDemo total: ' + total +
    '\n\nThis is a demo confirmation only. No payment was taken and nothing will be shipped.';
  const html = '<div style="margin:0 auto;max-width:600px;padding:32px 24px;background:#f8f5ec;color:#202a47;font-family:Arial,sans-serif">' +
    '<p style="font-size:13px;letter-spacing:3px;text-transform:lowercase">morrow®</p>' +
    '<p style="font-size:12px;letter-spacing:2px;text-transform:uppercase">A little note from your skincare club</p>' +
    '<h1 style="font-size:34px">Thanks, ' + escapeHtml(firstName) + '.</h1>' +
    '<p>Your demo order <strong>' + escapeHtml(order) + '</strong> is noted.</p>' +
    '<table style="width:100%;border-collapse:collapse">' + rowsHtml + '</table>' +
    '<p style="text-align:right;font-size:18px"><strong>Demo total ' + total + '</strong></p>' +
    '<div style="margin-top:28px;padding:16px;background:#f4e747;border-radius:12px;font-size:13px;line-height:1.5">' +
    'This is a demo confirmation only. No payment was taken and nothing will be shipped.</div></div>';

  try {
    const form = new FormData();
    form.set('from', from);
    form.set('to', email);
    form.set('subject', 'Morrow demo order ' + order + ' — your confirmation');
    form.set('text', text);
    form.set('html', html);
    const base = process.env.MAILGUN_REGION === 'eu'
      ? 'https://api.eu.mailgun.net'
      : 'https://api.mailgun.net';
    const response = await fetch(base + '/v3/' + encodeURIComponent(domain) + '/messages', {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from('api:' + apiKey).toString('base64') },
      body: form
    });
    if (!response.ok) {
      console.error('Mailgun send failed with status', response.status);
      return res.status(502).json({ error: 'Mailgun could not send the email. Please try again later.' });
    }
    recentByEmail.set(email, now);
    return res.status(200).json({ ok: true });
  } catch (error) {
    console.error('Mailgun request failed:', error && error.message);
    return res.status(502).json({ error: 'The email service could not be reached. Please try again later.' });
  }
};
