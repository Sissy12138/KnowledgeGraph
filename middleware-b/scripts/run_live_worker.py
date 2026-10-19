#!/usr/bin/env python3
"""Run one real-model PDF extraction and submit the v0.5 result to A."""
from __future__ import annotations
import argparse, json, logging, time
from http.server import BaseHTTPRequestHandler, HTTPServer
import threading
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import ProxyHandler, Request, build_opener
from uuid import uuid4
from ..model_client import OpenAICompatibleClient
from ..cross_paper_relation_candidates import add_cross_paper_method_candidates
from ..entity_normalization import ANodeMatchCandidateClient, EntityNormalizer, RawEntity
from ..method_relation_candidates import add_same_paper_method_candidates
from ..paper_extraction import SinglePaperExtractor
from ..pdf_ingestion import PdfPaperParser
from ..providers import ProviderConfig
from ..research_overview import LiveResearchOverviewExtractor, ResearchOverviewResult

_LOCAL_HTTP = build_opener(ProxyHandler({}))

def get_json(url: str) -> dict:
    with _LOCAL_HTTP.open(url, timeout=20) as response: return json.loads(response.read().decode())

def post_json(url: str, body: dict) -> tuple[int, dict]:
    request = Request(url, data=json.dumps(body, ensure_ascii=False).encode(), headers={"Content-Type": "application/json"}, method="POST")
    with _LOCAL_HTTP.open(request, timeout=120) as response: return response.status, json.loads(response.read().decode())

def submission(extraction, paper_id: str, document=None, known_dois=None, overview: ResearchOverviewResult | None = None, method_matches=None, concept_matches=None) -> dict:
    evidence, seen = [], set()
    def add(item):
        for value in item.evidence:
            if value.id not in seen:
                seen.add(value.id); evidence.append({"clientRef": value.id, "section": value.section, "text": value.text})
    for group in (extraction.research_questions, extraction.concepts, extraction.methods, extraction.findings):
        for item in group: add(item)
    if overview:
        for field_evidence in overview.evidence_by_field.values():
            for value in field_evidence:
                if value.id not in seen:
                    seen.add(value.id); evidence.append({"clientRef": value.id, "section": value.section, "text": value.text})
    def entity_resolution(ref, label, confidence, decision):
        selected_existing = []
        include_new = True
        match_status = "new"
        new_label = label
        new_score = confidence
        if decision is not None and hasattr(decision, "status"):
          by_id = {value.entity_id: value for value in decision.candidates}
          selected_ids = decision.matched_entity_ids if decision.status == "matched" else decision.selected_candidate_ids
          selected_existing = [
              {"nodeId": node_id, "label": by_id[node_id].canonical_name, "recommendationScore": decision.recommendation_scores.get(node_id, by_id[node_id].recommendation_score)}
              for node_id in selected_ids if node_id in by_id
          ]
          include_new = decision.status == "new"
          match_status = "new" if decision.status == "new" else "uncertain"
          new_label = decision.canonical_name or label
          new_score = decision.new_recommendation_score if decision.new_recommendation_score is not None else confidence
        elif isinstance(decision, list):
          selected_existing = decision
          match_status = "uncertain" if decision else "new"
        candidates = [
            {"clientRef": f"candidate_{ref}_existing_{position}", "kind": "existing", "nodeId": value["nodeId"], "label": value["label"], "recommendationScore": value.get("recommendationScore")}
            for position, value in enumerate(selected_existing)
        ]
        if include_new:
          candidates.append({"clientRef": f"candidate_{ref}", "kind": "new", "nodeId": None, "label": new_label, "recommendationScore": new_score if not selected_existing else min(new_score or 0.5, 0.69)})
        if not candidates:
          candidates.append({"clientRef": f"candidate_{ref}", "kind": "new", "nodeId": None, "label": label, "recommendationScore": confidence})
          match_status = "new"
          new_label = label
        candidates.sort(key=lambda value: (value["recommendationScore"] is None, -(value["recommendationScore"] or 0)))
        return new_label, match_status, candidates

    concepts = []
    for index, item in enumerate(extraction.concepts):
        label = item.normalized or item.display or item.source_term
        if not label: continue
        ref = f"concept_{index}_{uuid4().hex[:8]}"
        normalized_label, match_status, candidates = entity_resolution(ref, label, item.confidence, (concept_matches or {}).get(label))
        concepts.append({"clientRef": ref, "rawText": item.source_term or label, "normalizedLabel": normalized_label, "matchStatus": match_status, "candidates": candidates, "extractionConfidence": item.confidence, "evidenceRefs": item.evidence_ids})
    methods_payload = []
    for index, item in enumerate(extraction.methods):
        label = item.normalized or item.display or item.source_term
        if not label: continue
        ref = f"method_{index}_{uuid4().hex[:8]}"
        normalized_label, match_status, candidates = entity_resolution(ref, label, item.confidence, (method_matches or {}).get(label))
        methods_payload.append({"clientRef": ref, "rawText": item.source_term or label, "normalizedLabel": normalized_label, "methodType": item.method_type or "other", "description": item.reason, "matchStatus": match_status, "candidates": candidates, "extractionConfidence": item.confidence, "evidenceRefs": item.evidence_ids})
    findings = [{"clientRef": f"finding_{uuid4().hex[:12]}", "statement": item.text or item.display or "", "confidence": item.confidence, "evidenceRefs": item.evidence_ids} for item in extraction.findings if item.text or item.display]
    relations = []
    for reference in (document.references if document else []):
      target = known_dois.get(reference.doi.casefold()) if reference.doi and known_dois else None
      if not target: continue
      ref_id = f"reference_{uuid4().hex[:10]}"; evidence.append({"clientRef": ref_id, "section": "References", "text": reference.raw_text})
      relations.append({"source": {"type": "formalNodeId", "value": paper_id}, "target": {"type": "formalNodeId", "value": target}, "relationType": "cites", "confidence": 1.0, "evidenceRefs": [ref_id]})
    fallback_overview = {"researchTopics": [item.display or item.normalized for item in extraction.concepts if item.display or item.normalized][:10], "researchQuestion": extraction.research_questions[0].text if extraction.research_questions else None, "sample": None, "methods": "；".join(item.display for item in extraction.methods if item.display) or None, "mainResults": "；".join(item["statement"] for item in findings[:3]) or None}
    return {"submissionId": f"live-worker-{uuid4().hex[:12]}", "paperId": paper_id, "researchOverview": overview.to_payload() if overview else fallback_overview, "evidence": evidence, "concepts": concepts, "methods": methods_payload, "findings": findings, "relationCandidates": relations}

def main() -> None:
    parser = argparse.ArgumentParser(description="Run one live PDF analysis")
    parser.add_argument("--a-base-url", default="http://127.0.0.1:8000"); parser.add_argument("--paper-id"); parser.add_argument("--watch", action="store_true"); parser.add_argument("--interval", type=float, default=3.0); parser.add_argument("--log-file", default="logs/live-worker.log"); parser.add_argument("--status-file", default="logs/live-worker.status.json"); parser.add_argument("--health-port", type=int, default=8765)
    args = parser.parse_args(); Path(args.log_file).parent.mkdir(parents=True, exist_ok=True); logging.basicConfig(filename=args.log_file, level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    base = args.a_base_url.rstrip("/")
    def heartbeat(status="running", job_id=None, error=None):
      path = Path(args.status_file); path.parent.mkdir(parents=True, exist_ok=True)
      path.write_text(json.dumps({"status": status, "lastHeartbeatAt": datetime.now(timezone.utc).isoformat(), "jobId": job_id, "error": error}, ensure_ascii=False), encoding="utf-8")
    class HealthHandler(BaseHTTPRequestHandler):
      def do_GET(self):
        if self.path != "/health": self.send_response(404); self.end_headers(); return
        path = Path(args.status_file)
        body = path.read_bytes() if path.exists() else b'{"status":"starting"}'
        self.send_response(200); self.send_header("Content-Type", "application/json"); self.send_header("Content-Length", str(len(body))); self.end_headers(); self.wfile.write(body)
      def log_message(self, *_): pass
    health = HTTPServer(("127.0.0.1", args.health_port), HealthHandler)
    threading.Thread(target=health.serve_forever, daemon=True).start()
    def process(job):
      def progress(value, stage):
        post_json(f"{base}/api/v1/internal/analysis-jobs/{job['id']}/progress", {"progress": value, "stage": stage})
      progress(5, "读取论文信息")
      config = get_json(f"{base}/api/v1/internal/model-config")
      paper = get_json(f"{base}/api/v1/papers/{job['paperId']}"); attachments = paper.get("attachments", [])
      papers = get_json(f"{base}/api/v1/papers?page=1&pageSize=100").get("items", [])
      known_dois = {item["doi"].casefold(): item["id"] for item in papers if item.get("doi")}
      pdf = next((item.get("path") for item in attachments if item.get("contentType") == "application/pdf"), None)
      if not pdf: raise RuntimeError("论文没有可读取的 PDF 附件")
      model = OpenAICompatibleClient(ProviderConfig(config["provider"], config["baseUrl"], config["model"], config["apiKey"]))
      progress(25, "解析 PDF")
      document = PdfPaperParser().parse(pdf, job["paperId"])
      progress(55, "调用大模型分析")
      extraction = SinglePaperExtractor("live", model, progress=progress).extract(document)
      if extraction.agent_errors:
        logging.error("core extraction failed: %s", extraction.agent_errors)
        raise RuntimeError(f"模型分析未完成：{extraction.agent_errors}")
      progress(72, "提取研究概览")
      research_overview = LiveResearchOverviewExtractor(model, progress=progress).extract(document, extraction)
      concept_matches = {}
      method_matches = {}
      concept_normalizer = EntityNormalizer(ANodeMatchCandidateClient(base), "live", model)
      method_normalizer = EntityNormalizer(ANodeMatchCandidateClient(base), "live", model)
      concept_entities = []
      for item in extraction.concepts:
        label = item.normalized or item.display or item.source_term
        if not label: continue
        concept_entities.append((label, RawEntity(
              item.source_term or label, label, "concept",
              "\n".join(value.text for value in item.evidence) or None,
              item.evidence_ids,
        )))
      progress(82, "批量匹配概念实体")
      if concept_entities:
        try:
          decisions = concept_normalizer.normalize_many([entity for _, entity in concept_entities])
          concept_matches.update({label: decision for (label, _), decision in zip(concept_entities, decisions, strict=True)})
        except Exception:
          logging.exception("concept entity batch matching skipped")
      method_entities = []
      for item in extraction.methods:
        label = item.normalized or item.display or item.source_term
        if not label: continue
        method_entities.append((label, RawEntity(
              item.source_term or label, label, "method",
              "\n".join(value.text for value in item.evidence) or None,
              item.evidence_ids,
        )))
      progress(86, "批量匹配方法实体")
      if method_entities:
        try:
          decisions = method_normalizer.normalize_many([entity for _, entity in method_entities])
          method_matches.update({label: decision for (label, _), decision in zip(method_entities, decisions, strict=True)})
        except Exception:
          logging.exception("method entity batch matching skipped")
      progress(90, "生成证据与图谱建议")
      result_payload = submission(extraction, job["paperId"], document, known_dois, research_overview, method_matches, concept_matches)
      progress(92, "判断同篇方法与概念关系")
      try:
        relation_count = add_same_paper_method_candidates(result_payload, model)
        logging.info("same-paper method candidates job=%s count=%s", job["id"], relation_count)
      except Exception:
        logging.exception("same-paper method relation judgment skipped job=%s", job["id"])
      progress(95, "判断跨文献关系")
      try:
        graph = get_json(f"{base}/api/v1/graph")
        latest_extractions = {}
        for candidate_paper in papers:
          candidate_id = candidate_paper.get("id")
          if not candidate_id or candidate_id == job["paperId"]:
            continue
          try:
            latest_extractions[candidate_id] = get_json(f"{base}/api/v1/papers/{candidate_id}/extractions/latest")
          except Exception:
            # 未分析过的论文不参与跨论文候选；单篇分析仍然可以正常完成。
            continue
        relation_count = add_cross_paper_method_candidates(result_payload, graph, latest_extractions, model)
        logging.info("cross-paper method candidates job=%s count=%s", job["id"], relation_count)
      except Exception:
        # 关系候选是增强项，不能因为模型额外一次判断失败而使整篇论文分析失败。
        logging.exception("cross-paper candidate generation skipped job=%s", job["id"])
      current_job = get_json(f"{base}/api/v1/analysis-jobs/{job['id']}")
      if current_job.get("status") == "cancelled":
        logging.info("job cancelled before result submission job=%s", job["id"])
        return
      progress(98, "保存分析结果")
      status, result = post_json(f"{base}/api/v1/internal/analysis-jobs/{job['id']}/result", result_payload)
      print(json.dumps({"jobId": job["id"], "httpStatus": status, "result": result}, ensure_ascii=False), flush=True)
    def once():
      jobs = []
      if args.paper_id:
        if not args.watch:
          jobs = [post_json(f"{base}/api/v1/papers/{args.paper_id}/analysis-jobs", {})[1]]
        else:
          jobs = [job for job in get_json(f"{base}/api/v1/analysis-jobs?status=queued&limit=100").get("items", []) if job.get("paperId") == args.paper_id]
      else:
        jobs = get_json(f"{base}/api/v1/analysis-jobs?status=queued&limit=100").get("items", [])
      for job in jobs:
        try: heartbeat("processing", job["id"]); logging.info("processing job=%s paper=%s", job["id"], job["paperId"]); process(job); heartbeat("running")
        except Exception as error:
          heartbeat("degraded", job.get("id"), str(error)); logging.exception("live job failed job=%s: %s", job.get("id"), error)
          try: post_json(f"{base}/api/v1/internal/analysis-jobs/{job['id']}/failed", {"code": "WORKER_ERROR", "message": str(error)})
          except Exception: logging.exception("unable to mark job failed")
      if not jobs: heartbeat("running")
      return len(jobs)
    if args.watch:
      while True:
        try:
          once()
        except Exception as error:
          # At application startup the backend can come online a moment after
          # the worker.  Keep the daemon alive and retry rather than silently
          # losing all subsequent analysis tasks.
          heartbeat("degraded", error=str(error))
          logging.exception("worker poll failed: %s", error)
        time.sleep(max(args.interval, 0.2))
    if not args.paper_id: raise SystemExit("--paper-id is required unless --watch is used")
    once()
if __name__ == "__main__": main()
