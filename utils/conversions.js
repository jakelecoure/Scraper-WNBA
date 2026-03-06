/**
 * Convert Basketball Reference formats to DB-ready values.
 * All functions return null on invalid input so database inserts never fail.
 */

/**
 * Height: "6-7" (feet-inches) -> centimeters.
 */
export function heightToCm(heightStr) {
  if (!heightStr || typeof heightStr !== 'string') return null;
  const trimmed = heightStr.trim();
  const match = trimmed.match(/^(\d+)-(\d+)$/);
  if (!match) {
    const cmMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*cm$/i);
    if (cmMatch) return parseFloat(cmMatch[1]);
    return null;
  }
  const feet = parseInt(match[1], 10);
  const inches = parseInt(match[2], 10);
  return Math.round((feet * 30.48 + inches * 2.54) * 100) / 100;
}

/**
 * Weight: pounds -> kilograms. Accepts "250lb", "250 lb", or "113kg".
 */
export function weightToKg(weightStr) {
  if (!weightStr || typeof weightStr !== 'string') return null;
  const trimmed = weightStr.trim();
  const lbMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*lb$/i);
  if (lbMatch) {
    const lbs = parseFloat(lbMatch[1]);
    return Math.round((lbs * 0.453592) * 100) / 100;
  }
  const kgMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*kg$/i);
  if (kgMatch) return parseFloat(kgMatch[1]);
  return null;
}

/**
 * Birth date: "December 30, 1984" or "1984-12-30" -> PostgreSQL date string (YYYY-MM-DD).
 */
export function parseBirthDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const trimmed = dateStr.trim();
  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
  }
  const months = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
  };
  const match = trimmed.match(/(\w+)\s+(\d{1,2}),?\s+(\d{4})/i);
  if (match) {
    const month = months[match[1].toLowerCase()];
    const day = parseInt(match[2], 10);
    const year = parseInt(match[3], 10);
    if (month && day >= 1 && day <= 31 && year >= 1900) {
      const d = new Date(year, month - 1, day);
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

/**
 * Parse percentage string ".417" or "41.7%" -> 0.417 or null
 */
export function parsePct(str) {
  if (str === undefined || str === null || str === '') return null;
  const s = String(str).trim().replace(/%$/, '');
  const n = parseFloat(s);
  if (Number.isNaN(n)) return null;
  if (n > 1 && n <= 100) return Math.round(n / 100 * 10000) / 10000;
  return Math.round(n * 10000) / 10000;
}

/**
 * Parse numeric string to number or null
 */
export function parseNum(str) {
  if (str === undefined || str === null || str === '') return null;
  const n = parseFloat(String(str).trim().replace(/,/g, ''));
  return Number.isNaN(n) ? null : n;
}

export default {
  heightToCm,
  weightToKg,
  parseBirthDate,
  parsePct,
  parseNum,
};
