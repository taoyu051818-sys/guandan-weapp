# Bomb VFX v1

Deterministic, project-generated 2D textures for the GuanDan bomb projectile
and impact. The source contains no fonts or third-party artwork.

## Generate

Run with the Codex bundled Python environment that provides Pillow:

```sh
/Users/mac/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3 scripts/generate-bomb-vfx-assets.py
```

The generator uses the fixed seed `0x20260806`. Random streams are derived per
asset name, so adding another asset does not change existing PNG output.

## Runtime textures

| Texture | Size | Intended use |
| --- | ---: | --- |
| `bomb-body.png` | 256 x 256 | Projectile body and burning fuse |
| `trail-soft.png` | 256 x 64 | Additive projectile trail, pointing right |
| `hot-core.png` | 256 x 256 | Additive impact flash and fire core |
| `spark-streak.png` | 128 x 32 | Rotated and scaled radial sparks |
| `debris-shard.png` | 64 x 64 | Rotated and tinted blast debris |
| `noise-tile.png` | 128 x 128 | Repeat-wrapped distortion noise for a shader |

Use linear filtering with mipmaps disabled. Use clamp wrapping for every image
except `noise-tile.png`, which is periodic and should use repeat wrapping.
Transparent assets include RGB color bleed beneath zero-alpha border pixels to
avoid dark fringes under linear sampling.

The generator intentionally does not create or modify Cocos `.meta` files.
