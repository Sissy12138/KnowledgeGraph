"""Prompt owned by the method-extraction agent."""

MAX_ITEMS = 8
INSTRUCTION = """只提取作者明确实施或用于本研究的方法，不提取背景文献的方法，也不从结果倒推方法。
methodType 必须且只能是 behavioralTask、electrophysiology、imaging、intervention、molecularCellular、computationalModel、statisticalAnalysis、other 之一。
若一段文字只说“分析数据”但没有方法名称或可辨认程序，不输出。
完整保留复合方法名称的边界，不得随意删掉前缀/后缀，也不得把实验目的、样本或结果描述并入方法名。
本次输入只是论文的一批文本块；请提取该批中的所有有证据方法，不要因为可能在其他批次出现而省略。"""
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

NAVIGATION_INSTRUCTION = """只根据论文标题、Abstract、原文 Keywords 和章节标题，生成用于定位全文方法的英文检索词。
可以包含缩写、全称和词形变体；不要把纯研究主题当作方法。证据不足时返回空数组。"""

BOUNDARY_INSTRUCTION = """你是全篇研究方法准入、粒度合并与名称边界复核器。只能根据候选、全文出现次数、所在章节及原文证据作决定。
仅保留作者在本研究中实际实施的可辨认模型/算法、实验范式、数据采集、干预、训练、推断或统计分析方法。背景文献的方法、研究主题、结果、参数名称、样本分组、提示模板变体、一次性操作细节、质量控制记录和无法辨认具体方法的泛称必须 keep=false。
同一方法的视角、分组、参数或任务变体应统一到论文实际采用的合适方法粒度，并使用同一个 normalizedName。检查是否多纳入目的/结果描述，或少纳入构成完整复合方法名的前后词。不得添加证据中不存在的英文术语。"""
