const labels = {
  item: "items", items: "items", "item(s)": "items", values: "values", value: "values",
  sender: "sender", s: "sender", receiver: "receiver", r: "receiver", date: "date", d: "date",
};
const fieldPattern = /(?:^|[\s|;])(item\(s\)|items?|values?|sender|receiver|date|[srd])\s*:/gi;

function amount(text) {
  const match = /^\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*([km])?\s*$/i.exec(text);
  if (!match) return null;
  const value = Number(match[1].replaceAll(",", "")) * ({ k: 1e3, m: 1e6 }[match[2]?.toLowerCase()] ?? 1);
  return Number.isSafeInteger(value) ? value : null;
}

function validDate(year, month, day) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() + 1 !== Number(month) ||
      date.getUTCDate() !== Number(day)) return null;
  return date.toISOString().slice(0, 10);
}

export function dateCandidates(text, postedAt) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (iso) return [validDate(...iso.slice(1))].filter(Boolean);
  const numeric = /^(\d{1,2})[/.\-](\d{1,2})(?:[/.\-](\d{2}|\d{4}))?$/.exec(text);
  if (!numeric) return [];
  const [, first, second, writtenYear] = numeric;
  const post = Date.parse(postedAt);
  const postYear = new Date(post).getUTCFullYear();
  const year = writtenYear ? (writtenYear.length === 2 ? 2000 + Number(writtenYear) : Number(writtenYear)) : postYear;
  const options = [[first, second], [second, first]].map(([month, day]) => {
    const date = validDate(year, month, day);
    return !writtenYear && date && Date.parse(date) > post + 86400000 ? validDate(year - 1, month, day) : date;
  });
  return [...new Set(options.filter(Boolean))];
}

const normalize = (name) => name.normalize("NFKC").toLowerCase().replace(/[^a-z0-9]/g, "");

export function nameIndex(items) {
  const index = new Map();
  for (const [kind, rows] of Object.entries(items)) {
    for (const [id, row] of Object.entries(rows)) {
      for (const label of new Set(row.slice(0, 2).map(normalize).filter(Boolean))) {
        const matches = index.get(label) ?? [];
        matches.push({ kind, id });
        index.set(label, matches);
      }
    }
  }
  return index;
}

function basket(text, index) {
  return text.split(/\s*\+\s*|\s*;\s*|,\s+/).filter(Boolean).map((token) => {
    const match = /^(?:(\d+)\s*x\s*)?(.+?)(?:\s+x\s*(\d+))?$/i.exec(token.trim());
    if (!match) return { raw: token, quantity: 1, matches: [] };
    const name = match[2];
    const caption = /^(.*?)\s+\(([^()]+)\)$/.exec(name);
    return { raw: token, quantity: Number(match[1] ?? match[3] ?? 1),
      matches: index.get(normalize(name)) ?? (caption && (index.get(normalize(caption[1])) ?? index.get(normalize(caption[2])))) ?? [] };
  });
}

export function parsePost(post, index) {
  const raw = post.text ?? "";
  const body = raw.replace(/\s*\(edited\)(?:\s+[A-Za-z]+, [^\n]+)?\s*$/i, "");
  const matches = [...body.matchAll(fieldPattern)];
  const fields = Object.fromEntries(matches.map((match, i) => {
    const key = labels[match[1].toLowerCase()];
    const value = body.slice(match.index + match[0].length, matches[i + 1]?.index ?? body.length);
    return [key, value.replace(/\*\*|__/g, "").trim()];
  }));
  const lead = body.slice(0, matches[0]?.index ?? body.length).split("\n").map((line) => line.trim()).filter(Boolean);
  const comparison = /^(\d[\d,.]*\s*[km]?)\s+vs?\.?\s+(\d[\d,.]*\s*[km]?)(?=$|\s|\()/i;
  fields.values ??= lead.find((line) => comparison.test(line));
  if (lead.length && (matches.length || fields.values) && !comparison.test(lead[0])) fields.items ??= lead[0];
  const valueParts = comparison.exec(fields.values ?? "")?.slice(1) ?? [];
  const submitted = valueParts.map(amount);
  const dates = dateCandidates(fields.date ?? "", post.postedAt);
  const issues = [];
  if (fields.date && dates.length !== 1) issues.push("ambiguous-or-unrecognized-date");
  if (fields.values && (submitted.length !== 2 || submitted.some((value) => value == null) ||
      valueParts.some((part) => /^\s*\d{1,3}\s*$/.test(part)))) {
    issues.push("missing-or-unclear-units");
  }
  const baskets = fields.items?.split(/\s+(?:vs?\.?|\/)\s+/i).map((part) => basket(part, index)) ?? [];
  if (baskets.flat().some((item) => item.matches.length !== 1)) issues.push("unresolved-items");
  return {
    raw, fields, submitted: submitted.length === 2 ? submitted : null, dates, baskets, issues,
    moderation: matches.length === 0 && /\b(?:moderation|reminder|rules?|proofs? (?:must|should)|removed|warning)\b/i.test(raw),
  };
}

export function submittedOverpay(parsed, targetSide) {
  if (![0, 1].includes(targetSide) || parsed.issues.includes("missing-or-unclear-units") ||
      !parsed.submitted?.every(Number.isSafeInteger)) return null;
  return parsed.submitted[1 - targetSide] - parsed.submitted[targetSide];
}
