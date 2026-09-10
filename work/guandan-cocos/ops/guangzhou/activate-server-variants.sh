#!/usr/bin/env bash
# Authorized server release, optionally including web. Never replaces credentials.
set -euo pipefail
release_id=${1:?release id required}
expected_hash=${2:?SHA-256 required}
allow_active=
with_web=false
for option in "${@:3}"; do
  case "$option" in
    --allow-active) allow_active=$option ;;
    --with-web) with_web=true ;;
    *) echo "Unknown release option: $option" >&2; exit 2 ;;
  esac
done
[[ "$release_id" =~ ^20[0-9]{6}-[a-z0-9-]+$ ]]
[[ "$expected_hash" =~ ^[a-f0-9]{64}$ ]]
archive="/tmp/guandan-release-${release_id}.tgz"
release="/srv/guandan/releases/${release_id}"
backup="/srv/guandan/backups/${release_id}"
node=/opt/node-v24.19.0/bin/node
[[ -f "$archive" && ! -L "$archive" && ! -e "$release" && ! -e "$backup" ]]
[[ $(sha256sum "$archive" | cut -d ' ' -f 1) == "$expected_hash" ]]
previous=$(readlink -f /srv/guandan/current)
[[ "$previous" == /srv/guandan/releases/* && -d "$previous/web" ]]
# Only reviewed code/rules and explicitly requested web assets; never secrets/data.
tar -tzf "$archive" | "$node" -e 'let s="";process.stdin.on("data",b=>s+=b);process.stdin.on("end",()=>{for(const p of s.trim().split("\n")){const allowed=/^(shared-core\/(dist\/|package.json$)|work\/guandan-windows-source\/(server\/|package.json$))/.test(p)||(process.argv[1]==="true"&&p.startsWith("web/"));if(p.split("/").includes("..")||!allowed)throw Error("Unexpected archive path: "+p)}})' "$with_web"
mkdir "$release"
tar --no-same-owner -xzf "$archive" -C "$release"
if [[ "$with_web" == true ]]; then
  [[ -f "$release/web/index.html" ]]
else
  cp -a "$previous/web" "$release/web"
fi
chown -R root:root "$release"
chmod -R go-w "$release"
cd "$release/work/guandan-windows-source"
"$node" --check server/weapp-ws.js
"$node" --check server/platform-server.js
for test in game-stats friend-room-settings friend-room-observer game-session; do "$node" "server/${test}.test.mjs"; done
for test in matchmaking-service profile-avatar default-profile-upload account-service platform friend-room-service; do "$node" "server/platform/${test}.test.mjs"; done
for test in tournament-service tournament-pairing tournament-orchestrator tournament-live; do "$node" "server/platform/${test}.test.mjs"; done
"$node" server/platform/spectator-event-service.test.mjs
"$node" server/platform/game-result-service.test.mjs
"$node" server/weapp-match-lifecycle.test.mjs
"$node" server/weapp-friend-bots.smoke.mjs
"$node" server/duplicate-room-runtime.test.mjs
"$node" server/duplicate-room-ws.test.mjs
"$node" server/weapp-rotating.smoke.mjs

# Do not interrupt a connected player, waiting party, or unfinished ordinary/duplicate hand.
if [[ "$allow_active" != '--allow-active' ]]; then
if [[ $(ss -Htn state established '( sport = :33102 )' | wc -l) -gt 0 ]]; then
  echo 'Release staged only: a game client is connected. No service stopped.'
  exit 3
fi
"$node" -e 'const fs=require("fs");for(const p of ["/srv/guandan/shared/data/rooms.json","/srv/guandan/shared/data/rooms.json.duplicate"]){if(!fs.existsSync(p))continue;const s=JSON.parse(fs.readFileSync(p,"utf8"));if(s.rooms.some(r=>r.phase==="playing"||(["playing","tribute"].includes(r.state?.phase)&&!r.matchEnded)))throw Error("Release staged only: active hand; no service stopped")}'
else
  echo 'Operator explicitly authorized interrupting active connections for this release.'
fi

mkdir "$backup"
printf '%s\n' "$previous" > "$backup/previous-release.txt"
printf '%s\n' "$expected_hash" > "$backup/archive.sha256"
rollback () {
  echo 'Activation failed; restoring previous code, preserving data for inspection.' >&2
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
"$node" --input-type=module -e 'let ok=false;for(let n=0;n<30;n++){try{if((await fetch("http://127.0.0.1:33103/api/v1/health",{signal:AbortSignal.timeout(1500)})).ok){ok=true;break}}catch{}await new Promise(r=>setTimeout(r,250))}if(!ok)throw Error("Platform failed health check")'
systemctl start guandan-game
"$node" --input-type=module -e 'import net from "node:net";let ok=false;for(let n=0;n<30;n++){ok=await new Promise(r=>{const s=net.connect(33102,"127.0.0.1");s.once("connect",()=>{s.destroy();r(true)});s.once("error",()=>r(false))});if(ok)break;await new Promise(r=>setTimeout(r,250))}if(!ok)throw Error("Game failed listen check")'
systemctl is-active guandan-platform guandan-game
trap - ERR
echo "Activated ${release_id}; previous release ${previous}; data backup ${backup}/data"
