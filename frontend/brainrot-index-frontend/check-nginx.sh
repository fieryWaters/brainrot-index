#!/usr/bin/env bash
# Checks nginx's routing rules against the running stack on spark.
# Run from the repository root: bash frontend/brainrot-index-frontend/check-nginx.sh
set -u
failures=0

# expect <description> <wanted status> <actual status>
expect() {
  if [ "$2" = "$3" ]; then
    echo "ok    $1 ($3)"
  else
    echo "FAIL  $1: wanted $2, got $3"
    failures=$((failures + 1))
  fi
}

private_status() {
  curl -s -o /dev/null -w '%{http_code}' -H "Host: $1" "http://127.0.0.1:3400$2"
}

# Port 8080 is not published; ask from inside the web container.
tunnel_status() {
  docker compose exec -T web sh -c "wget -S -O /dev/null --header 'Host: $1' 'http://127.0.0.1:8080$2' 2>&1" \
    | awk '/HTTP\// { print $2; exit }'
}

expect "admin on the private host" 302 "$(private_status brainrot.jacob-waters.com /admin/)"
expect "admin on the public host, private port" 404 "$(private_status brainrotindex.com /admin/)"
expect "admin on www, private port" 301 "$(private_status www.brainrotindex.com /admin/)"
expect "admin through the tunnel port" 404 "$(tunnel_status brainrotindex.com /admin/)"
expect "admin through the tunnel port with the private host" 404 "$(tunnel_status brainrot.jacob-waters.com /admin/)"
expect "api through the tunnel port" 200 "$(tunnel_status brainrotindex.com /api/health/)"
expect "site through the tunnel port" 200 "$(tunnel_status brainrotindex.com /)"
expect "www redirects to the bare domain" 301 "$(tunnel_status www.brainrotindex.com /)"

exit "$failures"
