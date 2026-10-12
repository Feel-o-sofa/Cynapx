mod client;
mod util;

use client::{configure, Client};

fn use_client(c: &Client) {
    c.configure();
    configure();
    util::log(&util::factorial(5).to_string());
}

fn shutdown() -> String {
    std::fmt::format(format_args!("bye"))
}

fn main() {}
