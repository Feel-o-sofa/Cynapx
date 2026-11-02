from .locale_manager import LocaleManager
from .palette_parser import load_palette


def route(path):
    def wrap(fn):
        return fn
    return wrap


@route("/palette")
def palette_view():
    return load_palette("palettes/default_palette.json")


def main():
    strings = LocaleManager("assets/lang/en.json")
    print(strings.get("app_title"), palette_view())


def _on_click():
    return "clicked"


HANDLERS = {"click": _on_click}
