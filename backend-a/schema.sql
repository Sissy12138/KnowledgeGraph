PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS papers (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_library_id INTEGER NOT NULL,
    source_item_key TEXT NOT NULL,
    item_type TEXT NOT NULL,
    title TEXT NOT NULL,
    abstract TEXT,
    date_text TEXT,
    year INTEGER,
    doi TEXT,
    url TEXT,
    journal_name TEXT,
    issn TEXT,
    eissn TEXT,
    status TEXT NOT NULL DEFAULT 'unprocessed'
        CHECK (status IN ('unprocessed', 'queued', 'processing', 'pendingReview', 'completed', 'failed')),
    latest_job_id TEXT,
    pending_suggestion_count INTEGER NOT NULL DEFAULT 0,
    source_created_at TEXT,
    source_updated_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_type, source_library_id, source_item_key)
);

CREATE TABLE IF NOT EXISTS authors (
    id TEXT PRIMARY KEY,
    source_type TEXT NOT NULL,
    source_creator_id TEXT NOT NULL,
    name TEXT NOT NULL,
    first_name TEXT,
    last_name TEXT,
    orcid TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_type, source_creator_id)
);

CREATE TABLE IF NOT EXISTS paper_authors (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    author_id TEXT NOT NULL REFERENCES authors(id),
    role TEXT NOT NULL,
    position INTEGER NOT NULL,
    PRIMARY KEY (paper_id, author_id, role)
);

CREATE TABLE IF NOT EXISTS paper_tags (
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    tag TEXT NOT NULL,
    PRIMARY KEY (paper_id, tag)
);

CREATE TABLE IF NOT EXISTS paper_attachments (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    path TEXT NOT NULL,
    content_type TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS zotero_sync_scope (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    mode TEXT NOT NULL CHECK (mode IN ('library', 'collections')),
    collection_keys TEXT NOT NULL DEFAULT '[]',
    include_subcollections INTEGER NOT NULL DEFAULT 0
        CHECK (include_subcollections IN (0, 1)),
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS analysis_jobs (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    status TEXT NOT NULL
        CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'cancelled')),
    progress INTEGER NOT NULL DEFAULT 0
        CHECK (progress BETWEEN 0 AND 100),
    stage TEXT NOT NULL,
    previous_paper_status TEXT NOT NULL,
    error_code TEXT,
    error_message TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TEXT,
    completed_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_papers_year ON papers(year);
CREATE INDEX IF NOT EXISTS idx_papers_status ON papers(status);
CREATE INDEX IF NOT EXISTS idx_paper_authors_author ON paper_authors(author_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_analysis_jobs_active_paper
    ON analysis_jobs(paper_id)
    WHERE status IN ('queued', 'processing');

CREATE TABLE IF NOT EXISTS extractions (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    analysis_job_id TEXT NOT NULL UNIQUE REFERENCES analysis_jobs(id) ON DELETE CASCADE,
    submission_id TEXT NOT NULL,
    is_latest INTEGER NOT NULL DEFAULT 1 CHECK (is_latest IN (0, 1)),
    research_topics TEXT NOT NULL DEFAULT '[]',
    research_question TEXT,
    sample TEXT,
    methods TEXT,
    main_results TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS evidence (
    id TEXT PRIMARY KEY,
    extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    client_ref TEXT NOT NULL,
    section TEXT,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (extraction_id, client_ref)
);

CREATE TABLE IF NOT EXISTS extracted_concepts (
    id TEXT PRIMARY KEY,
    extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    client_ref TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    match_status TEXT NOT NULL CHECK (match_status IN ('matched', 'uncertain', 'new')),
    matched_node_ids TEXT NOT NULL DEFAULT '[]',
    extraction_confidence REAL CHECK (extraction_confidence BETWEEN 0 AND 1),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (extraction_id, client_ref)
);

CREATE TABLE IF NOT EXISTS extracted_methods (
    id TEXT PRIMARY KEY,
    extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    client_ref TEXT NOT NULL,
    raw_text TEXT NOT NULL,
    normalized_label TEXT NOT NULL,
    method_type TEXT NOT NULL,
    description TEXT,
    match_status TEXT NOT NULL CHECK (match_status IN ('matched', 'uncertain', 'new')),
    matched_node_ids TEXT NOT NULL DEFAULT '[]',
    extraction_confidence REAL CHECK (extraction_confidence BETWEEN 0 AND 1),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (extraction_id, client_ref)
);

CREATE TABLE IF NOT EXISTS extracted_findings (
    id TEXT PRIMARY KEY,
    extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    client_ref TEXT NOT NULL,
    statement TEXT NOT NULL,
    confidence REAL CHECK (confidence BETWEEN 0 AND 1),
    formal_node_id TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (extraction_id, client_ref)
);

CREATE TABLE IF NOT EXISTS extraction_evidence (
    item_type TEXT NOT NULL CHECK (item_type IN ('concept', 'method', 'finding')),
    item_id TEXT NOT NULL,
    evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    PRIMARY KEY (item_type, item_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS graph_nodes (
    id TEXT PRIMARY KEY,
    node_type TEXT NOT NULL CHECK (node_type IN ('concept', 'method', 'finding')),
    label TEXT NOT NULL,
    description TEXT,
    method_type TEXT,
    aliases TEXT NOT NULL DEFAULT '[]',
    source_paper_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (node_type, label COLLATE NOCASE)
);

CREATE TABLE IF NOT EXISTS resolution_candidates (
    id TEXT PRIMARY KEY,
    extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    owner_type TEXT NOT NULL CHECK (owner_type IN ('concept', 'method')),
    owner_id TEXT NOT NULL,
    client_ref TEXT NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('existing', 'new')),
    node_id TEXT,
    label TEXT NOT NULL,
    recommendation_score REAL CHECK (recommendation_score BETWEEN 0 AND 1),
    position INTEGER NOT NULL,
    resolved_node_id TEXT,
    UNIQUE (extraction_id, client_ref)
);

CREATE TABLE IF NOT EXISTS suggestions (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    operation TEXT NOT NULL CHECK (operation IN (
        'resolveConceptMatch', 'resolveMethodMatch', 'addFinding', 'addRelation'
    )),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'accepted', 'rejected', 'superseded'
    )),
    title TEXT NOT NULL,
    reason TEXT NOT NULL,
    confidence REAL CHECK (confidence BETWEEN 0 AND 1),
    proposed_change TEXT NOT NULL,
    execution_result TEXT,
    reviewed_at TEXT,
    superseded_at TEXT,
    review_comment TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS suggestion_evidence (
    suggestion_id TEXT NOT NULL REFERENCES suggestions(id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    PRIMARY KEY (suggestion_id, evidence_id)
);

CREATE TABLE IF NOT EXISTS relation_candidates (
    id TEXT PRIMARY KEY,
    extraction_id TEXT NOT NULL REFERENCES extractions(id) ON DELETE CASCADE,
    paper_id TEXT NOT NULL REFERENCES papers(id) ON DELETE CASCADE,
    source_ref_type TEXT NOT NULL,
    source_ref_value TEXT NOT NULL,
    target_ref_type TEXT NOT NULL,
    target_ref_value TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    confidence REAL CHECK (confidence BETWEEN 0 AND 1),
    evidence_ids TEXT NOT NULL DEFAULT '[]',
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
        'pending', 'suggestionCreated', 'discarded', 'superseded'
    )),
    suggestion_id TEXT REFERENCES suggestions(id),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS graph_edges (
    id TEXT PRIMARY KEY,
    source_id TEXT NOT NULL,
    source_type TEXT NOT NULL,
    target_id TEXT NOT NULL,
    target_type TEXT NOT NULL,
    relation_type TEXT NOT NULL,
    label TEXT NOT NULL,
    confidence REAL CHECK (confidence BETWEEN 0 AND 1),
    weight REAL,
    source_paper_ids TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (source_id, target_id, relation_type)
);

CREATE TABLE IF NOT EXISTS graph_edge_evidence (
    edge_id TEXT NOT NULL REFERENCES graph_edges(id) ON DELETE CASCADE,
    evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,
    PRIMARY KEY (edge_id, evidence_id)
);

CREATE INDEX IF NOT EXISTS idx_extractions_paper_latest
    ON extractions(paper_id, is_latest);
CREATE INDEX IF NOT EXISTS idx_evidence_extraction ON evidence(extraction_id);
CREATE INDEX IF NOT EXISTS idx_candidates_owner ON resolution_candidates(owner_type, owner_id);
CREATE INDEX IF NOT EXISTS idx_suggestions_filter
    ON suggestions(status, operation, paper_id, created_at);
CREATE INDEX IF NOT EXISTS idx_relation_candidates_extraction
    ON relation_candidates(extraction_id, status);
CREATE INDEX IF NOT EXISTS idx_graph_edges_source ON graph_edges(source_id);
CREATE INDEX IF NOT EXISTS idx_graph_edges_target ON graph_edges(target_id);
