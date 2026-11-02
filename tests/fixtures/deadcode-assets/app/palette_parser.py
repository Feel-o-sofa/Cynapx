import json


def load_palette(path):
    with open(path) as f:
        return json.load(f)


def _unused_helper(colors):
    return [c.upper() for c in colors]


def remove_background_ai_torch(image):
    return image
