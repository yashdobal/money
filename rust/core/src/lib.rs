//! Money's engine: card bills, Safe to spend, the salary plan, spending, Rewards and Trips. First a port of the
//! original JavaScript engine (with its row shaping and the collector's category rules); the tests hold that engine's
//! recorded answers on the demo data (tests/golden), so every figure stays the same unless a change means it to.
pub mod time;
pub mod fmt;
pub mod refine;
pub mod shape;
pub mod engine;
pub mod sms;

pub use engine::Engine;
pub fn version() -> &'static str { env!("CARGO_PKG_VERSION") }
