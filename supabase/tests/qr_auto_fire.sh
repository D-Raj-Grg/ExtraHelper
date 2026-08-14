#!/usr/bin/env bash
# QR order → kitchen, both modes, driven over real PostgREST as the roles that
# actually make these calls: an anonymous guest holding a table token, and a
# signed-in staff member accepting the order.
#
# The bug this covers: place_qr_order used to write orders + order_items and no
# KOTs, so a guest order was invisible on every kitchen board.
#
# Leaves two orders behind (printed at the end) and, on a tenant that had no
# `tenant_settings` row, creates one at column defaults — delete both if the
# tenant's prior state matters.
#
# Needs a service-role key to inspect KOTs and to clean up its own orders.
#   TABLE_TOKEN=<qr_token>  TENANT=<tenant uuid>  SERVICE_KEY=<service role key>
set -uo pipefail
# env.json (gitignored) holds the Supabase URL + publishable key. Resolved
# relative to this script so the tests run from any checkout, not just mine.
cd "$(dirname "$0")/../../../extrahelper_flutter"

URL=$(python3 -c "import json;print(json.load(open('env.json'))['SUPABASE_URL'])")
KEY=$(python3 -c "import json;d=json.load(open('env.json'));print(d.get('SUPABASE_PUBLISHABLE_KEY') or d.get('SUPABASE_ANON_KEY'))")

# Credentials come from the environment — never hardcode them here. This repo is
# public, and these accounts are real: the owner is the account Apple's reviewer
# signs in with.
#
#   export DEMO_OWNER_EMAIL=... DEMO_OWNER_PASSWORD=...
#   export DEMO_WAITER_EMAIL=... DEMO_WAITER_PASSWORD=...
OWNER_EMAIL="${DEMO_OWNER_EMAIL:?set DEMO_OWNER_EMAIL}"
OWNER_PASSWORD="${DEMO_OWNER_PASSWORD:?set DEMO_OWNER_PASSWORD}"
WAITER_EMAIL="${DEMO_WAITER_EMAIL:?set DEMO_WAITER_EMAIL}"
WAITER_PASSWORD="${DEMO_WAITER_PASSWORD:?set DEMO_WAITER_PASSWORD}"
TABLE_TOKEN="${TABLE_TOKEN:?set TABLE_TOKEN}"
TENANT="${TENANT:?set TENANT}"
SERVICE_KEY="${SERVICE_KEY:?set SERVICE_KEY}"
ITEM="${ITEM:?set ITEM}"   # an active, un-86'd menu item in that tenant

login() {
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
    -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
OWNER=$(login "$OWNER_EMAIL" "$OWNER_PASSWORD")
WAITER=$(login "$WAITER_EMAIL" "$WAITER_PASSWORD")
PASS=0; FAIL=0

# Raw RPC as anon (no Authorization header — a guest has no session).
anon_rpc() { curl -s -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $KEY" \
  -H "Content-Type: application/json" -d "$2"; }

auth_rpc() { curl -s -X POST "$URL/rest/v1/rpc/$2" -H "apikey: $KEY" \
  -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"; }

svc() { curl -s "$URL/rest/v1/$1" -H "apikey: $SERVICE_KEY" \
  -H "Authorization: Bearer $SERVICE_KEY"; }

set_auto() { # set_auto true|false — upsert: a tenant may have no settings row yet
  curl -s -X POST "$URL/rest/v1/tenant_settings" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
    -H "Content-Type: application/json" -H "Prefer: resolution=merge-duplicates" \
    -d "{\"tenant_id\":\"$TENANT\",\"qr_auto_fire\":$1}" >/dev/null
}

kots_for() { svc "kots?order_id=eq.$1&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"; }
status_of() { svc "orders?id=eq.$1&select=status" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['status'])"; }
code_of() { python3 -c "
import json,sys
raw=sys.stdin.read().strip()
try: d=json.loads(raw)
except Exception: print('OK'); raise SystemExit
print(d.get('code','OK') if isinstance(d,dict) and 'code' in d else 'OK')"; }

is() { # is <label> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf "  PASS  %-52s %s\n" "$1" "$3"
  else FAIL=$((FAIL+1)); printf "  FAIL  %-52s expected %s, got %s\n" "$1" "$2" "$3"; fi
}

BODY=$(printf '{"_token":"%s","_items":[{"item_id":"%s","qty":1}]}' "$TABLE_TOKEN" "$ITEM")
CREATED=()

echo "== auto-fire on =="
set_auto true
ORDER=$(anon_rpc place_qr_order "$BODY" | tr -d '"')
CREATED+=("$ORDER")
is "guest order reaches the kitchen"        1 "$(kots_for "$ORDER")"
is "guest order advances to in_kitchen"     in_kitchen "$(status_of "$ORDER")"

echo "== auto-fire off (waiter confirms) =="
set_auto false
sleep 31   # the per-table rate limit is 3 orders / 30s
ORDER2=$(anon_rpc place_qr_order "$BODY" | tr -d '"')
CREATED+=("$ORDER2")
is "guest order waits for a waiter"         0 "$(kots_for "$ORDER2")"
is "guest order stays placed"               placed "$(status_of "$ORDER2")"
ACCEPT_BODY=$(printf '{"_order_id":"%s"}' "$ORDER2")
is "accepting fires it"                     1 "$(auth_rpc "$OWNER" accept_qr_order "$ACCEPT_BODY")"
is "accepted order is in_kitchen"           in_kitchen "$(status_of "$ORDER2")"
is "accepting twice is a no-op"             0 "$(auth_rpc "$OWNER" accept_qr_order "$ACCEPT_BODY")"

echo "== guards =="
# Build bodies up front: backslash-escaped quotes inside a "$( … )" that is
# itself inside double quotes reach curl as literal backslashes, and PostgREST
# answers PGRST102 (bad body) instead of the guard's own SQLSTATE.
KOTS_BODY=$(printf '{"_order_id":"%s","_tenant":"%s"}' "$ORDER2" "$TENANT")

is "anon cannot accept an order"            42501 "$(anon_rpc accept_qr_order "$ACCEPT_BODY" | code_of)"
# A waiter holds order.fire — accepting a guest order is their job, so this is
# an allow-case, not a guard. It is here to prove the gate reads the permission
# and not the role name.
is "waiter may accept (holds order.fire)"   OK "$(auth_rpc "$WAITER" accept_qr_order "$ACCEPT_BODY" | code_of)"
is "unknown order is not found"             P0002 "$(auth_rpc "$OWNER" accept_qr_order '{"_order_id":"00000000-0000-0000-0000-000000000000"}' | code_of)"
is "anon cannot build tickets directly"     42501 "$(anon_rpc fire_order_kots "$KOTS_BODY" | code_of)"

# Leave the tenant on the shipped default.
set_auto true

echo
echo "orders created by this run (delete them if this is a demo tenant):"
printf '  %s\n' "${CREATED[@]}"
echo "PASS=$PASS FAIL=$FAIL"
[ "$FAIL" -eq 0 ]
