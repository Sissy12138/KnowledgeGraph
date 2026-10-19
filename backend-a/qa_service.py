"""Grounded multi-turn question answering over the local research library."""

from __future__ import annotations

import json
import re
import sqlite3
import ssl
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import certifi

from .database import connect
from .model_providers import build_generation_request, extract_generated_text


class QuestionAnswerError(RuntimeError):
    def __init__(self, code: str, message: str, retryable: bool = False) -> None:
        super().__init__(message)
        self.code = code
        self.retryable = retryable


_STOPWORDS = {
    "what", "which", "how", "why", "the", "and", "are", "was", "were", "this",
    "that", "these", "those", "paper", "papers", "study", "studies",
    "什么", "哪些", "如何", "为什么", "文章", "论文", "研究", "文献", "主要", "进行",
}


def _terms(question: str) -> list[str]:
    raw = re.findall(r"[A-Za-z0-9][A-Za-z0-9_.+-]{1,}|[\u4e00-\u9fff]{2,}", question.casefold())
    terms: list[str] = []
    for term in raw:
        if term in _STOPWORDS:
            continue
        terms.append(term)
        if re.fullmatch(r"[\u4e00-\u9fff]{4,}", term):
            terms.extend(term[index : index + 2] for index in range(len(term) - 1))
    return list(dict.fromkeys(terms))


def _score(text: str, terms: list[str]) -> int:
    folded = text.casefold()
    return sum((len(term) + 1) * folded.count(term) for term in terms)


def _json_list(value: str | None) -> list[str]:
    try:
        parsed = json.loads(value or "[]")
    except json.JSONDecodeError:
        return []
    return [str(item) for item in parsed if str(item).strip()] if isinstance(parsed, list) else []


def retrieve_sources(database_path: Path, question: str, limit: int = 12) -> list[dict]:
    """Rank analyzed papers and their evidence without sending the full library to a model."""
    terms = _terms(question)
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    candidates: list[tuple[int, int, dict]] = []
    try:
        papers = list(connection.execute(
            """
            SELECT p.id, p.title, p.abstract, p.year, p.journal_name,
                   e.research_topics, e.research_question, e.sample, e.methods,
                   e.main_results, e.created_at AS extraction_created_at,
                   GROUP_CONCAT(DISTINCT a.name) AS authors,
                   GROUP_CONCAT(DISTINCT pt.tag) AS tags
            FROM papers p
            JOIN extractions e ON e.paper_id = p.id AND e.is_latest = 1
            LEFT JOIN paper_authors pa ON pa.paper_id = p.id
            LEFT JOIN authors a ON a.id = pa.author_id
            LEFT JOIN paper_tags pt ON pt.paper_id = p.id
            GROUP BY p.id, e.id
            ORDER BY e.created_at DESC
            LIMIT 300
            """
        ))

        for recency, row in enumerate(papers):
            topics = _json_list(row["research_topics"])
            fields = [
                row["title"], row["abstract"], "；".join(topics), row["research_question"],
                row["sample"], row["methods"], row["main_results"], row["authors"], row["tags"],
            ]
            text = "\n".join(value for value in fields if isinstance(value, str) and value.strip())
            title_score = _score(row["title"], terms) * 3
            score = title_score + _score(text, terms)
            # Broad questions still receive representative analyzed papers.
            if not terms:
                score = max(1, 30 - recency)
            if score:
                overview = "\n".join(
                    value for value in (
                        f"研究主题：{'；'.join(topics)}" if topics else None,
                        f"研究问题：{row['research_question']}" if row["research_question"] else None,
                        f"样本及分组：{row['sample']}" if row["sample"] else None,
                        f"方法：{row['methods']}" if row["methods"] else None,
                        f"主要结果：{row['main_results']}" if row["main_results"] else None,
                        f"摘要：{row['abstract']}" if row["abstract"] else None,
                    ) if value
                )
                candidates.append((score, recency, {
                    "id": row["id"], "type": "paper", "paperId": row["id"],
                    "title": row["title"], "excerpt": overview[:1800],
                    "year": row["year"], "journal": row["journal_name"],
                }))

        for row in connection.execute(
            """
            SELECT ev.id, ev.text, ev.section, ev.paper_id, p.title
            FROM evidence ev JOIN papers p ON p.id = ev.paper_id
            JOIN extractions ex ON ex.id = ev.extraction_id AND ex.is_latest = 1
            ORDER BY ev.created_at DESC LIMIT 1200
            """
        ):
            score = _score(row["text"], terms)
            if score:
                candidates.append((score + 8, 0, {
                    "id": row["id"], "type": "evidence", "paperId": row["paper_id"],
                    "title": row["title"], "location": row["section"] or "分析证据",
                    "excerpt": row["text"][:1400],
                }))

        for row in connection.execute(
            """
            SELECT n.id, n.node_type, n.label, n.description, n.source_paper_ids
            FROM graph_nodes n ORDER BY n.updated_at DESC LIMIT 800
            """
        ):
            text = "\n".join(value for value in (row["label"], row["description"]) if value)
            score = _score(text, terms)
            if score:
                paper_ids = _json_list(row["source_paper_ids"])
                candidates.append((score + 4, 0, {
                    "id": row["id"], "type": row["node_type"],
                    "paperId": paper_ids[0] if paper_ids else None,
                    "title": row["label"], "excerpt": text[:1200],
                }))
    finally:
        connection.close()

    # If keyword matching is too strict, use recent analyzed overviews rather than hallucinating.
    if not candidates and papers:
        for recency, row in enumerate(papers[:6]):
            topics = _json_list(row["research_topics"])
            excerpt = "\n".join(value for value in (
                f"研究主题：{'；'.join(topics)}" if topics else None,
                f"研究问题：{row['research_question']}" if row["research_question"] else None,
                f"方法：{row['methods']}" if row["methods"] else None,
                f"主要结果：{row['main_results']}" if row["main_results"] else None,
                f"摘要：{row['abstract']}" if row["abstract"] else None,
            ) if value)
            candidates.append((1, recency, {
                "id": row["id"], "type": "paper", "paperId": row["id"],
                "title": row["title"], "excerpt": excerpt[:1800],
                "year": row["year"], "journal": row["journal_name"],
            }))

    candidates.sort(key=lambda item: (-item[0], item[1], item[2]["id"]))
    selected: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for _, _, source in candidates:
        key = (source.get("paperId") or source["id"], source["type"])
        if key in seen and source["type"] == "paper":
            continue
        seen.add(key)
        selected.append(source)
        if len(selected) >= limit:
            break
    return selected


def _validated_history(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    result = []
    for item in value[-6:]:
        if not isinstance(item, dict) or item.get("role") not in {"user", "assistant"}:
            continue
        content = item.get("content")
        if isinstance(content, str) and content.strip():
            result.append({"role": item["role"], "content": content.strip()[:2000]})
    return result


def answer_question(database_path: Path, config: dict, question: str, history: object = None) -> dict:
    if not isinstance(question, str) or not 2 <= len(question.strip()) <= 1000:
        raise QuestionAnswerError("INVALID_QUESTION", "问题长度必须在 2–1000 个字符之间")
    question = question.strip()
    sources = retrieve_sources(database_path, question)
    if not sources:
        return {
            "answer": "当前文献库中还没有可用于回答该问题的已分析内容。",
            "sources": [], "model": None,
        }

    previous = _validated_history(history)
    history_text = "\n".join(
        ("用户" if item["role"] == "user" else "助手") + "：" + item["content"]
        for item in previous
    )
    system_prompt = (
        "你是研知图的本地科研知识问答助手。只能依据本次提供的本地知识库材料回答，"
        "不得用外部常识补足缺失事实。区分论文明确报告的结论与跨论文归纳；材料不足时明确说明。"
        "使用中文、结构清楚、避免空泛措辞；每个关键判断后用[1]、[2]标注材料编号。"
    )
    user_prompt = (
        (f"最近对话：\n{history_text}\n\n" if history_text else "")
        + f"当前问题：\n{question}\n\n本地知识库材料：\n"
        + "\n\n".join(
            f"[{index}] {source['type']}｜{source['title']}"
            + (f"｜{source['location']}" if source.get("location") else "")
            + f"\n{source['excerpt']}"
            for index, source in enumerate(sources, start=1)
        )
    )
    request = build_generation_request(config, system_prompt, user_prompt)
    try:
        context = ssl.create_default_context(cafile=certifi.where())
        with urlopen(request, timeout=120, context=context) as response:
            body = json.loads(response.read().decode("utf-8"))
        answer = extract_generated_text(config["provider"], body)
    except HTTPError as error:
        retryable = error.code == 429 or error.code >= 500
        message = "模型额度或速率受限" if error.code == 429 else f"模型服务返回 HTTP {error.code}"
        raise QuestionAnswerError("MODEL_PROVIDER_ERROR", message, retryable) from error
    except (URLError, TimeoutError) as error:
        raise QuestionAnswerError("MODEL_NETWORK_ERROR", "无法连接模型服务，请检查网络或稍后重试", True) from error
    except (json.JSONDecodeError, ValueError, KeyError) as error:
        raise QuestionAnswerError("MODEL_RESPONSE_INVALID", "模型返回内容无法解析，请重试", True) from error
    return {"answer": answer, "sources": sources, "model": config["model"]}
