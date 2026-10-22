const ONES = [
  "Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
const SCALES = ["", "Thousand", "Million", "Billion"];

/** 1–999 in words. */
function underThousand(n: number): string {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds) words.push(ONES[hundreds], "Hundred");
  if (rest >= 20) {
    words.push(TENS[Math.floor(rest / 10)]);
    if (rest % 10) words.push(ONES[rest % 10]);
  } else if (rest > 0) {
    words.push(ONES[rest]);
  }
  return words.join(" ");
}

function integerWords(n: number): string {
  if (n === 0) return "Zero";
  const parts: string[] = [];
  for (let scale = 0; n > 0; scale++, n = Math.floor(n / 1000)) {
    const chunk = n % 1000;
    if (chunk) parts.unshift([underThousand(chunk), SCALES[scale]].filter(Boolean).join(" "));
  }
  return parts.join(" ");
}

/**
 * "1250.50" → "Rupees One Thousand Two Hundred Fifty and Cents Fifty Only".
 * International grouping (thousand, million), not lakh. Works on the decimal string.
 */
export function amountInWords(amount: string): string {
  const [rupees, cents = "0"] = amount.trim().replace(/^-/, "").split(".");
  const r = Number(rupees);
  const c = Number(cents.padEnd(2, "0").slice(0, 2));
  return `Rupees ${integerWords(r)}${c ? ` and Cents ${integerWords(c)}` : ""} Only`;
}
