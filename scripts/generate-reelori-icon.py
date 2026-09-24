"""Render the Reelori mark as a Windows multi-size icon.

Requires Pillow. The vector master is public/assets/reelori-mark.svg.
"""

from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SIZE = 1024
SCALE = SIZE / 64

def p(value):
    return round(value * SCALE)

image = Image.new("RGBA", (SIZE, SIZE), "#111412")
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((0, 0, SIZE - 1, SIZE - 1), radius=p(16), fill="#111412")
draw.rounded_rectangle((p(9), p(17), p(55), p(56)), radius=p(11), fill="#DFFF7A")
draw.rounded_rectangle((p(13), p(21), p(51), p(52)), radius=p(7), fill="#111412")
draw.line((p(32), p(46), p(32), p(34)), fill="#DFFF7A", width=p(3.5))
draw.polygon([(p(31.5), p(36)), (p(26), p(34)), (p(22), p(30)), (p(20.5), p(27)),
              (p(26), p(28)), (p(30), p(31))], fill="#DFFF7A")
draw.polygon([(p(33), p(34)), (p(35), p(29)), (p(40), p(25)), (p(44), p(23)),
              (p(43), p(28)), (p(39), p(32))], fill="#DFFF7A")

target = ROOT / "packaging/windows/Reelori.ico"
image.save(target, format="ICO", sizes=[(16, 16), (24, 24), (32, 32),
                                       (48, 48), (64, 64), (128, 128), (256, 256)])
print(target)
