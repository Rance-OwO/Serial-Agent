#!/usr/bin/env python3
"""
Convert SerialAgent.svg to a VSCode activitybar-compatible icon.
- Removes background
- Converts all colors to a single color (white by default)
- Optimizes the SVG for VSCode sidebar usage
"""

import re
import sys
from pathlib import Path


def convert_svg_for_vscode(input_path: str, output_path: str, fill_color: str = "#FFFFFF"):
    """Convert a complex SVG to a single-color version for VSCode activitybar."""

    with open(input_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Remove background (usually the first white/light fill)
    # Remove paths with very light fills (background)
    bg_pattern = r'<path[^>]*fill="#F[A-Fa-f0-9]{6}"[^>]*/>\s*'
    content = re.sub(bg_pattern, '', content, count=5)

    # Also remove common background colors
    for bg_color in ['#FEFEFD', '#FCFDFC', '#FCFCFB', '#FBFBFA', '#F9FAFA', '#FFFFFF']:
        bg_pattern = rf'<path[^>]*fill="{bg_color}"[^>]*/>\s*'
        content = re.sub(bg_pattern, '', content, count=1)

    # Replace all fill colors with the target color
    content = re.sub(r'fill="#[A-Fa-f0-9]{6}"', f'fill="{fill_color}"', content)

    # Remove stroke colors if any, replace with target
    content = re.sub(r'stroke="#[A-Fa-f0-9]{6}"', f'stroke="{fill_color}"', content)

    # Add opacity for better visibility in both themes
    # VSCode handles white icons in dark theme and can invert for light theme

    # Update SVG dimensions for VSCode (24x24 or 128x128 viewBox is typical)
    content = re.sub(
        r'<svg([^>]*)width="2048" height="2048"',
        r'<svg\1width="128" height="128"',
        content
    )

    # Write output
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)

    # Report sizes
    original_size = Path(input_path).stat().st_size
    new_size = Path(output_path).stat().st_size
    print(f"Original: {original_size:,} bytes")
    print(f"Converted: {new_size:,} bytes")
    print(f"Reduction: {(1 - new_size/original_size)*100:.1f}%")


def create_vscode_activitybar_icon(input_path: str, output_path: str):
    """
    Create a proper VSCode activitybar icon.
    VSCode expects a single-color icon that it can theme.
    """
    import xml.etree.ElementTree as ET

    # Parse SVG
    tree = ET.parse(input_path)
    root = tree.getroot()

    # Get namespace if any
    ns = {'svg': 'http://www.w3.org/2000/svg'}

    # Collect all path data
    paths = []
    for path in root.iter():
        if path.tag.endswith('path') or 'path' in path.tag:
            d = path.get('d')
            fill = path.get('fill', '')
            if d and fill and not fill.upper().startswith('#F'):  # Skip background
                paths.append(d)

    # Create new simplified SVG
    svg_content = f'''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 2048 2048" width="128" height="128">
  <g fill="#FFFFFF">
'''
    for d in paths:
        svg_content += f'    <path d="{d}"/>\n'

    svg_content += '''  </g>
</svg>
'''

    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)

    print(f"Created: {output_path}")
    print(f"Paths included: {len(paths)}")


if __name__ == '__main__':
    script_dir = Path(__file__).parent
    input_file = script_dir / 'SerialAgent.svg'
    output_file = script_dir / 'SerialAgent_vscode.svg'

    if not input_file.exists():
        print(f"Error: {input_file} not found")
        sys.exit(1)

    print("Converting SVG for VSCode activitybar...")
    print(f"Input: {input_file}")
    print(f"Output: {output_file}")
    print()

    # Method 1: Simple color replacement
    convert_svg_for_vscode(str(input_file), str(output_file))

    print()
    print("Done! Check the output file.")
    print()
    print("To use in package.json, update:")
    print('  "icon": "media/SerialAgent_vscode.svg"')
