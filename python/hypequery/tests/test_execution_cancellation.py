from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import replace
from typing import cast

import pytest

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, Deadline
from hypequery.execution import AsyncClickHouseExecutor, AsyncFromSyncClickHouseExecutor
from hypequery.execution.results import DriverResult


class Result:
    def __init__(self) -> None:
        self.column_names = ("value",)
        self.result_rows = [(1,)]


class AsyncClient:
    def __init__(self) -> None:
        self.started = asyncio.Event()
        self.cancelled = asyncio.Event()
        self.calls = 0

    async def query(self, *_args: object, **_kwargs: object) -> DriverResult:
        self.calls += 1
        self.started.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            self.cancelled.set()
            raise
        return cast(DriverResult, Result())


class Control:
    def __init__(self) -> None:
        self.calls: list[tuple[str, dict[str, str]]] = []

    async def command(self, cmd: str, parameters: dict[str, str]) -> object:
        self.calls.append((cmd, parameters))
        return "finished"


def query(
    *, deadline: Deadline | None = None, cancellation: threading.Event | None = None
) -> CompiledQuery:
    return CompiledQuery("SELECT 1 AS value", {}, deadline=deadline, cancellation=cancellation)


def category(error: pytest.ExceptionInfo[CompiledQueryError]) -> str:
    return error.value.category


def test_caller_signal_cancels_driver_and_wins_over_deadline() -> None:
    async def run() -> None:
        signal = threading.Event()
        client = AsyncClient()
        control = Control()
        compiled = query(deadline=Deadline.after(0.1), cancellation=signal)
        executor = AsyncClickHouseExecutor(client, control)
        task = asyncio.create_task(executor.execute(compiled))
        await client.started.wait()
        signal.set()
        await asyncio.sleep(0.12)
        with pytest.raises(CompiledQueryError) as exc:
            await task
        assert category(exc) == "aborted"
        assert client.cancelled.is_set()
        assert control.calls == [
            ("KILL QUERY WHERE query_id = {id:String} SYNC", {"id": compiled.query_id})
        ]

    asyncio.run(run())


def test_deadline_cancels_driver() -> None:
    async def run() -> None:
        client = AsyncClient()
        control = Control()
        compiled = query(deadline=Deadline.after(0.05))
        with pytest.raises(CompiledQueryError) as exc:
            await AsyncClickHouseExecutor(client, control).execute(compiled)
        assert category(exc) == "deadline-exceeded"
        assert client.cancelled.is_set()
        assert len(control.calls) == 1

    asyncio.run(run())


def test_handler_task_cancellation_stops_server_work() -> None:
    async def run() -> None:
        client = AsyncClient()
        control = Control()
        compiled = query()
        task = asyncio.create_task(AsyncClickHouseExecutor(client, control).execute(compiled))
        await client.started.wait()
        task.cancel()
        with pytest.raises(CompiledQueryError) as exc:
            await task
        assert category(exc) == "aborted"
        assert client.cancelled.is_set()
        assert len(control.calls) == 1

    asyncio.run(run())


def test_driver_task_cancellation_is_not_misreported_as_handler_abort() -> None:
    class DriverCancelled:
        async def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            raise asyncio.CancelledError

    async def run() -> None:
        control = Control()
        with pytest.raises(CompiledQueryError) as exc:
            await AsyncClickHouseExecutor(DriverCancelled(), control).execute(query())
        assert category(exc) == "internal"
        assert control.calls == []

    asyncio.run(run())


def test_queued_query_expires_without_driver_admission() -> None:
    async def run() -> None:
        client = AsyncClient()
        control = Control()
        executor = AsyncClickHouseExecutor(client, control, max_concurrent=1)
        first = asyncio.create_task(executor.execute(query()))
        await client.started.wait()
        with pytest.raises(CompiledQueryError) as exc:
            await executor.execute(query(deadline=Deadline.after(0.05)))
        assert category(exc) == "deadline-exceeded"
        assert client.calls == 1
        first.cancel()
        with pytest.raises(CompiledQueryError):
            await first

    asyncio.run(run())


class SyncClient:
    def __init__(self) -> None:
        self.started = threading.Event()
        self.released = threading.Event()
        self.finished = threading.Event()
        self.calls = 0

    def query(self, *_args: object, **_kwargs: object) -> DriverResult:
        self.calls += 1
        self.started.set()
        self.released.wait(timeout=3)
        self.finished.set()
        return cast(DriverResult, Result())


class SyncControl:
    def __init__(self, client: SyncClient) -> None:
        self.client = client
        self.calls = 0

    def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
        self.calls += 1
        self.client.released.set()
        return "finished"


def test_bounded_sync_bridge_does_not_block_loop_or_leak_workers() -> None:
    async def run() -> None:
        client = SyncClient()
        control = SyncControl(client)
        executor = AsyncFromSyncClickHouseExecutor(client, control, max_concurrent=1)
        signal = threading.Event()
        task = asyncio.create_task(executor.execute(query(cancellation=signal)))
        ticks = 0
        while not client.started.is_set():
            await asyncio.sleep(0.005)
            ticks += 1
        assert ticks > 0
        signal.set()
        with pytest.raises(CompiledQueryError) as exc:
            await task
        assert category(exc) == "aborted"
        assert control.calls == 1
        assert client.finished.wait(timeout=1)
        executor.close()

    asyncio.run(run())
    deadline = time.monotonic() + 1
    while time.monotonic() < deadline and any(
        thread.name.startswith("hypequery-") for thread in threading.enumerate()
    ):
        time.sleep(0.01)
    assert not any(thread.name.startswith("hypequery-") for thread in threading.enumerate())


def test_sync_worker_keeps_its_slot_until_thread_exits() -> None:
    class DelayedControl(SyncControl):
        def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            self.calls += 1
            return "waiting"

    async def run() -> None:
        client = SyncClient()
        control = DelayedControl(client)
        executor = AsyncFromSyncClickHouseExecutor(client, control, max_concurrent=1)
        signal = threading.Event()
        first = asyncio.create_task(executor.execute(query(cancellation=signal)))
        while not client.started.is_set():
            await asyncio.sleep(0.005)
        signal.set()
        with pytest.raises(CompiledQueryError):
            await first
        with pytest.raises(CompiledQueryError) as exc:
            await executor.execute(query(deadline=Deadline.after(0.05)))
        assert category(exc) == "deadline-exceeded"
        assert client.calls == 1
        client.released.set()
        while not client.finished.is_set():
            await asyncio.sleep(0.005)
        executor.close()

    asyncio.run(run())


def test_preflight_signal_outranks_expired_deadline() -> None:
    async def run() -> None:
        signal = threading.Event()
        signal.set()
        compiled = replace(query(deadline=Deadline.after(-1)), cancellation=signal)
        client = AsyncClient()
        with pytest.raises(CompiledQueryError) as exc:
            await AsyncClickHouseExecutor(client, Control()).execute(compiled)
        assert category(exc) == "aborted"
        assert client.calls == 0

    asyncio.run(run())
