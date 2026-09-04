"""Minimal OpenAI-compatible model transport with no SDK dependency."""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .providers import ProviderConfig


class ModelCallError(RuntimeError):
    pass


class ModelClient(Protocol):
    def generate(self, system_prompt: str, user_prompt: str) -> str:
        """Generate one model response as text."""


@dataclass
class OpenAICompatibleClient:
    config: ProviderConfig
    timeout_seconds: float = 60.0

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        self.config.validate(require_key=True)
        endpoint = self.config.base_url.rstrip("/") + "/chat/completions"
        payload = {
            "model": self.config.model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "temperature": 0,
            "response_format": {"type": "json_object"},
        }
        request = Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"},
            method="POST",
        )
        try:
            with urlopen(request, timeout=self.timeout_seconds) as response:
                body = json.loads(response.read().decode("utf-8"))
        except HTTPError as error:
            detail = error.read().decode("utf-8", errors="replace")[:500]
            raise ModelCallError(f"model HTTP {error.code}: {detail}") from error
        except (URLError, TimeoutError) as error:
            raise ModelCallError(f"model transport failed: {error}") from error
        except json.JSONDecodeError as error:
            raise ModelCallError("model returned a non-JSON HTTP response") from error
        try:
            content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise ModelCallError("model response does not contain choices[0].message.content") from error
        if not isinstance(content, str) or not content.strip():
            raise ModelCallError("model response content is empty")
        return content
