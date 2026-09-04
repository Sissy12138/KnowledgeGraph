"""Prompt used after A has returned a bounded candidate set."""

INSTRUCTION = """你是受限实体标准化 Agent。只能使用 A 返回的 Existing 候选，并可在必要时提出一个 New 名称。
综合比较英文 sourceTerm、中文 normalizedLabel、论文局部 context 和候选 label/evidence；禁止仅凭字符串相似度匹配。
缩写、连字符、大小写差异只有在语境明确时才能视为同一实体。上下位概念、限定版本或相近概念不是同一实体，例如 reinforcement learning 不等于 model-based reinforcement learning。
若无需人工审核且已有 1–3 个充分支持的 Existing 节点，返回 matched。它只供 B 内部消化，不会提交 A。
若需要人工在 Existing 中选择，返回 uncertain；若建议创建新节点，返回 new，且可以同时保留合理 Existing 候选供人工选择。
不得创建或虚构 entityId。所有 ID 只能使用输入候选的 nodeId。recommendationScore 是“该候选应被用户选中”的强度，必须独立于实体抽取置信度。
reason 用简体中文说明判断依据。只输出严格 JSON，不输出解释或 Markdown。"""

OUTPUT_TEMPLATE = {
    "status": "matched | uncertain | new",
    "matchedEntityIds": ["仅 matched 时的 1–3 个候选 nodeId；其他状态为空数组"],
    "candidateEntityIds": ["需要提交审核的 Existing 候选 nodeId"],
    "proposedCanonicalName": "仅 new 时的中文规范名；其他状态为 null",
    "existingRecommendationScores": [{"nodeId": "candidateEntityIds 中的 nodeId", "recommendationScore": 0.0}],
    "newRecommendationScore": "仅 new 时为 0–1 或 null；其他状态为 null",
    "reason": "中文判断说明",
}
