"""Provider-neutral configuration. No API request is made in this module."""

from __future__ import annotations

from dataclasses import dataclass
from urllib.parse import urlparse

ProviderName = str

PROVIDER_DEFAULTS = {
    "openai": {"baseUrl": "https://api.openai.com/v1", "model": "gpt-5-mini"},
    "anthropic": {"baseUrl": "https://api.anthropic.com", "model": "claude-sonnet-4-5"},
    "gemini": {"baseUrl": "https://generativelanguage.googleapis.com/v1beta", "model": "gemini-3.8-flash"},
    "deepseek": {"baseUrl": "https://api.deepseek.com", "model": "deepseek-v4-flash"},
    "qwen": {"baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1", "model": "qwen3.8-max"},
    "minimax": {"baseUrl": "https://api.minimax.io/v1", "model": "MiniMax-M2.7"},
    "openrouter": {"baseUrl": "https://openrouter.ai/api/v1", "model": "openai/gpt-5-mini"},
    "groq": {"baseUrl": "https://api.groq.com/openai/v1", "model": "llama-3.3-70b-versatile"},
    "mistral": {"baseUrl": "https://api.mistral.ai/v1", "model": "mistral-large-latest"},
    "together": {"baseUrl": "https://api.together.xyz/v1", "model": "meta-llama/Llama-3.3-70B-Instruct-Turbo"},
    "siliconflow": {"baseUrl": "https://api.siliconflow.cn/v1", "model": "deepseek-ai/DeepSeek-V3"},
}


@dataclass(frozen=True)
class ProviderConfig:
    provider: ProviderName
    base_url: str
    model: str
    api_key: str | None = None

    def validate(self, require_key: bool = False) -> None:
        if self.provider not in PROVIDER_DEFAULTS:
            raise ValueError("unsupported provider")
        parsed = urlparse(self.base_url)
        if parsed.scheme != "https" or not parsed.netloc:
            raise ValueError("baseUrl must be an HTTPS URL")
        if not self.model.strip():
            raise ValueError("model is required")
        if require_key and not self.api_key:
            raise ValueError("apiKey is required before a live request")

    def public_settings(self) -> dict[str, str]:
        """Safe for UI responses: secrets are intentionally omitted."""
        return {"provider": self.provider, "baseUrl": self.base_url, "model": self.model}


def default_provider_config(provider: ProviderName) -> ProviderConfig:
    defaults = PROVIDER_DEFAULTS[provider]
    return ProviderConfig(provider=provider, base_url=defaults["baseUrl"], model=defaults["model"])
