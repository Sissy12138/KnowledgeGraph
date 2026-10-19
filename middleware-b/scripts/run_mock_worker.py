#!/usr/bin/env python3
"""Offline B worker for exercising the A/B contract before a model is configured."""

from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


def request_json(url: str, method: str = "GET", body: dict | None = None) -> tuple[int, dict]:
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    request = Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urlopen(request, timeout=20) as response:
        return response.status, json.loads(response.read().decode())


def mock_result() -> dict:
    evidence_ref = f"evidence_{uuid4().hex[:12]}"
    return {
        "researchOverview": {"researchTopics": ["不确定性"], "researchQuestion": "不确定性如何影响决策？", "sample": None, "methods": "行为任务", "mainResults": None},
        "evidence": [{"clientRef": evidence_ref, "section": "Abstract", "text": "The study examines uncertainty."}],
        "concepts": [], "methods": [],
        "findings": [{"clientRef": "finding_mock_001", "statement": "不确定性与较慢决策相关。", "confidence": 0.8, "evidenceRefs": [evidence_ref]}],
        "relationCandidates": [],
    }


def submit(base: str, job: dict) -> dict:
    submission_id = f"mock-worker-{uuid4().hex[:12]}"
    payload = {"submissionId": submission_id, "paperId": job["paperId"], **mock_result()}
    status, result = request_json(f"{base}/api/v1/internal/analysis-jobs/{job['id']}/result", "POST", payload)
    return {"jobId": job["id"], "submissionId": submission_id, "httpStatus": status, "result": result}


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the offline mock analysis worker")
    parser.add_argument("--a-base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--paper-id", help="limit processing to one paper")
    parser.add_argument("--watch", action="store_true", help="keep polling queued jobs")
    parser.add_argument("--interval", type=float, default=2.0)
    parser.add_argument("--log-file", default="logs/mock-worker.log")
    args = parser.parse_args()
    Path(args.log_file).parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(filename=args.log_file, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    base = args.a_base_url.rstrip("/")

    def once() -> int:
        _, response = request_json(f"{base}/api/v1/analysis-jobs?status=queued&limit=100")
        jobs = response.get("items", [])
        if args.paper_id:
            jobs = [job for job in jobs if job.get("paperId") == args.paper_id]
        for job in jobs:
            try:
                logging.info("processing job=%s paper=%s", job.get("id"), job.get("paperId"))
                print(json.dumps(submit(base, job), ensure_ascii=False), flush=True)
            except (HTTPError, URLError, TimeoutError, OSError, ValueError) as error:
                logging.exception("job failed job=%s", job.get("id"))
                print(json.dumps({"jobId": job.get("id"), "error": str(error)}, ensure_ascii=False), flush=True)
        return len(jobs)

    if not args.watch:
        if args.paper_id:
            _, job = request_json(f"{base}/api/v1/papers/{args.paper_id}/analysis-jobs", "POST", {})
            print(json.dumps(submit(base, job), ensure_ascii=False), flush=True)
        else:
            once()
        return
    while True:
        once()
        time.sleep(max(args.interval, 0.1))


if __name__ == "__main__":
    main()
