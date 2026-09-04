"""v05 正式节点查询、候选匹配和 Graph 查询。"""

import json
import sqlite3
from collections import defaultdict, deque
from itertools import combinations
from pathlib import Path

from .database import connect


class GraphQueryError(ValueError):
    pass


class GraphNodeNotFoundError(Exception):
    pass


def _utc(value: str | None) -> str | None:
    if value and "T" not in value:
        return value.replace(" ", "T", 1) + "Z"
    return value


def _node_summary(row: sqlite3.Row) -> dict:
    result = {
        "id": row["id"],
        "label": row["label"],
        "description": row["description"],
        "aliases": json.loads(row["aliases"]),
    }
    if row["node_type"] == "method":
        result["methodType"] = row["method_type"]
    return result


def list_formal_nodes(
    database_path: Path,
    node_type: str,
    search: str | None,
    page: int,
    page_size: int,
) -> dict:
    if node_type not in {"concept", "method"}:
        raise ValueError("nodeType 不合法")
    if page < 1 or page_size < 1 or page_size > 100:
        raise ValueError("page 必须大于等于 1，pageSize 必须在 1–100 之间")
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        rows = connection.execute(
            "SELECT * FROM graph_nodes WHERE node_type = ? ORDER BY label, id",
            (node_type,),
        ).fetchall()
        if search:
            term = search.casefold()
            rows = [
                row
                for row in rows
                if term in row["label"].casefold()
                or any(term in alias.casefold() for alias in json.loads(row["aliases"]))
            ]
        total = len(rows)
        start = (page - 1) * page_size
        return {
            "items": [_node_summary(row) for row in rows[start : start + page_size]],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    finally:
        connection.close()


def get_formal_node(database_path: Path, node_type: str, node_id: str) -> dict | None:
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        row = connection.execute(
            "SELECT * FROM graph_nodes WHERE id = ? AND node_type = ?",
            (node_id, node_type),
        ).fetchone()
        return _node_summary(row) if row else None
    finally:
        connection.close()


def list_concept_papers(
    database_path: Path,
    concept_id: str,
    page: int,
    page_size: int,
    sort_by: str,
    sort_order: str,
) -> dict:
    from .paper_repository import _summary

    if page < 1 or page_size < 1 or page_size > 100:
        raise ValueError("page 必须大于等于 1，pageSize 必须在 1–100 之间")
    columns = {"year": "p.year", "createdAt": "p.created_at", "updatedAt": "p.updated_at", "title": "p.title"}
    if sort_by not in columns or sort_order not in {"asc", "desc"}:
        raise ValueError("sortBy 或 sortOrder 不合法")
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        if not connection.execute(
            "SELECT 1 FROM graph_nodes WHERE id = ? AND node_type = 'concept'", (concept_id,)
        ).fetchone():
            raise GraphNodeNotFoundError
        total = connection.execute(
            "SELECT COUNT(*) FROM graph_edges WHERE target_id = ? AND relation_type = 'studies'",
            (concept_id,),
        ).fetchone()[0]
        rows = connection.execute(
            f"""
            SELECT p.* FROM papers p
            JOIN graph_edges e ON e.source_id = p.id
            WHERE e.target_id = ? AND e.relation_type = 'studies'
            ORDER BY {columns[sort_by]} {sort_order.upper()}, p.id
            LIMIT ? OFFSET ?
            """,
            (concept_id, page_size, (page - 1) * page_size),
        ).fetchall()
        return {
            "items": [_summary(connection, row) for row in rows],
            "page": page,
            "pageSize": page_size,
            "total": total,
        }
    finally:
        connection.close()


def match_node_candidates(
    database_path: Path,
    node_type: str,
    raw_text: str,
    normalized_label: str,
    limit: int,
) -> dict:
    if node_type not in {"concept", "method"}:
        raise ValueError("nodeType 不合法")
    if limit < 1 or limit > 10:
        raise ValueError("limit 必须在 1–10 之间")
    query = normalized_label.strip().casefold() or raw_text.strip().casefold()
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        candidates = []
        for row in connection.execute(
            "SELECT * FROM graph_nodes WHERE node_type = ?", (node_type,)
        ).fetchall():
            label = row["label"].casefold()
            aliases = [value.casefold() for value in json.loads(row["aliases"])]
            if query == label:
                score = 1.0
            elif query in aliases:
                score = 0.95
            elif query in label or label in query or any(query in value or value in query for value in aliases):
                score = 0.75
            else:
                continue
            candidates.append(
                {
                    "nodeId": row["id"],
                    "label": row["label"],
                    "recommendationScore": score,
                    "evidence": [],
                }
            )
        candidates.sort(key=lambda value: (-value["recommendationScore"], value["label"], value["nodeId"]))
        return {"nodeType": node_type, "candidates": candidates[:limit]}
    finally:
        connection.close()


def _all_nodes(connection: sqlite3.Connection) -> dict[str, dict]:
    nodes = {}
    for row in connection.execute("SELECT * FROM papers").fetchall():
        nodes[row["id"]] = {
            "id": row["id"],
            "nodeType": "paper",
            "label": row["title"],
            "description": row["abstract"],
            "sourcePaperIds": [row["id"]],
            "createdAt": _utc(row["created_at"]),
            "updatedAt": _utc(row["updated_at"]),
        }
    for row in connection.execute("SELECT * FROM authors").fetchall():
        paper_ids = [
            value["paper_id"]
            for value in connection.execute(
                "SELECT paper_id FROM paper_authors WHERE author_id = ? ORDER BY paper_id", (row["id"],)
            ).fetchall()
        ]
        nodes[row["id"]] = {
            "id": row["id"],
            "nodeType": "author",
            "label": row["name"],
            "description": None,
            "sourcePaperIds": paper_ids,
            "createdAt": _utc(row["created_at"]),
            "updatedAt": _utc(row["updated_at"]),
        }
    for row in connection.execute("SELECT * FROM graph_nodes").fetchall():
        nodes[row["id"]] = {
            "id": row["id"],
            "nodeType": row["node_type"],
            "label": row["label"],
            "description": row["description"],
            "sourcePaperIds": json.loads(row["source_paper_ids"]),
            "createdAt": _utc(row["created_at"]),
            "updatedAt": _utc(row["updated_at"]),
        }
    return nodes


def _all_edges(connection: sqlite3.Connection) -> list[dict]:
    edges = []
    for row in connection.execute("SELECT * FROM graph_edges").fetchall():
        evidence_ids = [
            item["evidence_id"]
            for item in connection.execute(
                "SELECT evidence_id FROM graph_edge_evidence WHERE edge_id = ? ORDER BY evidence_id",
                (row["id"],),
            ).fetchall()
        ]
        edges.append(
            {
                "id": row["id"],
                "sourceId": row["source_id"],
                "targetId": row["target_id"],
                "relationType": row["relation_type"],
                "label": row["label"],
                "confidence": row["confidence"],
                "evidenceIds": evidence_ids,
                "weight": row["weight"],
                "sourcePaperIds": json.loads(row["source_paper_ids"]),
                "createdAt": _utc(row["created_at"]),
                "updatedAt": _utc(row["updated_at"]),
            }
        )

    author_papers: dict[str, list[str]] = defaultdict(list)
    paper_authors: dict[str, list[str]] = defaultdict(list)
    for row in connection.execute(
        "SELECT paper_id, author_id FROM paper_authors ORDER BY paper_id, position, author_id"
    ).fetchall():
        author_papers[row["author_id"]].append(row["paper_id"])
        paper_authors[row["paper_id"]].append(row["author_id"])
        edges.append(
            {
                "id": f"authored:{row['author_id']}:{row['paper_id']}",
                "sourceId": row["author_id"],
                "targetId": row["paper_id"],
                "relationType": "authored",
                "label": "authored",
                "confidence": None,
                "evidenceIds": [],
                "weight": None,
                "sourcePaperIds": [row["paper_id"]],
                "createdAt": None,
                "updatedAt": None,
            }
        )

    pair_papers: dict[tuple[str, str], list[str]] = defaultdict(list)
    for paper_id, author_ids in paper_authors.items():
        for source_id, target_id in combinations(sorted(set(author_ids)), 2):
            pair_papers[(source_id, target_id)].append(paper_id)
    for (source_id, target_id), paper_ids in pair_papers.items():
        source_papers = sorted(set(paper_ids))
        edges.append(
            {
                "id": f"coAuthor:{source_id}:{target_id}",
                "sourceId": source_id,
                "targetId": target_id,
                "relationType": "coAuthor",
                "label": "coAuthor",
                "confidence": None,
                "evidenceIds": [],
                "weight": len(source_papers),
                "sourcePaperIds": source_papers,
                "createdAt": None,
                "updatedAt": None,
            }
        )
    return edges


def get_graph(database_path: Path, focus_node_id: str, depth: int, max_nodes: int) -> dict:
    if depth < 1 or depth > 5 or max_nodes < 10 or max_nodes > 50:
        raise GraphQueryError("depth 必须在 1–5，maxNodes 必须在 10–50")
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        nodes = _all_nodes(connection)
        if focus_node_id not in nodes:
            raise GraphNodeNotFoundError
        edges = _all_edges(connection)
        adjacency: dict[str, list[tuple[str, dict]]] = defaultdict(list)
        evidence_weight: dict[str, int] = defaultdict(int)
        for edge in edges:
            adjacency[edge["sourceId"]].append((edge["targetId"], edge))
            adjacency[edge["targetId"]].append((edge["sourceId"], edge))
            weight = len(edge["evidenceIds"])
            evidence_weight[edge["sourceId"]] += weight
            evidence_weight[edge["targetId"]] += weight

        distances = {focus_node_id: 0}
        queue = deque([focus_node_id])
        while queue:
            current = queue.popleft()
            if distances[current] >= depth:
                continue
            neighbours = sorted(
                adjacency[current],
                key=lambda value: (-evidence_weight[value[0]], value[0]),
            )
            for neighbour, _ in neighbours:
                if neighbour in nodes and neighbour not in distances:
                    distances[neighbour] = distances[current] + 1
                    queue.append(neighbour)

        ordered_ids = sorted(
            distances,
            key=lambda node_id: (distances[node_id], -evidence_weight[node_id], node_id),
        )
        total_matched = len(ordered_ids)
        selected_ids = set(ordered_ids[:max_nodes])
        selected_edges = [
            edge for edge in edges if edge["sourceId"] in selected_ids and edge["targetId"] in selected_ids
        ]
        evidence_ids = sorted({value for edge in selected_edges for value in edge["evidenceIds"]})
        evidence = []
        if evidence_ids:
            placeholders = ",".join("?" for _ in evidence_ids)
            for row in connection.execute(
                f"SELECT * FROM evidence WHERE id IN ({placeholders}) ORDER BY created_at, id",
                evidence_ids,
            ).fetchall():
                evidence.append(
                    {
                        "id": row["id"],
                        "paperId": row["paper_id"],
                        "section": row["section"],
                        "text": row["text"],
                    }
                )
        return {
            "nodes": [nodes[node_id] for node_id in ordered_ids[:max_nodes]],
            "edges": selected_edges,
            "evidence": evidence,
            "meta": {
                "focusNodeId": focus_node_id,
                "depth": depth,
                "nodeCount": min(total_matched, max_nodes),
                "edgeCount": len(selected_edges),
                "totalMatched": total_matched,
                "truncated": total_matched > max_nodes,
            },
        }
    finally:
        connection.close()
