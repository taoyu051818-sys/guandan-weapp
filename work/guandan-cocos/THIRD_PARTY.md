# Third-party art and tooling

Runtime inventory updated 2026-09-13. Source packs and generators are retained outside the Cocos bundle for provenance; their presence is not permission to re-enable retired features. Local license/hash checks do not independently establish commercial redistribution rights for every supplied asset.

## Kenney Particle Pack 1.1

- Source: https://www.kenney.nl/assets/particle-pack
- License: Creative Commons Zero (CC0 1.0)
- Local source: `third_party/assets/kenney-particle-pack/`
- Runtime selection: `assets/game-assets/effects/kenney/`
- Used for: impact rings, light sweeps, sparks, flames, and smoke. Textures are tinted, scaled, and animated by Cocos at runtime.

The upstream `License.txt` is kept beside both the source pack and selected runtime assets.

## rFXGen 5.0

- Source: https://github.com/raysan5/rfxgen
- License: zlib/libpng
- Source revision: `3185a36277226243695169da1e0d8d4aedde6f50`
- Local source: `third_party/tools/rfxgen/`
- Official macOS binary: `third_party/tools/rfxgen-bin/`
- Used for: generated 22.05 kHz mono WAV placeholders in `assets/game-assets/audio/voices/`.

Generated sound effects are project assets. The upstream source and binary licenses are preserved in their downloaded directories. Replace randomized placeholders with art-directed `.rfx` presets before production audio mastering.

Runtime event mapping is centralized in `assets/scripts/audio/AudioProfiles.ts`. The current legal placeholder reuse is:

| Semantic events | rFXGen runtime file |
| --- | --- |
| Deal, normal play, countdown | `card.wav` |
| Pass, defeat | `pass_1.wav` |
| Bomb | `bomb.wav` |
| Four-joker/king bomb | `king_bomb.wav` |
| Victory | `win.wav` |

These generated clips remain small fail-safe candidates. The wildcard/level-card dedicated route and duplicate straight-flush sound route are retired. Straight flush has exactly one female pattern announcement. Missing optional clips degrade to silence without stopping the game loop.

## Project-authorized Guandan audio collection

- Original list: `素材/音效/音效.txt`, supplied with the local reference project.
- Authorization: use in this project was confirmed by the user on 2026-08-04.
- Normalized catalog: `third_party/licenses/gameabc2-audio/catalog.json`.
- Download manifest and SHA-256 checksums: `third_party/licenses/gameabc2-audio/manifest.json`.
- Runtime selection: `assets/game-assets/audio/voices/licensed/` (4 clips: deal, bomb, defeat, female single 5).
- Source-only archive: `art-source/audio/licensed-archive/` (22 clips, never imported by Cocos).
- Reproducible import: `node scripts/import-licensed-audio.mjs`.

The current importer retains 26 MP3 entries across runtime and source-only archive. Pattern/single/pair announcements otherwise use the canonical female pack; superseded straight-flush and unconfirmed source announcements remain outside Cocos `assets/`. See the catalog and manifest rather than older import counts.

The source list's PNG “炸弹特效图汇总” was rejected during visual curation. It is recorded under `excluded` for auditability and was neither downloaded nor added to the runtime. No other image from this collection was imported.

## NiuMa client-cocos card background and curated audio

- Source: https://github.com/niuma-wj/client-cocos
- License: MIT
- Source revision: `f9d037feaef5a80867fd97c8dd39b9a7486fbeca`
- Original source directories: `assets/Game/Poker/`, `assets/GuanDan/Audio/ChuPai/Female/`, `assets/GuanDan/Audio/Phrase/Female/`, `assets/GuanDan/Audio/Clock/` and selected files directly under `assets/GuanDan/Audio/`.
- Runtime selections: `assets/game-assets/cards/classic/`, `assets/game-assets/audio/voices/niuma/` and `assets/game-assets/audio/music/niuma/`.
- Reproducible audio import: `NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-audio.mjs`.
- Reproducible BGM import: `NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-bgm.mjs`.
- Used for: the `classic` card surface background; female single/pair and selected pattern announcements; three pass variants; countdown 0–5; game-start, victory and defeat cues; one looping background track. Steel plate (“钢板”) uses the separately recorded TTS sample in `art-source/audio/tts/` and its runtime counterpart.

Only `bg_front.png` remains from the former NiuMa face-up card selection. Upstream prefabs, hand-selection, networking and game-state code were not copied. Cocos Creator 3.8.8 owns the imported metadata in this project. The full upstream license is retained both under `third_party/licenses/` and beside the runtime asset selection because the background and audio remain in use.

The 48 selected MP3 files are recorded with source paths, byte counts and SHA-256 hashes in `third_party/licenses/niuma-client-cocos-audio.json`. Cocos `.meta` files are retained for runtime clips. The semantic controller rotates `pass1/2/3`, selects the countdown second and keeps current generated/authorized fallbacks. The former OGG quick-chat clip is retired.

The 40-file male pack and its import script are retired; there is no player voice-selection setting. Historical male manifests remain provenance records only, not runtime selections.

The upstream `assets/GuanDan/Audio/bg.mp3` track is separately recorded in `third_party/licenses/niuma-client-cocos-bgm.json` and imported as `music/niuma/table_theme`. It uses an isolated looping `AudioSource`; music preference and volume are internal controller settings, not a restored settings page. Loop seam, loudness and device playback remain a human release check.

All quick-chat buttons, text/broadcast logic and audio routes are retired. Earlier phrase-index verification remains historical provenance; no phrase may re-enter runtime through fallback logic. `tests/quick-chat-regression.cjs` is a retirement guard, not a playable feature test.

The following source files are explicitly excluded and remain absent from runtime:

- `feiji.mp3`: the old client routes it to its steel/plate shape, but “飞机” conflicts with this project's “钢板” terminology.
- `yapai.mp3`: the old client plays it randomly, so there is no authoritative rules event that can trigger it without ambiguity.
- `dealcard.ogg`: the project already has an authorized MP3 deal cue; the redundant OGG has not passed the target WeChat format regression.
- Female and Male `phrase01.ogg` plus `phrase03.ogg` through `phrase09.ogg`: excluded individually; none is remapped to approximate or unrelated neutral copy.

The repository-wide MIT notice is preserved, but the audio pack has no separate per-file provenance statement. Keep the pinned revision, manifest and hashes with any redistribution, and complete listening/rights review before production release.

## Project-authorized classic card face assets

- Authorization: supplied and approved by the user for this project on 2026-08-11.
- Lossless source set: `art-source/cards/reference/` (36 WebP files with alpha).
- Runtime selection: `assets/game-assets/cards/classic/` (36 derived RGBA PNG files plus the retained NiuMa `bg_front.png`).
- Used for: red and black rank artwork, solid corner/HUD suit icons, outlined lower-card suit artwork, and the two joker faces.

The source WebP files are preserved outside `assets/` to keep the runtime bundle platform-safe. The current WeChat Android target cannot be assumed to decode WebP, so the runtime uses alpha-preserving PNG. Rank artwork stays at its source size; suit and joker artwork is downsampled to roughly twice its largest logical display size. Existing Cocos `.meta` files are retained to keep texture UUIDs stable. J, Q and K now use the same approved outlined suit artwork as number cards; the twelve former `role_*` portraits have been removed.

## User-supplied lobby and battle presentation assets

- Authorization: supplied by the user for this project on 2026-08-06.
- Runtime battle music: `assets/game-assets/audio/music/duizhan.mp3` (SHA-256 `11958667ef7fcbb0c6ab10e18c04c459b996e4e86c651a8695f6c20613b5db3c`).
- Timer source: `art-source/ui/chicken-timer-frame-source.png`; runtime frame `assets/game-assets/ui/table/chicken-timer-frame.png` is extracted by `scripts/extract-timer-frame.py` without redrawing the subject.
- Runtime lobby currency icon: `assets/game-assets/ui/lobby/coin.png`, copied byte-for-byte as a transparent PNG.
- Shop source: `art-source/ui/shop-float-chick-source.png`; runtime character `assets/game-assets/ui/lobby/shop-float-chick.png` is downsampled as PNG while retaining its original alpha channel.

The battle track is loaded only while the table is visible. The timer and lobby artwork remain in the downloadable `game-assets` bundle, not the WeChat main package.
