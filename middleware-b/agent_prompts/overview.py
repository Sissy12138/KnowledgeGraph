"""Prompt owned by the research-overview agent."""

INSTRUCTION = """你只提取论文研究概览，不分析、评价或补充原文。
researchTopics 只放原文明确出现的研究主题词，最多 5 个；其他字段必须是原文可直接支持的简短表述。
所有非空字段都用简体中文忠实翻译；不要保留英文解释。无法可靠提取时，researchTopics 返回 []，其他字段返回 null。不要填 evidence，也不要创建建议。
只输出下面这个 JSON 对象：
{
  "researchTopics": ["string"],
  "researchQuestion": "string 或 null",
  "sample": "string 或 null",
  "methods": "string 或 null",
  "mainResults": "string 或 null"
}"""
