# Lobby service icons

Selected original **Phosphor Icons / Fill**, `@phosphor-icons/core` version **2.1.1**.

- Upstream: https://github.com/phosphor-icons/core
- Package: https://registry.npmjs.org/@phosphor-icons/core/-/core-2.1.1.tgz
- License: MIT, retained in `LICENSE`.
- No path geometry changes. The build script replaces `currentColor` with approved deep-sea blue (`#23485C`), adds a faint ivory edge for shaded areas, and exports transparent 128 × 128 PNGs for Cocos / WeChat. Service labels use the same blue; the shop and quick-start gold are unchanged.
- Only seven selected icons are included; no icon-library runtime dependency or network requests.

Regenerate using `SHARP_MODULE=/path/to/sharp node scripts/build-lobby-service-icons.cjs` from the Cocos project.
