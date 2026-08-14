#!/usr/bin/env bash
# Discount replace/remove behaviour, exercised as the demo user through PostgREST
# so the real has_tenant_role / has_permission gates are in play.
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
TOK=$(curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$OWNER_EMAIL\",\"password\":\"$OWNER_PASSWORD\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['access_token'])")

BILL="${BILL_ID:?set BILL_ID}"
ITEM="${ITEM_ID:?set ITEM_ID}"
PASS=0; FAIL=0

rpc() { # rpc <name> <json>
  curl -s -X POST "$URL/rest/v1/rpc/$1" -H "apikey: $KEY" -H "Authorization: Bearer $TOK" \
    -H "Content-Type: application/json" -d "$2"
}
get() { curl -s "$URL/rest/v1/$1" -H "apikey: $KEY" -H "Authorization: Bearer $TOK"; }

bill_field() { get "bills?id=eq.$BILL&select=$1" | python3 -c "import json,sys;print(json.load(sys.stdin)[0]['$1'])"; }
staff_rows() { get "discounts?bill_id=eq.$BILL&order_item_id=is.null&coupon_code=is.null&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"; }
line_rows()  { get "discounts?order_item_id=eq.$ITEM&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))"; }
wipe() { rpc remove_bill_discount "{\"_bill_id\":\"$BILL\"}" >/dev/null 2>&1
         rpc remove_item_discount "{\"_order_item_id\":\"$ITEM\"}" >/dev/null 2>&1; }

check() { # check <label> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf "  PASS  %-52s %s\n" "$1" "$2"
  else FAIL=$((FAIL+1)); printf "  FAIL  %-52s expected %s, got %s\n" "$1" "$2" "$3"; fi
}

echo "== bill $BILL =="
wipe
# Derive the subtotal from the lines rather than bills.subtotal_cents, which is
# only correct once recompute_bill has run at least once for this bill.
SUB=$(get "orders?bill_id=eq.$BILL&select=order_items(qty,unit_price_cents,is_void)" | python3 -c "
import json,sys
print(sum(i['qty']*i['unit_price_cents']
          for o in json.load(sys.stdin) for i in o['order_items'] if not i['is_void']))")
echo "subtotal: $SUB cents"

echo
echo "1. second bill discount replaces the first"
rpc apply_bill_discount "{\"_bill_id\":\"$BILL\",\"_type\":\"percent\",\"_value\":10,\"_reason\":\"test A\"}" >/dev/null
rpc apply_bill_discount "{\"_bill_id\":\"$BILL\",\"_type\":\"percent\",\"_value\":20,\"_reason\":\"test B\"}" >/dev/null
check "staff bill discount rows" 1 "$(staff_rows)"
check "discount_cents = 20% of subtotal" "$(python3 -c "print(round($SUB*0.20))")" "$(bill_field discount_cents)"

echo
echo "2. remove_bill_discount clears it"
rpc remove_bill_discount "{\"_bill_id\":\"$BILL\"}" >/dev/null
check "staff bill discount rows" 0 "$(staff_rows)"
check "discount_cents" 0 "$(bill_field discount_cents)"

echo
echo "3. comp then discount: discount replaces the comp"
rpc set_bill_complimentary "{\"_bill_id\":\"$BILL\",\"_reason\":\"test comp\"}" >/dev/null
rpc apply_bill_discount "{\"_bill_id\":\"$BILL\",\"_type\":\"percent\",\"_value\":10,\"_reason\":\"after comp\"}" >/dev/null
check "staff bill discount rows" 1 "$(staff_rows)"
check "discount_cents = 10% of subtotal" "$(python3 -c "print(round($SUB*0.10))")" "$(bill_field discount_cents)"

echo
echo "4. discount then comp: comp replaces the discount"
rpc set_bill_complimentary "{\"_bill_id\":\"$BILL\",\"_reason\":\"comp wins\"}" >/dev/null
check "staff bill discount rows" 1 "$(staff_rows)"
check "total_cents (on the house)" 0 "$(bill_field total_cents)"
wipe

echo
echo "5. second line discount replaces the first, on that line"
rpc apply_item_discount "{\"_order_item_id\":\"$ITEM\",\"_type\":\"percent\",\"_value\":10,\"_reason\":\"line A\"}" >/dev/null
rpc apply_item_discount "{\"_order_item_id\":\"$ITEM\",\"_type\":\"percent\",\"_value\":50,\"_reason\":\"line B\"}" >/dev/null
check "line discount rows" 1 "$(line_rows)"

echo
echo "6. remove_item_discount clears that line"
rpc remove_item_discount "{\"_order_item_id\":\"$ITEM\"}" >/dev/null
check "line discount rows" 0 "$(line_rows)"
check "discount_cents" 0 "$(bill_field discount_cents)"

wipe

echo
echo "7. a coupon is not touched by a staff discount"
COUPON_ID=$(python3 - "$URL" "$KEY" "$TOK" "$BILL" <<'PY'
import json,sys,urllib.request
url,key,tok,bill=sys.argv[1:5]
# Seed a coupon-backed discount row directly; apply_coupon needs a coupons row,
# and the guarantee under test is only about the coupon_code predicate.
req=urllib.request.Request(f"{url}/rest/v1/discounts", method="POST",
    data=json.dumps({"tenant_id":"dd000000-0000-0000-0000-0000000000de","bill_id":bill,
                     "type":"percent","value":5,"coupon_code":"TESTCPN","reason":"coupon"}).encode())
for h,v in {"apikey":key,"Authorization":f"Bearer {tok}","Content-Type":"application/json",
            "Prefer":"return=representation"}.items(): req.add_header(h,v)
print(json.loads(urllib.request.urlopen(req).read())[0]["id"])
PY
)
rpc apply_bill_discount "{\"_bill_id\":\"$BILL\",\"_type\":\"percent\",\"_value\":10,\"_reason\":\"with coupon\"}" >/dev/null
CPN=$(get "discounts?bill_id=eq.$BILL&coupon_code=not.is.null&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")
check "coupon row survives" 1 "$CPN"
check "staff discount rows" 1 "$(staff_rows)"
check "discount_cents = 15% (10 staff + 5 coupon)" "$(python3 -c "print(round($SUB*0.10)+round($SUB*0.05))")" "$(bill_field discount_cents)"

echo
echo "8. remove_bill_discount leaves the coupon"
rpc remove_bill_discount "{\"_bill_id\":\"$BILL\"}" >/dev/null
check "coupon row still there" 1 "$(get "discounts?bill_id=eq.$BILL&coupon_code=not.is.null&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")"
check "discount_cents = coupon only" "$(python3 -c "print(round($SUB*0.05))")" "$(bill_field discount_cents)"
curl -s -X DELETE "$URL/rest/v1/discounts?id=eq.$COUPON_ID" -H "apikey: $KEY" -H "Authorization: Bearer $TOK" >/dev/null

echo
echo "9. a discount on another line is untouched"
OTHER="${OTHER_ITEM_ID:?set OTHER_ITEM_ID}"
rpc apply_item_discount "{\"_order_item_id\":\"$ITEM\",\"_type\":\"percent\",\"_value\":10,\"_reason\":\"line A\"}" >/dev/null
rpc apply_item_discount "{\"_order_item_id\":\"$OTHER\",\"_type\":\"percent\",\"_value\":10,\"_reason\":\"line B\"}" >/dev/null
rpc apply_item_discount "{\"_order_item_id\":\"$ITEM\",\"_type\":\"percent\",\"_value\":25,\"_reason\":\"line A again\"}" >/dev/null
check "line A rows" 1 "$(line_rows)"
check "line B rows" 1 "$(get "discounts?order_item_id=eq.$OTHER&select=id" | python3 -c "import json,sys;print(len(json.load(sys.stdin)))")"
rpc remove_item_discount "{\"_order_item_id\":\"$OTHER\"}" >/dev/null

wipe
echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
