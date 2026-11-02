from app.palette_parser import load_palette


def test_load_palette():
    assert load_palette("palettes/default_palette.json")


def helper_only_tests_use():
    return 1
