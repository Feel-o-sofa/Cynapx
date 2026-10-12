use crate::util::format;

pub fn configure() -> String {
    String::from("free")
}

pub struct Client;

impl Client {
    pub fn configure(&self) -> String {
        format(1)
    }

    pub fn run(&self) -> String {
        self.configure()
    }
}
