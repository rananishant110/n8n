const text = $json.text || "";
const orderNumber = text.match(/Order\s*Number[:\s]*(\d+)/i)?.[1] || '';
const orderDateMatch = text.match(/Order Date[:\s]+(\d{1,2})\/(\d{1,2})\/(\d{4})/i);
const formattedDate = orderDateMatch
  ? `${orderDateMatch[3]}-${orderDateMatch[1].padStart(2,'0')}-${orderDateMatch[2].padStart(2,'0')}`
  : '2026-04-02';

const startMarker = "Item Code Unit Price Amount";
const endMarker = "Net Order:";
const startIdx = text.indexOf(startMarker);
const endIdx = text.indexOf(endMarker);

if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
  return [{ json: { error: "Could not locate line items section", preview: text.slice(0, 500) } }];
}

let section = text.slice(startIdx + startMarker.length, endIdx).trim();
section = section.replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n+/g, "\n").trim();
const lines = section.split("\n").map(l => l.trim()).filter(Boolean);

function toNumber(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseNumbersAndDesc(s) {
  // Find .0000 - marks end of quantity
  const qtyIdx = s.indexOf('.0000');
  if (qtyIdx === -1) return { amount: null, unit_price: null, quantity: null, description: s };

  const desc = s.slice(qtyIdx + 5).trim();
  
  // Number section before description e.g. "156.0052.003.0000" or "371.256.7555.0000"
  // Try every possible way to split into amount, unit_price, qty
  // and use amount = unit_price * qty to find the correct split
  const numSection = s.slice(0, qtyIdx); // e.g. "156.0052.003" or "371.256.7555"
  const clean = numSection.replace(/,/g, "");

  // Generate all candidate splits:
  // We need to find 3 numbers: amount, unit_price, qty (integer)
  // where amount = unit_price * qty
  // Strategy: try every dot position as split between numbers

  // First find all dot positions in clean
  const dots = [];
  for (let i = 0; i < clean.length; i++) {
    if (clean[i] === '.') dots.push(i);
  }

  // Try every combination of two split points
  for (let i = 0; i < dots.length; i++) {
    for (let j = i + 1; j < dots.length; j++) {
      // Split 1: after dot[i] + 2 digits (end of amount)
      const amountEnd = dots[i] + 3; // dot + 2 decimal digits
      if (amountEnd > clean.length) continue;
      
      const amountStr = clean.slice(0, amountEnd);
      const rest = clean.slice(amountEnd);
      
      // Split 2: find unit_price end in rest
      const dotInRest = rest.indexOf('.');
      if (dotInRest === -1) continue;
      
      // Unit price can have 2 decimal digits
      const upEnd = dotInRest + 3;
      if (upEnd > rest.length) continue;
      
      const upStr = rest.slice(0, upEnd);
      const qtyStr = rest.slice(upEnd);
      
      const amount = toNumber(amountStr);
      const unit_price = toNumber(upStr);
      const qty = toNumber(qtyStr);
      
      if (amount === null || unit_price === null || qty === null) continue;
      if (qty <= 0 || unit_price <= 0) continue;
      
      const expected = Math.round(unit_price * qty * 100) / 100;
      if (Math.abs(expected - amount) < 0.02) {
        return { amount, unit_price, quantity: qty, description: desc };
      }
    }
  }

  // Fallback: just take first two XX.XX numbers and remaining as qty
  const fallbackMatch = clean.match(/^([\d,]+\.\d{2})([\d.]+\.\d{2})(\d+)$/);
  if (fallbackMatch) {
    return {
      amount: toNumber(fallbackMatch[1]),
      unit_price: toNumber(fallbackMatch[2]),
      quantity: toNumber(fallbackMatch[3]),
      description: desc
    };
  }

  return { amount: null, unit_price: null, quantity: null, description: desc };
}

const headerStartRe = /^(\d{3,})\s+([A-Z]+)\s+(.+)$/;
const lineItems = [];
let current = null;

for (const l of lines) {
  if (/^Ordered$/i.test(l)) continue;
  const m = l.match(headerStartRe);
  if (m) {
    if (current) {
      current.description = current.description.trim();
      lineItems.push(current);
    }
    const [, item_code, unit, rest] = m;
    const { amount, unit_price, quantity, description } = parseNumbersAndDesc(rest);
    current = { item_code, unit, amount, unit_price, quantity, description, raw_header: l };
  } else if (current) {
    current.description += (current.description ? " " : "") + l;
  }
}
if (current) {
  current.description = current.description.trim();
  lineItems.push(current);
}

const invoiceLines = lineItems.map(item => ({
  type: 0,
  name: item.description,
  unit_cost: { amount: String(item.unit_price ?? 0), code: "USD" },
  qty: String(item.quantity ?? 0)
}));

const payload = JSON.stringify({
  invoice: {
    customerid: "151069",
    create_date: new Date().toISOString().split('T')[0],
    lines: invoiceLines
  }
});

return [{ json: { payload } }];
