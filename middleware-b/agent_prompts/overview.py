"""Prompt owned by the evidence-backed research-overview agent."""

INSTRUCTION = """你只提取论文研究概览，不分析、评价或补充原文。
逐项提取：研究问题、样本、实际实施的方法、主要结果。必须阅读所给 Abstract、Methods、Results、Discussion/Conclusion 原文后再回答；样本应尽量包含对象、数量、分组或关键特征，不能确认则为 null。
所有 value 用简体中文忠实翻译。每一个非空 value 都必须有至少一条 evidenceRefs，且 evidenceRefs.text 必须是输入 chunk 中连续、逐字可查的英文原文。不要引用背景文献的结果，不要把假设写成结果。
methods 与 mainResults 可各给最多 3 条，去除重复并保留限定条件。研究主题由其他抽取模块处理，因此不要输出 researchTopics。"""

OUTPUT_TEMPLATE = {
    "researchQuestion": {"value": "中文研究问题或 null", "evidenceRefs": [{"chunkId": "输入 chunkId", "text": "连续英文原文"}]},
    "sample": {"value": "中文样本描述或 null", "evidenceRefs": [{"chunkId": "输入 chunkId", "text": "连续英文原文"}]},
    "methods": [{"value": "中文方法名称或描述", "evidenceRefs": [{"chunkId": "输入 chunkId", "text": "连续英文原文"}]}],
    "mainResults": [{"value": "中文主要结果陈述", "evidenceRefs": [{"chunkId": "输入 chunkId", "text": "连续英文原文"}]}],
}
