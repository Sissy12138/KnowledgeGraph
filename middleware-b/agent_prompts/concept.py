"""Prompt owned by the concept-extraction agent."""

MAX_ITEMS = 5
INSTRUCTION = """只识别作者在当前原文中明确定义、命名、操作化，或作为研究对象反复讨论的核心概念。
不要输出泛泛的学科词、普通名词、实验材料、作者姓名、机构、统计量，或只出现一次且没有定义的词。
displayName 和 normalizedName 使用忠实的中文译名；sourceTerm 保留原文英文术语。description 仅在原文有定义时填写，否则为 null。"""
OUTPUT_TEMPLATE = {
    "displayName": "中文概念译名",
    "normalizedName": "中文规范展示名",
    "sourceTerm": "原文英文术语；没有则 null",
    "description": "中文翻译的原文定义；没有则 null",
    "reason": "中文说明该概念为何被明确提出，不添加原文之外的信息",
    "confidence": 0.0,
    "evidenceRefs": [{"chunkId": "输入中的 chunkId", "text": "英文原文连续摘录"}],
}
