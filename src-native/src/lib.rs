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

// NOTE (Phase 13-5 / H-5): the previous `calculate_cyclomatic_complexity_native`
// counted whitespace-split tokens against a decision-point word list. That was
// fundamentally wrong — `if(x)` (no space) was missed, while `if` inside string
// literals/comments was counted, and the keyword list never matched non-TS
// grammar node types. Cyclomatic complexity for every language is now computed
// AST-accurately on the JS side via
// `MetricsCalculator.calculateCyclomaticComplexityTreeSitter()` walking the real
// tree-sitter syntax tree, so the broken native token counter has been removed
// to keep a single, correct code path. (`calculate_bulk_line_counts_parallel`
// above remains the only native helper, and it is line-count only.)
