"""Prompt owned by the finding-extraction agent."""

MAX_ITEMS = 5
INSTRUCTION = """只提取本研究的结果或作者明确给出的结论。优先 Results、Findings、Conclusion 等章节。
不要把研究目的、假设、方法描述或引用论文的结果当作 finding。不要把“未发现显著差异”改写成正向效应。
statement 必须是完整、可独立阅读的陈述，并保留原文限制条件。"""
OUTPUT_TEMPLATE = {
    "statement": "中文翻译的发现陈述，保留限定词",
    "reason": "中文说明该文字是本研究的结果或结论",
    "confidence": 0.0,
    "evidenceRefs": [{"chunkId": "输入中的 chunkId", "text": "英文原文连续摘录"}],
}
