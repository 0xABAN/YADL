from __future__ import annotations

import torch


def select_device(
    requested: str = "auto", *, require_accelerator: bool = True
) -> torch.device:
    if requested not in {"auto", "mps", "cuda", "cpu"}:
        raise ValueError(f"unknown device {requested!r}")
    available = {
        "mps": torch.backends.mps.is_available(),
        "cuda": torch.cuda.is_available(),
        "cpu": True,
    }
    selected = (
        ("mps" if available["mps"] else "cuda" if available["cuda"] else "cpu")
        if requested == "auto"
        else requested
    )
    if not available[selected]:
        raise RuntimeError(f"requested {selected} accelerator is unavailable")
    if require_accelerator and selected == "cpu":
        raise RuntimeError("training requires an MPS or CUDA accelerator")
    return torch.device(selected)
