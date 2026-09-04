import argparse
import json
from pathlib import Path
from urllib.parse import parse_qs
from wsgiref.simple_server import make_server

from .analysis_job_repository import (
    ActiveJobError,
    JobNotCancellableError,
    JobNotFoundError,
    PaperNotFoundError,
    cancel_job,
    create_job,
    get_job,
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
from .paper_repository import get_paper, list_papers
from .review_service import (
    ReviewError,
    accept_suggestion,
    get_suggestion_detail,
    list_suggestions,
    reject_suggestion,
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


def create_app(database_path: Path, zotero_root: Path | None = None):
    zotero_root = zotero_root or Path.home() / "Zotero"

    def app(environ, start_response):
        method = environ["REQUEST_METHOD"]
        path = environ["PATH_INFO"].rstrip("/") or "/"

        if method == "OPTIONS":
            start_response(
                "204 No Content",
                [
                    ("Access-Control-Allow-Origin", "*"),
                    ("Access-Control-Allow-Methods", "GET, POST, OPTIONS"),
                    ("Access-Control-Allow-Headers", "Content-Type"),
                ],
            )
            return [b""]

        try:
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
                try:
                    job = create_job(database_path, paper_id)
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

            job_prefix = "/api/v1/analysis-jobs/"
            if path.startswith(job_prefix):
                remainder = path.removeprefix(job_prefix)
                is_cancel = remainder.endswith("/cancel")
                job_id = remainder.removesuffix("/cancel") if is_cancel else remainder
                try:
                    if method == "POST" and is_cancel:
                        return _json(start_response, "200 OK", cancel_job(database_path, job_id))
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
                if method == "GET" and "/" not in remainder:
                    return _json(start_response, "200 OK", get_suggestion_detail(database_path, remainder))

            if method == "GET" and path == "/api/v1/graph":
                query = _query(environ)
                focus_node_id = query.get("focusNodeId", [None])[0]
                if not focus_node_id:
                    raise GraphQueryError("focusNodeId 必填")
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
