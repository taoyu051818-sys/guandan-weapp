# Image resource cleanup — 2026-09-26

## Scope and recovery

No gameplay, endpoint, layout or publishing changes are intended in this cleanup.
Three retired lobby pictures and their Cocos metadata moved from `assets/game-assets/ui/lobby`
to `art-source/ui/retired-lobby`. Five byte-identical profile pictures (011/014/019/022/025)
and their metadata moved to `art-source/ui/retired-profiles`; their profile entries now use
the existing 003 texture. Names and remote profile identity are unchanged.
These eight images are recoverable from those directories; they no longer ship at runtime.
The tournament cutout generator reads the archived original.

The original quick-start beach is preserved at `art-source/ui/lobby/quick-start-beach-source.png`.
`scripts/build-quick-start-background.cjs` reproduces the existing center-cover crop at
832 × 176 (four times the logical 208 × 44 area), retaining the runtime asset UUID.
Run it with Sharp installed, or set `SHARP_MODULE` to an installed Sharp module path.

## Resource ownership

- `assets/game-assets`: shipping media; `art-source`: unbundled sources and generators.
- `art-source/image-resources.json`: reviewed image inventory, usage, lifetime, source evidence,
  consumer references, per-file limits and retired source hashes. Source evidence is traceability,
  not a statement that every asset has independently verified commercial-use rights.
- `GameAssetLoader`: existing bundle-loading boundary, unchanged.
- `ProfileAvatarAssets`: avatar decoding, gateway retrieval and owned resources.
- `LeasedAssetCache`: active leases pin resources; at most eight idle entries are retained.
  Eviction releases dynamic SpriteFrame/Texture2D/ImageAsset objects; bundled textures use addRef/decRef.
- `AssetBinding`: clears the previous sprite before releasing its lease and rejects late results
  from an obsolete binding. `ProfileAvatar` only mounts avatars into UI nodes.

Existing card-frame and application-lifetime UI caches remain in their current modules.
This is not a claim that all resource caches or paths have been unified.

## Gates and results

`npm run verify:images` checks the exact image inventory, encoded/pixel budgets, metadata,
consumer reference tokens, duplicate file hashes and archived sources. Static references are
an audit guard, not proof that every UI branch has been exercised. The total source-image budget
is 6 MiB; changing it or adding an image requires reviewing the manifest explicitly.

Web finalization and WeChat verification also check shipped images against source bytes or,
when Cocos fixes transparent-edge RGB, its imported library products. Retired image UUIDs must
not appear in the shipped native directories. Cocos must build first to refresh that import cache.

| Measurement | Before | After |
| --- | ---: | ---: |
| Runtime source image count | 103 | 95 |
| Runtime source image bytes | 11,987,968 | 5,751,478 |
| Quick-start background bytes | 1,491,395 | 259,314 |
| WeChat main + subpackage bytes | 20,429,083 | 11,986,249 |

After cleanup: main 3,335,780 bytes; game-assets 8,650,469 bytes.
The before package measurement is the previously verified build, not WeChat's upload-compressed size.
`npm test`, runtime/core type checks, architecture and code-health gates passed. Both Cocos builds
and their finalization checks passed. Browser lobby media rendered; the existing platform connection
failure prevented an authenticated avatar round-trip. No upload or server deployment was performed.

## Phone acceptance checklist

| Action | Expected |
| --- | --- |
| Open lobby and watch one animation cycle | Original layout, chicken, steam and quick-start artwork remain visible |
| Open/close profile repeatedly | Avatar stays correct; no blank/destroyed texture |
| Change avatar, return to lobby, enter/leave table | New avatar remains; old async result cannot overwrite it |
| Switch among views showing many player avatars | No active avatar disappears when idle cache entries are evicted |
| Background app, resume and reconnect | Avatar restored with the page; no stale callback writes into a destroyed node |
