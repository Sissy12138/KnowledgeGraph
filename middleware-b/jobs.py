"""In-memory analysis job state machine with auditable progress events."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal

JobStatus = Literal["queued", "processing", "completed", "failed", "cancelled"]
JobStage = Literal["queued", "preprocessing", "analyzing", "aggregating", "validating", "completed", "failed", "cancelled"]

_TRANSITIONS = {
    "queued": {"processing", "cancelled"},
    "processing": {"completed", "failed", "cancelled"},
    "completed": set(),
    "failed": set(),
    "cancelled": set(),
}


@dataclass(frozen=True)
class JobEvent:
    at: str
    status: JobStatus
    stage: JobStage
    progress: int
    message: str


@dataclass
class AnalysisJobState:
    id: str
    paper_id: str
    status: JobStatus = "queued"
    stage: JobStage = "queued"
    progress: int = 0
    error_code: str | None = None
    error_message: str | None = None
    events: list[JobEvent] = field(default_factory=list)

    def transition(self, status: JobStatus, stage: JobStage, progress: int, message: str = "") -> None:
        if status not in _TRANSITIONS[self.status]:
            raise ValueError(f"invalid job transition: {self.status} -> {status}")
        self._set(status, stage, progress, message)

    def update(self, stage: JobStage, progress: int, message: str = "") -> None:
        if self.status != "processing":
            raise ValueError("only processing jobs can report progress")
        self._set(self.status, stage, progress, message)

    def fail(self, code: str, message: str) -> None:
        self.error_code = code
        self.error_message = message
        self.transition("failed", "failed", self.progress, message)

    def _set(self, status: JobStatus, stage: JobStage, progress: int, message: str) -> None:
        if not 0 <= progress <= 100 or progress < self.progress:
            raise ValueError("progress must be between 0 and 100 and never decrease")
        if status == "completed" and progress != 100:
            raise ValueError("completed jobs must have progress 100")
        self.status, self.stage, self.progress = status, stage, progress
        self.events.append(JobEvent(datetime.now(timezone.utc).isoformat(), status, stage, progress, message))
