from pkg.util import log
from pkg import util
from .client import Client


class Base:
    def setup(self):
        log("setup")

    def shared(self):
        return 1


class Service(Base):
    def setup(self):
        super().setup()
        return self.shared()


def build():
    c = Client()
    c.configure()
    svc = Service()
    svc.setup()
    util.factorial(3)
