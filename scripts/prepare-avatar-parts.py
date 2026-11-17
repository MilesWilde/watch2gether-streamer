"""Extract trusted OpenMoji 15.1.0 geometry; emit JSON for the avatar compositor."""
import copy
import json
import urllib.request
import xml.etree.ElementTree as ET

ET.register_namespace("", "http://www.w3.org/2000/svg")
ROOT = "https://raw.githubusercontent.com/hfg-gmuend/openmoji/15.1.0/"
sources = {}
parts = {}


def load(code):
    text = urllib.request.urlopen(ROOT + "color/svg/" + code + ".svg", timeout=30).read().decode()
    sources[code + ".svg"] = text
    root = ET.fromstring(text)
    groups = {node.get("id"): list(node) for node in root}
    return groups["color"], groups["line"]


def fragment(nodes, tint=False):
    group = ET.Element("g")
    for node in nodes:
        node = copy.deepcopy(node)
        for descendant in node.iter():
            descendant.tag = descendant.tag.split("}")[-1]
            if tint and descendant.get("fill") not in (None, "none", "#fff", "#ffffff"):
                descendant.set("fill", "#AVATAR_COLOR")
        group.append(node)
    return ET.tostring(group, encoding="unicode")


cat_color, cat_line = load("1F431")
parts["catFill"] = fragment(cat_color[:1], True)
parts["catEyes"] = fragment(cat_line[:2])
parts["catMouth"] = fragment([cat_color[1], cat_line[2], cat_line[3], cat_line[7]])
parts["catEars"] = fragment([cat_color[0], cat_line[4], cat_line[5], cat_line[8]], True)
parts["catWhiskers"] = fragment([cat_line[i] for i in [6, 9, 10, 12]])
beetle_color, beetle_line = load("1F41E")
parts["bugFace"] = fragment([beetle_color[1], beetle_line[8]], True)
parts["bugSpots"] = fragment([node for node in beetle_line if node.tag.endswith("circle")])
parts["bugEyes"] = fragment([node for node in beetle_line if node.tag.endswith("circle")][:2])
parts["beetleLimbs"] = fragment(beetle_line[:6])
ant_color, ant_line = load("1F41C")
parts["antLimbs"] = fragment(ant_line[:6])
parts["antAntennae"] = fragment(ant_line[6:8])
mosquito_color, mosquito_line = load("1F99F")
parts["proboscis"] = fragment([mosquito_line[3]])
parts["mosquitoWings"] = fragment(mosquito_color[2:4] + mosquito_line[6:8], True)
butterfly_color, butterfly_line = load("1F98B")
parts["butterflyWings"] = fragment(butterfly_color[:4] + butterfly_line[:4], True)
sources["LICENSE.txt"] = urllib.request.urlopen(ROOT + "LICENSE.txt", timeout=30).read().decode()
print(json.dumps({"sources": sources, "parts": parts}))
