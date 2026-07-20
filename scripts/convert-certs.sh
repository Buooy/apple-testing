#!/usr/bin/env bash
# Convert an Apple Merchant Identity Certificate (.p12) into the PEM pair the
# server needs for mTLS against Apple's merchant validation gateway.
#
#   MERCHANT_P12_PATH=~/Downloads/merchant_id.p12 \
#   MERCHANT_P12_PASSPHRASE=... \
#   npm run certs
#
# Leave MERCHANT_P12_PASSPHRASE unset to be prompted interactively.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${MERCHANT_P12_PATH:?set MERCHANT_P12_PATH to your .p12 file}"

if [ ! -f "$MERCHANT_P12_PATH" ]; then
  echo "not found: $MERCHANT_P12_PATH" >&2
  exit 1
fi

mkdir -p certs

# Apple ships p12 files using legacy RC2/3DES encryption. OpenSSL 3.x refuses
# these unless -legacy is passed; LibreSSL (macOS default) has no such flag and
# handles them natively. Detect which we're on.
LEGACY=""
if openssl version | grep -qi "^OpenSSL 3"; then
  LEGACY="-legacy"
fi
echo "using $(openssl version)${LEGACY:+ (with -legacy)}"

# Test for "set" rather than "non-empty": Keychain Access happily exports with
# an empty passphrase, and treating that as unset makes openssl block on a
# prompt that never gets answered in a non-interactive run.
if [ "${MERCHANT_P12_PASSPHRASE+set}" = set ]; then
  PASSIN=(-passin env:MERCHANT_P12_PASSPHRASE)
else
  PASSIN=()
fi

openssl pkcs12 -in "$MERCHANT_P12_PATH" -clcerts -nokeys $LEGACY \
  "${PASSIN[@]}" -out certs/merchant_id_cert.pem

openssl pkcs12 -in "$MERCHANT_P12_PATH" -nocerts -nodes $LEGACY \
  "${PASSIN[@]}" -out certs/merchant_id_key.pem

chmod 600 certs/merchant_id_key.pem

SUBJECT=$(openssl x509 -in certs/merchant_id_cert.pem -noout -subject)
echo
echo "wrote certs/merchant_id_cert.pem"
echo "wrote certs/merchant_id_key.pem"
echo "  $SUBJECT"

if echo "$SUBJECT" | grep -q "Payment Processing"; then
  echo
  echo "WARNING: this is a Payment Processing certificate, not a Merchant" >&2
  echo "Identity certificate. Merchant validation will fail with it. Generate" >&2
  echo "the Merchant Identity cert from the same Merchant ID in the portal." >&2
  exit 1
fi

echo
echo "For Railway, set these two variables:"
echo "  MERCHANT_ID_CERT_B64=$(base64 < certs/merchant_id_cert.pem | tr -d '\n' | cut -c1-24)..."
echo "  MERCHANT_ID_KEY_B64=$(base64 < certs/merchant_id_key.pem | tr -d '\n' | cut -c1-24)..."
echo
echo "Full values:"
echo "  base64 < certs/merchant_id_cert.pem | tr -d '\\n' | pbcopy"
echo "  base64 < certs/merchant_id_key.pem  | tr -d '\\n' | pbcopy"
