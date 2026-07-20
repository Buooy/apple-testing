import https from "node:https";
import { config } from "./config.js";

/**
 * Apple's merchant validation gateways.
 *   apple-pay-gateway.apple.com            production
 *   apple-pay-gateway-cert.apple.com       sandbox
 * plus regional variants (apple-pay-gateway-nc-pod1.apple.com, ...).
 *
 * The validationURL arrives from the *client*, so it is attacker-controllable.
 * Never present the merchant cert to a host we haven't allow-listed.
 */
const GATEWAY_HOST = /^apple-pay-gateway(-[a-z0-9-]+)?\.apple\.com$/;

export class ValidationError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export interface ValidationResult {
  session: unknown;
  latencyMs: number;
  gatewayHost: string;
}

export async function validateMerchant(validationURL: string): Promise<ValidationResult> {
  let url: URL;
  try {
    url = new URL(validationURL);
  } catch {
    throw new ValidationError("validationURL is not a valid URL", 400);
  }

  if (url.protocol !== "https:" || !GATEWAY_HOST.test(url.hostname)) {
    throw new ValidationError(`Refusing to contact non-Apple host: ${url.hostname}`, 400);
  }

  if (!config.hasCerts) {
    throw new ValidationError(
      "Merchant Identity Certificate not configured on the server " +
        "(set MERCHANT_ID_CERT_B64 / MERCHANT_ID_KEY_B64, or drop PEMs in certs/)",
      503,
    );
  }

  // initiativeContext MUST be the iframe's own hostname — the verified payment
  // domain — never the parent page's. This is the whole mechanism: Apple checks
  // the domain association for THIS value, and the parent is unverified.
  const payload = JSON.stringify({
    merchantIdentifier: config.merchantId,
    displayName: config.displayName,
    initiative: "web",
    initiativeContext: config.paymentDomain,
  });

  const started = Date.now();

  const { status, body } = await new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = https.request(
      {
        host: url.hostname,
        port: 443,
        path: url.pathname + url.search,
        method: "POST",
        cert: config.merchantCert!,
        key: config.merchantKey!,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 15_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () =>
          resolve({
            status: res.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8"),
          }),
        );
      },
    );

    req.on("timeout", () => req.destroy(new Error("Apple gateway timed out after 15s")));
    req.on("error", reject);
    req.end(payload);
  });

  const latencyMs = Date.now() - started;

  if (status !== 200) {
    // Apple's error bodies are the single most useful debugging artifact here.
    console.error(`[validate] gateway ${url.hostname} → ${status} in ${latencyMs}ms :: ${body}`);
    throw new ValidationError(`Apple gateway returned ${status}: ${body.slice(0, 500)}`, 502);
  }

  let session: unknown;
  try {
    session = JSON.parse(body);
  } catch {
    throw new ValidationError("Apple gateway returned non-JSON on 200", 502);
  }

  return { session, latencyMs, gatewayHost: url.hostname };
}
