#!/usr/bin/env bash
# Run over the authorized Guangzhou SSH connection after uploading the reviewed archive.
set -euo pipefail
release_id=${1:?release id required}
expected_hash=${2:?SHA-256 required}
[[ "$release_id" =~ ^20[0-9]{6}-[a-z0-9-]+$ ]]
[[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]]
archive="/tmp/guandan-release-${release_id}.tgz"
release="/srv/guandan/releases/${release_id}"
backup="/srv/guandan/backups/${release_id}"
node=/opt/node-v24.19.0/bin/node
[[ -f "$archive" && ! -L "$archive" && ! -e "$release" && ! -e "$backup" ]]
actual_hash=$(sha256sum "$archive" | cut -d ' ' -f 1)
[[ "$actual_hash" == "$expected_hash" ]]
previous=$(readlink -f /srv/guandan/current)
[[ "$previous" == /srv/guandan/releases/* && -d "$previous" ]]
mkdir "$release"
tar --no-same-owner -xzf "$archive" -C "$release"
chown -R root:root "$release"
chmod -R go-w "$release"
cd "$release/work/guandan-windows-source"
"$node" --check server/weapp-ws.js
"$node" --check server/platform-server.js
"$node" server/game-stats.test.mjs
"$node" server/friend-room-settings.test.mjs
"$node" server/friend-room-observer.test.mjs
"$node" server/game-session.test.mjs
"$node" server/platform/matchmaking-service.test.mjs
"$node" server/platform/profile-avatar.test.mjs
"$node" server/platform/account-service.test.mjs
"$node" server/platform/platform.test.mjs
"$node" server/platform/friend-room-service.test.mjs

# Refuse to interrupt a connected client or an unfinished live hand.
if [[ $(ss -Htn state established '( sport = :33102 )' | wc -l) -gt 0 ]]; then
  echo 'Release staged only: a game client is connected. No service stopped.'
  exit 3
fi
"$node" -e 'const fs=require("fs");const s=JSON.parse(fs.readFileSync("/srv/guandan/shared/data/rooms.json","utf8"));if(s.rooms.some(r=>["playing","tribute"].includes(r.state?.phase)&&!r.matchEnded))throw Error("Release staged only: active hand; no service stopped")'

mkdir -p "$backup"
rollback () {
  echo 'Activation failed; restoring the previous code release with the preserved data.' >&2
  systemctl stop guandan-game guandan-platform || true
  ln -s "$previous" "/srv/guandan/rollback-${release_id}"
  mv -Tf "/srv/guandan/rollback-${release_id}" /srv/guandan/current
  systemctl start guandan-platform guandan-game
}
trap rollback ERR
systemctl stop guandan-game guandan-platform
cp -a /srv/guandan/shared/data "$backup/data"
ln -s "$release" "/srv/guandan/next-${release_id}"
mv -Tf "/srv/guandan/next-${release_id}" /srv/guandan/current
systemctl start guandan-platform
"$node" --input-type=module -e 'let ok=false;for(let n=0;n<20;n++){try{if((await fetch("http://127.0.0.1:33103/api/v1/health")).ok){ok=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}if(!ok)throw Error("Platform failed health check")'
systemctl start guandan-game
"$node" --input-type=module -e 'import net from "node:net";let ok=false;for(let n=0;n<20;n++){ok=await new Promise(r=>{const s=net.connect(33102,"127.0.0.1");s.once("connect",()=>{s.destroy();r(true)});s.once("error",()=>r(false))});if(ok)break;await new Promise(r=>setTimeout(r,250))}if(!ok)throw Error("Game failed listen check")'
systemctl is-active guandan-platform guandan-game
trap - ERR
echo "Activated ${release_id}; previous release and backup retained at ${backup}"
