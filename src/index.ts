import express from "express";
import fs from "node:fs";
import path from "node:path";
import { config, describeConfig, ROOT } from "./config.js";
import { validateMerchant, ValidationError } from "./validate.js";

const app = express();
app.use(express.json({ limit: "16kb" }));

// Railway terminates TLS at the edge; without this req.protocol is always http.
app.set("trust proxy", true);

const page = (name: string, vars: Record<string, string> = {}) => {
  const html = fs.readFileSync(path.join(ROOT, "src", name), "utf8");
  return html.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? "");
};

const PAYMENT_ORIGIN = `https://${config.paymentDomain}`;

/* ────────────────────────────── payment origin ─────────────────────────────
 * Everything below is meant to be reached at https://pay.buooy.com — the
 * Apple-verified domain. These are the routes that must never carry
 * X-Frame-Options, and whose frame-ancestors must permit the parent.
 * ───────────────────────────────────────────────────────────────────────── */

/**
 * The domain association file proving to Apple that we control this host.
 * Must return 200 with the exact bytes, no redirect. Apple fetches it over the
 * public internet at verification time and periodically after.
 */
app.get("/.well-known/apple-developer-merchantid-domain-association", (_req, res) => {
  const file = path.join(ROOT, "well-known", "apple-developer-merchantid-domain-association");
  if (!fs.existsSync(file)) {
    console.warn("[well-known] association file missing — Apple verification will fail");
    return res.status(404).type("text/plain").send("association file not present on server");
  }
  res.type("text/plain").send(fs.readFileSync(file));
});

app.get("/checkout", (_req, res) => {
  // No X-Frame-Options, and frame-ancestors * so ANY parent may embed us.
  // Wide open on purpose: the point of the harness is to let arbitrary
  // unverified parents frame this origin. A real deployment would pin
  // frame-ancestors to the specific partner origins you have agreements with.
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.type("html").send(
    page("checkout.html", {
      MERCHANT_ID: config.merchantId,
      DISPLAY_NAME: config.displayName,
      PAYMENT_DOMAIN: config.paymentDomain,
      COUNTRY_CODE: config.countryCode,
      CURRENCY_CODE: config.currencyCode,
      TOTAL_LABEL: config.totalLabel,
      TOTAL_AMOUNT: config.totalAmount,
    }),
  );
});

app.post("/validate-merchant", async (req, res) => {
  const validationURL = req.body?.validationURL;
  if (typeof validationURL !== "string") {
    return res.status(400).json({ error: "body must be { validationURL: string }" });
  }

  try {
    const { session, latencyMs, gatewayHost } = await validateMerchant(validationURL);
    console.log(
      `[validate] ${new Date().toISOString()} host=${gatewayHost} status=200 latency=${latencyMs}ms`,
    );
    res.json(session);
  } catch (err) {
    const status = err instanceof ValidationError ? err.status : 502;
    const message = err instanceof Error ? err.message : "unknown error";
    console.error(`[validate] ${new Date().toISOString()} status=${status} :: ${message}`);
    res.status(status).json({ error: message });
  }
});

/**
 * Token sink. Deliberately isolated so a real PSP handoff — or the Payment
 * Processing cert decryption step — slots in here without touching anything
 * else. Today it just proves the token arrived.
 */
app.post("/authorized", (req, res) => {
  const token = req.body?.token;
  console.log(`[authorized] received token, network=${token?.paymentMethod?.network ?? "?"}`);
  res.json({ ok: true });
});

/* ─────────────────────────────── parent origin ──────────────────────────────
 * Reached at the OTHER domain (Railway-generated, or any domain you point at
 * this service). Deliberately unverified with Apple — that is the experiment.
 * ───────────────────────────────────────────────────────────────────────── */

app.get("/", (req, res) => {
  if (req.hostname === config.paymentDomain) return res.redirect("/checkout");

  const noPayment = "nopayment" in req.query;
  const deep = "deep" in req.query;

  const src = deep ? "/deep-frame" : `${PAYMENT_ORIGIN}/checkout`;
  const allow = noPayment ? "" : ` allow="payment ${deep ? "*" : PAYMENT_ORIGIN}"`;

  const mode = noPayment
    ? "NEGATIVE CONTROL — allow attribute omitted, Apple Pay should be unavailable"
    : deep
      ? "NESTED — parent → intermediate frame → checkout, both delegating"
      : "DEFAULT — allow=&quot;payment&quot; delegated to the verified origin";

  res.type("html").send(
    page("parent.html", {
      IFRAME_SRC: src,
      IFRAME_ALLOW: allow,
      MODE: mode,
      PARENT_HOST: req.hostname,
      PAYMENT_DOMAIN: config.paymentDomain,
    }),
  );
});

/**
 * Intermediate frame for ?deep=1. Permission-policy delegation must be granted
 * by EVERY frame in the chain — if this one omits `allow`, the innermost frame
 * loses Apple Pay even though the top-level parent granted it.
 */
app.get("/deep-frame", (_req, res) => {
  res.setHeader("Content-Security-Policy", "frame-ancestors *");
  res.type("html").send(
    `<!doctype html><meta charset="utf-8">
     <style>html,body{margin:0;height:100%;font:13px ui-monospace,monospace}
       .b{padding:4px 8px;background:#fef3c7;border-bottom:1px solid #d97706}
       iframe{width:100%;height:calc(100% - 26px);border:0}</style>
     <div class="b">intermediate frame (also delegating)</div>
     <iframe src="${PAYMENT_ORIGIN}/checkout" allow="payment ${PAYMENT_ORIGIN}"></iframe>`,
  );
});

app.get("/health", (_req, res) => res.json({ ok: true, paymentDomain: config.paymentDomain }));

app.listen(config.port, () => {
  console.log(`\nApple Pay iframe harness listening on :${config.port}\n`);
  console.log(describeConfig());
  console.log(`\n  payment origin  ${PAYMENT_ORIGIN}/checkout`);
  console.log(`  parent          any other host pointed at this service, at /\n`);
});
