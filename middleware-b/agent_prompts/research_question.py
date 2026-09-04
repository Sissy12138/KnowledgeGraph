"""Prompt owned by the research-question extraction agent."""

MAX_ITEMS = 3
INSTRUCTION = """只提取作者明确提出、检验或回答的研究问题。优先 Abstract 和 Introduction。
不要把泛泛研究主题、方法目标或未来工作写成研究问题。text 使用简体中文忠实翻译，sourceTerm 保留可定位的英文原句。"""
OUTPUT_TEMPLATE = {
    "text": "中文研究问题",
    "sourceTerm": "原文英文问题或目标表述",
    "reason": "中文说明原文为何构成研究问题",
    "confidence": 0.0,
    "evidenceRefs": [{"chunkId": "输入中的 chunkId", "text": "英文原文连续摘录"}],
}
