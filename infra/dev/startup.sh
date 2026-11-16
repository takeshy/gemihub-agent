#!/bin/bash
set -euo pipefail
umask 077
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y docker.io docker-compose python3 ca-certificates curl
systemctl enable --now docker
install -d -m 700 /etc/gemihub-dev /var/lib/gemihub-dev/parent /var/lib/gemihub-dev/caddy
install -d /opt/gemihub-dev
python3 - <<'PY'
import base64, pathlib, urllib.request
for key, name in [('compose', 'compose.yaml'), ('caddy', 'Caddyfile'), ('runner', 'run.py')]:
    request = urllib.request.Request('http://metadata.google.internal/computeMetadata/v1/instance/attributes/gemihub-dev-' + key, headers={'Metadata-Flavor':'Google'})
    with urllib.request.urlopen(request, timeout=10) as response:
        pathlib.Path('/opt/gemihub-dev', name).write_bytes(base64.b64decode(response.read()))
PY
if [[ ! -e /swapfile ]]; then
  fallocate -l 2G /swapfile
  chmod 600 /swapfile
  mkswap /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi
swapon -a
cat >/etc/sysctl.d/90-gemihub-dev.conf <<'EOF'
vm.swappiness=10
EOF
sysctl -p /etc/sysctl.d/90-gemihub-dev.conf
cat >/etc/systemd/system/gemihub-dev.service <<'EOF'
[Unit]
Description=GemiHub isolated development stack
After=network-online.target docker.service
Requires=docker.service
StartLimitIntervalSec=0
[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/gemihub-dev
ExecStart=/usr/bin/python3 /opt/gemihub-dev/run.py
Restart=on-failure
RestartSec=30
TimeoutStartSec=900
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable gemihub-dev
systemctl restart gemihub-dev
