use crate::client::Client;

pub struct Worker;

impl Worker {
    pub fn new() -> Self {
        Worker
    }

    pub fn run(&self) {}
}

pub fn build() {
    let c: Client = Client;
    c.configure();
    let w = Worker::new();
    w.run();
}
