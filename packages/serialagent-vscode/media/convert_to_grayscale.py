#!/usr/bin/env python3
"""Convert SerialAgent.png to grayscale PNG for VSCode activitybar."""

from PIL import Image
from pathlib import Path

script_dir = Path(__file__).parent
input_png = script_dir / 'SerialAgent.png'
output_png = script_dir / 'SerialAgent_gray.png'

print(f"Converting {input_png}...")

# Open and resize to 128x128
img = Image.open(input_png)
print(f"Original size: {img.size}")
print(f"Original mode: {img.mode}")

# Resize to 128x128 for VSCode activitybar
img = img.resize((128, 128), Image.Resampling.LANCZOS)
print(f"Resized to: {img.size}")

# Convert to grayscale
img_gray = img.convert('L')
img_gray.save(output_png)
print(f"Step: Converted to grayscale")

print(f"\nOutput: {output_png}")
print(f"Size: {output_png.stat().st_size:,} bytes")
