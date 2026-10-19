"""Provider catalog and request adapters for the local model configuration.

The catalog intentionally contains only direct, documented provider endpoints.
It is returned to the UI without secrets, while the corresponding request
builders keep protocol differences out of the route handler.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from urllib.request import Request


@dataclass(frozen=True)
class ProviderSpec:
    id: str
    label: str
    base_url: str
    protocol: str
    models: tuple[str, ...]

    def public_dict(self) -> dict:
        return {
            "id": self.id,
            "label": self.label,
            "baseUrl": self.base_url,
            "models": list(self.models),
        }


# `openai` means the Chat Completions request shape, not OpenAI as a company.
PROVIDERS = (
    ProviderSpec("openai", "OpenAI", "https://api.openai.com/v1", "openai", ("gpt-5-mini", "gpt-5", "gpt-4.1-mini")),
    ProviderSpec("anthropic", "Anthropic Claude", "https://api.anthropic.com", "anthropic", ("claude-sonnet-4-5", "claude-opus-4-5", "claude-haiku-4-5")),
    ProviderSpec("gemini", "Google Gemini", "https://generativelanguage.googleapis.com/v1beta", "gemini", ("gemini-3.8-flash", "gemini-3.8-pro")),
    ProviderSpec("deepseek", "DeepSeek", "https://api.deepseek.com", "openai", ("deepseek-v4-flash", "deepseek-v4-pro")),
    ProviderSpec("qwen", "通义千问（阿里云百炼）", "https://dashscope.aliyuncs.com/compatible-mode/v1", "openai", ("qwen3.8-max", "qwen3.8")),
    ProviderSpec("minimax", "MiniMax", "https://api.minimax.io/v1", "openai", ("MiniMax-M2.7", "MiniMax-M2.5")),
    ProviderSpec("openrouter", "OpenRouter", "https://openrouter.ai/api/v1", "openai", ("openai/gpt-5-mini", "anthropic/claude-sonnet-4.5", "google/gemini-3.8-flash")),
    ProviderSpec("groq", "Groq", "https://api.groq.com/openai/v1", "openai", ("llama-3.3-70b-versatile", "qwen/qwen3-32b")),
    ProviderSpec("mistral", "Mistral AI", "https://api.mistral.ai/v1", "openai", ("mistral-large-latest", "mistral-small-latest")),
    ProviderSpec("together", "Together AI", "https://api.together.xyz/v1", "openai", ("meta-llama/Llama-3.3-70B-Instruct-Turbo", "Qwen/Qwen3-32B")),
    ProviderSpec("siliconflow", "SiliconFlow", "https://api.siliconflow.cn/v1", "openai", ("deepseek-ai/DeepSeek-V3", "Qwen/Qwen3-32B")),
)
BY_ID = {item.id: item for item in PROVIDERS}


def list_providers() -> dict:
    return {"items": [item.public_dict() for item in PROVIDERS]}


def get_provider(provider: str) -> ProviderSpec:
    try:
        return BY_ID[provider]
    except KeyError as error:
        raise ValueError("不支持该模型服务商") from error


def validate_selection(provider: str, base_url: str, model: str) -> None:
    spec = get_provider(provider)
    if base_url.rstrip("/") != spec.base_url.rstrip("/"):
        raise ValueError("API 地址必须使用所选服务商的内置地址")
    if model not in spec.models:
        raise ValueError("模型必须从所选服务商的内置列表中选择")


def build_test_request(config: dict) -> Request:
    """Build a minimal, billable request in the provider's native format."""
    spec = get_provider(config["provider"])
    base_url = config["baseUrl"].rstrip("/")
    if spec.protocol == "anthropic":
        payload = {"model": config["model"], "max_tokens": 20, "temperature": 0, "messages": [{"role": "user", "content": "Reply with OK."}]}
        headers = {"x-api-key": config["apiKey"], "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
        endpoint = base_url + "/v1/messages"
    elif spec.protocol == "gemini":
        payload = {"contents": [{"parts": [{"text": "Reply with OK."}]}], "generationConfig": {"temperature": 0, "maxOutputTokens": 20}}
        headers = {"x-goog-api-key": config["apiKey"], "Content-Type": "application/json"}
        endpoint = base_url + "/models/" + config["model"] + ":generateContent"
    else:
        payload = {"model": config["model"], "messages": [{"role": "user", "content": "Reply with OK."}], "temperature": 0, "max_tokens": 20}
        headers = {"Authorization": f"Bearer {config['apiKey']}", "Content-Type": "application/json"}
        endpoint = base_url + "/chat/completions"
    return Request(endpoint, data=json.dumps(payload).encode("utf-8"), headers=headers, method="POST")


def build_generation_request(config: dict, system_prompt: str, user_prompt: str) -> Request:
    """Build one grounded text-generation request in the selected provider format."""
    spec = get_provider(config["provider"])
    base_url = config["baseUrl"].rstrip("/")
    if spec.protocol == "anthropic":
        payload = {
            "model": config["model"], "max_tokens": 1800, "temperature": 0.1,
            "system": system_prompt,
            "messages": [{"role": "user", "content": user_prompt}],
        }
        headers = {
            "x-api-key": config["apiKey"], "anthropic-version": "2023-06-01",
            "Content-Type": "application/json",
        }
        endpoint = base_url + "/v1/messages"
    elif spec.protocol == "gemini":
        payload = {
            "systemInstruction": {"parts": [{"text": system_prompt}]},
            "contents": [{"parts": [{"text": user_prompt}]}],
            "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1800},
        }
        headers = {"x-goog-api-key": config["apiKey"], "Content-Type": "application/json"}
        endpoint = base_url + "/models/" + config["model"] + ":generateContent"
    else:
        payload = {
            "model": config["model"],
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0.1, "max_tokens": 4000,
        }
        headers = {"Authorization": f"Bearer {config['apiKey']}", "Content-Type": "application/json"}
        endpoint = base_url + "/chat/completions"
    return Request(endpoint, data=json.dumps(payload, ensure_ascii=False).encode("utf-8"), headers=headers, method="POST")


def extract_generated_text(provider: str, body: dict) -> str:
    """Extract assistant text from supported provider response shapes."""
    spec = get_provider(provider)
    if spec.protocol == "anthropic":
        blocks = body.get("content") or []
        text = "\n".join(str(item.get("text", "")) for item in blocks if item.get("type") == "text")
    elif spec.protocol == "gemini":
        candidates = body.get("candidates") or []
        parts = candidates[0].get("content", {}).get("parts", []) if candidates else []
        text = "\n".join(str(item.get("text", "")) for item in parts)
    else:
        choices = body.get("choices") or []
        message = choices[0].get("message", {}) if choices else {}
        content = message.get("content", "") if isinstance(message, dict) else ""
        # Some reasoning-capable OpenAI-compatible models return an empty
        # `content` when their output budget is consumed, while still exposing
        # a usable answer in `reasoning_content`.
        if not content and isinstance(message, dict):
            content = message.get("reasoning_content", "")
        if isinstance(content, list):
            text = "\n".join(
                str(item.get("text", "")) if isinstance(item, dict) else str(item)
                for item in content
            )
        else:
            text = str(content)
    text = text.strip()
    if not text:
        raise ValueError("模型没有返回回答文本")
    return text
