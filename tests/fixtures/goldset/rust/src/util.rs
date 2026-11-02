pub fn format(n: i32) -> String {
    n.to_string()
}

pub fn log(msg: &str) {
    let _ = msg;
}

pub fn factorial(n: u64) -> u64 {
    if n <= 1 { 1 } else { n * factorial(n - 1) }
}
