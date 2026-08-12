# Classic card face sources

These 36 lossless WebP files and the full-resolution Joker PNG master are the user-supplied and approved card-face sources from 2026-08-11. They retain their source alpha data and stay outside the Cocos runtime bundle. `joker-template.png` is the normalized, reproducible Joker overlay derived from that master.

Runtime assets live in `assets/game-assets/cards/classic/` as RGBA PNG files because the current WeChat Android target does not guarantee WebP decoding. Conversion uses `dwebp`, then downsamples only artwork whose source resolution materially exceeds its largest runtime display size:

- `rank-{black,red}-{A,2..10,J,Q,K}.webp` maps unchanged at `48x64` to `num_{black,red}_{1..13}.png`.
- `suit-{suit}.webp` maps to `96x96` `shape_{suit}_s.png` for corner and HUD icons.
- `suit-{suit}-large.webp` maps to `128x128` `shape_{suit}.png` for the lower card face.
- `joker-small.webp` and `joker-big.webp` map to `148x212` `black_joker.png` and `red_joker.png`.

## Joker references and palettes

`joker-master.png` is the approved `539x772` RGBA master. It is an overlay, not a complete card backing: only its real alpha layer contains the vertical `JOKER` lettering and jester artwork. Fully transparent pixels retain unrelated hidden RGB data and must never be made opaque.

`joker-template.png` is the normalized `539x772` RGBA overlay. It preserves the master's real layout, clears RGB wherever alpha is zero, and records the reviewed red semantic palette. `joker-big.webp` and `joker-small.webp` are the red and black lossless derivatives of this one template. The runtime `red_joker.png` and `black_joker.png` files share the same alpha and semantic masks at `148x212`; Cocos supplies the white card surface separately through `bg_front.png`.

The source WebPs and runtime PNGs use fixed visible-pixel palettes so the artwork remains consistent across devices; alpha values remain unrestricted and fully transparent pixels are ignored:

- `red_joker.png`: white `#FFFFFF`, primary red `#D71920`, and dark red `#971216`.
- `black_joker.png`: white `#FFFFFF`, primary black `#000000`, and dark gray `#333333`.

The existing Cocos `.meta` files are intentionally retained so SpriteFrame UUIDs remain stable. `bg_front.png` remains the licensed NiuMa card surface; the obsolete `role_*` portraits are not used.
