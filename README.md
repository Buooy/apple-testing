# Apple Pay cross-origin iframe harness

Reproduces the Polymarket/swapped.com architecture: an **unverified parent page**
embeds an **Apple-verified payment origin** in an iframe, and Apple Pay works —
because since Safari 17 / iOS 17, WebKit lets `ApplePaySession` run in a
cross-origin iframe when every embedding frame carries `allow="payment"`.

The verified domain is the *iframe's*, never the parent's.

```
someotherdomain.com/          ← unverified parent, no domain association
  └── <iframe allow="payment" src="https://pay.buooy.com/checkout">
        └── pay.buooy.com     ← Apple-verified. ApplePaySession lives here.
              └── POST /validate-merchant ──mTLS──► apple-pay-gateway*.apple.com
                    initiativeContext: "pay.buooy.com"   ← the whole trick
```

One Node service serves both roles. Paths don't collide (`/` is the parent,
`/checkout` is the payment origin), so any domain you point at the service
becomes a parent — including Railway's generated `*.up.railway.app`, which is a
genuinely different registrable domain from `buooy.com`.

---

## Status: what's done vs. what needs you

Code is complete and exercised. Three things need the Apple Developer portal —
run `npm run check` any time to see which are outstanding.

| | Item | How |
|---|---|---|
| ⛔ | **Merchant Identity Certificate** | Portal → Merchant IDs → `merchant.0xbuooy.testing` → *Merchant Identity Certificate* → create → download `.p12` |
| ⛔ | **Domain association file** | Same Merchant ID → *Merchant Domains* → add `pay.buooy.com` → download → save to `well-known/` |
| ⛔ | **Verify the domain** | Click Verify **after** the file is live at the public URL |
| ⛔ | Sandbox tester Apple ID with a sandbox card in Wallet | Portal → Users and Access → Sandbox Testers |

> **The `apple_pay.cer` already in this repo is the wrong cert.** Its subject is
> `Apple Pay Payment Processing:merchant.0xbuooy.testing` — that one decrypts
> payment tokens (out of scope here). Merchant validation needs the separate
> *Merchant Identity* certificate from the same Merchant ID.

---

## Run it locally

```bash
npm install
cp .env.example .env
npm run check      # tells you exactly what's still missing
npm start          # http://localhost:3000
```

Local Safari will show the "unavailable" diagnostic, because `localhost` isn't
the verified domain. That's expected — real verification happens on the deployed
host. Locally you're checking routes and the log pane, not the sheet.

Converting the merchant identity `.p12` once you have it:

```bash
MERCHANT_P12_PATH=~/Downloads/merchant_id.p12 npm run certs
```

Handles both OpenSSL 3.x (needs `-legacy` for Apple's p12 encryption) and the
LibreSSL that ships with macOS (doesn't have the flag). Output lands in
`certs/`, which is git-ignored.

---

## Live deployment

| | |
|---|---|
| Project | `applepay-iframe-harness` (Experiments workspace) |
| Service | `harness` |
| Parent origin | https://harness-production-f9f3.up.railway.app |
| Payment origin | `https://pay.buooy.com` — attached, **DNS not yet pointed** |

The Railway-generated host is the unverified parent: a different registrable
domain from `buooy.com`, which is exactly the separation being tested.

Redeploy with `railway up --service harness`.

## Deploy from scratch

```bash
railway init
railway up
```

Then:

**1. Variables** — everything from `.env.example`, plus the certs as base64:

```bash
base64 < certs/merchant_id_cert.pem | tr -d '\n' | pbcopy   # MERCHANT_ID_CERT_B64
base64 < certs/merchant_id_key.pem  | tr -d '\n' | pbcopy   # MERCHANT_ID_KEY_B64
```

Private keys live in Railway variables, never in the repo.

**2. Domains** — attach `pay.buooy.com` as a custom domain and add the CNAME
Railway gives you to buooy.com's DNS. Also generate a Railway domain; that
`*.up.railway.app` host is your parent origin. Point a second real domain here
too if you want the parent on a domain you own.

**3. Order matters.** Deploy → confirm the association file is publicly
reachable → *then* click Verify in the Apple portal:

```bash
curl -i https://pay.buooy.com/.well-known/apple-developer-merchantid-domain-association
```

Must be `200` with the exact file bytes. No redirect.

---

## Verifying the mechanism

On Safari 17+ / iOS 17+ with a sandbox card in Wallet, open the **parent**
origin (the Railway domain, *not* `pay.buooy.com`):

| URL | Expected |
|---|---|
| `/` | Apple Pay button renders inside the iframe |
| `/?nopayment=1` | "ApplePaySession unavailable" — `allow` attribute omitted |
| `/?deep=1` | Works through two nested frames, both delegating |

That first pair is the proof. Same iframe, same verified origin, same device —
the only difference is one HTML attribute on an unverified parent.

Then: click the button → sheet opens → log pane shows `onvalidatemerchant` with
its latency → authorize → token prefix appears. Every lifecycle event lands in
the on-page log, because Safari devtools on iOS is not a debugging surface you
want to depend on.

---

## Layout

```
src/
  index.ts        routes; parent at /, payment origin elsewhere
  validate.ts     mTLS to Apple's gateway — the one Node-only piece
  config.ts       env + cert loading (base64 or files)
  checkout.html   ApplePaySession lifecycle + log pane
  parent.html     unverified embedder, with the mode toggles
scripts/
  check.ts        preflight; the automation/human boundary
  convert-certs.sh
well-known/       domain association file goes here (public, commit it)
certs/            git-ignored
```

Two deliberate isolations for later work: `validate.ts` holds the only Node-only
API, so a Workers/Hono port is contained; and `POST /authorized` is where token
decryption or a real PSP handoff slots in without touching anything else.

---

## When it breaks

| Symptom | Cause |
|---|---|
| `ApplePaySession` undefined in the iframe | Missing `allow="payment"` on the embedder or any intermediate frame; Safari < 17 |
| Button renders, dies at validation | `initiativeContext` ≠ `pay.buooy.com`; Payment Processing cert used instead of Merchant Identity; domain not verified |
| Gateway 400/419 | Malformed payload, reused merchant session, or >30s since validation started |
| Iframe blank | `X-Frame-Options` or a `frame-ancestors` that excludes the parent |
| Sheet opens then immediately errors | `countryCode`/`currencyCode` mismatched against the sandbox tester's region |
| `openssl pkcs12` fails | OpenSSL 3.x without `-legacy` — `npm run certs` handles this |

## Not in scope

No PSP integration or charge capture (the token is logged, not decrypted). No
production deployment. No non-Safari fallback. No automated E2E — the sheet
needs biometric auth on real hardware, so verification is the manual checklist
above.
