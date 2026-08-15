#!/usr/bin/env bash
# record_payment with the digital methods, exercised as real signed-in users.
#
# Two things are under test. First, that the new enum values reach the column
# at all — a method the type rejects comes back 22P02, and the cashier would
# have told the guest the bill was settled. Second, that `_reference` behaves:
# stored trimmed, dropped when blank, refused when absurd, and never a way past
# the permission check.
#
# This SPENDS MONEY against a real bill, so it wants a scratch bill in the demo
# tenant — never a tenant's live one.
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

login() {
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
    -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
OWNER=$(login "$OWNER_EMAIL" "$OWNER_PASSWORD")
WAITER=$(login "$WAITER_EMAIL" "$WAITER_PASSWORD")

# An OPEN bill in the demo tenant with at least NPR 60.00 outstanding — this
# script takes six 10.00 payments off it.
OPEN_BILL="${OPEN_BILL:?set OPEN_BILL}"
FOREIGN_BILL="${FOREIGN_BILL:?set FOREIGN_BILL}"   # a bill in another tenant
PASS=0; FAIL=0

code() { # code <token> <rpc> <json>
  if [ -n "$1" ]; then set -- "$1" "$2" "$3" "-HAuthorization: Bearer $1"; else set -- "$1" "$2" "$3" "-Hexpect:"; fi
  curl -s -X POST "$URL/rest/v1/rpc/$2" -H "apikey: $KEY" "$4" \
    -H "Content-Type: application/json" -d "$3" \
    | python3 -c "
import json,sys
raw=sys.stdin.read().strip()
try: d=json.loads(raw)
except Exception: print('OK'); raise SystemExit
print(d.get('code','OK') if isinstance(d,dict) and 'code' in d else 'OK')"
}

# The reference actually stored against an idempotency key. '-' means null.
stored_ref() { # stored_ref <token> <idempotency key>
  curl -s -G "$URL/rest/v1/payments" -H "apikey: $KEY" \
    -H "Authorization: Bearer $1" \
    --data-urlencode "idempotency_key=eq.$2" --data-urlencode "select=reference,method" \
    | python3 -c "
import json,sys
rows=json.load(sys.stdin)
print('-' if not rows else (rows[0].get('reference') or '-'))"
}

ok() { # ok <label> <actual>
  if [ "$2" = "OK" ]; then PASS=$((PASS+1)); printf "  PASS  %-54s %s\n" "$1" "$2"
  else FAIL=$((FAIL+1)); printf "  FAIL  %-54s expected OK, got %s\n" "$1" "$2"; fi
}

refuses() { # refuses <label> <expected sqlstate> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf "  PASS  %-54s refused %s\n" "$1" "$3"
  else FAIL=$((FAIL+1)); printf "  FAIL  %-54s expected %s, got %s\n" "$1" "$2" "$3"; fi
}

same() { # same <label> <expected> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf "  PASS  %-54s %s\n" "$1" "$3"
  else FAIL=$((FAIL+1)); printf "  FAIL  %-54s expected '%s', got '%s'\n" "$1" "$2" "$3"; fi
}

pay() { # pay <token> <method> <key> [reference]
  if [ "$#" -ge 4 ]; then
    code "$1" record_payment "$(printf '{"_bill_id":"%s","_method":"%s","_amount_cents":1000,"_idempotency_key":"%s","_reference":"%s"}' "$OPEN_BILL" "$2" "$3" "$4")"
  else
    code "$1" record_payment "$(printf '{"_bill_id":"%s","_method":"%s","_amount_cents":1000,"_idempotency_key":"%s"}' "$OPEN_BILL" "$2" "$3")"
  fi
}

RUN="$(date +%s)"

echo "== the new methods reach the column =="
for m in esewa fonepay bank wallet; do
  ok "$m is a real payment_method" "$(pay "$OWNER" "$m" "test-$RUN-$m" "TXN-$m")"
done
ok  "cash still works with no reference at all" "$(pay "$OWNER" cash "test-$RUN-cash")"
refuses "a method the enum has never held"  22P02 "$(pay "$OWNER" khalti "test-$RUN-khalti")"

echo
echo "== the reference =="
same "eSewa's reference is stored"          "TXN-esewa" "$(stored_ref "$OWNER" "test-$RUN-esewa")"
same "cash has no reference"                "-"         "$(stored_ref "$OWNER" "test-$RUN-cash")"

ok   "a padded reference is accepted"       "$(pay "$OWNER" bank "test-$RUN-pad" "   TXN-PADDED   ")"
same "…and stored trimmed"                  "TXN-PADDED" "$(stored_ref "$OWNER" "test-$RUN-pad")"

ok   "a blank reference is accepted"        "$(pay "$OWNER" wallet "test-$RUN-blank" "   ")"
same "…and stored as null, not ''"          "-"          "$(stored_ref "$OWNER" "test-$RUN-blank")"

LONG=$(python3 -c "print('X'*121)")
refuses "a reference past the 120 cap"      22001 "$(pay "$OWNER" esewa "test-$RUN-long" "$LONG")"

echo
echo "== a reference is not a way in =="
refuses "a waiter still cannot take payment" 42501 "$(pay "$WAITER" esewa "test-$RUN-waiter" "TXN")"
refuses "anon still cannot take payment"     42501 "$(pay "" esewa "test-$RUN-anon" "TXN")"
refuses "another tenant's bill is still shut" 42501 \
  "$(code "$OWNER" record_payment "$(printf '{"_bill_id":"%s","_method":"esewa","_amount_cents":1000,"_idempotency_key":"test-%s-foreign","_reference":"TXN"}' "$FOREIGN_BILL" "$RUN")")"

echo
echo "== the 4-arg call still resolves (offline replays from an older build) =="
ok "no _reference key at all" "$(pay "$OWNER" card "test-$RUN-4arg")"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
