/**
 * Preflight. Reports what is configured and, for anything missing, the exact
 * next action. This is the boundary between what the code can do and what has
 * to happen in the Apple Developer portal.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const problems: string[] = [];

const ok = (m: string) => console.log(`  ok    ${m}`);
const bad = (m: string, fix: string) => {
  console.log(`  MISS  ${m}`);
  problems.push(`${m}\n        → ${fix}`);
};

console.log("\nApple Pay iframe harness — preflight\n");

// ── node ────────────────────────────────────────────────────────────────────
const major = Number(process.versions.node.split(".")[0]);
major >= 20
  ? ok(`node ${process.versions.node}`)
  : bad(`node ${process.versions.node} is too old`, "install Node 20 or newer");

// ── env ─────────────────────────────────────────────────────────────────────
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  ok(".env present");
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
} else {
  bad(".env missing", "cp .env.example .env  (defaults are already correct for pay.buooy.com)");
}

const paymentDomain = process.env.PAYMENT_DOMAIN?.trim() || "pay.buooy.com";
ok(`payment domain ${paymentDomain}`);

// ── merchant identity certificate ───────────────────────────────────────────
const certPath = path.join(ROOT, "certs", "merchant_id_cert.pem");
const keyPath = path.join(ROOT, "certs", "merchant_id_key.pem");
const hasB64 = Boolean(process.env.MERCHANT_ID_CERT_B64 && process.env.MERCHANT_ID_KEY_B64);
const hasFiles = fs.existsSync(certPath) && fs.existsSync(keyPath);

const KEYCHAIN_EXPORT =
  "the private key is in your login keychain (from the CSR), but the PEM isn't on disk:\n" +
  "          1. open certs/merchant_id.cer to import it into Keychain Access\n" +
  "          2. Keychain Access → My Certificates → 'Apple Pay Merchant Identity: ...'\n" +
  "             → expand it, select BOTH rows → right-click → Export 2 items → .p12\n" +
  "          3. MERCHANT_P12_PATH=~/Downloads/Certificates.p12 npm run certs";

if (hasB64) {
  ok("merchant identity cert from env (base64)");
} else if (fs.existsSync(certPath) && !fs.existsSync(keyPath)) {
  bad("merchant identity cert present, but no private key", KEYCHAIN_EXPORT);
} else if (hasFiles) {
  try {
    const subject = execFileSync(
      "openssl",
      ["x509", "-in", certPath, "-noout", "-subject"],
      { encoding: "utf8" },
    ).trim();
    if (subject.includes("Payment Processing")) {
      bad(
        "certs/ holds a Payment Processing cert, not Merchant Identity",
        "in the Apple portal open Merchant ID → Merchant Identity Certificate → " +
          "create one, then: MERCHANT_P12_PATH=... npm run certs",
      );
    } else {
      ok(`merchant identity cert from certs/  (${subject.split("/CN=")[1] ?? subject})`);
    }
  } catch {
    bad("certs/merchant_id_cert.pem is unreadable", "regenerate with npm run certs");
  }
} else {
  bad(
    "no merchant identity certificate",
    "Apple portal → Merchant ID → Merchant Identity Certificate → export .p12, then\n" +
      "          MERCHANT_P12_PATH=~/Downloads/merchant_id.p12 npm run certs",
  );
}

// ── domain association file ─────────────────────────────────────────────────
const assoc = path.join(ROOT, "well-known", "apple-developer-merchantid-domain-association");
if (fs.existsSync(assoc) && fs.statSync(assoc).size > 100) {
  ok(`domain association file (${fs.statSync(assoc).size} bytes)`);
} else {
  bad(
    "domain association file missing",
    `Apple portal → Merchant ID → Merchant Domains → add ${paymentDomain} → download,\n` +
      "          save it to well-known/apple-developer-merchantid-domain-association",
  );
}

// ── deps ────────────────────────────────────────────────────────────────────
fs.existsSync(path.join(ROOT, "node_modules"))
  ? ok("dependencies installed")
  : bad("node_modules missing", "npm install");

// ── report ──────────────────────────────────────────────────────────────────
if (problems.length === 0) {
  console.log("\nAll preflight checks passed.\n");
  console.log("Next: npm start, then deploy and verify the domain with Apple.\n");
  process.exit(0);
}

console.log(`\n${problems.length} item(s) need attention:\n`);
problems.forEach((p, i) => console.log(`  ${i + 1}. ${p}\n`));
process.exit(1);
