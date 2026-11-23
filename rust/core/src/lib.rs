//! Money's engine in Rust: a port of app/engine.js (with app/shape.js and the collector's category rules), checked
//! figure by figure against it on the demo data (tests/parity.rs runs both and compares their snapshots).
pub mod time;
pub mod fmt;
pub mod refine;
pub mod shape;
pub mod engine;

pub use engine::Engine;
pub fn version() -> &'static str { env!("CARGO_PKG_VERSION") }
