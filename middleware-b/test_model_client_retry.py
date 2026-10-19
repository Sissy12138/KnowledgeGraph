import io
import json
import unittest
from unittest.mock import patch
from urllib.error import URLError

from . import model_client
from .model_client import ModelCallError, OpenAICompatibleClient
from .providers import ProviderConfig


class _Response:
    def __init__(self, payload: dict):
        self._body = io.BytesIO(json.dumps(payload).encode("utf-8"))

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self):
        return self._body.read()


class ModelClientRetryTest(unittest.TestCase):
    def client(self) -> OpenAICompatibleClient:
        return OpenAICompatibleClient(
            ProviderConfig("deepseek", "https://api.deepseek.com", "deepseek-v4-flash", "test"),
            max_attempts=3,
        )

    @patch.object(model_client.time, "sleep")
    @patch.object(model_client, "urlopen")
    def test_transient_transport_error_is_retried(self, mocked_urlopen, mocked_sleep):
        mocked_urlopen.side_effect = [
            URLError("temporary TLS failure"),
            _Response({"choices": [{"message": {"content": "{\"items\": []}"}}]}),
        ]
        self.assertEqual('{"items": []}', self.client().generate("system", "user"))
        self.assertEqual(2, mocked_urlopen.call_count)
        mocked_sleep.assert_called_once()

    @patch.object(model_client.time, "sleep")
    @patch.object(model_client, "urlopen", side_effect=URLError("down"))
    def test_persistent_transport_error_fails_after_three_attempts(self, mocked_urlopen, _mocked_sleep):
        with self.assertRaises(ModelCallError):
            self.client().generate("system", "user")
        self.assertEqual(3, mocked_urlopen.call_count)


if __name__ == "__main__":
    unittest.main()
