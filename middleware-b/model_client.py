"""Minimal OpenAI-compatible model transport with no SDK dependency."""

from __future__ import annotations

from dataclasses import dataclass
import json
import time
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
    max_attempts: int = 3

    def generate(self, system_prompt: str, user_prompt: str) -> str:
        self.config.validate(require_key=True)
        base_url = self.config.base_url.rstrip("/")
        if self.config.provider == "anthropic":
            endpoint = base_url + "/v1/messages"
            payload = {"model": self.config.model, "system": system_prompt, "messages": [{"role": "user", "content": user_prompt}], "temperature": 0, "max_tokens": 4096}
            headers = {"x-api-key": self.config.api_key, "anthropic-version": "2023-06-01", "Content-Type": "application/json"}
        elif self.config.provider == "gemini":
            endpoint = base_url + "/models/" + self.config.model + ":generateContent"
            payload = {"systemInstruction": {"parts": [{"text": system_prompt}]}, "contents": [{"role": "user", "parts": [{"text": user_prompt}]}], "generationConfig": {"temperature": 0, "responseMimeType": "application/json"}}
            headers = {"x-goog-api-key": self.config.api_key, "Content-Type": "application/json"}
        else:
            endpoint = base_url + "/chat/completions"
            payload = {"model": self.config.model, "messages": [{"role": "system", "content": system_prompt}, {"role": "user", "content": user_prompt}], "temperature": 0, "response_format": {"type": "json_object"}}
            headers = {"Authorization": f"Bearer {self.config.api_key}", "Content-Type": "application/json"}
        request = Request(
            endpoint,
            data=json.dumps(payload).encode("utf-8"),
            headers=headers,
            method="POST",
        )
        body = None
        last_error: Exception | None = None
        for attempt in range(1, max(1, self.max_attempts) + 1):
            try:
                with urlopen(request, timeout=self.timeout_seconds) as response:
                    body = json.loads(response.read().decode("utf-8"))
                break
            except HTTPError as error:
                detail = error.read().decode("utf-8", errors="replace")[:500]
                if error.code not in {408, 429, 500, 502, 503, 504} or attempt >= self.max_attempts:
                    raise ModelCallError(f"model HTTP {error.code}: {detail}") from error
                last_error = error
            except (URLError, TimeoutError, OSError) as error:
                if attempt >= self.max_attempts:
                    raise ModelCallError(f"model transport failed after {attempt} attempts: {error}") from error
                last_error = error
            except json.JSONDecodeError as error:
                raise ModelCallError("model returned a non-JSON HTTP response") from error
            time.sleep(1.5 * attempt)
        if body is None:
            raise ModelCallError(f"model transport failed: {last_error}")
        try:
            if self.config.provider == "anthropic":
                content = "".join(item["text"] for item in body["content"] if item.get("type") == "text")
            elif self.config.provider == "gemini":
                content = "".join(item["text"] for item in body["candidates"][0]["content"]["parts"] if "text" in item)
            else:
                content = body["choices"][0]["message"]["content"]
        except (KeyError, IndexError, TypeError) as error:
            raise ModelCallError("model response does not contain generated text") from error
        if not isinstance(content, str) or not content.strip():
            raise ModelCallError("model response content is empty")
        return content
