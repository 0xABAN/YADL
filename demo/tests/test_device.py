import pytest
import torch

from backend.train.device import select_device


def test_auto_device_prefers_apple_mps(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(torch.backends.mps, "is_available", lambda: True)
    monkeypatch.setattr(torch.cuda, "is_available", lambda: True)

    assert select_device("auto").type == "mps"


def test_training_rejects_cpu_when_an_accelerator_is_required() -> None:
    with pytest.raises(RuntimeError, match="accelerator"):
        select_device("cpu", require_accelerator=True)
