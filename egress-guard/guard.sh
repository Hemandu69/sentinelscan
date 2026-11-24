#!/bin/sh
# guard apply <host> <port> <ipv4>...   allow only these addresses on this TCP port
# guard lock                            allow no target at all
# guard status                          print the rules and pinned names
# guard probe <port> <ipv4>             prove that the firewall blocks, and that the target is allowed
# Needs CAP_NET_ADMIN. The values are checked by the API and again here.
set -eu
umask 022
export LC_ALL=C
gateway=172.29.83.1
fail() { echo "guard: $1" >&2; exit 2; }
ipv4() { echo "$1" | grep -Eq '^([0-9]{1,3}\.){3}[0-9]{1,3}$' || fail 'address'; }
port() { echo "$1" | grep -Eq '^[1-9][0-9]{0,4}$' && [ "$1" -le 65535 ] || fail 'port'; }
rules() {
  cat <<EOF
add table inet sentinelscan
delete table inet sentinelscan
table inet sentinelscan {
  counter denied { }
  chain output {
    type filter hook output priority filter; policy drop;
    ip daddr 127.0.0.1 tcp dport 8090 accept
    ip daddr 127.0.0.1 tcp sport 8090 accept
    ip daddr $gateway tcp sport 8090 tcp flags & (syn | ack) != syn accept
EOF
  for ip in $2; do echo "    ip daddr $ip tcp dport $1 accept"; done
  cat <<EOF
    counter name denied reject with icmpx type admin-prohibited
  }
}
EOF
}
names() { # host ips
  grep -v '# sentinelscan$' /etc/hosts > /tmp/hosts
  for ip in $2; do echo "$ip $1 # sentinelscan" >> /tmp/hosts; done
  cat /tmp/hosts > /etc/hosts
}
status() {
  nft -s list table inet sentinelscan 2>/dev/null || { echo OPEN; return 0; }
  grep '# sentinelscan$' /etc/hosts || true
}
denied() { nft list counter inet sentinelscan denied | sed -n 's/.*packets \([0-9]*\).*/\1/p'; }
blocked() { # proto ip port: must fail, and the firewall itself must have refused it
  before=$(denied)
  if [ "$1" = udp ]; then echo x | nc -u -w 1 "$2" "$3" >/dev/null 2>&1 || true
  else nc -z -w 2 "$2" "$3" >/dev/null 2>&1 && fail "reachable $2:$3"; fi
  [ "$(denied)" -gt "$before" ] || fail "not refused by the firewall $2:$3"
}
case "${1:-status}" in
  apply)
    [ $# -ge 4 ] || fail 'arguments'
    host=$2; echo "$host" | grep -Eq '^[a-z0-9.-]{1,253}$' || fail 'host'
    port "$3"; p=$3; shift 3
    for ip in "$@"; do ipv4 "$ip"; done
    rules "$p" "$*" > /tmp/rules
    nft -f /tmp/rules
    names "$host" "$*"
    status;;
  lock) rules 1 '' > /tmp/rules; nft -f /tmp/rules; names none ''; status;;
  status) status;;
  probe)
    [ $# -eq 3 ] || fail 'arguments'
    port "$2"; ipv4 "$3"
    # ZAP reads names from the hosts file only, so a name lookup over the network must fail too.
    blocked tcp 172.29.83.2 5432
    blocked tcp $gateway 80
    blocked tcp 10.0.0.1 80
    blocked tcp 192.168.65.254 80
    blocked tcp 169.254.169.254 80
    blocked tcp 1.1.1.1 443
    blocked tcp 127.0.0.1 80
    blocked udp 127.0.0.11 53
    blocked udp 1.1.1.1 53
    # The same address on another port is outside the authorized origin.
    other=81; [ "$2" = 81 ] && other=82
    blocked tcp "$3" $other
    nc -z -w 5 "$3" "$2" >/dev/null 2>&1 || fail 'target unreachable'
    echo VERIFIED;;
  *) fail 'command';;
esac
