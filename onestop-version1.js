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
  return [{
    json: {
      error: "Could not locate line items section",
      preview: text.slice(0, 500),
    }
  }];
}

let section = text.slice(startIdx + startMarker.length, endIdx).trim();
section = section
  .replace(/\r/g, "")
  .replace(/[ \t]+/g, " ")
  .replace(/\n+/g, "\n")
  .trim();

const lines = section.split("\n").map(l => l.trim()).filter(Boolean);

function toNumber(s) {
  if (s == null) return null;
  const n = Number(String(s).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function parseNumbersAndDesc(s) {
  let numStr = "";
  let descStr = "";

  for (let i = 0; i < s.length; i++) {
    if (/[a-zA-Z(]/.test(s[i])) {
      descStr = s.slice(i).trim();
      break;
    }
    numStr += s[i];
  }

  const numbers = [];
  let rem = numStr.trim();
  const numRe = /^([\d,]*\d\.\d{2})/;

  while (rem.length > 0) {
    const m = rem.match(numRe);
    if (!m) break;
    numbers.push(m[1]);
    rem = rem.slice(m[0].length);
  }

  return { numbers, description: descStr };
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
    const { numbers, description } = parseNumbersAndDesc(rest);

    current = {
      item_code,
      unit,
      amount:      toNumber(numbers[0] ?? null),
      unit_price:  toNumber(numbers[1] ?? null),
      quantity:    toNumber(numbers[2] ?? null),
      description: description,
      raw_header:  l,
    };

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
  unit_cost: {
    amount: String(item.unit_price),
    code: "USD"
  },
  qty: String(item.quantity)
}));

const payload = JSON.stringify({
  invoice: {
    customerid: "1921089",
    create_date: new Date().toISOString().split('T')[0],
    lines: invoiceLines
  }
});

return [{ json: { payload } }];
