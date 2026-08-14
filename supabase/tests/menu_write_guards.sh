#!/usr/bin/env bash
# Menu editing is a boundary, not a hidden button — driven over real PostgREST
# as the roles that actually make these calls.
#
# What this covers (20260814170000):
#   * the variant RPCs work for an owner and refuse a waiter and a guest;
#   * the *tables* refuse a waiter directly, which is the hole the migration
#     closed — before it, `tenant_all` let any member of the tenant PATCH
#     item_variants straight through the API and reprice the menu;
#   * a waiter can still READ the menu, because the POS and the offline cache
#     both depend on it.
#
# Creates one throwaway menu item + variants and deletes them at the end.
#
# Credentials come from the environment — never hardcode them here. This repo is
# public, and these accounts are real.
#
#   export DEMO_OWNER_EMAIL=... DEMO_OWNER_PASSWORD=...
#   export DEMO_WAITER_EMAIL=... DEMO_WAITER_PASSWORD=...
#   TENANT=<tenant uuid> SERVICE_KEY=<service role key> ./menu_write_guards.sh
set -uo pipefail
# env.json (gitignored) holds the Supabase URL + publishable key. Resolved
# relative to this script so the tests run from any checkout.
cd "$(dirname "$0")/../../../extrahelper_flutter"

URL=$(python3 -c "import json;print(json.load(open('env.json'))['SUPABASE_URL'])")
KEY=$(python3 -c "import json;d=json.load(open('env.json'));print(d.get('SUPABASE_PUBLISHABLE_KEY') or d.get('SUPABASE_ANON_KEY'))")

OWNER_EMAIL="${DEMO_OWNER_EMAIL:?set DEMO_OWNER_EMAIL}"
OWNER_PASSWORD="${DEMO_OWNER_PASSWORD:?set DEMO_OWNER_PASSWORD}"
WAITER_EMAIL="${DEMO_WAITER_EMAIL:?set DEMO_WAITER_EMAIL}"
WAITER_PASSWORD="${DEMO_WAITER_PASSWORD:?set DEMO_WAITER_PASSWORD}"
TENANT="${TENANT:?set TENANT}"
SERVICE_KEY="${SERVICE_KEY:?set SERVICE_KEY}"

login() {
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
    -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
OWNER=$(login "$OWNER_EMAIL" "$OWNER_PASSWORD")
WAITER=$(login "$WAITER_EMAIL" "$WAITER_PASSWORD")
[ -n "$OWNER" ] || { echo "owner login failed"; exit 1; }
[ -n "$WAITER" ] || { echo "waiter login failed"; exit 1; }
PASS=0; FAIL=0

# Bodies are built with printf into a variable first: written inline inside an
# already-quoted argument the backslashes reach curl literally and PostgREST
# answers PGRST102 instead of the guard's own SQLSTATE.
auth_rpc() { curl -s -X POST "$URL/rest/v1/rpc/$2" -H "apikey: $KEY" \
  -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"; }
anon_rpc() { curl -s -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $KEY" \
  -H "Content-Type: application/json" -d "$2"; }
auth_get() { curl -s "$URL/rest/v1/$2" -H "apikey: $KEY" -H "Authorization: Bearer $1"; }
svc() { curl -s "$URL/rest/v1/$1" -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY"; }

ok()   { PASS=$((PASS+1)); echo "  ok   — $1"; }
bad()  { FAIL=$((FAIL+1)); echo "  FAIL — $1: $2"; }
check() { # check <label> <expected substring> <actual>
  case "$3" in *"$2"*) ok "$1";; *) bad "$1" "$3";; esac
}
jqf() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('$1','') if isinstance(d,dict) else '')"; }

echo "== fixture =="
ITEM=$(curl -s -X POST "$URL/rest/v1/menu_items" \
  -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d "$(printf '{"tenant_id":"%s","name":"ZZ guard test","base_price_cents":10000}' "$TENANT")" \
  | python3 -c "import json,sys;r=json.load(sys.stdin);print(r[0]['id'] if r else '')")
[ -n "$ITEM" ] || { echo "could not create fixture item"; exit 1; }
echo "  item $ITEM"

cleanup() {
  curl -s -X DELETE "$URL/rest/v1/item_variants?item_id=eq.$ITEM" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null
  curl -s -X DELETE "$URL/rest/v1/menu_items?id=eq.$ITEM" \
    -H "apikey: $SERVICE_KEY" -H "Authorization: Bearer $SERVICE_KEY" > /dev/null
  echo "  fixture deleted"
}
trap cleanup EXIT

echo "== the owner can edit =="
BODY=$(printf '{"_item_id":"%s","_name":"Small","_price_delta_cents":0}' "$ITEM")
V1=$(auth_rpc "$OWNER" add_variant "$BODY" | tr -d '"')
case "$V1" in
  ????????-*) ok "owner adds a variant" ;;
  *) bad "owner adds a variant" "$V1" ;;
esac
BODY=$(printf '{"_item_id":"%s","_name":"Large","_price_delta_cents":25000}' "$ITEM")
V2=$(auth_rpc "$OWNER" add_variant "$BODY" | tr -d '"')

BODY=$(printf '{"_variant_id":"%s","_name":"Small (250g)","_price_delta_cents":-500}' "$V1")
RES=$(auth_rpc "$OWNER" update_variant "$BODY")
NAME=$(svc "item_variants?id=eq.$V1&select=name,price_delta_cents" \
  | python3 -c "import json,sys;r=json.load(sys.stdin);print(f\"{r[0]['name']}|{r[0]['price_delta_cents']}\" if r else '')")
check "owner renames and reprices" "Small (250g)|-500" "$NAME"

echo "== appended, then moved =="
ORDER=$(svc "item_variants?item_id=eq.$ITEM&select=name&order=sort" \
  | python3 -c "import json,sys;print(','.join(v['name'] for v in json.load(sys.stdin)))")
check "a new variant lands at the bottom" "Small (250g),Large" "$ORDER"

BODY=$(printf '{"_variant_id":"%s","_direction":"up"}' "$V2")
POS=$(auth_rpc "$OWNER" move_variant "$BODY")
check "moving up returns the new position" "1" "$POS"
ORDER=$(svc "item_variants?item_id=eq.$ITEM&select=name&order=sort" \
  | python3 -c "import json,sys;print(','.join(v['name'] for v in json.load(sys.stdin)))")
check "the order actually changed" "Large,Small (250g)" "$ORDER"

BODY=$(printf '{"_variant_id":"%s","_direction":"up"}' "$V2")
POS=$(auth_rpc "$OWNER" move_variant "$BODY")
check "moving past the top is a no-op, not an error" "1" "$POS"

echo "== the guards =="
BODY=$(printf '{"_item_id":"%s","_name":"Sneaky","_price_delta_cents":0}' "$ITEM")
RES=$(auth_rpc "$WAITER" add_variant "$BODY" | jqf code)
check "a waiter cannot add a variant" "42501" "$RES"

BODY=$(printf '{"_variant_id":"%s","_name":"Free","_price_delta_cents":-100000}' "$V1")
RES=$(auth_rpc "$WAITER" update_variant "$BODY" | jqf code)
check "a waiter cannot reprice a variant" "42501" "$RES"

BODY=$(printf '{"_variant_id":"%s","_direction":"down"}' "$V1")
RES=$(auth_rpc "$WAITER" move_variant "$BODY" | jqf code)
check "a waiter cannot reorder variants" "42501" "$RES"

BODY=$(printf '{"_variant_id":"%s"}' "$V1")
RES=$(auth_rpc "$WAITER" delete_variant "$BODY" | jqf code)
check "a waiter cannot delete a variant" "42501" "$RES"

BODY=$(printf '{"_item_id":"%s","_name":"Anonymous","_price_delta_cents":0}' "$ITEM")
RES=$(anon_rpc add_variant "$BODY" | jqf message)
check "a guest with no session cannot add a variant" "permission denied" "$RES"

echo "== the hole this closed: the table itself =="
# Before the migration every one of these succeeded.
RES=$(curl -s -X PATCH "$URL/rest/v1/item_variants?id=eq.$V1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $WAITER" \
  -H "Content-Type: application/json" -H "Prefer: return=representation" \
  -d '{"price_delta_cents":1}')
CHANGED=$(svc "item_variants?id=eq.$V1&select=price_delta_cents" \
  | python3 -c "import json,sys;r=json.load(sys.stdin);print(r[0]['price_delta_cents'] if r else '')")
check "a waiter's direct PATCH changes nothing" "-500" "$CHANGED"

RES=$(curl -s -X POST "$URL/rest/v1/item_variants" \
  -H "apikey: $KEY" -H "Authorization: Bearer $WAITER" \
  -H "Content-Type: application/json" \
  -d "$(printf '{"tenant_id":"%s","item_id":"%s","name":"Direct","price_delta_cents":0}' "$TENANT" "$ITEM")" \
  | jqf code)
check "a waiter's direct INSERT is refused" "42501" "$RES"

RES=$(curl -s -X DELETE "$URL/rest/v1/item_variants?id=eq.$V1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $WAITER" -H "Prefer: return=representation")
STILL=$(svc "item_variants?id=eq.$V1&select=id" \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "a waiter's direct DELETE removes nothing" "1" "$STILL"

RES=$(curl -s -X PATCH "$URL/rest/v1/menu_items?id=eq.$ITEM" \
  -H "apikey: $KEY" -H "Authorization: Bearer $WAITER" \
  -H "Content-Type: application/json" -d '{"base_price_cents":1}')
PRICE=$(svc "menu_items?id=eq.$ITEM&select=base_price_cents" \
  | python3 -c "import json,sys;r=json.load(sys.stdin);print(r[0]['base_price_cents'] if r else '')")
check "a waiter cannot reprice the item either" "10000" "$PRICE"

echo "== reads stay open =="
# The till, the KDS and the offline cache all read the menu as whoever is
# signed in. Locking writes must not lock these.
SEEN=$(auth_get "$WAITER" "menu_items?id=eq.$ITEM&select=id,item_variants(id)" \
  | python3 -c "import json,sys;r=json.load(sys.stdin);print(len(r[0]['item_variants']) if r else 0)")
case "$SEEN" in
  0) bad "a waiter can still read the menu" "saw no variants" ;;
  *) ok "a waiter can still read the menu ($SEEN variants)" ;;
esac

echo "== owner deletes =="
BODY=$(printf '{"_variant_id":"%s"}' "$V2")
auth_rpc "$OWNER" delete_variant "$BODY" > /dev/null
LEFT=$(svc "item_variants?item_id=eq.$ITEM&select=id" \
  | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "owner deletes a variant" "1" "$LEFT"
BODY=$(printf '{"_variant_id":"%s"}' "$V2")
RES=$(auth_rpc "$OWNER" delete_variant "$BODY" | jqf code)
check "deleting the same variant twice is not an error" "" "$RES"

echo
echo "$PASS passed, $FAIL failed"
[ "$FAIL" -eq 0 ]
