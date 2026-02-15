use napi_derive::napi;
use rayon::prelude::*;
use serde::{Deserialize, Serialize};
use std::fs;

#[derive(Serialize, Deserialize, Debug)]
pub struct CodeNodeNative {
    pub qualified_name: String,
    pub symbol_type: String,
    pub language: String,
    pub file_path: String,
    pub start_line: i32,
    pub end_line: i32,
    pub loc: i32,
    pub cyclomatic: i32,
    pub signature: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct RawCodeEdgeNative {
    pub from_qname: String,
    pub to_qname: String,
    pub edge_type: String,
    pub dynamic: bool,
}

#[napi(object)]
pub struct DeltaGraphNative {
    pub nodes: Vec<serde_json::Value>,
    pub edges: Vec<serde_json::Value>,
}

#[napi]
pub fn calculate_bulk_line_counts_parallel(file_paths: Vec<String>) -> Vec<i32> {
    file_paths
        .par_iter()
        .map(|path| {
            fs::read_to_string(path)
                .map(|content| content.lines().count() as i32)
                .unwrap_or(0)
        })
        .collect()
}

#[napi]
pub fn calculate_cyclomatic_complexity_native(source: String, decision_points: Vec<String>) -> i32 {
    let mut complexity = 1;
    for word in source.split_whitespace() {
        if decision_points.contains(&word.to_string()) {
            complexity += 1;
        }
    }
    complexity
}
