import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
os.environ["PANTRY_WORKERS"] = "0"


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import db

    monkeypatch.setattr(db, "DATA_DIR", str(tmp_path))
    db.set_path(str(tmp_path / "pantry.db"))
    from fastapi.testclient import TestClient
    from app.main import app

    with TestClient(app) as test_client:
        yield test_client
