#!/usr/bin/env python3
"""
PNG to SVG converter for VSCode extension icons.
Creates a theme-compatible SVG that uses currentColor for VSCode theme support.

Usage:
    uv run --with pillow png_to_svg.py
    or
    python png_to_svg.py
"""

import os
from pathlib import Path


def create_themed_svg(svg_path: str) -> None:
    """
    Create a theme-compatible SVG that uses currentColor.
    This version works with VSCode's light/dark themes.

    Design based on icon.png:
    - Robot head with rounded corners and gradient fill
    - Antenna on top with ball
    - Two circular eyes
    - Rectangular mouth/speaker
    - Signal waves on both sides
    """
    svg_content = '''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
  <!-- Serial Agent: Robot head with signal waves -->

  <!-- Robot head -->
  <rect x="28" y="32" width="72" height="64" rx="12" fill="currentColor" opacity="0.2"/>

  <!-- Antenna -->
  <line x1="64" y1="32" x2="64" y2="16"/>
  <circle cx="64" cy="12" r="6" fill="currentColor"/>

  <!-- Left eye -->
  <circle cx="48" cy="56" r="8" fill="currentColor"/>

  <!-- Right eye -->
  <circle cx="80" cy="56" r="8" fill="currentColor"/>

  <!-- Mouth/speaker -->
  <rect x="48" y="72" width="32" height="8" rx="2" fill="currentColor" opacity="0.7"/>

  <!-- Signal waves (left) -->
  <path d="M16 48 Q8 64 16 80" stroke-width="2.5" opacity="0.7"/>
  <path d="M6 36 Q-6 64 6 92" stroke-width="2" opacity="0.5"/>

  <!-- Signal waves (right) -->
  <path d="M112 48 Q120 64 112 80" stroke-width="2.5" opacity="0.7"/>
  <path d="M122 36 Q134 64 122 92" stroke-width="2" opacity="0.5"/>
</svg>
'''

    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)

    print(f"Created theme-compatible SVG: {svg_path}")


def create_colored_svg(svg_path: str) -> None:
    """
    Create a colored SVG that matches the original icon.png design.
    Uses cyan-teal gradient like the original.
    """
    svg_content = '''<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <!-- Serial Agent: Robot head with signal waves (colored version) -->

  <defs>
    <!-- Head gradient (cyan to teal) - matches original icon.png -->
    <linearGradient id="headGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#00d4ff;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#0099cc;stop-opacity:1" />
    </linearGradient>
  </defs>

  <!-- Robot head background -->
  <rect x="28" y="32" width="72" height="64" rx="12"
        fill="url(#headGradient)" stroke="#0088aa" stroke-width="3"/>

  <!-- Antenna -->
  <line x1="64" y1="32" x2="64" y2="16" stroke="#0088aa" stroke-width="3" stroke-linecap="round"/>
  <circle cx="64" cy="12" r="6" fill="#0088aa"/>

  <!-- Left eye -->
  <circle cx="48" cy="56" r="8" fill="#003344"/>

  <!-- Right eye -->
  <circle cx="80" cy="56" r="8" fill="#003344"/>

  <!-- Mouth/speaker -->
  <rect x="48" y="72" width="32" height="8" rx="2" fill="#003344" opacity="0.8"/>

  <!-- Signal waves (left) -->
  <path d="M16 48 Q8 64 16 80" stroke="#0088aa" stroke-width="2.5" fill="none" opacity="0.7"/>
  <path d="M6 36 Q-6 64 6 92" stroke="#0088aa" stroke-width="2" fill="none" opacity="0.5"/>

  <!-- Signal waves (right) -->
  <path d="M112 48 Q120 64 112 80" stroke="#0088aa" stroke-width="2.5" fill="none" opacity="0.7"/>
  <path d="M122 36 Q134 64 122 92" stroke="#0088aa" stroke-width="2" fill="none" opacity="0.5"/>
</svg>
'''

    with open(svg_path, 'w', encoding='utf-8') as f:
        f.write(svg_content)

    print(f"Created colored SVG: {svg_path}")


def main():
    # Get the directory where this script is located
    script_dir = Path(__file__).parent
    png_file = script_dir / "icon.png"
    svg_file = script_dir / "icon.svg"

    print(f"PNG to SVG Converter for VSCode Extensions")
    print(f"Input: {png_file}")
    print(f"Output: {svg_file}")
    print("-" * 50)

    # Check if PNG exists
    if not png_file.exists():
        print(f"Warning: {png_file} not found, creating SVG anyway...")

    # For VSCode activitybar icons, use currentColor for theme compatibility
    # This is the recommended approach
    create_themed_svg(str(svg_file))

    print("-" * 50)
    print("Done!")
    print("")
    print("Note: The SVG uses 'currentColor' which will automatically")
    print("adapt to VSCode's theme (light/dark mode).")


if __name__ == "__main__":
    main()
