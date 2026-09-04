"""Provider-neutral configuration. No API request is made in this module."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from urllib.parse import urlparse

ProviderName = Literal["openai", "deepseek", "qwen"]

PROVIDER_DEFAULTS = {
    "openai": {"baseUrl": "https://api.openai.com/v1", "model": "gpt-5.6-luna"},
    "deepseek": {"baseUrl": "https://api.deepseek.com", "model": "deepseek-v4-flash"},
    "qwen": {"baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1", "model": "qwen-flash"},
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
