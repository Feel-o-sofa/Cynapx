import json


class LocaleManager:
    def __init__(self, path):
        self.strings = self._load(path)

    def _load(self, path):
        with open(path) as f:
            return json.load(f)

    def get(self, key, fallback=""):
        return self.strings.get(key, fallback)

    @property
    def language(self):
        return self.strings.get("language", "en")

    def __repr__(self):
        return "LocaleManager()"
