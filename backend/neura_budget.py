"""Daily Neuron budget, saturation gate and usage statistics for the Neura engine.

Zero-spend rule: every inference reserves its worst-case cost *before* it runs.
When the daily budget (kept under Cloudflare's free 10,000 Neurons) would be
exceeded, the request is refused — it never falls through to a paid tier.
Cloudflare's free allocation resets at 00:00 UTC, so our days are UTC days.
"""
from __future__ import annotations

import asyncio
import time
import uuid
from collections import deque
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Callable, Dict, Optional

from pymongo.errors import DuplicateKeyError

UNLIMITED = None


class BudgetExceeded(Exception):
    """Raised before any call that the free budget cannot cover."""

    def __init__(self, scope: str, message: str, reset_at: datetime):
        super().__init__(message)
        self.scope = scope  # global | subject
        self.message = message
        self.reset_at = reset_at


class Saturated(Exception):
    def __init__(self, message: str):
        super().__init__(message)
        self.message = message


@dataclass
class Reservation:
    id: str
    day: str
    subject_key: Optional[str]
    neurons: float


def utc_day(now: datetime) -> str:
    return now.strftime("%Y-%m-%d")


def next_reset(now: datetime) -> datetime:
    return (now + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)


def reset_label(reset_at: datetime) -> str:
    return reset_at.strftime("%H:%M UTC")


class NeuronBudget:
    """Atomic reservations in MongoDB, safe with several workers.

    Collections:
      ai_budget_days      {_id: day, committed, requests, …}
      ai_budget_subjects  {_id: "<kind>:<id>:<day>", committed, requests}
    """

    def __init__(self, db, *, daily_limit: float, plan_limits: Dict[str, Optional[float]],
                 free_share: float = 0.7, clock: Callable[[], datetime] = lambda: datetime.now(timezone.utc)):
        self.db = db
        self.daily_limit = float(daily_limit)
        self.plan_limits = plan_limits
        self.free_share = min(1.0, max(0.1, float(free_share)))
        self.clock = clock

    def subject_limit(self, subject: Optional[dict]) -> Optional[float]:
        if not subject:
            return UNLIMITED
        if "limit" in subject:
            return subject["limit"]
        return self.plan_limits.get(subject.get("plan") or "free", self.plan_limits.get("free"))

    def global_cap(self, subject: Optional[dict]) -> float:
        # Free accounts can only use part of the day's budget: paid/VIP users and
        # API keys keep the rest when the app is saturated.
        if subject and subject.get("kind") in ("user", "anon") and (subject.get("plan") or "free") == "free":
            return self.daily_limit * self.free_share
        return self.daily_limit

    @staticmethod
    def subject_key(subject: Optional[dict], day: str) -> Optional[str]:
        if not subject or not subject.get("id"):
            return None
        return f"{subject.get('kind', 'user')}:{subject['id']}:{day}"

    async def _ensure(self, collection, key: str):
        try:
            await collection.update_one(
                {"_id": key}, {"$setOnInsert": {"committed": 0.0, "requests": 0}}, upsert=True
            )
        except DuplicateKeyError:
            pass

    async def _take(self, collection, key: str, amount: float, cap: Optional[float]) -> bool:
        await self._ensure(collection, key)
        query = {"_id": key}
        if cap is not None:
            query["committed"] = {"$lte": cap - amount}
        result = await collection.update_one(query, {"$inc": {"committed": amount, "requests": 1}})
        return result.modified_count == 1

    async def reserve(self, subject: Optional[dict], neurons: float) -> Reservation:
        now = self.clock()
        day = utc_day(now)
        reset_at = next_reset(now)
        amount = round(max(0.0, float(neurons)), 3)
        if not await self._take(self.db.ai_budget_days, day, amount, self.global_cap(subject)):
            raise BudgetExceeded(
                "global",
                "Le quota gratuit d'IA de Neura Al Noor est épuisé pour aujourd'hui. "
                f"Il revient à minuit UTC ({reset_label(reset_at)}, soit 1 h ou 2 h du matin en France).",
                reset_at,
            )
        key = self.subject_key(subject, day)
        if key is not None:
            limit = self.subject_limit(subject)
            if not await self._take(self.db.ai_budget_subjects, key, amount, limit):
                await self.db.ai_budget_days.update_one({"_id": day}, {"$inc": {"committed": -amount, "requests": -1}})
                raise BudgetExceeded(
                    "subject",
                    "Tu as atteint ta limite d'IA gratuite pour aujourd'hui. "
                    f"Elle revient à minuit UTC ({reset_label(reset_at)}, soit 1 h ou 2 h du matin en France).",
                    reset_at,
                )
        return Reservation(id=str(uuid.uuid4()), day=day, subject_key=key, neurons=amount)

    async def settle(self, reservation: Reservation, actual_neurons: float):
        """Replace the reserved worst case by the real cost."""
        delta = round(float(actual_neurons) - reservation.neurons, 3)
        if delta:
            await self.db.ai_budget_days.update_one({"_id": reservation.day}, {"$inc": {"committed": delta}})
            if reservation.subject_key:
                await self.db.ai_budget_subjects.update_one({"_id": reservation.subject_key}, {"$inc": {"committed": delta}})
        reservation.neurons = round(float(actual_neurons), 3)

    async def release(self, reservation: Reservation):
        await self.db.ai_budget_days.update_one(
            {"_id": reservation.day}, {"$inc": {"committed": -reservation.neurons, "requests": -1}}
        )
        if reservation.subject_key:
            await self.db.ai_budget_subjects.update_one(
                {"_id": reservation.subject_key}, {"$inc": {"committed": -reservation.neurons, "requests": -1}}
            )
        reservation.neurons = 0.0

    async def snapshot(self, subject: Optional[dict] = None) -> dict:
        now = self.clock()
        day = utc_day(now)
        doc = await self.db.ai_budget_days.find_one({"_id": day}) or {}
        used = round(float(doc.get("committed", 0.0)), 3)
        result = {
            "day": day,
            "daily_limit": self.daily_limit,
            "used": used,
            "remaining": round(max(0.0, self.daily_limit - used), 3),
            "requests": int(doc.get("requests", 0)),
            "free_share": self.free_share,
            "reset_at": next_reset(now).isoformat(),
        }
        key = self.subject_key(subject, day)
        if key:
            mine = await self.db.ai_budget_subjects.find_one({"_id": key}) or {}
            limit = self.subject_limit(subject)
            result["subject"] = {
                "used": round(float(mine.get("committed", 0.0)), 3),
                "limit": limit,
                "remaining": None if limit is None else round(max(0.0, limit - float(mine.get("committed", 0.0))), 3),
                "requests": int(mine.get("requests", 0)),
            }
        return result


class ConcurrencyGate:
    """Limits simultaneous inferences and requests per minute (per backend process).

    Beyond `max_concurrent`, requests wait in a queue (at most `max_queue`, at most
    `queue_timeout` seconds); beyond that they are refused with a clear message.
    """

    def __init__(self, *, max_concurrent: int, max_queue: int, queue_timeout: float, rpm_limit: int,
                 monotonic: Callable[[], float] = time.monotonic):
        self.max_concurrent = max(1, int(max_concurrent))
        self.max_queue = max(0, int(max_queue))
        self.queue_timeout = float(queue_timeout)
        self.rpm_limit = max(1, int(rpm_limit))
        self.monotonic = monotonic
        self._semaphore = asyncio.Semaphore(self.max_concurrent)
        self._starts = deque()
        self.active = 0
        self.waiting = 0
        self.rejected = 0
        self.served = 0
        self.max_wait_ms = 0

    def _rpm_ok(self) -> bool:
        now = self.monotonic()
        while self._starts and now - self._starts[0] > 60:
            self._starts.popleft()
        return len(self._starts) < self.rpm_limit

    @asynccontextmanager
    async def slot(self):
        if not self._rpm_ok():
            self.rejected += 1
            raise Saturated("Neura Al Noor reçoit trop de demandes en ce moment. Réessaie dans une minute.")
        if self._semaphore.locked() and self.waiting >= self.max_queue:
            self.rejected += 1
            raise Saturated("Neura Al Noor est saturée en ce moment. Réessaie dans quelques secondes.")
        started = self.monotonic()
        self.waiting += 1
        try:
            await asyncio.wait_for(self._semaphore.acquire(), timeout=self.queue_timeout)
        except asyncio.TimeoutError:
            self.rejected += 1
            raise Saturated("Trop d'attente : Neura Al Noor est saturée. Réessaie dans quelques secondes.")
        finally:
            self.waiting -= 1
        self.max_wait_ms = max(self.max_wait_ms, int((self.monotonic() - started) * 1000))
        self._starts.append(self.monotonic())
        self.active += 1
        try:
            yield
        finally:
            self.active -= 1
            self.served += 1
            self._semaphore.release()

    def stats(self) -> dict:
        return {
            "active": self.active,
            "waiting": self.waiting,
            "max_concurrent": self.max_concurrent,
            "max_queue": self.max_queue,
            "rpm_limit": self.rpm_limit,
            "served": self.served,
            "rejected": self.rejected,
            "max_wait_ms": self.max_wait_ms,
        }
