"""Prompt owned by the method-extraction agent."""

MAX_ITEMS = 5
INSTRUCTION = """只提取作者明确实施或用于本研究的方法，不提取背景文献的方法，也不从结果倒推方法。
methodType 必须且只能是 behavioralTask、electrophysiology、imaging、intervention、molecularCellular、computationalModel、statisticalAnalysis、other 之一。
若一段文字只说“分析数据”但没有方法名称或可辨认程序，不输出。"""
OUTPUT_TEMPLATE = {
    "displayName": "中文方法名称",
    "normalizedName": "中文规范展示名",
    "sourceTerm": "原文英文方法名称；没有则 null",
    "methodType": "允许枚举之一",
    "description": "中文翻译的原文明确描述；没有则 null",
    "reason": "中文说明原文如何表明该方法被实际使用",
    "confidence": 0.0,
    "evidenceRefs": [{"chunkId": "输入中的 chunkId", "text": "英文原文连续摘录"}],
}
