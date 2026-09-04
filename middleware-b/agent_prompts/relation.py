"""Prompt owned by the relation-extraction agent."""

MAX_ITEMS = 3
INSTRUCTION = """仅在原文明确表达关系，且 sourceId 与 targetId 都存在于【已有节点】中时，提出关系建议。
relationType 只能是 studies、uses、reports、supports、contradicts、relatedTo、broaderThan、cites 之一。
不要因为两个节点同时出现就建立 relatedTo；不要把语义相近自行判定为 broaderThan；不要把论文参考文献中的引用关系误作本论文结论。
如果只有一个节点、节点不存在、关系方向不明确或证据不足，返回 []。"""
OUTPUT_TEMPLATE = {
    "sourceId": "已有节点 ID",
    "targetId": "已有节点 ID",
    "relationType": "允许枚举之一",
    "reason": "中文说明原文为何直接支持此方向和类型",
    "confidence": 0.0,
    "evidenceRefs": [{"chunkId": "输入中的 chunkId", "text": "英文原文连续摘录"}],
}
