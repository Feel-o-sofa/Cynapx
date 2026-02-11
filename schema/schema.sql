-- schema/schema.sql
-- Single source of truth for the Cynapx database schema.

-- Node table: Stores symbols (files, classes, methods, etc.)
CREATE TABLE IF NOT EXISTS nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    qualified_name TEXT NOT NULL UNIQUE,
    symbol_type TEXT NOT NULL, -- file, module, class, interface, method, function, field, test
    language TEXT NOT NULL,
    file_path TEXT NOT NULL,
    start_line INTEGER NOT NULL,
    end_line INTEGER NOT NULL,
    visibility TEXT NOT NULL, -- public, protected, internal, private
    is_generated INTEGER NOT NULL DEFAULT 0, -- boolean (0 or 1)
    last_updated_commit TEXT NOT NULL,
    version INTEGER NOT NULL,
    
    -- Symbol-specific attributes (logical_scheme_and_indexing_strat.md)
    checksum TEXT,       -- for symbol_type = 'file'
    modifiers TEXT,      -- for class/interface/method/function (JSON array of strings)
    signature TEXT,      -- for method/function
    return_type TEXT,    -- for method/function
    field_type TEXT,     -- for field
    
    -- Metrics (api_specification.md)
    loc INTEGER DEFAULT 0,
    cyclomatic INTEGER DEFAULT 0,
    fan_in INTEGER DEFAULT 0,
    fan_out INTEGER DEFAULT 0
);

-- Edge table: Stores relationships between symbols
CREATE TABLE IF NOT EXISTS edges (
    from_id INTEGER NOT NULL,
    to_id INTEGER NOT NULL,
    edge_type TEXT NOT NULL, -- defines, contains, namespace_of, inherits, implements, calls, overrides, reads, writes, tests, depends_on
    dynamic INTEGER NOT NULL DEFAULT 0, -- boolean (0 or 1)
    call_site_line INTEGER,
    
    FOREIGN KEY (from_id) REFERENCES nodes(id) ON DELETE CASCADE,
    FOREIGN KEY (to_id) REFERENCES nodes(id) ON DELETE CASCADE
);

-- Mandatory Indexes (logical_scheme_and_indexing_strat.md Section 5.1)
CREATE INDEX IF NOT EXISTS idx_nodes_qualified_name ON nodes (qualified_name);
CREATE UNIQUE INDEX IF NOT EXISTS idx_nodes_symbol_type_qualified_name ON nodes (symbol_type, qualified_name);
CREATE INDEX IF NOT EXISTS idx_nodes_file_path ON nodes (file_path);
CREATE INDEX IF NOT EXISTS idx_nodes_version ON nodes (version);

-- Optimization Indexes (logical_scheme_and_indexing_strat.md Section 5.2)
CREATE INDEX IF NOT EXISTS idx_edges_from_id ON edges (from_id);
CREATE INDEX IF NOT EXISTS idx_edges_to_id ON edges (to_id);
CREATE INDEX IF NOT EXISTS idx_edges_edge_type ON edges (edge_type);
CREATE INDEX IF NOT EXISTS idx_edges_edge_type_dynamic ON edges (edge_type, dynamic);
CREATE INDEX IF NOT EXISTS idx_nodes_symbol_type_language ON nodes (symbol_type, language);


-- FTS5 Virtual Table for Fast Symbol Search (Task 2)
CREATE VIRTUAL TABLE IF NOT EXISTS fts_symbols USING fts5(
    qualified_name,
    symbol_type,
    file_path,
    content='nodes',
    content_rowid='id'
);

-- Triggers to ensure FTS index is kept in sync with the nodes table
CREATE TRIGGER IF NOT EXISTS nodes_ai AFTER INSERT ON nodes BEGIN
  INSERT INTO fts_symbols(rowid, qualified_name, symbol_type, file_path) VALUES (new.id, new.qualified_name, new.symbol_type, new.file_path);
END;

CREATE TRIGGER IF NOT EXISTS nodes_ad AFTER DELETE ON nodes BEGIN
  INSERT INTO fts_symbols(fts_symbols, rowid, qualified_name, symbol_type, file_path) VALUES('delete', old.id, old.qualified_name, old.symbol_type, old.file_path);
END;

CREATE TRIGGER IF NOT EXISTS nodes_au AFTER UPDATE ON nodes BEGIN
  INSERT INTO fts_symbols(fts_symbols, rowid, qualified_name, symbol_type, file_path) VALUES('delete', old.id, old.qualified_name, old.symbol_type, old.file_path);
  INSERT INTO fts_symbols(rowid, qualified_name, symbol_type, file_path) VALUES (new.id, new.qualified_name, new.symbol_type, new.file_path);
END;

-- Metadata table for tracking system state (Task 13-1)
CREATE TABLE IF NOT EXISTS index_metadata (
    key TEXT PRIMARY KEY,
    value TEXT
);

-- Initialize global counters
INSERT OR IGNORE INTO index_metadata (key, value) VALUES ('total_calls_count', '0');

-- Trigger to auto-update fan_in/out metrics on nodes AND global counter when an edge is inserted
CREATE TRIGGER IF NOT EXISTS edges_ai_metrics AFTER INSERT ON edges
WHEN new.edge_type = 'calls'
BEGIN
  UPDATE nodes SET fan_out = fan_out + 1 WHERE id = new.from_id;
  UPDATE nodes SET fan_in = fan_in + 1 WHERE id = new.to_id;
  UPDATE index_metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'total_calls_count';
END;

-- Trigger to auto-update fan_in/out metrics on nodes AND global counter when an edge is deleted
CREATE TRIGGER IF NOT EXISTS edges_ad_metrics AFTER DELETE ON edges
WHEN old.edge_type = 'calls'
BEGIN
  UPDATE nodes SET fan_out = fan_out - 1 WHERE id = old.from_id;
  UPDATE nodes SET fan_in = fan_in - 1 WHERE id = old.to_id;
  UPDATE index_metadata SET value = CAST(value AS INTEGER) - 1 WHERE key = 'total_calls_count';
END;

-- Handle edge type updates (rare but possible)
CREATE TRIGGER IF NOT EXISTS edges_au_metrics AFTER UPDATE ON edges
BEGIN
  -- If type changed from non-calls to calls
  UPDATE nodes SET fan_out = fan_out + 1 WHERE id = new.from_id AND old.edge_type != 'calls' AND new.edge_type = 'calls';
  UPDATE nodes SET fan_in = fan_in + 1 WHERE id = new.to_id AND old.edge_type != 'calls' AND new.edge_type = 'calls';
  UPDATE index_metadata SET value = CAST(value AS INTEGER) + 1 WHERE key = 'total_calls_count' AND old.edge_type != 'calls' AND new.edge_type = 'calls';
  
  -- If type changed from calls to non-calls
  UPDATE nodes SET fan_out = fan_out - 1 WHERE id = old.from_id AND old.edge_type = 'calls' AND new.edge_type != 'calls';
  UPDATE nodes SET fan_in = fan_in - 1 WHERE id = old.to_id AND old.edge_type = 'calls' AND new.edge_type != 'calls';
  UPDATE index_metadata SET value = CAST(value AS INTEGER) - 1 WHERE key = 'total_calls_count' AND old.edge_type = 'calls' AND new.edge_type != 'calls';
END;
