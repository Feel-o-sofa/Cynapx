from .util import format_num


def configure():
    return "free"


class Client:
    def configure(self):
        return format_num(1)

    def run(self):
        return self.configure()
