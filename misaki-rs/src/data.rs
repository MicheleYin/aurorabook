use std::collections::HashMap;
use serde_json;
use crate::lexicon::PhonemeEntry;

pub fn load_us_gold() -> HashMap<String, PhonemeEntry> {
    let data = include_str!("../data/us_gold.json");
    serde_json::from_str(data).unwrap_or_default()
}

pub fn load_us_silver() -> HashMap<String, PhonemeEntry> {
    let data = include_str!("../data/us_silver.json");
    serde_json::from_str(data).unwrap_or_default()
}

pub fn load_gb_gold() -> HashMap<String, PhonemeEntry> {
    let data = include_str!("../data/gb_gold.json");
    serde_json::from_str(data).unwrap_or_default()
}

pub fn load_gb_silver() -> HashMap<String, PhonemeEntry> {
    let data = include_str!("../data/gb_silver.json");
    serde_json::from_str(data).unwrap_or_default()
}
