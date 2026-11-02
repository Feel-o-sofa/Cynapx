from .client import Client


def make_client() -> Client:
    return Client()


class Holder:
    def __init__(self):
        self.client = Client()

    def use(self):
        self.client.configure()


def via_return():
    c = make_client()
    c.configure()


def via_chain():
    make_client().configure()
