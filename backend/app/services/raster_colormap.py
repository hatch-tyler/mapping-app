"""Raster color ramp definitions and colormap builder for rio-tiler rendering.

Mirrors the color ramp definitions from frontend/src/utils/colorRamps.ts
to ensure consistent rendering between frontend previews and backend tiles.
"""

from __future__ import annotations

# Color ramp stop definitions: list of (R, G, B, A) tuples.
# These match the frontend colorRamps.ts exactly.
COLOR_RAMPS: dict[str, list[tuple[int, int, int, int]]] = {
    "viridis": [
        (68, 1, 84, 255),
        (72, 40, 120, 255),
        (62, 74, 137, 255),
        (49, 104, 142, 255),
        (38, 130, 142, 255),
        (31, 158, 137, 255),
        (53, 183, 121, 255),
        (109, 205, 89, 255),
        (180, 222, 44, 255),
        (253, 231, 37, 255),
    ],
    "blues": [
        (247, 251, 255, 255),
        (222, 235, 247, 255),
        (198, 219, 239, 255),
        (158, 202, 225, 255),
        (107, 174, 214, 255),
        (66, 146, 198, 255),
        (33, 113, 181, 255),
        (8, 81, 156, 255),
        (8, 48, 107, 255),
    ],
    "greens": [
        (247, 252, 245, 255),
        (229, 245, 224, 255),
        (199, 233, 192, 255),
        (161, 217, 155, 255),
        (116, 196, 118, 255),
        (65, 171, 93, 255),
        (35, 139, 69, 255),
        (0, 109, 44, 255),
        (0, 68, 27, 255),
    ],
    "reds": [
        (255, 245, 240, 255),
        (254, 224, 210, 255),
        (252, 187, 161, 255),
        (252, 146, 114, 255),
        (251, 106, 74, 255),
        (239, 59, 44, 255),
        (203, 24, 29, 255),
        (165, 15, 21, 255),
        (103, 0, 13, 255),
    ],
    "oranges": [
        (255, 245, 235, 255),
        (254, 230, 206, 255),
        (253, 208, 162, 255),
        (253, 174, 107, 255),
        (253, 141, 60, 255),
        (241, 105, 19, 255),
        (217, 72, 1, 255),
        (166, 54, 3, 255),
        (127, 39, 4, 255),
    ],
    "purples": [
        (252, 251, 253, 255),
        (239, 237, 245, 255),
        (218, 218, 235, 255),
        (188, 189, 220, 255),
        (158, 154, 200, 255),
        (128, 125, 186, 255),
        (106, 81, 163, 255),
        (84, 39, 143, 255),
        (63, 0, 125, 255),
    ],
    "rdylgn": [
        (165, 0, 38, 255),
        (215, 48, 39, 255),
        (244, 109, 67, 255),
        (253, 174, 97, 255),
        (254, 224, 139, 255),
        (255, 255, 191, 255),
        (217, 239, 139, 255),
        (166, 217, 106, 255),
        (102, 189, 99, 255),
        (26, 152, 80, 255),
        (0, 104, 55, 255),
    ],
    "rdbu": [
        (103, 0, 31, 255),
        (178, 24, 43, 255),
        (214, 96, 77, 255),
        (244, 165, 130, 255),
        (253, 219, 199, 255),
        (247, 247, 247, 255),
        (209, 229, 240, 255),
        (146, 197, 222, 255),
        (67, 147, 195, 255),
        (33, 102, 172, 255),
        (5, 48, 97, 255),
    ],
    "spectral": [
        (158, 1, 66, 255),
        (213, 62, 79, 255),
        (244, 109, 67, 255),
        (253, 174, 97, 255),
        (254, 224, 139, 255),
        (255, 255, 191, 255),
        (230, 245, 152, 255),
        (171, 221, 164, 255),
        (102, 194, 165, 255),
        (50, 136, 189, 255),
        (94, 79, 162, 255),
    ],
    "cividis": [
        (0, 32, 77, 255),
        (0, 67, 106, 255),
        (54, 92, 108, 255),
        (91, 112, 108, 255),
        (126, 132, 107, 255),
        (163, 152, 97, 255),
        (199, 174, 73, 255),
        (229, 199, 44, 255),
        (253, 231, 37, 255),
    ],
    "inferno": [
        (0, 0, 4, 255),
        (40, 11, 84, 255),
        (101, 21, 110, 255),
        (159, 42, 99, 255),
        (212, 72, 66, 255),
        (245, 125, 21, 255),
        (250, 186, 12, 255),
        (237, 239, 93, 255),
        (252, 255, 164, 255),
    ],
    "plasma": [
        (13, 8, 135, 255),
        (75, 3, 161, 255),
        (126, 3, 168, 255),
        (168, 34, 150, 255),
        (204, 71, 120, 255),
        (230, 111, 81, 255),
        (248, 159, 28, 255),
        (240, 210, 35, 255),
        (240, 249, 33, 255),
    ],
    "puor": [
        (45, 0, 75, 255),
        (84, 39, 136, 255),
        (128, 115, 172, 255),
        (178, 171, 210, 255),
        (216, 218, 235, 255),
        (247, 247, 247, 255),
        (254, 224, 182, 255),
        (253, 184, 99, 255),
        (224, 130, 20, 255),
        (179, 88, 6, 255),
        (127, 59, 8, 255),
    ],
    "brtl": [
        (84, 48, 5, 255),
        (140, 81, 10, 255),
        (191, 129, 45, 255),
        (223, 194, 125, 255),
        (246, 232, 195, 255),
        (245, 245, 245, 255),
        (199, 234, 229, 255),
        (128, 205, 193, 255),
        (53, 151, 143, 255),
        (1, 102, 94, 255),
        (0, 60, 48, 255),
    ],
}

# Default categorical palette (matches frontend CATEGORY_PALETTE)
CATEGORICAL_PALETTE: list[tuple[int, int, int, int]] = [
    (66, 133, 244, 255),
    (52, 168, 83, 255),
    (251, 188, 4, 255),
    (234, 67, 53, 255),
    (154, 160, 166, 255),
    (255, 112, 67, 255),
    (0, 172, 193, 255),
    (124, 77, 255, 255),
    (233, 30, 99, 255),
    (0, 150, 136, 255),
    (255, 193, 7, 255),
    (63, 81, 181, 255),
]


def _lerp(a: int, b: int, t: float) -> int:
    return round(a + (b - a) * t)


def _lerp_color(
    c1: tuple[int, int, int, int], c2: tuple[int, int, int, int], t: float
) -> tuple[int, int, int, int]:
    return (
        _lerp(c1[0], c2[0], t),
        _lerp(c1[1], c2[1], t),
        _lerp(c1[2], c2[2], t),
        _lerp(c1[3], c2[3], t),
    )


def interpolate_ramp(ramp_name: str, t: float) -> tuple[int, int, int, int]:
    """Interpolate a color at position t (0-1) along a named ramp."""
    stops = COLOR_RAMPS.get(ramp_name)
    if not stops:
        return (128, 128, 128, 255)
    t = max(0.0, min(1.0, t))
    n = len(stops)
    if n == 1:
        return stops[0]
    scaled = t * (n - 1)
    lo = int(scaled)
    hi = min(lo + 1, n - 1)
    return _lerp_color(stops[lo], stops[hi], scaled - lo)


def build_continuous_colormap(
    ramp_name: str, num_entries: int = 256
) -> dict[int, tuple[int, int, int, int]]:
    """Build a rio-tiler compatible colormap dict from a named color ramp.

    Returns {0: (R,G,B,A), 1: (R,G,B,A), ..., 255: (R,G,B,A)}.
    """
    cmap: dict[int, tuple[int, int, int, int]] = {}
    for i in range(num_entries):
        t = i / max(num_entries - 1, 1)
        cmap[i] = interpolate_ramp(ramp_name, t)
    return cmap


def build_classified_colormap(
    value_map: dict[str, dict],
) -> dict[int, tuple[int, int, int, int]]:
    """Build a rio-tiler colormap from a classified value_map.

    value_map: {"1": {"color": [R,G,B,A], "label": "..."}, ...}
    Returns {pixel_value: (R,G,B,A), ...} with unmapped values transparent.
    """
    cmap: dict[int, tuple[int, int, int, int]] = {}
    # Default all entries to transparent
    for i in range(256):
        cmap[i] = (0, 0, 0, 0)
    for val_str, entry in value_map.items():
        try:
            val = int(val_str)
        except (ValueError, TypeError):
            continue
        color = entry.get("color", [128, 128, 128, 255])
        cmap[val] = (color[0], color[1], color[2], color[3] if len(color) > 3 else 255)
    return cmap


def get_category_color(index: int) -> tuple[int, int, int, int]:
    """Get a color from the categorical palette by index."""
    return CATEGORICAL_PALETTE[index % len(CATEGORICAL_PALETTE)]
