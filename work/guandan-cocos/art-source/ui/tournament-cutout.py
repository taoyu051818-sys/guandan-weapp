"""User-approved local matte extraction; original blue-backed artwork is untouched."""
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[2]
source = root / 'assets/game-assets/ui/lobby/entry-tournament-solid-v3.png'
target = root / 'assets/game-assets/ui/lobby/entry-tournament-cutout-v4.png'
im = Image.open(source).convert('RGBA')
# Blue-grey background has B > G; gold and turquoise artwork have G > B.
# A narrow soft matte keeps the original antialiased silhouette and handle holes.
alpha = Image.new('L', im.size)
alpha.putdata([max(0, min(255, round((g - b + 2) * 255 / 12))) for r, g, b, _ in im.getdata()])
im.putalpha(alpha)
bounds = alpha.getbbox()
assert bounds and bounds[0] > 100 and bounds[2] < im.width - 100
im = im.crop(bounds)
im.thumbnail((480, 480), Image.Resampling.LANCZOS)
canvas = Image.new('RGBA', (512, 512))
canvas.alpha_composite(im, ((512 - im.width) // 2, (512 - im.height) // 2))
canvas.save(target, optimize=True)
print(f'{target}: {target.stat().st_size} bytes; crop={bounds}, fitted={im.size}')
