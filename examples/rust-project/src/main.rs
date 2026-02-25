use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug)]
struct Greeting {
    message: String,
}

#[tokio::main]
async fn main() {
    let greeting = Greeting {
        message: "Hello from Dependicus Rust example".to_string(),
    };
    println!("{:?}", greeting);
}
