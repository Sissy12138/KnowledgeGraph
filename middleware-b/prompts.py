"""Prompt registry used by the orchestrator and provider adapters."""

from __future__ import annotations

from dataclasses import dataclass
import json

from .agent_prompts import concept, finding, method, relation
from .agent_prompts.common import GLOBAL_GUARDRAILS
from .agent_prompts.overview import INSTRUCTION as OVERVIEW_INSTRUCTION


@dataclass(frozen=True)
class AgentSpec:
    name: str
    role_instruction: str
    output_template: dict[str, object]
    max_items: int


SUGGESTION_SPECS = {
    "concept": AgentSpec("concept", concept.INSTRUCTION, concept.OUTPUT_TEMPLATE, concept.MAX_ITEMS),
    "method": AgentSpec("method", method.INSTRUCTION, method.OUTPUT_TEMPLATE, method.MAX_ITEMS),
    "finding": AgentSpec("finding", finding.INSTRUCTION, finding.OUTPUT_TEMPLATE, finding.MAX_ITEMS),
    "relation": AgentSpec("relation", relation.INSTRUCTION, relation.OUTPUT_TEMPLATE, relation.MAX_ITEMS),
}


def render_prompt(spec: AgentSpec, paper_title: str, section: str, text: str, existing_nodes: list[dict[str, str]] | None = None) -> str:
    context = ""
    if existing_nodes is not None:
        context = "\n【已有节点】\n" + json.dumps(existing_nodes, ensure_ascii=False)
    return (
        GLOBAL_GUARDRAILS.format(max_items=spec.max_items)
        + "\n\n【当前任务】\n"
        + spec.role_instruction
        + "\n\n【输出对象模板】\n"
        + json.dumps(spec.output_template, ensure_ascii=False, indent=2)
        + f"\n\n【论文标题】\n{paper_title}\n【当前章节】\n{section}{context}\n【章节原文】\n{text}"
    )
