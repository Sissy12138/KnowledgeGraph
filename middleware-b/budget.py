"""Local cost estimation used before any provider request is allowed."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class TokenPricing:
    input_per_million_usd: float
    output_per_million_usd: float


DEFAULT_PRICING = {
    "qwen": TokenPricing(0.022, 0.216),
    "deepseek": TokenPricing(0.14, 0.28),
    "openai": TokenPricing(0.20, 1.20),
}


def estimate_cost_usd(provider: str, input_tokens: int, output_tokens: int) -> float:
    if provider not in DEFAULT_PRICING:
        raise ValueError("pricing is not configured for this provider")
    if input_tokens < 0 or output_tokens < 0:
        raise ValueError("token counts cannot be negative")
    price = DEFAULT_PRICING[provider]
    return (input_tokens * price.input_per_million_usd + output_tokens * price.output_per_million_usd) / 1_000_000


def enforce_budget(estimated_cost_usd: float, limit_usd: float) -> None:
    if estimated_cost_usd > limit_usd:
        raise ValueError(f"estimated cost ${estimated_cost_usd:.6f} exceeds the ${limit_usd:.6f} limit")
