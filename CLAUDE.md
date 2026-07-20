# Operating notes

Apple Pay cross-origin iframe harness. One Node service plays both roles: an
**unverified parent** at `/` and the **Apple-verified payment origin** at
`/checkout`. Paths don't collide, so any domain pointed at the service becomes a
parent. No tunnel, no local TLS, no second server.

## Live

| | |
|---|---|
| Parent origin | https://harness-production-f9f3.up.railway.app |
| Payment origin | https://pay.buooy.com (CNAME → `12hc5bf8.up.railway.app`) |
| Railway | project `applepay-iframe-harness`, service `harness` |
| Merchant ID | `merchant.0xbuooy.testing`, team `QWN2M3D38E`, region SG |

```bash
npm run check                      # preflight; tells you what's missing
npm start                          # local, PORT=3000 (often occupied — use 3777)
railway up --service harness       # deploy
railway logs --service harness     # runtime logs
```

## The load-bearing details

**`initiativeContext` must be the iframe's hostname**, never the parent's. It's
pinned to `PAYMENT_DOMAIN` in `validate.ts`. This is the entire mechanism — Apple
checks the domain association for that value, and the parent stays unverified.

**Permissions-policy delegation must be granted by every frame in the chain.**
A single intermediate frame missing `allow="payment"` kills Apple Pay in the
innermost frame even when the top-level parent granted it. `?deep=1` exercises
this.

**The association file is regenerated on every download** — new signature and
`dateCreated` each time. Two downloaded copies are genuinely different files, not
duplicates. Keep exactly one, at `well-known/apple-developer-merchantid-domain-association`
(no extension); the `.txt` route serves those same bytes.

**Two certs exist and they are not interchangeable.** Merchant validation needs
the *Merchant Identity* cert. The *Payment Processing* cert decrypts tokens and
is out of scope. Both live under the same Merchant ID and their subjects differ
only by that phrase.

## Local Safari won't show the button

`localhost` isn't the verified domain, so `ApplePaySession` stays undefined and
the log pane says so. That's correct behaviour, not a bug. The sheet can only be
exercised on the deployed host, on real hardware, with a sandbox card.

## Secrets

Certs load from `MERCHANT_ID_{CERT,KEY}_B64` (Railway) or `certs/*.pem` (local).
`certs/` and `.env` are git-ignored *and* `.railwayignore`d — `railway up`
uploads a directory rather than a commit, so both lists matter. The private key
reaches the deployment only as a Railway variable.

Never print cert or key contents, or a merchant session, into logs or the
transcript.

## Extension points, deliberately isolated

- `validate.ts` holds the only Node-only API (mTLS). A Workers/Hono port is
  contained to that file.
- `POST /authorized` is where token decryption or a real PSP handoff slots in.

## Verifying a change

`npm run check` then `npx tsc --noEmit`, then exercise the routes — the allow-list
rejection, the well-known byte-comparison, and a live merchant validation are all
curl-able without a browser. The `allow="payment"` mechanism itself is the one
thing curl cannot settle; it needs Safari 17+ on real hardware.
