import os
from pathlib import Path
import tempfile
import unittest

from backend.model_config import (
    clear_config,
    configure_storage,
    private_dict,
    public_status,
    set_config,
)


class ModelConfigPersistenceTest(unittest.TestCase):
    def test_configuration_survives_reload_without_plaintext_secret(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "model-config.json"
            configure_storage(path)
            set_config({
                "provider": "deepseek",
                "baseUrl": "https://api.deepseek.com",
                "model": "deepseek-v4-flash",
                "apiKey": "test-secret-value",
            })
            self.assertTrue(public_status()["configured"])
            self.assertTrue(path.exists())
            self.assertNotIn("test-secret-value", path.read_text(encoding="utf-8"))
            if os.name != "nt":
                self.assertEqual(0o600, path.stat().st_mode & 0o777)

            configure_storage(path)
            self.assertEqual("test-secret-value", private_dict()["apiKey"])
            clear_config()
            self.assertFalse(path.exists())


if __name__ == "__main__":
    unittest.main()
