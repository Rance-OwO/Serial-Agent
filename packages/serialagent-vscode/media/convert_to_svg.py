#!/usr/bin/env python3
"""Convert SerialAgent.png to a white SVG for VSCode activitybar."""

from PIL import Image
from pathlib import Path
import base64
from io import BytesIO

script_dir = Path(__file__).parent
input_png = script_dir / 'SerialAgent.png'
output_svg = script_dir / 'SerialAgent_icon.svg'

print(f"Converting {input_png}...")

# Open and resize to 128x128
img = Image.open(input_png)
img = img.resize((128, 128), Image.Resampling.LANCZOS)

# Convert to grayscale, then to white (with alpha based on brightness)
img_rgba = img.convert('RGBA')
pixels = img_rgba.load()

width, height = img_rgba.size
for y in range(height):
    for x in range(width):
        r, g, b, a = pixels[x, y]
        # Calculate brightness
        brightness = (r + g + b) / 3
        # Convert to white with alpha based on original brightness
        # Dark areas become more opaque white, light areas become transparent
        new_alpha = int(255 * (1 - brightness / 255))
        pixels[x, y] = (255, 255, 255, new_alpha)

# Save as PNG first (base64 embedded in SVG)
buffer = BytesIO()
img_rgba.save(buffer, format='PNG')
png_data = base64.b64encode(buffer.getvalue()).decode('utf-8')

# Create SVG with embedded PNG
svg_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="128" height="128" viewBox="0 0 128 128">
  <image width="128" height="128" xlink:href="data:image/png;base64,{png_data}"/>
</svg>
'''

with open(output_svg, 'w', encoding='utf-8') as f:
    f.write(svg_content)

print(f"Output: {output_svg}")
print(f"Size: {output_svg.stat().st_size:,} bytes")
