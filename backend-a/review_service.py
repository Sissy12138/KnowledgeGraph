"""v05 Suggestion 查询、采纳、拒绝和正式图谱写入。"""

import json
import sqlite3
import uuid
from pathlib import Path

from .database import connect
from .schemas import (
    RELATION_ENDPOINTS,
    SUGGESTION_OPERATIONS,
    SUGGESTION_STATUSES,
    SchemaValidationError,
    optional_string,
    require_dict,
    require_list,
    require_string,
)


class ReviewError(Exception):
    def __init__(self, code: str, message: str, status: int, details: dict | None = None):
        super().__init__(message)
        self.code = code
        self.status = status
        self.details = details


def _id() -> str:
    return str(uuid.uuid4())


def _json(value) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def _utc(value: str | None) -> str | None:
    if value and "T" not in value:
        return value.replace(" ", "T", 1) + "Z"
    return value


def _evidence_ids(connection: sqlite3.Connection, suggestion_id: str) -> list[str]:
    return [
        row["evidence_id"]
        for row in connection.execute(
            """
            SELECT evidence_id FROM suggestion_evidence
            WHERE suggestion_id = ? ORDER BY evidence_id
            """,
            (suggestion_id,),
        ).fetchall()
    ]


def _suggestion(connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "paperId": row["paper_id"],
        "extractionId": row["extraction_id"],
        "operation": row["operation"],
        "status": row["status"],
        "title": row["title"],
        "reason": row["reason"],
        "confidence": row["confidence"],
        "evidenceIds": _evidence_ids(connection, row["id"]),
        "proposedChange": json.loads(row["proposed_change"]),
        "executionResult": json.loads(row["execution_result"]) if row["execution_result"] else None,
        "reviewedAt": _utc(row["reviewed_at"]),
        "supersededAt": _utc(row["superseded_at"]),
        "reviewComment": row["review_comment"],
        "createdAt": _utc(row["created_at"]),
        "updatedAt": _utc(row["updated_at"]),
    }


def _evidence_pool(connection: sqlite3.Connection, suggestion_ids: list[str]) -> list[dict]:
    if not suggestion_ids:
        return []
    placeholders = ",".join("?" for _ in suggestion_ids)
    rows = connection.execute(
        f"""
        SELECT DISTINCT e.*
        FROM evidence e
        JOIN suggestion_evidence se ON se.evidence_id = e.id
        WHERE se.suggestion_id IN ({placeholders})
        ORDER BY e.created_at, e.id
        """,
        suggestion_ids,
    ).fetchall()
    return [
        {
            "id": row["id"],
            "paperId": row["paper_id"],
            "section": row["section"],
            "text": row["text"],
        }
        for row in rows
    ]


def list_suggestions(
    database_path: Path,
    page: int,
    page_size: int,
    paper_id: str | None,
    status: str | None,
    operation: str | None,
) -> dict:
    if page < 1 or page_size < 1 or page_size > 100:
        raise ValueError("page 必须大于等于 1，pageSize 必须在 1–100 之间")
    if status is not None and status not in SUGGESTION_STATUSES:
        raise ValueError("status 不合法")
    if operation is not None and operation not in SUGGESTION_OPERATIONS:
        raise ValueError("operation 不合法")

    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        base_conditions = []
        base_parameters: list[object] = []
        if paper_id:
            base_conditions.append("paper_id = ?")
            base_parameters.append(paper_id)
        if operation:
            base_conditions.append("operation = ?")
            base_parameters.append(operation)

        conditions = list(base_conditions)
        parameters = list(base_parameters)
        if status:
            conditions.append("status = ?")
            parameters.append(status)
        where = f"WHERE {' AND '.join(conditions)}" if conditions else ""
        count_where = f"WHERE {' AND '.join(base_conditions)}" if base_conditions else ""

        total = connection.execute(
            f"SELECT COUNT(*) FROM suggestions {where}", parameters
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT * FROM suggestions {where}
            ORDER BY created_at DESC, id DESC LIMIT ? OFFSET ?
            """,
            [*parameters, page_size, (page - 1) * page_size],
        ).fetchall()
        items = [_suggestion(connection, row) for row in rows]

        status_counts = {value: 0 for value in ("pending", "accepted", "rejected", "superseded")}
        for row in connection.execute(
            f"SELECT status, COUNT(*) AS count FROM suggestions {count_where} GROUP BY status",
            base_parameters,
        ).fetchall():
            status_counts[row["status"]] = row["count"]

        paper_ids = list(dict.fromkeys(row["paper_id"] for row in rows))
        papers = []
        if paper_ids:
            placeholders = ",".join("?" for _ in paper_ids)
            paper_rows = connection.execute(
                f"SELECT id, title FROM papers WHERE id IN ({placeholders})", paper_ids
            ).fetchall()
            by_id = {row["id"]: {"id": row["id"], "title": row["title"]} for row in paper_rows}
            papers = [by_id[value] for value in paper_ids if value in by_id]

        return {
            "items": items,
            "page": page,
            "pageSize": page_size,
            "total": total,
            "evidence": _evidence_pool(connection, [row["id"] for row in rows]),
            "papers": papers,
            "statusCounts": status_counts,
        }
    finally:
        connection.close()


def get_suggestion_detail(database_path: Path, suggestion_id: str) -> dict:
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute("SELECT * FROM suggestions WHERE id = ?", (suggestion_id,)).fetchone()
        if not row:
            raise ReviewError("SUGGESTION_NOT_FOUND", "未找到指定建议", 404)
        paper = connection.execute(
            "SELECT id, title FROM papers WHERE id = ?", (row["paper_id"],)
        ).fetchone()
        return {
            "suggestion": _suggestion(connection, row),
            "evidence": _evidence_pool(connection, [suggestion_id]),
            "paper": {"id": paper["id"], "title": paper["title"]},
        }
    finally:
        connection.close()


def _formal_node_type(connection: sqlite3.Connection, node_id: str) -> str | None:
    if connection.execute("SELECT 1 FROM papers WHERE id = ?", (node_id,)).fetchone():
        return "paper"
    if connection.execute("SELECT 1 FROM authors WHERE id = ?", (node_id,)).fetchone():
        return "author"
    row = connection.execute("SELECT node_type FROM graph_nodes WHERE id = ?", (node_id,)).fetchone()
    return row["node_type"] if row else None


def _merge_json_list(raw: str, values: list[str]) -> str:
    current = json.loads(raw)
    return _json(list(dict.fromkeys([*current, *values])))


def _create_or_reuse_edge(
    connection: sqlite3.Connection,
    source_id: str,
    source_type: str,
    target_id: str,
    target_type: str,
    relation_type: str,
    confidence: float | None,
    evidence_ids: list[str],
    source_paper_ids: list[str],
) -> str:
    if RELATION_ENDPOINTS.get(relation_type) != (source_type, target_type):
        raise ReviewError("INVALID_RELATION", "关系类型与端点类型不一致", 422)
    if relation_type == "relatedTo" and source_id > target_id:
        source_id, target_id = target_id, source_id
        source_type, target_type = target_type, source_type

    row = connection.execute(
        """
        SELECT * FROM graph_edges
        WHERE source_id = ? AND target_id = ? AND relation_type = ?
        """,
        (source_id, target_id, relation_type),
    ).fetchone()
    if row:
        edge_id = row["id"]
        connection.execute(
            """
            UPDATE graph_edges
            SET source_paper_ids = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (_merge_json_list(row["source_paper_ids"], source_paper_ids), edge_id),
        )
    else:
        edge_id = _id()
        connection.execute(
            """
            INSERT INTO graph_edges (
                id, source_id, source_type, target_id, target_type, relation_type,
                label, confidence, source_paper_ids
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                edge_id,
                source_id,
                source_type,
                target_id,
                target_type,
                relation_type,
                relation_type,
                confidence,
                _json(source_paper_ids),
            ),
        )
    connection.executemany(
        "INSERT OR IGNORE INTO graph_edge_evidence (edge_id, evidence_id) VALUES (?, ?)",
        [(edge_id, evidence_id) for evidence_id in evidence_ids],
    )
    return edge_id


def _resolve_relation_ref(
    connection: sqlite3.Connection, extraction_id: str, ref_type: str, ref_value: str
) -> tuple[str, str] | None:
    if ref_type == "formalNodeId":
        node_type = _formal_node_type(connection, ref_value)
        return (ref_value, node_type) if node_type else None
    if ref_type == "resolutionCandidateRef":
        row = connection.execute(
            """
            SELECT resolved_node_id FROM resolution_candidates
            WHERE extraction_id = ? AND client_ref = ? AND resolved_node_id IS NOT NULL
            """,
            (extraction_id, ref_value),
        ).fetchone()
        if not row:
            return None
        return row["resolved_node_id"], _formal_node_type(connection, row["resolved_node_id"])
    if ref_type == "findingRef":
        row = connection.execute(
            """
            SELECT formal_node_id FROM extracted_findings
            WHERE extraction_id = ? AND client_ref = ?
            """,
            (extraction_id, ref_value),
        ).fetchone()
        if not row or not row["formal_node_id"]:
            return None
        return row["formal_node_id"], "finding"
    return None


def _pending_relation_suggestion(
    connection: sqlite3.Connection,
    source_id: str,
    target_id: str,
    relation_type: str,
) -> str | None:
    rows = connection.execute(
        "SELECT id, proposed_change FROM suggestions WHERE operation = 'addRelation' AND status = 'pending'"
    ).fetchall()
    for row in rows:
        proposed = json.loads(row["proposed_change"])
        if (
            proposed["sourceId"] == source_id
            and proposed["targetId"] == target_id
            and proposed["relationType"] == relation_type
        ):
            return row["id"]
    return None


def _activate_relation_candidates(connection: sqlite3.Connection, extraction_id: str) -> None:
    rows = connection.execute(
        "SELECT * FROM relation_candidates WHERE extraction_id = ? AND status = 'pending'",
        (extraction_id,),
    ).fetchall()
    for row in rows:
        source = _resolve_relation_ref(
            connection, extraction_id, row["source_ref_type"], row["source_ref_value"]
        )
        target = _resolve_relation_ref(
            connection, extraction_id, row["target_ref_type"], row["target_ref_value"]
        )
        if not source or not target:
            continue
        source_id, source_type = source
        target_id, target_type = target
        if row["relation_type"] == "relatedTo" and source_id > target_id:
            source_id, target_id = target_id, source_id
            source_type, target_type = target_type, source_type
        if RELATION_ENDPOINTS.get(row["relation_type"]) != (source_type, target_type):
            raise ReviewError("INVALID_RELATION", "延迟关系候选的端点类型不合法", 422)

        existing_edge = connection.execute(
            """
            SELECT id FROM graph_edges
            WHERE source_id = ? AND target_id = ? AND relation_type = ?
            """,
            (source_id, target_id, row["relation_type"]),
        ).fetchone()
        if existing_edge:
            connection.execute(
                "UPDATE relation_candidates SET status = 'discarded', updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                (row["id"],),
            )
            continue

        suggestion_id = _pending_relation_suggestion(
            connection, source_id, target_id, row["relation_type"]
        )
        if not suggestion_id:
            suggestion_id = _id()
            proposed = {
                "type": "addRelation",
                "sourceId": source_id,
                "sourceType": source_type,
                "targetId": target_id,
                "targetType": target_type,
                "relationType": row["relation_type"],
            }
            connection.execute(
                """
                INSERT INTO suggestions (
                    id, paper_id, extraction_id, operation, status, title, reason,
                    confidence, proposed_change
                ) VALUES (?, ?, ?, 'addRelation', 'pending', ?, ?, ?, ?)
                """,
                (
                    suggestion_id,
                    row["paper_id"],
                    extraction_id,
                    f"新增关系：{row['relation_type']}",
                    "依赖端点已经通过审核，请审核候选关系。",
                    row["confidence"],
                    _json(proposed),
                ),
            )
            evidence_ids = json.loads(row["evidence_ids"])
            connection.executemany(
                "INSERT INTO suggestion_evidence (suggestion_id, evidence_id) VALUES (?, ?)",
                [(suggestion_id, evidence_id) for evidence_id in evidence_ids],
            )
        else:
            evidence_ids = json.loads(row["evidence_ids"])
            connection.executemany(
                "INSERT OR IGNORE INTO suggestion_evidence (suggestion_id, evidence_id) VALUES (?, ?)",
                [(suggestion_id, evidence_id) for evidence_id in evidence_ids],
            )
        connection.execute(
            """
            UPDATE relation_candidates
            SET status = 'suggestionCreated', suggestion_id = ?, updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (suggestion_id, row["id"]),
        )


def _discard_relation_refs(
    connection: sqlite3.Connection,
    extraction_id: str,
    ref_type: str,
    refs: list[str],
) -> None:
    if not refs:
        return
    placeholders = ",".join("?" for _ in refs)
    connection.execute(
        f"""
        UPDATE relation_candidates
        SET status = 'discarded', updated_at = CURRENT_TIMESTAMP
        WHERE extraction_id = ? AND status = 'pending' AND (
            (source_ref_type = ? AND source_ref_value IN ({placeholders})) OR
            (target_ref_type = ? AND target_ref_value IN ({placeholders}))
        )
        """,
        [extraction_id, ref_type, *refs, ref_type, *refs],
    )


def _refresh_paper(connection: sqlite3.Connection, paper_id: str) -> None:
    count = connection.execute(
        "SELECT COUNT(*) FROM suggestions WHERE paper_id = ? AND status = 'pending'",
        (paper_id,),
    ).fetchone()[0]
    connection.execute(
        """
        UPDATE papers
        SET pending_suggestion_count = ?, status = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
        """,
        (count, "pendingReview" if count else "completed", paper_id),
    )


def _check_pending(row: sqlite3.Row) -> None:
    if row["status"] == "superseded":
        raise ReviewError(
            "SUGGESTION_SUPERSEDED",
            "该建议已被新版分析结果替代",
            409,
            {
                "suggestionId": row["id"],
                "currentStatus": "superseded",
                "supersededAt": _utc(row["superseded_at"]),
            },
        )
    if row["status"] != "pending":
        raise ReviewError(
            "SUGGESTION_ALREADY_REVIEWED",
            "该建议已经完成审核",
            409,
            {
                "suggestionId": row["id"],
                "currentStatus": row["status"],
                "reviewedAt": _utc(row["reviewed_at"]),
            },
        )


def accept_suggestion(database_path: Path, suggestion_id: str, payload: dict) -> dict:
    try:
        body = require_dict(payload, "body")
        comment = optional_string(body.get("comment"), "comment", 1000)
    except SchemaValidationError as error:
        raise ReviewError("INVALID_REQUEST", str(error), 400) from error

    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            row = connection.execute("SELECT * FROM suggestions WHERE id = ?", (suggestion_id,)).fetchone()
            if not row:
                raise ReviewError("SUGGESTION_NOT_FOUND", "未找到指定建议", 404)
            _check_pending(row)
            proposed = json.loads(row["proposed_change"])
            evidence_ids = _evidence_ids(connection, suggestion_id)

            if row["operation"] in {"resolveConceptMatch", "resolveMethodMatch"}:
                try:
                    resolution = require_dict(body.get("resolution"), "resolution")
                    selected = require_list(resolution.get("selectedTargets"), "resolution.selectedTargets")
                except SchemaValidationError as error:
                    raise ReviewError("INVALID_RESOLUTION", str(error), 400) from error
                if not 1 <= len(selected) <= 3:
                    raise ReviewError("INVALID_RESOLUTION", "必须选择一至三个候选", 400)

                targets = []
                candidate_ids = []
                overrides = {}
                for index, value in enumerate(selected):
                    target = require_dict(value, f"selectedTargets[{index}]")
                    candidate_id = require_string(target.get("candidateId"), "candidateId")
                    if candidate_id in candidate_ids:
                        raise ReviewError("INVALID_RESOLUTION", "candidateId 不能重复", 400)
                    candidate_ids.append(candidate_id)
                    overrides[candidate_id] = optional_string(
                        target.get("labelOverride"), "labelOverride", 200
                    )

                owner_type = "concept" if row["operation"] == "resolveConceptMatch" else "method"
                owner_id = proposed["extractedConceptId" if owner_type == "concept" else "extractedMethodId"]
                placeholders = ",".join("?" for _ in candidate_ids)
                candidate_rows = connection.execute(
                    f"""
                    SELECT * FROM resolution_candidates
                    WHERE owner_type = ? AND owner_id = ? AND id IN ({placeholders})
                    """,
                    [owner_type, owner_id, *candidate_ids],
                ).fetchall()
                by_id = {candidate["id"]: candidate for candidate in candidate_rows}
                if len(by_id) != len(candidate_ids):
                    raise ReviewError("INVALID_RESOLUTION", "候选不属于当前 Suggestion", 400)
                if sum(by_id[value]["kind"] == "new" for value in candidate_ids) > 1:
                    raise ReviewError("INVALID_RESOLUTION", "最多选择一个 New 候选", 400)

                item_table = "extracted_concepts" if owner_type == "concept" else "extracted_methods"
                item = connection.execute(
                    f"SELECT * FROM {item_table} WHERE id = ?", (owner_id,)
                ).fetchone()
                for candidate_id in candidate_ids:
                    candidate = by_id[candidate_id]
                    override = overrides[candidate_id]
                    if candidate["kind"] == "existing":
                        if override is not None:
                            raise ReviewError("INVALID_RESOLUTION", "Existing 候选不能修改名称", 400)
                        node = connection.execute(
                            "SELECT * FROM graph_nodes WHERE id = ? AND node_type = ?",
                            (candidate["node_id"], owner_type),
                        ).fetchone()
                        if not node:
                            raise ReviewError("RESOLUTION_CANDIDATE_STALE", "已有候选已失效", 409)
                        node_id = node["id"]
                        label = node["label"]
                        created = False
                    else:
                        label = override or candidate["label"]
                        if not label or len(label) > 200:
                            raise ReviewError("INVALID_RESOLUTION", "New 候选名称长度必须为1–200", 400)
                        stale = None
                        for node in connection.execute(
                            "SELECT id, label, aliases FROM graph_nodes WHERE node_type = ?",
                            (owner_type,),
                        ).fetchall():
                            aliases = [value.casefold() for value in json.loads(node["aliases"])]
                            if label.casefold() == node["label"].casefold() or label.casefold() in aliases:
                                stale = node
                                break
                        if stale:
                            raise ReviewError(
                                "RESOLUTION_CANDIDATE_STALE",
                                "New 候选已存在对应正式节点，请重新选择",
                                409,
                                {"nodeId": stale["id"]},
                            )
                        node_id = _id()
                        aliases = [] if item["raw_text"].casefold() == label.casefold() else [item["raw_text"]]
                        connection.execute(
                            """
                            INSERT INTO graph_nodes (
                                id, node_type, label, description, method_type, aliases, source_paper_ids
                            ) VALUES (?, ?, ?, ?, ?, ?, ?)
                            """,
                            (
                                node_id,
                                owner_type,
                                label,
                                item["description"] if owner_type == "method" else None,
                                item["method_type"] if owner_type == "method" else None,
                                _json(list(dict.fromkeys(aliases))),
                                _json([row["paper_id"]]),
                            ),
                        )
                        created = True

                    if node_id in {target["nodeId"] for target in targets}:
                        raise ReviewError("INVALID_RESOLUTION", "最终正式节点不能重复", 400)

                    if not created:
                        node = connection.execute("SELECT source_paper_ids FROM graph_nodes WHERE id = ?", (node_id,)).fetchone()
                        connection.execute(
                            "UPDATE graph_nodes SET source_paper_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                            (_merge_json_list(node["source_paper_ids"], [row["paper_id"]]), node_id),
                        )
                    relation_type = "studies" if owner_type == "concept" else "uses"
                    relation_id = _create_or_reuse_edge(
                        connection,
                        row["paper_id"],
                        "paper",
                        node_id,
                        owner_type,
                        relation_type,
                        candidate["recommendation_score"],
                        evidence_ids,
                        [row["paper_id"]],
                    )
                    connection.execute(
                        "UPDATE resolution_candidates SET resolved_node_id = ? WHERE id = ?",
                        (node_id, candidate_id),
                    )
                    targets.append(
                        {
                            "candidateId": candidate_id,
                            "nodeId": node_id,
                            "label": label,
                            "created": created,
                            "relationId": relation_id,
                        }
                    )

                all_candidates = connection.execute(
                    "SELECT client_ref, id FROM resolution_candidates WHERE owner_type = ? AND owner_id = ?",
                    (owner_type, owner_id),
                ).fetchall()
                unselected_refs = [candidate["client_ref"] for candidate in all_candidates if candidate["id"] not in candidate_ids]
                _discard_relation_refs(
                    connection, row["extraction_id"], "resolutionCandidateRef", unselected_refs
                )
                matched_ids = [target["nodeId"] for target in targets]
                connection.execute(
                    f"UPDATE {item_table} SET match_status = 'matched', matched_node_ids = ? WHERE id = ?",
                    (_json(matched_ids), owner_id),
                )
                execution = {"type": "resolveMatch", "resolvedTargets": targets}
                _activate_relation_candidates(connection, row["extraction_id"])

            elif row["operation"] == "addFinding":
                if body.get("resolution") is not None:
                    raise ReviewError("INVALID_REQUEST", "addFinding 的 resolution 必须为 null", 400)
                finding = connection.execute(
                    "SELECT * FROM extracted_findings WHERE id = ?",
                    (proposed["extractedFindingId"],),
                ).fetchone()
                existing_finding = connection.execute(
                    """
                    SELECT * FROM graph_nodes
                    WHERE node_type = 'finding' AND label = ? COLLATE NOCASE
                    """,
                    (finding["statement"],),
                ).fetchone()
                if existing_finding:
                    node_id = existing_finding["id"]
                    connection.execute(
                        "UPDATE graph_nodes SET source_paper_ids = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                        (
                            _merge_json_list(existing_finding["source_paper_ids"], [row["paper_id"]]),
                            node_id,
                        ),
                    )
                else:
                    node_id = _id()
                    connection.execute(
                        """
                        INSERT INTO graph_nodes (id, node_type, label, aliases, source_paper_ids)
                        VALUES (?, 'finding', ?, '[]', ?)
                        """,
                        (node_id, finding["statement"], _json([row["paper_id"]])),
                    )
                relation_id = _create_or_reuse_edge(
                    connection,
                    row["paper_id"],
                    "paper",
                    node_id,
                    "finding",
                    "reports",
                    finding["confidence"],
                    evidence_ids,
                    [row["paper_id"]],
                )
                connection.execute(
                    "UPDATE extracted_findings SET formal_node_id = ? WHERE id = ?",
                    (node_id, finding["id"]),
                )
                execution = {"type": "addFinding", "nodeId": node_id, "relationId": relation_id}
                _activate_relation_candidates(connection, row["extraction_id"])

            else:
                if body.get("resolution") is not None:
                    raise ReviewError("INVALID_REQUEST", "addRelation 的 resolution 必须为 null", 400)
                source_type = _formal_node_type(connection, proposed["sourceId"])
                target_type = _formal_node_type(connection, proposed["targetId"])
                if source_type != proposed["sourceType"] or target_type != proposed["targetType"]:
                    raise ReviewError("INVALID_RELATION", "关系端点已失效", 409)
                source_paper_ids = [row["paper_id"]]
                if evidence_ids:
                    placeholders = ",".join("?" for _ in evidence_ids)
                    source_paper_ids.extend(
                        item["paper_id"]
                        for item in connection.execute(
                            f"SELECT DISTINCT paper_id FROM evidence WHERE id IN ({placeholders})",
                            evidence_ids,
                        ).fetchall()
                    )
                relation_id = _create_or_reuse_edge(
                    connection,
                    proposed["sourceId"],
                    proposed["sourceType"],
                    proposed["targetId"],
                    proposed["targetType"],
                    proposed["relationType"],
                    row["confidence"],
                    evidence_ids,
                    list(dict.fromkeys(source_paper_ids)),
                )
                execution = {"type": "addRelation", "relationId": relation_id}

            connection.execute(
                """
                UPDATE suggestions
                SET status = 'accepted', execution_result = ?, reviewed_at = CURRENT_TIMESTAMP,
                    superseded_at = NULL, review_comment = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (_json(execution), comment, suggestion_id),
            )
            _refresh_paper(connection, row["paper_id"])
            updated = connection.execute("SELECT * FROM suggestions WHERE id = ?", (suggestion_id,)).fetchone()
        return _suggestion(connection, updated)
    except SchemaValidationError as error:
        raise ReviewError("INVALID_REQUEST", str(error), 400) from error
    except sqlite3.IntegrityError as error:
        raise ReviewError("INVALID_REQUEST", str(error), 422) from error
    finally:
        connection.close()


def reject_suggestion(database_path: Path, suggestion_id: str, payload: dict) -> dict:
    try:
        body = require_dict(payload, "body")
        reason = optional_string(body.get("reason"), "reason", 1000)
    except SchemaValidationError as error:
        raise ReviewError("INVALID_REQUEST", str(error), 400) from error

    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            row = connection.execute("SELECT * FROM suggestions WHERE id = ?", (suggestion_id,)).fetchone()
            if not row:
                raise ReviewError("SUGGESTION_NOT_FOUND", "未找到指定建议", 404)
            _check_pending(row)
            proposed = json.loads(row["proposed_change"])
            if row["operation"] in {"resolveConceptMatch", "resolveMethodMatch"}:
                owner_type = "concept" if row["operation"] == "resolveConceptMatch" else "method"
                owner_id = proposed["extractedConceptId" if owner_type == "concept" else "extractedMethodId"]
                refs = [
                    item["client_ref"]
                    for item in connection.execute(
                        "SELECT client_ref FROM resolution_candidates WHERE owner_type = ? AND owner_id = ?",
                        (owner_type, owner_id),
                    ).fetchall()
                ]
                _discard_relation_refs(
                    connection, row["extraction_id"], "resolutionCandidateRef", refs
                )
            elif row["operation"] == "addFinding":
                finding = connection.execute(
                    "SELECT client_ref FROM extracted_findings WHERE id = ?",
                    (proposed["extractedFindingId"],),
                ).fetchone()
                _discard_relation_refs(
                    connection, row["extraction_id"], "findingRef", [finding["client_ref"]]
                )

            connection.execute(
                """
                UPDATE suggestions
                SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP,
                    superseded_at = NULL, review_comment = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (reason, suggestion_id),
            )
            _refresh_paper(connection, row["paper_id"])
            updated = connection.execute("SELECT * FROM suggestions WHERE id = ?", (suggestion_id,)).fetchone()
        return _suggestion(connection, updated)
    finally:
        connection.close()
