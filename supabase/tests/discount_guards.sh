#!/usr/bin/env bash
# The guards on the discount RPCs, exercised as real signed-in users.
#
# Every one of these must be REFUSED. A pass here means the server said no —
# which is the whole point of putting the rule in a security definer function
# rather than in a client.
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

login() {
  curl -s -X POST "$URL/auth/v1/token?grant_type=password" -H "apikey: $KEY" \
    -H "Content-Type: application/json" -d "{\"email\":\"$1\",\"password\":\"$2\"}" \
    | python3 -c "import json,sys;print(json.load(sys.stdin).get('access_token',''))"
}
OWNER=$(login "$OWNER_EMAIL" "$OWNER_PASSWORD")
WAITER=$(login "$WAITER_EMAIL" "$WAITER_PASSWORD")

FOREIGN_BILL="${FOREIGN_BILL:?set FOREIGN_BILL}"   # a bill in another tenant
PAID_BILL="${PAID_BILL:?set PAID_BILL}"            # a settled bill in the demo tenant
OPEN_BILL="${OPEN_BILL:?set OPEN_BILL}"            # an open bill in the demo tenant
PASS=0; FAIL=0

# Returns the SQLSTATE the RPC raised, or "OK" if it succeeded.
# An empty token means a genuinely anonymous call — no Authorization header at
# all, which is what an unauthenticated caller actually sends. Passing an empty
# "Bearer " instead only ever proves the JWT parser rejects it.
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

refuses() { # refuses <label> <expected sqlstate> <actual>
  if [ "$2" = "$3" ]; then PASS=$((PASS+1)); printf "  PASS  %-54s refused %s\n" "$1" "$3"
  else FAIL=$((FAIL+1)); printf "  FAIL  %-54s expected %s, got %s\n" "$1" "$2" "$3"; fi
}

echo "== guards =="
BODY_OPEN=$(printf '{"_bill_id":"%s"}' "$OPEN_BILL")
BODY_PAID=$(printf '{"_bill_id":"%s"}' "$PAID_BILL")
BODY_FOREIGN=$(printf '{"_bill_id":"%s"}' "$FOREIGN_BILL")
BODY_DISC_OPEN=$(printf '{"_bill_id":"%s","_type":"percent","_value":10}' "$OPEN_BILL")
BODY_DISC_PAID=$(printf '{"_bill_id":"%s","_type":"percent","_value":10}' "$PAID_BILL")

refuses "waiter cannot remove a bill discount"        42501 "$(code "$WAITER" remove_bill_discount "$BODY_OPEN")"
refuses "waiter cannot apply a bill discount"         42501 "$(code "$WAITER" apply_bill_discount "$BODY_DISC_OPEN")"
refuses "owner cannot reach another tenant's bill"    42501 "$(code "$OWNER"  remove_bill_discount "$BODY_FOREIGN")"
refuses "a settled bill takes no discount"            22023 "$(code "$OWNER"  apply_bill_discount "$BODY_DISC_PAID")"
refuses "a settled bill's discount cannot be removed" 22023 "$(code "$OWNER"  remove_bill_discount "$BODY_PAID")"
refuses "an unknown bill is not found"                P0002 "$(code "$OWNER"  remove_bill_discount '{"_bill_id":"00000000-0000-0000-0000-000000000000"}')"
refuses "anon cannot remove a discount"               42501 "$(code ""        remove_bill_discount "$BODY_OPEN")"

echo
echo "removing a discount that isn't there is not an error (idempotent):"
R=$(code "$OWNER" remove_bill_discount "$BODY_OPEN")
if [ "$R" = "OK" ]; then PASS=$((PASS+1)); printf "  PASS  %-54s %s\n" "no-op remove succeeds" "$R"
else FAIL=$((FAIL+1)); printf "  FAIL  %-54s got %s\n" "no-op remove succeeds" "$R"; fi

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" -eq 0 ]
