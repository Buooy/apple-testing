# Domain association

Apple's proof-of-control file goes here, named exactly:

```
apple-developer-merchantid-domain-association
```

No extension. Get it from the Apple Developer portal:

> Certificates, Identifiers & Profiles → Identifiers → Merchant IDs →
> `merchant.0xbuooy.testing` → Merchant Domains → Add Domain → `pay.buooy.com`
> → **Download**

The server publishes it at
`https://pay.buooy.com/.well-known/apple-developer-merchantid-domain-association`.

It must be live and returning 200 **before** you click Verify in the portal.
It is a public file, not a secret — committing it is fine and keeps deploys
reproducible.
