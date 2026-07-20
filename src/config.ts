import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Minimal .env support so local runs need no extra flags. Real environments
// (Railway) set process.env directly, which always wins over the file.
const envFile = path.join(ROOT, ".env");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].trim().replace(/^["'](.*)["']$/, "$1");
    }
  }
}

function env(key: string, fallback?: string): string {
  const v = process.env[key]?.trim();
  if (v) return v;
  if (fallback !== undefined) return fallback;
  throw new Error(`Missing required env var: ${key}`);
}

/**
 * Merchant Identity Certificate (NOT the Payment Processing cert).
 *
 * Two sources, in order:
 *   1. MERCHANT_ID_CERT_B64 / MERCHANT_ID_KEY_B64  — base64 PEM, used on Railway
 *   2. certs/merchant_id_{cert,key}.pem            — files, used locally
 *
 * Missing certs are non-fatal: the checkout page still loads and the log pane
 * reports the failure, which is more useful than a boot crash while iterating.
 */
function loadPem(b64Key: string, file: string): string | null {
  const b64 = process.env[b64Key]?.trim();
  if (b64) return Buffer.from(b64, "base64").toString("utf8");

  const p = path.join(ROOT, "certs", file);
  if (fs.existsSync(p)) return fs.readFileSync(p, "utf8");

  return null;
}

const merchantCert = loadPem("MERCHANT_ID_CERT_B64", "merchant_id_cert.pem");
const merchantKey = loadPem("MERCHANT_ID_KEY_B64", "merchant_id_key.pem");

export const config = {
  merchantId: env("APPLE_MERCHANT_ID", "merchant.0xbuooy.testing"),
  displayName: env("APPLE_DISPLAY_NAME", "Iframe Harness Test"),

  /** The Apple-verified domain. Doubles as the Host-header routing key. */
  paymentDomain: env("PAYMENT_DOMAIN", "pay.buooy.com"),

  countryCode: env("COUNTRY_CODE", "SG"),
  currencyCode: env("CURRENCY_CODE", "SGD"),
  totalLabel: env("TOTAL_LABEL", "Iframe Harness"),
  totalAmount: env("TOTAL_AMOUNT", "1.00"),

  port: Number(env("PORT", "3000")),

  merchantCert,
  merchantKey,
  get hasCerts() {
    return Boolean(merchantCert && merchantKey);
  },
} as const;

export function describeConfig(): string {
  return [
    `  merchantId     ${config.merchantId}`,
    `  paymentDomain  ${config.paymentDomain}`,
    `  currency       ${config.totalAmount} ${config.currencyCode} (${config.countryCode})`,
    `  merchant certs ${config.hasCerts ? "loaded" : "MISSING — /validate-merchant will 503"}`,
  ].join("\n");
}
