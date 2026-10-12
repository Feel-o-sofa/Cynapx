import logging

from .client import Client, configure
from .util import log, factorial


def use_client(c: Client):
    c.configure()
    configure()
    log(str(factorial(5)))


def shutdown():
    logging.log(20, "bye")
