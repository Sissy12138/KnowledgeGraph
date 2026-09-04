"""保存 B 的 v05 分析结果，并生成待审核 Suggestion。"""

import json
import sqlite3
import uuid
from pathlib import Path

from .analysis_job_repository import serialize_job
from .database import connect
from .schemas import (
    ANALYZED_RELATION_TYPES,
    METHOD_TYPES,
    RELATION_ENDPOINTS,
    SchemaValidationError,
    ensure_unique,
    optional_score,
    optional_string,
    require_dict,
    require_enum,
    require_list,
    require_string,
)


class AnalysisResultError(Exception):
    def __init__(self, code: str, message: str, status: int, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details


class ExtractionNotFoundError(Exception):
    pass


def _id() -> str:
    return str(uuid.uuid4())


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _utc(value: str | None) -> str | None:
    if value and "T" not in value:
        return value.replace(" ", "T", 1) + "Z"
    return value


def _formal_node_type(connection: sqlite3.Connection, node_id: str) -> str | None:
    if connection.execute("SELECT 1 FROM papers WHERE id = ?", (node_id,)).fetchone():
        return "paper"
    if connection.execute("SELECT 1 FROM authors WHERE id = ?", (node_id,)).fetchone():
        return "author"
    row = connection.execute("SELECT node_type FROM graph_nodes WHERE id = ?", (node_id,)).fetchone()
    return row["node_type"] if row else None


def _evidence_ids(connection: sqlite3.Connection, item_type: str, item_id: str) -> list[str]:
    rows = connection.execute(
        """
        SELECT evidence_id FROM extraction_evidence
        WHERE item_type = ? AND item_id = ?
        ORDER BY evidence_id
        """,
        (item_type, item_id),
    ).fetchall()
    return [row["evidence_id"] for row in rows]


def _candidate_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "nodeId": row["node_id"],
        "label": row["label"],
        "recommendationScore": row["recommendation_score"],
    }


def _item_candidates(connection: sqlite3.Connection, owner_type: str, owner_id: str) -> list[dict]:
    rows = connection.execute(
        """
        SELECT * FROM resolution_candidates
        WHERE owner_type = ? AND owner_id = ?
        ORDER BY position, id
        """,
        (owner_type, owner_id),
    ).fetchall()
    return [_candidate_dict(row) for row in rows]


def _serialize_extraction(connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
    concepts = []
    for item in connection.execute(
        "SELECT * FROM extracted_concepts WHERE extraction_id = ? ORDER BY created_at, id",
        (row["id"],),
    ).fetchall():
        concepts.append(
            {
                "id": item["id"],
                "paperId": item["paper_id"],
                "rawText": item["raw_text"],
                "normalizedLabel": item["normalized_label"],
                "matchStatus": item["match_status"],
                "matchedConceptIds": json.loads(item["matched_node_ids"]),
                "candidates": _item_candidates(connection, "concept", item["id"]),
                "extractionConfidence": item["extraction_confidence"],
                "evidenceIds": _evidence_ids(connection, "concept", item["id"]),
            }
        )

    methods = []
    for item in connection.execute(
        "SELECT * FROM extracted_methods WHERE extraction_id = ? ORDER BY created_at, id",
        (row["id"],),
    ).fetchall():
        methods.append(
            {
                "id": item["id"],
                "paperId": item["paper_id"],
                "rawText": item["raw_text"],
                "normalizedLabel": item["normalized_label"],
                "methodType": item["method_type"],
                "description": item["description"],
                "matchStatus": item["match_status"],
                "matchedMethodIds": json.loads(item["matched_node_ids"]),
                "candidates": _item_candidates(connection, "method", item["id"]),
                "extractionConfidence": item["extraction_confidence"],
                "evidenceIds": _evidence_ids(connection, "method", item["id"]),
            }
        )

    findings = []
    for item in connection.execute(
        "SELECT * FROM extracted_findings WHERE extraction_id = ? ORDER BY created_at, id",
        (row["id"],),
    ).fetchall():
        findings.append(
            {
                "id": item["id"],
                "paperId": item["paper_id"],
                "statement": item["statement"],
                "confidence": item["confidence"],
                "evidenceIds": _evidence_ids(connection, "finding", item["id"]),
            }
        )

    evidence = [
        {
            "id": item["id"],
            "paperId": item["paper_id"],
            "section": item["section"],
            "text": item["text"],
        }
        for item in connection.execute(
            "SELECT * FROM evidence WHERE extraction_id = ? ORDER BY created_at, id",
            (row["id"],),
        ).fetchall()
    ]
    return {
        "id": row["id"],
        "paperId": row["paper_id"],
        "analysisJobId": row["analysis_job_id"],
        "isLatest": bool(row["is_latest"]),
        "researchOverview": {
            "researchTopics": json.loads(row["research_topics"]),
            "researchQuestion": row["research_question"],
            "sample": row["sample"],
            "methods": row["methods"],
            "mainResults": row["main_results"],
        },
        "concepts": concepts,
        "methods": methods,
        "findings": findings,
        "evidence": evidence,
        "createdAt": _utc(row["created_at"]),
    }


def get_latest_extraction(database_path: Path, paper_id: str) -> dict:
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            """
            SELECT * FROM extractions
            WHERE paper_id = ? AND is_latest = 1
            ORDER BY created_at DESC, id DESC LIMIT 1
            """,
            (paper_id,),
        ).fetchone()
        if not row:
            raise ExtractionNotFoundError
        return _serialize_extraction(connection, row)
    finally:
        connection.close()


def _normalize_overview(payload: dict) -> dict:
    overview = require_dict(payload.get("researchOverview"), "researchOverview")
    topics = [require_string(value, "researchOverview.researchTopics[]") for value in require_list(
        overview.get("researchTopics"), "researchOverview.researchTopics"
    )]
    ensure_unique(topics, "researchOverview.researchTopics")
    return {
        "researchTopics": topics,
        "researchQuestion": optional_string(overview.get("researchQuestion"), "researchOverview.researchQuestion"),
        "sample": optional_string(overview.get("sample"), "researchOverview.sample"),
        "methods": optional_string(overview.get("methods"), "researchOverview.methods"),
        "mainResults": optional_string(overview.get("mainResults"), "researchOverview.mainResults"),
    }


def _normalize_submission(payload: dict) -> dict:
    payload = require_dict(payload, "body")
    result = {
        "submissionId": require_string(payload.get("submissionId"), "submissionId"),
        "paperId": require_string(payload.get("paperId"), "paperId"),
        "researchOverview": _normalize_overview(payload),
    }

    evidence = []
    evidence_refs = []
    for index, value in enumerate(require_list(payload.get("evidence"), "evidence")):
        item = require_dict(value, f"evidence[{index}]")
        client_ref = require_string(item.get("clientRef"), f"evidence[{index}].clientRef")
        evidence_refs.append(client_ref)
        evidence.append(
            {
                "clientRef": client_ref,
                "section": optional_string(item.get("section"), f"evidence[{index}].section"),
                "text": require_string(item.get("text"), f"evidence[{index}].text"),
            }
        )
    ensure_unique(evidence_refs, "evidence.clientRef")
    evidence_ref_set = set(evidence_refs)
    result["evidence"] = evidence

    candidate_refs: list[str] = []
    candidate_type_by_ref: dict[str, str] = {}

    def normalize_candidates(values, owner_type: str, owner_index: int, match_status: str) -> list[dict]:
        candidates = []
        new_count = 0
        for position, value in enumerate(require_list(values, f"{owner_type}s[{owner_index}].candidates")):
            item = require_dict(value, "candidate")
            kind = require_enum(item.get("kind"), "candidate.kind", {"existing", "new"})
            node_id = item.get("nodeId")
            if kind == "existing":
                node_id = require_string(node_id, "candidate.nodeId")
            elif node_id is not None:
                raise SchemaValidationError("New candidate.nodeId 必须为 null")
            new_count += kind == "new"
            client_ref = require_string(item.get("clientRef"), "candidate.clientRef")
            candidate_refs.append(client_ref)
            candidate_type_by_ref[client_ref] = owner_type
            candidates.append(
                {
                    "clientRef": client_ref,
                    "kind": kind,
                    "nodeId": node_id,
                    "label": require_string(item.get("label"), "candidate.label", 200),
                    "recommendationScore": optional_score(
                        item.get("recommendationScore"), "candidate.recommendationScore"
                    ),
                    "inputPosition": position,
                }
            )
        if not candidates:
            raise SchemaValidationError("每个 Concept/Method 至少需要一个候选")
        if new_count > 1:
            raise SchemaValidationError("每个 Concept/Method 最多一个 New 候选")
        if match_status == "new" and new_count != 1:
            raise SchemaValidationError("matchStatus=new 时必须包含一个 New 候选")
        existing_ids = [candidate["nodeId"] for candidate in candidates if candidate["kind"] == "existing"]
        ensure_unique(existing_ids, "Existing candidate.nodeId")
        return sorted(
            candidates,
            key=lambda candidate: (
                candidate["recommendationScore"] is None,
                -(candidate["recommendationScore"] or 0),
                candidate["inputPosition"],
            ),
        )

    concepts = []
    concept_refs = []
    for index, value in enumerate(require_list(payload.get("concepts"), "concepts")):
        item = require_dict(value, f"concepts[{index}]")
        client_ref = require_string(item.get("clientRef"), f"concepts[{index}].clientRef")
        concept_refs.append(client_ref)
        match_status = require_enum(item.get("matchStatus"), "concept.matchStatus", {"uncertain", "new"})
        refs = [require_string(ref, "concept.evidenceRefs[]") for ref in require_list(
            item.get("evidenceRefs"), "concept.evidenceRefs"
        )]
        ensure_unique(refs, "concept.evidenceRefs")
        if not refs or not set(refs) <= evidence_ref_set:
            raise SchemaValidationError("concept.evidenceRefs 必须引用已提交 Evidence")
        concepts.append(
            {
                "clientRef": client_ref,
                "rawText": require_string(item.get("rawText"), "concept.rawText"),
                "normalizedLabel": require_string(item.get("normalizedLabel"), "concept.normalizedLabel", 200),
                "matchStatus": match_status,
                "candidates": normalize_candidates(item.get("candidates"), "concept", index, match_status),
                "extractionConfidence": optional_score(item.get("extractionConfidence"), "concept.extractionConfidence"),
                "evidenceRefs": refs,
            }
        )
    ensure_unique(concept_refs, "concept.clientRef")
    result["concepts"] = concepts

    methods = []
    method_refs = []
    for index, value in enumerate(require_list(payload.get("methods"), "methods")):
        item = require_dict(value, f"methods[{index}]")
        client_ref = require_string(item.get("clientRef"), f"methods[{index}].clientRef")
        method_refs.append(client_ref)
        match_status = require_enum(item.get("matchStatus"), "method.matchStatus", {"uncertain", "new"})
        refs = [require_string(ref, "method.evidenceRefs[]") for ref in require_list(
            item.get("evidenceRefs"), "method.evidenceRefs"
        )]
        ensure_unique(refs, "method.evidenceRefs")
        if not refs or not set(refs) <= evidence_ref_set:
            raise SchemaValidationError("method.evidenceRefs 必须引用已提交 Evidence")
        methods.append(
            {
                "clientRef": client_ref,
                "rawText": require_string(item.get("rawText"), "method.rawText"),
                "normalizedLabel": require_string(item.get("normalizedLabel"), "method.normalizedLabel", 200),
                "methodType": require_enum(item.get("methodType"), "method.methodType", METHOD_TYPES),
                "description": optional_string(item.get("description"), "method.description"),
                "matchStatus": match_status,
                "candidates": normalize_candidates(item.get("candidates"), "method", index, match_status),
                "extractionConfidence": optional_score(item.get("extractionConfidence"), "method.extractionConfidence"),
                "evidenceRefs": refs,
            }
        )
    ensure_unique(method_refs, "method.clientRef")
    ensure_unique(candidate_refs, "candidate.clientRef")
    result["methods"] = methods

    findings = []
    finding_refs = []
    for index, value in enumerate(require_list(payload.get("findings"), "findings")):
        item = require_dict(value, f"findings[{index}]")
        client_ref = require_string(item.get("clientRef"), f"findings[{index}].clientRef")
        finding_refs.append(client_ref)
        refs = [require_string(ref, "finding.evidenceRefs[]") for ref in require_list(
            item.get("evidenceRefs"), "finding.evidenceRefs"
        )]
        ensure_unique(refs, "finding.evidenceRefs")
        if not refs or not set(refs) <= evidence_ref_set:
            raise SchemaValidationError("finding.evidenceRefs 必须引用已提交 Evidence")
        findings.append(
            {
                "clientRef": client_ref,
                "statement": require_string(item.get("statement"), "finding.statement"),
                "confidence": optional_score(item.get("confidence"), "finding.confidence"),
                "evidenceRefs": refs,
            }
        )
    ensure_unique(finding_refs, "finding.clientRef")
    result["findings"] = findings

    relations = []
    for index, value in enumerate(require_list(payload.get("relationCandidates"), "relationCandidates")):
        item = require_dict(value, f"relationCandidates[{index}]")

        def node_ref(value, field: str) -> dict:
            ref = require_dict(value, field)
            ref_type = require_enum(
                ref.get("type"), f"{field}.type", {"formalNodeId", "resolutionCandidateRef", "findingRef"}
            )
            ref_value = require_string(ref.get("value"), f"{field}.value")
            if ref_type == "resolutionCandidateRef" and ref_value not in set(candidate_refs):
                raise SchemaValidationError(f"{field} 引用了不存在的候选")
            if ref_type == "findingRef" and ref_value not in set(finding_refs):
                raise SchemaValidationError(f"{field} 引用了不存在的 Finding")
            return {"type": ref_type, "value": ref_value}

        refs = [require_string(ref, "relation.evidenceRefs[]") for ref in require_list(
            item.get("evidenceRefs"), "relation.evidenceRefs"
        )]
        ensure_unique(refs, "relation.evidenceRefs")
        if not refs or not set(refs) <= evidence_ref_set:
            raise SchemaValidationError("relation.evidenceRefs 必须引用已提交 Evidence")
        relations.append(
            {
                "source": node_ref(item.get("source"), "relation.source"),
                "target": node_ref(item.get("target"), "relation.target"),
                "relationType": require_enum(
                    item.get("relationType"), "relation.relationType", ANALYZED_RELATION_TYPES
                ),
                "confidence": optional_score(item.get("confidence"), "relation.confidence"),
                "evidenceRefs": refs,
            }
        )
    result["relationCandidates"] = relations
    result["_candidateTypes"] = candidate_type_by_ref
    return result


def _insert_suggestion(
    connection: sqlite3.Connection,
    paper_id: str,
    extraction_id: str,
    operation: str,
    title: str,
    reason: str,
    confidence: float | None,
    proposed_change: dict,
    evidence_ids: list[str],
) -> str:
    suggestion_id = _id()
    connection.execute(
        """
        INSERT INTO suggestions (
            id, paper_id, extraction_id, operation, status, title, reason,
            confidence, proposed_change
        ) VALUES (?, ?, ?, ?, 'pending', ?, ?, ?, ?)
        """,
        (
            suggestion_id,
            paper_id,
            extraction_id,
            operation,
            title,
            reason,
            confidence,
            _json(proposed_change),
        ),
    )
    connection.executemany(
        "INSERT INTO suggestion_evidence (suggestion_id, evidence_id) VALUES (?, ?)",
        [(suggestion_id, evidence_id) for evidence_id in evidence_ids],
    )
    return suggestion_id


def _accepted_result(connection: sqlite3.Connection, extraction_row: sqlite3.Row, created: bool) -> tuple[dict, bool]:
    evidence_ids = [
        row["id"]
        for row in connection.execute(
            "SELECT id FROM evidence WHERE extraction_id = ? ORDER BY created_at, id",
            (extraction_row["id"],),
        ).fetchall()
    ]
    suggestion_ids = [
        row["id"]
        for row in connection.execute(
            "SELECT id FROM suggestions WHERE extraction_id = ? ORDER BY created_at, id",
            (extraction_row["id"],),
        ).fetchall()
    ]
    job_row = connection.execute(
        "SELECT * FROM analysis_jobs WHERE id = ?", (extraction_row["analysis_job_id"],)
    ).fetchone()
    return (
        {
            "extractionId": extraction_row["id"],
            "evidenceIds": evidence_ids,
            "suggestionIds": suggestion_ids,
            "analysisJob": serialize_job(job_row),
        },
        created,
    )


def submit_analysis_result(database_path: Path, job_id: str, payload: dict) -> tuple[dict, bool]:
    try:
        data = _normalize_submission(payload)
    except SchemaValidationError as error:
        raise AnalysisResultError("INVALID_ANALYSIS_RESULT", str(error), 422) from error

    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        existing = connection.execute(
            "SELECT * FROM extractions WHERE analysis_job_id = ?", (job_id,)
        ).fetchone()
        if existing:
            if existing["submission_id"] != data["submissionId"]:
                raise AnalysisResultError(
                    "JOB_RESULT_ALREADY_SUBMITTED",
                    "该任务已经提交过不同的分析结果",
                    409,
                )
            return _accepted_result(connection, existing, False)

        job = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
        if not job:
            raise AnalysisResultError("JOB_NOT_FOUND", "未找到指定任务", 404)
        if job["paper_id"] != data["paperId"]:
            raise AnalysisResultError("INVALID_ANALYSIS_RESULT", "paperId 与任务不一致", 422)
        if job["status"] not in {"queued", "processing"}:
            raise AnalysisResultError("JOB_NOT_ACCEPTING_RESULTS", "该任务不再接收分析结果", 409)

        with connection:
            for candidate_group, expected_type in (
                (data["concepts"], "concept"),
                (data["methods"], "method"),
            ):
                for item in candidate_group:
                    for candidate in item["candidates"]:
                        if candidate["kind"] == "existing":
                            row = connection.execute(
                                "SELECT node_type, label FROM graph_nodes WHERE id = ?",
                                (candidate["nodeId"],),
                            ).fetchone()
                            if not row or row["node_type"] != expected_type:
                                raise AnalysisResultError(
                                    "INVALID_ANALYSIS_RESULT",
                                    "Existing candidate.nodeId 不是类型一致的正式节点",
                                    422,
                                )
                            candidate["label"] = row["label"]

            for relation in data["relationCandidates"]:
                source = relation["source"]
                target = relation["target"]
                source_type = (
                    _formal_node_type(connection, source["value"])
                    if source["type"] == "formalNodeId"
                    else data["_candidateTypes"].get(source["value"], "finding")
                )
                target_type = (
                    _formal_node_type(connection, target["value"])
                    if target["type"] == "formalNodeId"
                    else data["_candidateTypes"].get(target["value"], "finding")
                )
                if not source_type or not target_type:
                    raise AnalysisResultError("INVALID_ANALYSIS_RESULT", "关系引用的正式节点不存在", 422)
                if RELATION_ENDPOINTS[relation["relationType"]] != (source_type, target_type):
                    raise AnalysisResultError("INVALID_ANALYSIS_RESULT", "关系类型与端点类型不一致", 422)

            connection.execute(
                "UPDATE extractions SET is_latest = 0 WHERE paper_id = ? AND is_latest = 1",
                (data["paperId"],),
            )
            connection.execute(
                """
                UPDATE suggestions
                SET status = 'superseded', superseded_at = CURRENT_TIMESTAMP,
                    reviewed_at = NULL, updated_at = CURRENT_TIMESTAMP
                WHERE paper_id = ? AND status = 'pending'
                """,
                (data["paperId"],),
            )
            connection.execute(
                """
                UPDATE relation_candidates
                SET status = 'superseded', updated_at = CURRENT_TIMESTAMP
                WHERE paper_id = ? AND status = 'pending'
                """,
                (data["paperId"],),
            )

            extraction_id = _id()
            overview = data["researchOverview"]
            connection.execute(
                """
                INSERT INTO extractions (
                    id, paper_id, analysis_job_id, submission_id, is_latest,
                    research_topics, research_question, sample, methods, main_results
                ) VALUES (?, ?, ?, ?, 1, ?, ?, ?, ?, ?)
                """,
                (
                    extraction_id,
                    data["paperId"],
                    job_id,
                    data["submissionId"],
                    _json(overview["researchTopics"]),
                    overview["researchQuestion"],
                    overview["sample"],
                    overview["methods"],
                    overview["mainResults"],
                ),
            )

            evidence_map = {}
            for item in data["evidence"]:
                evidence_id = _id()
                evidence_map[item["clientRef"]] = evidence_id
                connection.execute(
                    """
                    INSERT INTO evidence (id, extraction_id, paper_id, client_ref, section, text)
                    VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        evidence_id,
                        extraction_id,
                        data["paperId"],
                        item["clientRef"],
                        item["section"],
                        item["text"],
                    ),
                )

            suggestion_ids = []

            for owner_type, items, table, operation in (
                ("concept", data["concepts"], "extracted_concepts", "resolveConceptMatch"),
                ("method", data["methods"], "extracted_methods", "resolveMethodMatch"),
            ):
                for item in items:
                    item_id = _id()
                    if owner_type == "concept":
                        connection.execute(
                            """
                            INSERT INTO extracted_concepts (
                                id, extraction_id, paper_id, client_ref, raw_text,
                                normalized_label, match_status, extraction_confidence
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                item_id,
                                extraction_id,
                                data["paperId"],
                                item["clientRef"],
                                item["rawText"],
                                item["normalizedLabel"],
                                item["matchStatus"],
                                item["extractionConfidence"],
                            ),
                        )
                    else:
                        connection.execute(
                            """
                            INSERT INTO extracted_methods (
                                id, extraction_id, paper_id, client_ref, raw_text,
                                normalized_label, method_type, description, match_status,
                                extraction_confidence
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                item_id,
                                extraction_id,
                                data["paperId"],
                                item["clientRef"],
                                item["rawText"],
                                item["normalizedLabel"],
                                item["methodType"],
                                item["description"],
                                item["matchStatus"],
                                item["extractionConfidence"],
                            ),
                        )

                    evidence_ids = [evidence_map[ref] for ref in item["evidenceRefs"]]
                    connection.executemany(
                        "INSERT INTO extraction_evidence (item_type, item_id, evidence_id) VALUES (?, ?, ?)",
                        [(owner_type, item_id, evidence_id) for evidence_id in evidence_ids],
                    )

                    candidate_ids = []
                    default_candidate_id = None
                    for position, candidate in enumerate(item["candidates"]):
                        candidate_id = _id()
                        candidate_ids.append(candidate_id)
                        if default_candidate_id is None and candidate["recommendationScore"] is not None:
                            default_candidate_id = candidate_id
                        connection.execute(
                            """
                            INSERT INTO resolution_candidates (
                                id, extraction_id, owner_type, owner_id, client_ref, kind,
                                node_id, label, recommendation_score, position
                            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                candidate_id,
                                extraction_id,
                                owner_type,
                                item_id,
                                candidate["clientRef"],
                                candidate["kind"],
                                candidate["nodeId"],
                                candidate["label"],
                                candidate["recommendationScore"],
                                position,
                            ),
                        )

                    proposed_change = {
                        "type": operation,
                        "candidateIds": candidate_ids,
                        "defaultCandidateId": default_candidate_id,
                        "maxSelections": 3,
                    }
                    proposed_change["extractedConceptId" if owner_type == "concept" else "extractedMethodId"] = item_id
                    suggestion_ids.append(
                        _insert_suggestion(
                            connection,
                            data["paperId"],
                            extraction_id,
                            operation,
                            f"匹配{('概念' if owner_type == 'concept' else '方法')}：{item['normalizedLabel']}",
                            "请根据原文证据选择一至三个正式节点。",
                            item["extractionConfidence"],
                            proposed_change,
                            evidence_ids,
                        )
                    )

            for item in data["findings"]:
                item_id = _id()
                connection.execute(
                    """
                    INSERT INTO extracted_findings (
                        id, extraction_id, paper_id, client_ref, statement, confidence
                    ) VALUES (?, ?, ?, ?, ?, ?)
                    """,
                    (
                        item_id,
                        extraction_id,
                        data["paperId"],
                        item["clientRef"],
                        item["statement"],
                        item["confidence"],
                    ),
                )
                evidence_ids = [evidence_map[ref] for ref in item["evidenceRefs"]]
                connection.executemany(
                    "INSERT INTO extraction_evidence (item_type, item_id, evidence_id) VALUES ('finding', ?, ?)",
                    [(item_id, evidence_id) for evidence_id in evidence_ids],
                )
                suggestion_ids.append(
                    _insert_suggestion(
                        connection,
                        data["paperId"],
                        extraction_id,
                        "addFinding",
                        f"新增发现：{item['statement']}",
                        "请确认该发现是否由原文证据支持。",
                        item["confidence"],
                        {"type": "addFinding", "extractedFindingId": item_id, "statement": item["statement"]},
                        evidence_ids,
                    )
                )

            for relation in data["relationCandidates"]:
                source = relation["source"]
                target = relation["target"]
                if (
                    relation["relationType"] == "relatedTo"
                    and source["type"] == target["type"] == "formalNodeId"
                    and source["value"] > target["value"]
                ):
                    source, target = target, source
                relation_id = _id()
                evidence_ids = [evidence_map[ref] for ref in relation["evidenceRefs"]]
                connection.execute(
                    """
                    INSERT INTO relation_candidates (
                        id, extraction_id, paper_id, source_ref_type, source_ref_value,
                        target_ref_type, target_ref_value, relation_type, confidence, evidence_ids
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        relation_id,
                        extraction_id,
                        data["paperId"],
                        source["type"],
                        source["value"],
                        target["type"],
                        target["value"],
                        relation["relationType"],
                        relation["confidence"],
                        _json(evidence_ids),
                    ),
                )

                if source["type"] == target["type"] == "formalNodeId":
                    source_type = _formal_node_type(connection, source["value"])
                    target_type = _formal_node_type(connection, target["value"])
                    expected = RELATION_ENDPOINTS[relation["relationType"]]
                    if (source_type, target_type) != expected:
                        raise AnalysisResultError(
                            "INVALID_ANALYSIS_RESULT", "关系类型与正式端点类型不一致", 422
                        )
                    proposed = {
                        "type": "addRelation",
                        "sourceId": source["value"],
                        "sourceType": source_type,
                        "targetId": target["value"],
                        "targetType": target_type,
                        "relationType": relation["relationType"],
                    }
                    existing_edge = connection.execute(
                        """
                        SELECT id FROM graph_edges
                        WHERE source_id = ? AND target_id = ? AND relation_type = ?
                        """,
                        (source["value"], target["value"], relation["relationType"]),
                    ).fetchone()
                    suggestion_id = None
                    if not existing_edge:
                        for pending in connection.execute(
                            """
                            SELECT id, proposed_change FROM suggestions
                            WHERE operation = 'addRelation' AND status = 'pending'
                            """
                        ).fetchall():
                            current = json.loads(pending["proposed_change"])
                            if (
                                current["sourceId"] == source["value"]
                                and current["targetId"] == target["value"]
                                and current["relationType"] == relation["relationType"]
                            ):
                                suggestion_id = pending["id"]
                                break
                    if not existing_edge and not suggestion_id:
                        suggestion_id = _insert_suggestion(
                            connection,
                            data["paperId"],
                            extraction_id,
                            "addRelation",
                            f"新增关系：{relation['relationType']}",
                            "两个正式端点均已解析，请审核候选关系。",
                            relation["confidence"],
                            proposed,
                            evidence_ids,
                        )
                        suggestion_ids.append(suggestion_id)
                    elif suggestion_id:
                        connection.executemany(
                            "INSERT OR IGNORE INTO suggestion_evidence (suggestion_id, evidence_id) VALUES (?, ?)",
                            [(suggestion_id, evidence_id) for evidence_id in evidence_ids],
                        )
                    connection.execute(
                        """
                        UPDATE relation_candidates
                        SET status = ?, suggestion_id = ?, updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (
                            "suggestionCreated" if suggestion_id else "discarded",
                            suggestion_id,
                            relation_id,
                        ),
                    )

            pending_count = len(suggestion_ids)
            paper_status = "pendingReview" if pending_count else "completed"
            connection.execute(
                """
                UPDATE analysis_jobs
                SET status = 'completed', stage = 'completed', progress = 100,
                    started_at = COALESCE(started_at, CURRENT_TIMESTAMP),
                    completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (job_id,),
            )
            connection.execute(
                """
                UPDATE papers
                SET status = ?, pending_suggestion_count = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (paper_status, pending_count, data["paperId"]),
            )

        extraction_row = connection.execute(
            "SELECT * FROM extractions WHERE id = ?", (extraction_id,)
        ).fetchone()
        return _accepted_result(connection, extraction_row, True)
    except sqlite3.IntegrityError as error:
        raise AnalysisResultError("INVALID_ANALYSIS_RESULT", str(error), 422) from error
    finally:
        connection.close()
