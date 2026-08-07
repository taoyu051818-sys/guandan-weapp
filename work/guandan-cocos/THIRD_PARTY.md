# Third-party art and tooling

This project keeps runtime assets small and uses code-driven Cocos animation. The full source packs and generators are retained under `third_party/` for reproducible iteration.

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
| Bomb, straight flush | `bomb.wav` |
| Four-joker/king bomb | `king_bomb.wav` |
| Wildcard actually used | `wildcard.wav` |
| Victory | `win.wav` |

These generated clips remain as small fail-safe candidates. Missing optional clips are handled as a normal silent fallback and never stop the game loop.

## Project-authorized Guandan audio collection

- Original list: `素材/音效/音效.txt`, supplied with the local reference project.
- Authorization: use in this project was confirmed by the user on 2026-08-04.
- Normalized catalog: `third_party/licenses/gameabc2-audio/catalog.json`.
- Download manifest and SHA-256 checksums: `third_party/licenses/gameabc2-audio/manifest.json`.
- Runtime selection: `assets/game-assets/audio/voices/licensed/`.
- Reproducible import: `node scripts/import-licensed-audio.mjs`.

All 27 MP3 entries were downloaded and retained under semantic, collision-free names. Deal, pass, bomb, straight flush and defeat replace the generated placeholders at runtime while keeping those placeholders as fallbacks. Unambiguous straight, single-card and pair announcements are selected from the actual `PlayAction`; missing ranks keep the generic card sound. The unusually long source entry labelled “等等，轿夫抬杠子对A” is archived locally but deliberately not auto-played until its intended product use is confirmed.

The source list's PNG “炸弹特效图汇总” was rejected during visual curation. It is recorded under `excluded` for auditability and was neither downloaded nor added to the runtime. No other image from this collection was imported.

## NiuMa client-cocos card components and curated audio

- Source: https://github.com/niuma-wj/client-cocos
- License: MIT
- Source revision: `f9d037feaef5a80867fd97c8dd39b9a7486fbeca`
- Original source directories: `assets/Game/Poker/`, `assets/GuanDan/Audio/ChuPai/Female/`, `assets/GuanDan/Audio/Phrase/Female/`, `assets/GuanDan/Audio/Clock/` and selected files directly under `assets/GuanDan/Audio/`.
- Runtime selections: `assets/game-assets/cards/classic/`, `assets/game-assets/audio/voices/niuma/` and `assets/game-assets/audio/music/niuma/`.
- Reproducible audio import: `NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-audio.mjs`.
- Reproducible optional Male pack import: `NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-male-audio.mjs`.
- Reproducible BGM import: `NIUMA_CLIENT_COCOS_DIR=/path/to/client-cocos node scripts/import-niuma-bgm.mjs`.
- Used for: the optional `classic` card skin; complete Female and Male single/pair announcements and selected semantically explicit pattern announcements (steel plate/“钢板” excluded); pack-specific pass variants; countdown 0–5; game-start, victory and defeat cues; one exact-copy quick-chat sentence in each voice pack; one optional looping background track.

Only the 49 PNG components required for face-up cards were selected. Upstream `.meta` files and its prefab, hand-selection, networking and game-state code were not copied. Cocos Creator 3.8.8 owns the imported metadata in this project. The full upstream license is retained both under `third_party/licenses/` and beside the runtime asset selection.

The 48 selected MP3 files and 1 selected OGG quick-chat file are recorded with their source paths, byte counts and SHA-256 hashes in `third_party/licenses/niuma-client-cocos-audio.json`. Cocos `.meta` files are retained for every runtime clip. The semantic controller rotates `pass1/2/3`, selects the exact countdown second, layers the start cue before the existing deal event, and keeps current generated/authorized fallbacks.

The optional Male pack contains 39 play/pass MP3 files plus the exact-copy Male `phrase02` OGG. It is recorded separately in `third_party/licenses/niuma-client-cocos-male-audio.json` and selected in settings. Human fallbacks never cross from Male to Female or from Female to Male; generated non-voice effects may still provide a neutral fallback.

The upstream `assets/GuanDan/Audio/bg.mp3` track is separately recorded in `third_party/licenses/niuma-client-cocos-bgm.json` and imported as `music/niuma/table_theme`. It uses an isolated looping `AudioSource`, so one-shot card sounds cannot interrupt it; the existing music switch and volume now control real playback. Its source/hash/format are verified, while loop seam, loudness and device playback remain a human release check.

Quick-chat meaning was not inferred from file numbers. At the pinned revision, both `GuanDanPlayer.ts` and `SeatPanel.ts` define the same nine displayed phrases in array order, and `AudioControl.playPhrase` adds one before loading `Phrase/Female/phraseNN`. A clip enters runtime only when the current whitelist text exactly matches the verified spoken sentence:

| Current neutral copy | Verified upstream sentence | Runtime keys |
| --- | --- | --- |
| 你的牌打得太好啦 | 你的牌打得太好啦 | `niuma/chat_nice_play`, `niuma-male/chat_nice_play` |

The remaining current buttons—请尽快出牌、配合得好、大家加油、谢谢、再来一局—have no exact compatible clip in this source set and intentionally degrade to silence. Upstream phrase01 and phrases 03–09 are recorded as excluded in the manifest because they are approximate/sarcastic, negative, admonishing, context-specific, opposite to “再来一局”, or unnecessarily harsh.

The following source files are explicitly excluded and remain absent from runtime:

- `feiji.mp3`: the old client routes it to its steel/plate shape, but “飞机” conflicts with this project's “钢板” terminology.
- `yapai.mp3`: the old client plays it randomly, so there is no authoritative rules event that can trigger it without ambiguity.
- `dealcard.ogg`: the project already has an authorized MP3 deal cue; the redundant OGG has not passed the target WeChat format regression.
- Female and Male `phrase01.ogg` plus `phrase03.ogg` through `phrase09.ogg`: excluded individually; none is remapped to approximate or unrelated neutral copy.

The repository-wide MIT notice is preserved, but the audio pack has no separate per-file provenance statement. Keep the pinned revision, manifest and hashes with any redistribution, and complete listening/rights review before production release.

## User-supplied lobby and battle presentation assets

- Authorization: supplied by the user for this project on 2026-08-06.
- Runtime battle music: `assets/game-assets/audio/music/duizhan.mp3` (SHA-256 `11958667ef7fcbb0c6ab10e18c04c459b996e4e86c651a8695f6c20613b5db3c`).
- Timer source: `art-source/ui/chicken-timer-frame-source.png`; runtime frame `assets/game-assets/ui/table/chicken-timer-frame.png` is extracted by `scripts/extract-timer-frame.py` without redrawing the subject.
- Runtime lobby currency icon: `assets/game-assets/ui/lobby/coin.png`, copied byte-for-byte as a transparent PNG.
- Shop source: `art-source/ui/shop-float-chick-source.png`; runtime character `assets/game-assets/ui/lobby/shop-float-chick.png` is downsampled as PNG while retaining its original alpha channel.

The battle track is loaded only while the table is visible. The timer and lobby artwork remain in the downloadable `game-assets` bundle, not the WeChat main package.
