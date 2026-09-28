#!/usr/bin/env bash
# Coupons, end to end, as the demo users through PostgREST so the real
# has_permission gates, the RLS policies and the unique index are all in play.
#
# Needs an OPEN bill with lines worth at least 10.00 (BILL_ID) whose orders
# carry no customer, and a second open bill (BILL_ID_2) for the usage cap.
set -uo pipefail
cd "$(dirname "$0")/../../../extrahelper_flutter"

URL=$(python3 -c "import json;print(json.load(open('env.json'))['SUPABASE_URL'])")
KEY=$(python3 -c "import json;d=json.load(open('env.json'));print(d.get('SUPABASE_PUBLISHABLE_KEY') or d.get('SUPABASE_ANON_KEY'))")

#   export DEMO_OWNER_EMAIL=... DEMO_OWNER_PASSWORD=...
#   export DEMO_WAITER_EMAIL=... DEMO_WAITER_PASSWORD=...
OWNER_EMAIL="${DEMO_OWNER_EMAIL:?set DEMO_OWNER_EMAIL}"
OWNER_PASSWORD="${DEMO_OWNER_PASSWORD:?set DEMO_OWNER_PASSWORD}"
WAITER_EMAIL="${DEMO_WAITER_EMAIL:?set DEMO_WAITER_EMAIL}"
WAITER_PASSWORD="${DEMO_WAITER_PASSWORD:?set DEMO_WAITER_PASSWORD}"
BILL="${BILL_ID:?set BILL_ID}"
BILL2="${BILL_ID_2:?set BILL_ID_2}"
TENANT="${TENANT_ID:?set TENANT_ID}"

login() {
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
    -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])"
}
OWNER=$(login "$OWNER_EMAIL" "$OWNER_PASSWORD")
WAITER=$(login "$WAITER_EMAIL" "$WAITER_PASSWORD")
PASS=0; FAIL=0

rpc() { # rpc <token> <name> <json>
  curl -s -X POST "$URL/rest/v1/rpc/$2" -H "apikey: $KEY" -H "Authorization: Bearer $1" \
    -H "Content-Type: application/json" -d "$3"
}
get() { curl -s "$URL/rest/v1/$2" -H "apikey: $KEY" -H "Authorization: Bearer $1"; }
post_table() { # post_table <token> <table> <json> → http status
  curl -s -o /dev/null -w "%{http_code}" -X POST "$URL/rest/v1/$2" -H "apikey: $KEY" \
    -H "Authorization: Bearer $1" -H "Content-Type: application/json" -d "$3"
}
field() { python3 -c "import json,sys;d=json.load(sys.stdin);print(d[0]['$1'] if isinstance(d,list) else d.get('$1',d))"; }
msg()   { python3 -c "import json,sys;d=json.load(sys.stdin);print(d.get('message', d) if isinstance(d,dict) else d)"; }

ok()   { PASS=$((PASS+1)); printf "  PASS  %s\n" "$1"; }
bad()  { FAIL=$((FAIL+1)); printf "  FAIL  %s — %s\n" "$1" "$2"; }
expect_eq() { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1" "expected $2, got $3"; fi; }
expect_has() { if printf '%s' "$3" | grep -qi -- "$2"; then ok "$1"; else bad "$1" "wanted '$2' in: $3"; fi; }

bill_total() { get "$OWNER" "bills?id=eq.$1&select=total_cents" | field total_cents; }
used_count() { get "$OWNER" "coupons?id=eq.$1&select=used_count" | field used_count; }

echo "== create"
CODE="T$(date +%s | tail -c 6)"
NEW=$(rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":null,\"_code\":\"$CODE\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}")
CID=$(printf '%s' "$NEW" | tr -d '"')
if [[ "$CID" =~ ^[0-9a-f-]{36}$ ]]; then ok "owner creates a coupon ($CODE)"; else bad "owner creates a coupon" "$NEW"; fi
GEN=$(rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":null,\"_code\":\"\",\"_name\":\"gen\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}" | tr -d '"')
GENCODE=$(get "$OWNER" "coupons?id=eq.$GEN&select=code" | field code)
expect_has "blank code is generated (SAVE10-XXXX)" "SAVE10-" "$GENCODE"
rpc "$OWNER" delete_coupon "{\"_id\":\"$GEN\"}" >/dev/null

echo "== guards"
expect_has "waiter cannot create a coupon"   "permission" "$(rpc "$WAITER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":null,\"_code\":\"WAITER1\",\"_name\":null,\"_type\":\"percent\",\"_value\":100,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}")"
# PostgREST maps 42501 to 403 when the request carries a valid JWT.
expect_eq  "waiter cannot POST /coupons"      "403" "$(post_table "$WAITER" coupons "{\"tenant_id\":\"$TENANT\",\"code\":\"WAITER2\",\"type\":\"percent\",\"value\":100}")"
expect_eq  "waiter cannot POST /discounts"    "403" "$(post_table "$WAITER" discounts "{\"tenant_id\":\"$TENANT\",\"bill_id\":\"$BILL\",\"type\":\"percent\",\"value\":100}")"
expect_eq  "waiter sees no coupons"           "[]"  "$(get "$WAITER" "coupons?select=id&tenant_id=eq.$TENANT")"
expect_has "waiter cannot apply a coupon"     "permission" "$(rpc "$WAITER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}")"

echo "== apply / remove"
BEFORE=$(bill_total "$BILL")
AFTER=$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}")
if [ "$AFTER" -lt "$BEFORE" ] 2>/dev/null; then ok "apply drops the total ($BEFORE → $AFTER)"; else bad "apply drops the total" "$BEFORE → $AFTER"; fi
expect_eq  "used_count is 1" "1" "$(used_count "$CID")"
expect_has "second apply refused" "already on this bill" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}")"
expect_has "lower-case code works too (refused as already applied, not invalid)" "already" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$(printf '%s' "$CODE" | tr 'A-Z' 'a-z')\"}")"
RESTORED=$(rpc "$OWNER" remove_coupon "{\"_bill_id\":\"$BILL\"}")
expect_eq  "remove restores the total" "$BEFORE" "$RESTORED"
expect_eq  "used_count back to 0" "0" "$(used_count "$CID")"

echo "== rules"
rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":\"$CID\",\"_code\":\"\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":1,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}" >/dev/null
rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}" >/dev/null
expect_has "usage limit 1: second bill refused" "used up" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL2\",\"_code\":\"$CODE\"}")"
rpc "$OWNER" remove_coupon "{\"_bill_id\":\"$BILL\"}" >/dev/null

rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":\"$CID\",\"_code\":\"\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":99999999,\"_once_per_customer\":false,\"_order_types\":null}" >/dev/null
expect_has "minimum order refused" "Minimum order" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}")"

rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":\"$CID\",\"_code\":\"\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":[\"pickup\"]}" >/dev/null
expect_has "order type refused on a dine-in bill" "isn't valid for" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}")"

rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":\"$CID\",\"_code\":\"\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":false,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}" >/dev/null
expect_has "paused refused" "paused" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}")"

TOMORROW=$(python3 -c "import datetime;print((datetime.datetime.utcnow()+datetime.timedelta(days=1)).isoformat()+'Z')")
rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":\"$CID\",\"_code\":\"\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":\"$TOMORROW\",\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}" >/dev/null
expect_has "not yet valid refused" "yet" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}")"

YESTERDAY=$(python3 -c "import datetime;print((datetime.datetime.utcnow()-datetime.timedelta(days=1)).isoformat()+'Z')")
rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":\"$CID\",\"_code\":\"\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":\"$YESTERDAY\",\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}" >/dev/null
expect_has "expired refused" "expired" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}")"

expect_has "unknown code refused" "isn't valid" "$(rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"NOPE-0000\"}")"

echo "== delete"
rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":\"$CID\",\"_code\":\"\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}" >/dev/null
rpc "$OWNER" apply_coupon "{\"_bill_id\":\"$BILL\",\"_code\":\"$CODE\"}" >/dev/null
expect_has "used coupon cannot be deleted" "pause it" "$(rpc "$OWNER" delete_coupon "{\"_id\":\"$CID\"}")"
expect_has "used coupon's code cannot change" "can't change" "$(rpc "$OWNER" upsert_coupon "{\"_tenant\":\"$TENANT\",\"_id\":\"$CID\",\"_code\":\"RENAMED1\",\"_name\":\"test\",\"_type\":\"percent\",\"_value\":10,\"_is_active\":true,\"_valid_from\":null,\"_valid_to\":null,\"_usage_limit\":null,\"_min_subtotal_cents\":0,\"_once_per_customer\":false,\"_order_types\":null}")"
rpc "$OWNER" remove_coupon "{\"_bill_id\":\"$BILL\"}" >/dev/null
expect_eq  "unused coupon deletes" "" "$(rpc "$OWNER" delete_coupon "{\"_id\":\"$CID\"}" | tr -d '\n')"

echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
