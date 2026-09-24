"""Render the brand SVG into a multi-size Windows icon (requires Pillow)."""

from math import cos, radians, sin
from pathlib import Path
import re
from xml.etree import ElementTree

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "public/assets/reelori-mark.svg"
TARGET = ROOT / "packaging/windows/Reelori.ico"
SIZE = 1024
SCALE = SIZE / 64
TOKENS = re.compile(r"[MLHVCZ]|-?\d+(?:\.\d+)?")


def scaled(point):
    return tuple(round(number * SCALE) for number in point)


def flatten_path(path):
    tokens = TOKENS.findall(path)
    points = []
    position = (0.0, 0.0)
    start = position
    index = 0
    command = None
    while index < len(tokens):
        if tokens[index].isalpha():
            command = tokens[index]
            index += 1
        if command == "Z":
            position = start
            points.append(scaled(position))
            command = None
            continue
        if command == "M" or command == "L":
            position = (float(tokens[index]), float(tokens[index + 1]))
            index += 2
            if command == "M":
                start = position
                command = "L"
            points.append(scaled(position))
        elif command == "H":
            position = (float(tokens[index]), position[1])
            index += 1
            points.append(scaled(position))
        elif command == "V":
            position = (position[0], float(tokens[index]))
            index += 1
            points.append(scaled(position))
        elif command == "C":
            controls = [float(value) for value in tokens[index:index + 6]]
            index += 6
            p0 = position
            p1 = (controls[0], controls[1])
            p2 = (controls[2], controls[3])
            p3 = (controls[4], controls[5])
            for step in range(1, 41):
                t = step / 40
                inverse = 1 - t
                point = (
                    inverse**3 * p0[0] + 3 * inverse**2 * t * p1[0]
                    + 3 * inverse * t**2 * p2[0] + t**3 * p3[0],
                    inverse**3 * p0[1] + 3 * inverse**2 * t * p1[1]
                    + 3 * inverse * t**2 * p2[1] + t**3 * p3[1],
                )
                points.append(scaled(point))
            position = p3
        else:
            raise ValueError(f"Unsupported SVG path command: {command}")
    return points


image = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
root = ElementTree.parse(SOURCE).getroot()
for element in root:
    name = element.tag.rsplit("}", 1)[-1]
    fill = element.attrib.get("fill")
    if name == "path":
        draw.polygon(flatten_path(element.attrib["d"]), fill=fill)
    elif name == "rect":
        x = float(element.attrib.get("x", "0"))
        y = float(element.attrib.get("y", "0"))
        width = float(element.attrib["width"])
        height = float(element.attrib["height"])
        transform = element.attrib.get("transform")
        if transform:
            angle, cx, cy = (float(value) for value in re.findall(
                r"-?\d+(?:\.\d+)?", transform
            ))
            theta = radians(angle)
            corners = [(x, y), (x + width, y), (x + width, y + height),
                       (x, y + height)]
            rotated = [
                scaled((cx + (px - cx) * cos(theta) - (py - cy) * sin(theta),
                        cy + (px - cx) * sin(theta) + (py - cy) * cos(theta)))
                for px, py in corners
            ]
            draw.polygon(rotated, fill=fill)
        else:
            draw.rounded_rectangle(
                (round(x * SCALE), round(y * SCALE),
                 round((x + width) * SCALE), round((y + height) * SCALE)),
                radius=round(float(element.attrib.get("rx", "0")) * SCALE),
                fill=fill,
            )

image.save(TARGET, format="ICO", sizes=[
    (16, 16), (24, 24), (32, 32), (48, 48),
    (64, 64), (128, 128), (256, 256),
])
print(TARGET)
