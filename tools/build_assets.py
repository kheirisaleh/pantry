import io
import json
import os
import shutil
import sys

import cairosvg
from PIL import Image, ImageDraw

modules = sys.argv[1]
app = sys.argv[2]
out = sys.argv[3]
static = os.path.join(out, "static")
for folder in ("icons", "fonts", "vendor", "m"):
    os.makedirs(os.path.join(static, folder), exist_ok=True)

with open(os.path.join(modules, "@iconify-json/fluent-emoji-flat/icons.json")) as handle:
    icons = json.load(handle)
width = icons.get("width", 32)
height = icons.get("height", 32)
with open(os.path.join(app, "icon_names.json")) as handle:
    icon_names = json.load(handle)
for name in icon_names:
    icon = icons["icons"][name]
    svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {} {}">{}</svg>'.format(
        icon.get("width", width), icon.get("height", height), icon["body"]
    )
    with open(os.path.join(static, "icons", name + ".svg"), "w") as handle:
        handle.write(svg)
with open(os.path.join(static, "icons", "ATTRIBUTION.txt"), "w") as handle:
    handle.write("Food icons: Fluent Emoji Flat by Microsoft, MIT License, via Iconify.\n")

fonts = [
    ("manrope", ["manrope-latin-{}-normal.woff2".format(weight) for weight in (400, 500, 600, 700, 800)]),
    ("bricolage-grotesque", ["bricolage-grotesque-latin-{}-normal.woff2".format(weight) for weight in (500, 600, 700, 800)]),
    ("vazirmatn", ["vazirmatn-arabic-{}-normal.woff2".format(weight) for weight in (400, 600)]),
]
for package, files in fonts:
    for file in files:
        shutil.copy(os.path.join(modules, "@fontsource", package, "files", file), os.path.join(static, "fonts", file))

shutil.copy(os.path.join(modules, "chart.js/dist/chart.umd.min.js"), os.path.join(static, "vendor", "chart.umd.min.js"))
shutil.copy(os.path.join(modules, "chart.js/LICENSE.md"), os.path.join(static, "vendor", "CHARTJS_LICENSE.md"))

for size in (180, 192, 512):
    cairosvg.svg2png(
        url=os.path.join(app, "static", "logo.svg"),
        write_to=os.path.join(static, "m", "icon-{}.png".format(size)),
        output_width=size,
        output_height=size,
    )
pan = cairosvg.svg2png(url=os.path.join(static, "icons", "shallow-pan-of-food.svg"), output_width=600, output_height=600)
for size in ():
    scale = size * 4
    image = Image.new("RGBA", (scale, scale), (23, 17, 28, 255))
    draw = ImageDraw.Draw(image)
    radius = int(scale * 0.40)
    center = scale // 2
    ring = int(scale * 0.03)
    draw.ellipse([center - radius - ring, center - radius - ring, center + radius + ring, center + radius + ring], fill=(242, 169, 59, 255))
    draw.ellipse([center - radius, center - radius, center + radius, center + radius], fill=(43, 32, 52, 255))
    inner = int(radius * 0.86)
    draw.ellipse([center - inner, center - inner, center + inner, center + inner], fill=(56, 42, 67, 255))
    picture = Image.open(io.BytesIO(pan)).convert("RGBA").resize((int(radius * 1.15), int(radius * 1.15)), Image.LANCZOS)
    image.alpha_composite(picture, (center - picture.width // 2, center - picture.height // 2))
    image.resize((size, size), Image.LANCZOS).convert("RGB").save(os.path.join(static, "m", "icon-{}.png".format(size)))
