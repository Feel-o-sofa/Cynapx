use crate::client::Client;

pub struct Holder {
    c: Client,
}

pub fn make() -> Client {
    Client
}

impl Holder {
    pub fn via_field(&self) {
        self.c.configure();
    }
}

pub fn via_return() {
    let c = make();
    c.configure();
}

pub fn via_chain() {
    make().configure();
}
