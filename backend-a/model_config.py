"""Restart-safe local model configuration.

The secret lives next to the active user database, never in the application
bundle. Windows uses DPAPI so the API key is bound to the current account.
Other platforms use a permission-restricted envelope for local development.
"""

from __future__ import annotations

import base64
import ctypes
from ctypes import wintypes
from dataclasses import asdict, dataclass
import json
import os
from pathlib import Path
import sys
from urllib.parse import urlparse

from .model_providers import validate_selection


@dataclass
class ModelConfig:
    provider: str
    base_url: str
    model: str
    api_key: str


_config: ModelConfig | None = None
_storage_path: Path | None = None


class _DataBlob(ctypes.Structure):
    _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_byte))]


def _dpapi_protect(value: bytes) -> bytes:
    buffer = ctypes.create_string_buffer(value)
    source = _DataBlob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    protected = _DataBlob()
    if not ctypes.windll.crypt32.CryptProtectData(
        ctypes.byref(source), "Yanzhitu model configuration", None, None, None, 0,
        ctypes.byref(protected),
    ):
        raise OSError("Windows DPAPI could not protect the model configuration")
    try:
        return ctypes.string_at(protected.pbData, protected.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(protected.pbData)


def _dpapi_unprotect(value: bytes) -> bytes:
    buffer = ctypes.create_string_buffer(value)
    source = _DataBlob(len(value), ctypes.cast(buffer, ctypes.POINTER(ctypes.c_byte)))
    plain = _DataBlob()
    if not ctypes.windll.crypt32.CryptUnprotectData(
        ctypes.byref(source), None, None, None, None, 0, ctypes.byref(plain),
    ):
        raise OSError("Windows DPAPI could not read the model configuration")
    try:
        return ctypes.string_at(plain.pbData, plain.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(plain.pbData)


def _encode(config: ModelConfig) -> dict:
    raw = json.dumps(asdict(config), ensure_ascii=False).encode("utf-8")
    if sys.platform == "win32":
        return {
            "version": 1,
            "protection": "windows-dpapi-current-user",
            "payload": base64.b64encode(_dpapi_protect(raw)).decode("ascii"),
        }
    return {
        "version": 1,
        "protection": "posix-user-file",
        "payload": base64.b64encode(raw).decode("ascii"),
    }


def _decode(envelope: dict) -> ModelConfig:
    if envelope.get("version") != 1 or not isinstance(envelope.get("payload"), str):
        raise ValueError("unsupported model configuration file")
    raw = base64.b64decode(envelope["payload"], validate=True)
    protection = envelope.get("protection")
    if protection == "windows-dpapi-current-user":
        if sys.platform != "win32":
            raise ValueError("Windows-protected model configuration cannot be opened here")
        raw = _dpapi_unprotect(raw)
    elif protection != "posix-user-file":
        raise ValueError("unsupported model configuration protection")
    value = json.loads(raw.decode("utf-8"))
    return ModelConfig(
        provider=str(value["provider"]),
        base_url=str(value["base_url"]),
        model=str(value["model"]),
        api_key=str(value["api_key"]),
    )


def configure_storage(path: Path) -> None:
    """Select the active user-scoped store and restore it when available."""
    global _config, _storage_path
    _storage_path = path
    _config = None
    if not path.exists():
        return
    try:
        envelope = json.loads(path.read_text(encoding="utf-8"))
        restored = _decode(envelope)
        validate_selection(restored.provider, restored.base_url, restored.model)
        if not restored.api_key:
            raise ValueError("empty API key")
        _config = restored
    except (OSError, ValueError, KeyError, json.JSONDecodeError):
        _config = None


def _persist() -> None:
    if _storage_path is None or _config is None:
        return
    _storage_path.parent.mkdir(parents=True, exist_ok=True)
    temporary = _storage_path.with_suffix(_storage_path.suffix + ".tmp")
    temporary.write_text(json.dumps(_encode(_config), ensure_ascii=False), encoding="utf-8")
    if os.name != "nt":
        os.chmod(temporary, 0o600)
    temporary.replace(_storage_path)
    if os.name != "nt":
        os.chmod(_storage_path, 0o600)


def set_config(value: dict) -> dict:
    global _config
    provider, base_url, model, api_key = (value.get(k) for k in ("provider", "baseUrl", "model", "apiKey"))
    if not all(isinstance(v, str) and v.strip() for v in (provider, base_url, model, api_key)):
        raise ValueError("provider、baseUrl、model、apiKey 均不能为空")
    parsed = urlparse(base_url)
    if parsed.scheme != "https" or not parsed.netloc:
        raise ValueError("baseUrl 必须是 HTTPS 地址")
    validate_selection(provider, base_url, model)
    _config = ModelConfig(provider, base_url.rstrip("/"), model, api_key)
    _persist()
    return public_status()


def public_status() -> dict:
    if _config is None:
        return {"configured": False, "provider": None, "baseUrl": None, "model": None}
    return {"configured": True, "provider": _config.provider, "baseUrl": _config.base_url, "model": _config.model}


def get_config() -> ModelConfig:
    if _config is None:
        raise ValueError("尚未配置模型 API")
    return _config


def private_dict() -> dict:
    config = get_config()
    return {"provider": config.provider, "baseUrl": config.base_url, "model": config.model, "apiKey": config.api_key}


def clear_config() -> None:
    global _config
    _config = None
    if _storage_path is not None:
        try:
            _storage_path.unlink()
        except FileNotFoundError:
            pass
