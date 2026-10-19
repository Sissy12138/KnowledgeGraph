import argparse
import json
import ssl
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from pathlib import Path
from urllib.parse import parse_qs
from wsgiref.simple_server import make_server

import certifi

from .analysis_job_repository import (
    ActiveJobError,
    JobNotCancellableError,
    JobNotDeletableError,
    JobNotFoundError,
    PaperNotFoundError,
    cancel_job,
    create_jobs_for_new_papers,
    fail_job,
    create_job,
    delete_job,
    get_job,
    list_jobs,
    update_job_progress,
)
from .analysis_service import (
    AnalysisResultError,
    ExtractionNotFoundError,
    get_latest_extraction,
    submit_analysis_result,
)
from .graph_service import (
    GraphNodeNotFoundError,
    GraphQueryError,
    get_formal_node,
    get_graph,
    list_concept_papers,
    list_formal_nodes,
    match_node_candidates,
)
from .paper_repository import get_author, get_paper, list_papers, remove_paper
from .model_config import clear_config, configure_storage, private_dict, public_status, set_config
from .model_providers import build_test_request, list_providers
from .qa_service import QuestionAnswerError, answer_question
from .review_service import (
    ReviewError,
    accept_suggestion,
    apply_unreviewed_citations,
    get_suggestion_detail,
    list_suggestions,
    reconcile_rejected_entity_relations,
    reject_suggestion,
    reopen_suggestion,
)
from .zotero_import_service import (
    ZoteroImportError,
    get_zotero_status,
    import_zotero_selection,
    list_zotero_collections,
    preview_zotero_import,
    sync_zotero,
)


HTTP_STATUS = {
    200: "200 OK",
    201: "201 Created",
    400: "400 Bad Request",
    404: "404 Not Found",
    409: "409 Conflict",
    422: "422 Unprocessable Entity",
    500: "500 Internal Server Error",
    503: "503 Service Unavailable",
}


def _json(start_response, status: str, data: dict) -> list[bytes]:
    body = json.dumps(data, ensure_ascii=False).encode("utf-8")
    start_response(
        status,
        [
            ("Content-Type", "application/json; charset=utf-8"),
            ("Content-Length", str(len(body))),
            ("Access-Control-Allow-Origin", "*"),
        ],
    )
    return [body]


def _error(
    start_response,
    status: str,
    code: str,
    message: str,
    details: dict | None = None,
    retryable: bool = False,
) -> list[bytes]:
    return _json(
        start_response,
        status,
        {
            "error": {
                "code": code,
                "message": message,
                "retryable": retryable,
                "details": details,
                "requestId": "local",
            }
        },
    )


def _read_json(environ) -> dict:
    try:
        length = int(environ.get("CONTENT_LENGTH") or "0")
        raw = environ["wsgi.input"].read(length)
        value = json.loads(raw.decode("utf-8")) if raw else {}
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as error:
        raise ValueError("请求体必须是有效 JSON") from error
    if not isinstance(value, dict):
        raise ValueError("请求体必须是 JSON 对象")
    return value


def _query(environ) -> dict[str, list[str]]:
    return parse_qs(environ.get("QUERY_STRING", ""))


def _model_test_error(error: Exception) -> tuple[str, str, dict, bool]:
    """Turn provider failures into messages a local user can act on.

    The provider response body is deliberately not returned: it may contain
    request metadata, while a concise status-specific explanation is enough
    for local troubleshooting.
    """
    if isinstance(error, HTTPError):
        status = error.code
        if status in {401, 403}:
            return ("MODEL_AUTH_FAILED", "API Key 无效、已撤销，或没有该模型的访问权限。", {"providerStatus": status}, False)
        if status == 404:
            return ("MODEL_NOT_FOUND", "所选模型或兼容 API 地址不存在。请重新选择服务商和模型。", {"providerStatus": status}, False)
        if status == 429:
            return ("MODEL_RATE_OR_QUOTA_LIMIT", "服务商拒绝了请求：可能是余额不足、账单未启用，或暂时触发了速率限制。", {"providerStatus": status}, True)
        return ("MODEL_PROVIDER_ERROR", f"模型服务返回 HTTP {status}。请稍后重试，或检查该服务商控制台。", {"providerStatus": status}, status >= 500)
    if isinstance(error, URLError):
        return ("MODEL_NETWORK_ERROR", "无法连接模型服务。请检查网络、代理或服务商地址。", {}, True)
    if isinstance(error, ValueError):
        return ("MODEL_NOT_CONFIGURED", str(error), {}, False)
    return ("MODEL_TEST_FAILED", "模型连接测试失败。请检查配置后重试。", {}, True)


def create_app(database_path: Path, zotero_root: Path | None = None):
    zotero_root = zotero_root or Path.home() / "Zotero"
    configure_storage(database_path.with_name("model-config.json"))
    apply_unreviewed_citations(database_path)
    reconcile_rejected_entity_relations(database_path)

    def app(environ, start_response):
        method = environ["REQUEST_METHOD"]
        path = environ["PATH_INFO"].rstrip("/") or "/"

        if method == "OPTIONS":
            start_response(
                "204 No Content",
                [
                    ("Access-Control-Allow-Origin", "*"),
                    ("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS"),
                    ("Access-Control-Allow-Headers", "Content-Type"),
                ],
            )
            return [b""]

        try:
            if method == "GET" and path == "/healthz":
                return _json(start_response, "200 OK", {"status": "ok", "service": "backend-a"})

            if method == "GET" and path == "/api/v1/model-config":
                return _json(start_response, "200 OK", public_status())
            if method == "GET" and path == "/api/v1/model-providers":
                return _json(start_response, "200 OK", list_providers())
            if method == "POST" and path == "/api/v1/model-config":
                try:
                    return _json(start_response, "200 OK", set_config(_read_json(environ)))
                except ValueError as error:
                    return _error(start_response, "400 Bad Request", "INVALID_MODEL_CONFIG", str(error))
            if method == "DELETE" and path == "/api/v1/model-config":
                clear_config()
                return _json(start_response, "200 OK", public_status())

            if method == "GET" and path == "/api/v1/internal/model-config":
                try:
                    return _json(start_response, "200 OK", private_dict())
                except ValueError as error:
                    return _error(start_response, "409 Conflict", "MODEL_NOT_CONFIGURED", str(error))
            if method == "POST" and path == "/api/v1/model-config/test":
                try:
                    config = private_dict()
                    started = time.monotonic()
                    request = build_test_request(config)
                    context = ssl.create_default_context(cafile=certifi.where())
                    with urlopen(request, timeout=30, context=context) as response:
                        response.read()
                    return _json(start_response, "200 OK", {"ok": True, "latencyMs": round((time.monotonic() - started) * 1000), "model": config["model"]})
                except Exception as error:
                    code, message, details, retryable = _model_test_error(error)
                    return _error(start_response, "502 Bad Gateway", code, message, details, retryable)

            if method == "POST" and path == "/api/v1/qa":
                try:
                    config = private_dict()
                except ValueError:
                    return _error(
                        start_response,
                        "409 Conflict",
                        "MODEL_NOT_CONFIGURED",
                        "请先在模型配置页面保存并测试 API Key，再使用知识问答。",
                    )
                body = _read_json(environ)
                return _json(
                    start_response,
                    "200 OK",
                    answer_question(database_path, config, body.get("question"), body.get("history")),
                )

            if method == "GET" and path == "/api/v1/zotero/status":
                return _json(start_response, "200 OK", get_zotero_status())

            if method == "GET" and path == "/api/v1/zotero/collections":
                return _json(start_response, "200 OK", list_zotero_collections(database_path))

            if method == "POST" and path == "/api/v1/zotero/import-preview":
                result = preview_zotero_import(database_path, zotero_root, _read_json(environ))
                return _json(start_response, "200 OK", result)

            if method == "POST" and path == "/api/v1/zotero/import":
                result = import_zotero_selection(database_path, zotero_root, _read_json(environ))
                return _json(start_response, "200 OK", result)

            if method == "POST" and path == "/api/v1/zotero/sync":
                return _json(start_response, "200 OK", sync_zotero(database_path, zotero_root))

            if method == "GET" and path == "/api/v1/papers":
                query = _query(environ)
                result = list_papers(
                    database_path=database_path,
                    page=int(query.get("page", ["1"])[0]),
                    page_size=int(query.get("pageSize", ["20"])[0]),
                    status=query.get("status", [None])[0],
                    search=query.get("search", [None])[0],
                    sort_by=query.get("sortBy", ["updatedAt"])[0],
                    sort_order=query.get("sortOrder", ["desc"])[0],
                )
                return _json(start_response, "200 OK", result)

            if method == "GET" and path in {"/api/v1/concepts", "/api/v1/methods"}:
                query = _query(environ)
                node_type = "concept" if path.endswith("concepts") else "method"
                result = list_formal_nodes(
                    database_path,
                    node_type,
                    query.get("search", [None])[0],
                    int(query.get("page", ["1"])[0]),
                    int(query.get("pageSize", ["20"])[0]),
                )
                return _json(start_response, "200 OK", result)

            author_prefix = "/api/v1/authors/"
            if method == "GET" and path.startswith(author_prefix):
                author_id = path.removeprefix(author_prefix)
                if not author_id or "/" in author_id:
                    return _error(start_response, "404 Not Found", "AUTHOR_NOT_FOUND", "未找到指定作者")
                author = get_author(database_path, author_id)
                if not author:
                    return _error(start_response, "404 Not Found", "AUTHOR_NOT_FOUND", "未找到指定作者")
                return _json(start_response, "200 OK", author)

            concept_prefix = "/api/v1/concepts/"
            if method == "GET" and path.startswith(concept_prefix):
                remainder = path.removeprefix(concept_prefix)
                if remainder.endswith("/papers"):
                    concept_id = remainder.removesuffix("/papers")
                    query = _query(environ)
                    result = list_concept_papers(
                        database_path,
                        concept_id,
                        int(query.get("page", ["1"])[0]),
                        int(query.get("pageSize", ["20"])[0]),
                        query.get("sortBy", ["year"])[0],
                        query.get("sortOrder", ["desc"])[0],
                    )
                    return _json(start_response, "200 OK", result)
                if "/" not in remainder:
                    node = get_formal_node(database_path, "concept", remainder)
                    if not node:
                        return _error(start_response, "404 Not Found", "CONCEPT_NOT_FOUND", "未找到指定概念")
                    return _json(start_response, "200 OK", node)

            method_prefix = "/api/v1/methods/"
            if method == "GET" and path.startswith(method_prefix):
                method_id = path.removeprefix(method_prefix)
                if "/" not in method_id:
                    node = get_formal_node(database_path, "method", method_id)
                    if not node:
                        return _error(start_response, "404 Not Found", "METHOD_NOT_FOUND", "未找到指定方法")
                    return _json(start_response, "200 OK", node)

            if method == "POST" and path == "/api/v1/internal/node-match-candidates":
                body = _read_json(environ)
                result = match_node_candidates(
                    database_path,
                    body.get("nodeType"),
                    body.get("rawText") or "",
                    body.get("normalizedLabel") or "",
                    int(body.get("limit", 5)),
                )
                return _json(start_response, "200 OK", result)

            paper_job_suffix = "/analysis-jobs"
            if method == "POST" and path.startswith("/api/v1/papers/") and path.endswith(paper_job_suffix):
                paper_id = path.removeprefix("/api/v1/papers/").removesuffix(paper_job_suffix).rstrip("/")
                if not public_status()["configured"]:
                    return _error(
                        start_response,
                        "409 Conflict",
                        "MODEL_NOT_CONFIGURED",
                        "请先在模型配置页面填写并测试 API Key，再开始分析。",
                    )
                try:
                    body = _read_json(environ)
                    job = create_job(database_path, paper_id, body.get("resultMode", "preserve"))
                except PaperNotFoundError:
                    return _error(start_response, "404 Not Found", "PAPER_NOT_FOUND", "未找到指定论文")
                except ActiveJobError as error:
                    return _error(
                        start_response,
                        "409 Conflict",
                        "ACTIVE_JOB_EXISTS",
                        "该论文已有活动分析任务",
                        {"activeJobId": error.job_id},
                    )
                return _json(start_response, "201 Created", job)

            result_prefix = "/api/v1/internal/analysis-jobs/"
            if method == "POST" and path.startswith(result_prefix) and path.endswith("/result"):
                job_id = path.removeprefix(result_prefix).removesuffix("/result").rstrip("/")
                result, created = submit_analysis_result(database_path, job_id, _read_json(environ))
                return _json(start_response, "201 Created" if created else "200 OK", result)

            if method == "POST" and path.startswith("/api/v1/internal/analysis-jobs/") and path.endswith("/progress"):
                job_id = path.removeprefix("/api/v1/internal/analysis-jobs/").removesuffix("/progress").rstrip("/")
                body = _read_json(environ)
                return _json(start_response, "200 OK", update_job_progress(database_path, job_id, body.get("progress"), body.get("stage")))

            if method == "POST" and path.startswith("/api/v1/internal/analysis-jobs/") and path.endswith("/failed"):
                job_id = path.removeprefix("/api/v1/internal/analysis-jobs/").removesuffix("/failed").rstrip("/")
                body = _read_json(environ)
                return _json(start_response, "200 OK", fail_job(database_path, job_id, str(body.get("code", "WORKER_ERROR")), str(body.get("message", "Worker failed"))))

            job_prefix = "/api/v1/analysis-jobs/"
            if method == "GET" and path == "/api/v1/analysis-jobs":
                query = _query(environ)
                return _json(start_response, "200 OK", list_jobs(
                    database_path,
                    query.get("status", [None])[0],
                    int(query.get("limit", ["20"])[0]),
                ))
            if method == "POST" and path == "/api/v1/analysis-jobs/analyze-new":
                if not public_status()["configured"]:
                    return _error(
                        start_response,
                        "409 Conflict",
                        "MODEL_NOT_CONFIGURED",
                        "请先在模型配置页面填写并测试 API Key，再开始批量分析。",
                    )
                return _json(start_response, "201 Created", create_jobs_for_new_papers(database_path))
            if path.startswith(job_prefix):
                remainder = path.removeprefix(job_prefix)
                is_cancel = remainder.endswith("/cancel")
                job_id = remainder.removesuffix("/cancel") if is_cancel else remainder
                try:
                    if method == "POST" and is_cancel:
                        return _json(start_response, "200 OK", cancel_job(database_path, job_id))
                    if method == "DELETE" and not is_cancel and "/" not in job_id:
                        return _json(start_response, "200 OK", delete_job(database_path, job_id))
                    if method == "GET" and not is_cancel and "/" not in job_id:
                        return _json(start_response, "200 OK", get_job(database_path, job_id))
                except JobNotFoundError:
                    return _error(start_response, "404 Not Found", "JOB_NOT_FOUND", "未找到指定任务")
                except JobNotCancellableError:
                    return _error(
                        start_response,
                        "409 Conflict",
                        "JOB_NOT_CANCELLABLE",
                        "该任务已经结束，不能取消",
                    )
                except JobNotDeletableError:
                    return _error(
                        start_response,
                        "409 Conflict",
                        "JOB_NOT_DELETABLE",
                        "只有同篇论文已有成功任务时，才能删除失败或已取消的任务记录",
                    )

            latest_suffix = "/extractions/latest"
            if method == "GET" and path.startswith("/api/v1/papers/") and path.endswith(latest_suffix):
                paper_id = path.removeprefix("/api/v1/papers/").removesuffix(latest_suffix).rstrip("/")
                try:
                    return _json(start_response, "200 OK", get_latest_extraction(database_path, paper_id))
                except ExtractionNotFoundError:
                    return _error(
                        start_response, "404 Not Found", "EXTRACTION_NOT_FOUND", "该论文尚无分析结果"
                    )

            if method == "GET" and path == "/api/v1/suggestions":
                query = _query(environ)
                result = list_suggestions(
                    database_path,
                    int(query.get("page", ["1"])[0]),
                    int(query.get("pageSize", ["20"])[0]),
                    query.get("paperId", [None])[0],
                    query.get("status", [None])[0],
                    query.get("operation", [None])[0],
                )
                return _json(start_response, "200 OK", result)

            suggestion_prefix = "/api/v1/suggestions/"
            if path.startswith(suggestion_prefix):
                remainder = path.removeprefix(suggestion_prefix)
                if method == "POST" and remainder.endswith("/accept"):
                    suggestion_id = remainder.removesuffix("/accept")
                    return _json(
                        start_response,
                        "200 OK",
                        accept_suggestion(database_path, suggestion_id, _read_json(environ)),
                    )
                if method == "POST" and remainder.endswith("/reject"):
                    suggestion_id = remainder.removesuffix("/reject")
                    return _json(
                        start_response,
                        "200 OK",
                        reject_suggestion(database_path, suggestion_id, _read_json(environ)),
                    )
                if method == "POST" and remainder.endswith("/reopen"):
                    suggestion_id = remainder.removesuffix("/reopen")
                    return _json(
                        start_response,
                        "200 OK",
                        reopen_suggestion(database_path, suggestion_id),
                    )
                if method == "GET" and "/" not in remainder:
                    return _json(start_response, "200 OK", get_suggestion_detail(database_path, remainder))

            if method == "GET" and path == "/api/v1/graph":
                query = _query(environ)
                focus_node_id = query.get("focusNodeId", [None])[0]
                if not focus_node_id:
                    return _json(start_response, "200 OK", get_graph(database_path))
                try:
                    depth = int(query.get("depth", ["2"])[0])
                    max_nodes = int(query.get("maxNodes", ["30"])[0])
                except ValueError as error:
                    raise GraphQueryError("depth 和 maxNodes 必须是整数") from error
                result = get_graph(
                    database_path,
                    focus_node_id,
                    depth,
                    max_nodes,
                )
                return _json(start_response, "200 OK", result)

            paper_prefix = "/api/v1/papers/"
            if method == "DELETE" and path.startswith(paper_prefix):
                paper_id = path.removeprefix(paper_prefix)
                if not paper_id or "/" in paper_id or not remove_paper(database_path, paper_id):
                    return _error(start_response, "404 Not Found", "PAPER_NOT_FOUND", "未找到指定论文")
                return _json(start_response, "200 OK", {"deleted": True, "paperId": paper_id})

            if method == "GET" and path.startswith(paper_prefix):
                paper_id = path.removeprefix(paper_prefix)
                if not paper_id or "/" in paper_id:
                    return _error(start_response, "404 Not Found", "NOT_FOUND", "接口不存在")
                paper = get_paper(database_path, paper_id)
                if paper is None:
                    return _error(start_response, "404 Not Found", "PAPER_NOT_FOUND", "未找到指定论文")
                return _json(start_response, "200 OK", paper)

        except AnalysisResultError as error:
            return _error(
                start_response,
                HTTP_STATUS[error.status],
                error.code,
                str(error),
                error.details,
            )
        except ZoteroImportError as error:
            return _error(
                start_response,
                HTTP_STATUS[error.status],
                error.code,
                str(error),
                error.details,
                retryable=error.status == 503,
            )
        except ReviewError as error:
            return _error(
                start_response,
                HTTP_STATUS[error.status],
                error.code,
                str(error),
                error.details,
            )
        except GraphNodeNotFoundError:
            return _error(start_response, "404 Not Found", "GRAPH_NODE_NOT_FOUND", "未找到中心节点")
        except GraphQueryError as error:
            return _error(start_response, "400 Bad Request", "INVALID_GRAPH_QUERY", str(error))
        except QuestionAnswerError as error:
            status = "400 Bad Request" if error.code == "INVALID_QUESTION" else "502 Bad Gateway"
            return _error(start_response, status, error.code, str(error), retryable=error.retryable)
        except (TypeError, ValueError) as error:
            return _error(start_response, "400 Bad Request", "INVALID_REQUEST", str(error))

        return _error(start_response, "404 Not Found", "NOT_FOUND", "接口不存在")

    return app


def main() -> None:
    backend_dir = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser(description="启动研知图 A 后端")
    parser.add_argument("--database", type=Path, default=backend_dir / "data" / "yanzhitu.sqlite3")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--zotero-root", type=Path, default=Path.home() / "Zotero")
    args = parser.parse_args()

    with make_server(args.host, args.port, create_app(args.database, args.zotero_root)) as server:
        print(f"A 后端已启动：http://{args.host}:{args.port}/api/v1/papers")
        server.serve_forever()


if __name__ == "__main__":
    main()
