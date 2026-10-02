# Map picture for a batch report: the batch's places as dots over the owner's
# Google Earth screenshot of the import shape (OSM tiles aren't reachable from
# every machine; the screenshot is). Same calibration as shape.png: Cape
# Florida at pixel (1362, 1092), 27 m per pixel.
#   python3 scripts/osm-import/plot.py docs/miami-import/<category>.json <screenshot> <out.png>
import json, math, sys
from PIL import Image, ImageDraw, ImageFont

report = json.load(open(sys.argv[1]))
im = Image.open(sys.argv[2]).convert('RGB')
AX, AY, ALAT, ALNG, MPP = 1362, 1092, 25.6660, -80.1570, 27.0
DLAT = MPP / 111000
DLNG = MPP / (111320 * math.cos(math.radians(25.73)))
px = lambda la, ln: (AX + (ln - ALNG) / DLNG, AY - (la - ALAT) / DLAT)
d = ImageDraw.Draw(im)
shape = [(25.8054, -80.3215), (25.8076, -80.1271), (25.6660, -80.1570), (25.6580, -80.3299)]
P = [px(*c) for c in shape]
d.line(P + [P[0]], fill=(255, 40, 40), width=3)
for la, ln, photo in report['points']:
    x, y = px(la, ln)
    col = (0, 230, 120) if photo else (255, 210, 0)
    d.ellipse([x - 3, y - 3, x + 3, y + 3], fill=col, outline=(0, 0, 0))
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 24)
d.text((400, 410), f"{report['category']}: {report['count']} places  (green = Commons photo, yellow = Google/tile on view)", fill=(255, 255, 255), font=f, stroke_width=3, stroke_fill=(0, 0, 0))
im.crop((380, 400, 1500, 1260)).save(sys.argv[3])
