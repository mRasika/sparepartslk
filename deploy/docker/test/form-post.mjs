// Fills in one of the app's forms like a browser without JavaScript, for the Docker stack test
// (stack-test.sh): reads the page, keeps the hidden fields React adds so the form works without
// JavaScript, adds the given boxes and posts it. Exits 0 when the app answered with a redirect to
// <expected path> AND gave a login cookie; 1 otherwise, printing what happened.
//
// Usage: node form-post.mjs <page url> <expected redirect path> name=value [name=value …]
//   e.g. node form-post.mjs http://127.0.0.1:3100/setup /dashboard setupKey=… businessName=…
const [pageUrl, expected, ...pairs] = process.argv.slice(2);
if (!expected) {
  console.error("Usage: node form-post.mjs <page url> <expected redirect path> name=value …");
  process.exit(1);
}

const unescape = (s) =>
  s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const page = await fetch(pageUrl, { redirect: "manual" });
const html = await page.text();
const form = html.match(/<form[\s\S]*?<\/form>/)?.[0];
if (page.status !== 200 || !form) {
  console.log(`The form is not there (status ${page.status} ${page.headers.get("location") ?? ""}).`);
  process.exit(1);
}

const body = new FormData();
for (const m of form.matchAll(/<input[^>]*type="hidden"[^>]*>/g)) {
  const name = m[0].match(/name="([^"]*)"/)?.[1];
  const value = m[0].match(/value="([^"]*)"/)?.[1] ?? "";
  if (name?.startsWith("$ACTION")) body.append(unescape(name), unescape(value));
}
for (const pair of pairs) {
  const at = pair.indexOf("=");
  body.append(pair.slice(0, at), pair.slice(at + 1));
}

const origin = new URL(pageUrl).origin;
const sent = await fetch(pageUrl, { method: "POST", body, headers: { origin }, redirect: "manual" });
const location = sent.headers.get("location") ?? "";
const cookies = sent.headers.getSetCookie?.() ?? [];
const gotCookie = cookies.some((c) => /session_token=[^;]+/.test(c));
if (sent.status === 303 && location.endsWith(expected) && gotCookie) {
  console.log(`OK: sent on to ${location}, login cookie given.`);
  process.exit(0);
}
const text = unescape(await sent.text());
const said = text.match(/(Setup is locked|already set up|key is not right|Enter [a-z ]+|don't match|incorrect|Too many)[^<"\\]*/g);
console.log(
  `Not OK: status ${sent.status}, redirect "${location}", cookie ${gotCookie ? "yes" : "no"}: ${
    said ? [...new Set(said)].join(" | ") : "no message"
  }`,
);
process.exit(1);
