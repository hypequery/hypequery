from __future__ import annotations

import asyncio
import threading
import time
from dataclasses import replace
from typing import cast

import pytest

from hypequery.datasets.planner import CompiledQuery, CompiledQueryError, Deadline
from hypequery.execution import AsyncClickHouseExecutor, AsyncFromSyncClickHouseExecutor
from hypequery.execution import cancellation as cancellation_module
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


def test_caller_cancellation_wins_when_control_connection_fails() -> None:
    class BrokenControl:
        async def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            raise OSError("control connection unavailable")

    async def run() -> None:
        signal = threading.Event()
        client = AsyncClient()
        task = asyncio.create_task(
            AsyncClickHouseExecutor(client, BrokenControl()).execute(query(cancellation=signal))
        )
        await client.started.wait()
        signal.set()
        with pytest.raises(CompiledQueryError) as exc:
            await task
        assert category(exc) == "aborted"
        assert client.cancelled.is_set()

    asyncio.run(run())


def test_native_async_slot_waits_for_uncooperative_driver(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class SlowCancelClient:
        def __init__(self) -> None:
            self.started = asyncio.Event()
            self.released = asyncio.Event()
            self.calls = 0

        async def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            self.calls += 1
            self.started.set()
            while not self.released.is_set():
                try:
                    await self.released.wait()
                except asyncio.CancelledError:
                    continue
            return cast(DriverResult, Result())

    async def run() -> None:
        monkeypatch.setattr(cancellation_module, "_DRAIN_SECONDS", 0.05)
        signal = threading.Event()
        client = SlowCancelClient()
        executor = AsyncClickHouseExecutor(client, Control(), max_concurrent=1)
        first = asyncio.create_task(executor.execute(query(cancellation=signal)))
        await client.started.wait()
        signal.set()
        with pytest.raises(CompiledQueryError) as exc:
            await asyncio.wait_for(first, timeout=1)
        assert category(exc) == "aborted"
        with pytest.raises(CompiledQueryError) as queued:
            await executor.execute(query(deadline=Deadline.after(0.05)))
        assert category(queued) == "deadline-exceeded"
        assert client.calls == 1
        client.released.set()
        await asyncio.wait_for(executor.execute(query()), timeout=1)
        assert client.calls == 2

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


def test_sync_bridge_aclose_waits_and_closes_driver_clients() -> None:
    class ClosableClient(SyncClient):
        closed = False

        def close(self) -> None:
            self.closed = True

    class ClosableControl(SyncControl):
        closed = False

        def close(self) -> None:
            self.closed = True

    async def run() -> None:
        client = ClosableClient()
        control = ClosableControl(client)
        executor = AsyncFromSyncClickHouseExecutor(client, control, max_concurrent=1)
        pending = asyncio.create_task(executor.execute(query()))
        while not client.started.is_set():
            await asyncio.sleep(0.005)
        closing = asyncio.create_task(executor.aclose())
        await asyncio.sleep(0)
        assert not closing.done()
        client.released.set()
        await pending
        await closing
        assert client.closed
        assert control.closed
        with pytest.raises(CompiledQueryError) as exc:
            await executor.execute(query())
        assert category(exc) == "unavailable"

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


@pytest.mark.parametrize("deadline", [False, True])
def test_sync_query_uses_control_connection_and_never_returns_cancelled_rows(
    deadline: bool,
) -> None:
    from hypequery.execution import ClickHouseExecutor

    started = threading.Event()
    finished = threading.Event()
    signal = threading.Event()
    calls: list[tuple[str, dict[str, str]]] = []

    class BlockingClient:
        def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            started.set()
            assert finished.wait(2)
            return cast(DriverResult, Result())

    class SyncControl:
        def command(self, cmd: str, parameters: dict[str, str]) -> object:
            calls.append((cmd, parameters))
            finished.set()
            return None

    compiled = query(cancellation=signal, deadline=Deadline.after(0.1) if deadline else None)

    def cancel_after_start() -> None:
        started.wait(1)
        signal.set()

    trigger = threading.Thread(target=cancel_after_start)
    if not deadline:
        trigger.start()
    try:
        with pytest.raises(CompiledQueryError) as exc:
            ClickHouseExecutor(BlockingClient(), control_client=SyncControl()).execute(compiled)
        assert category(exc) == ("deadline-exceeded" if deadline else "aborted")
        assert calls == [
            ("KILL QUERY WHERE query_id = {id:String} SYNC", {"id": compiled.query_id})
        ]
    finally:
        finished.set()
        if not deadline:
            trigger.join()


def test_sync_cancellation_retries_when_first_kill_precedes_query_registration() -> None:
    from hypequery.execution import ClickHouseExecutor

    started = threading.Event()
    register = threading.Event()
    registered = threading.Event()
    early_kill = threading.Event()
    stopped = threading.Event()
    signal = threading.Event()
    attempts: list[bool] = []

    class SubmittingClient:
        def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            started.set()
            assert register.wait(2)
            registered.set()
            assert stopped.wait(2)
            return cast(DriverResult, Result())

    class SyncControl:
        def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            attempts.append(registered.is_set())
            if registered.is_set():
                stopped.set()
            else:
                early_kill.set()
            return None

    def interrupt_submission() -> None:
        started.wait(2)
        signal.set()
        early_kill.wait(2)
        register.set()

    trigger = threading.Thread(target=interrupt_submission)
    trigger.start()
    try:
        with pytest.raises(CompiledQueryError) as exc:
            ClickHouseExecutor(SubmittingClient(), control_client=SyncControl()).execute(
                query(cancellation=signal)
            )
        assert category(exc) == "aborted"
        assert attempts[0] is False
        assert True in attempts
    finally:
        register.set()
        stopped.set()
        trigger.join()


@pytest.mark.parametrize("confirmation", ["finished", ["finished", "query-id"], ("finished",)])
def test_confirmed_sync_cancellation_stops_control_traffic_before_driver_returns(
    confirmation: object,
) -> None:
    from concurrent.futures import ThreadPoolExecutor

    from hypequery.execution import ClickHouseExecutor

    started = threading.Event()
    release = threading.Event()
    confirmed = threading.Event()
    signal = threading.Event()
    attempts: list[str] = []

    class SlowReturningClient:
        def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            started.set()
            assert release.wait(2)
            return cast(DriverResult, Result())

    class SyncControl:
        def command(self, _cmd: str, parameters: dict[str, str]) -> object:
            attempts.append(parameters["id"])
            confirmed.set()
            return confirmation

    with ThreadPoolExecutor(max_workers=1) as workers:
        compiled = query(cancellation=signal)
        executor = ClickHouseExecutor(SlowReturningClient(), control_client=SyncControl())
        task = workers.submit(executor.execute, compiled)
        try:
            assert started.wait(1)
            signal.set()
            assert confirmed.wait(1)
            time.sleep(0.15)
            assert not task.done()
            assert attempts == [compiled.query_id]
        finally:
            release.set()
        with pytest.raises(CompiledQueryError) as exc:
            task.result(timeout=1)
        assert category(exc) == "aborted"


def test_native_async_cancellation_retries_until_the_server_confirms() -> None:
    async def run() -> None:
        signal = threading.Event()
        client = AsyncClient()
        confirmed = asyncio.Event()

        class LateControl:
            def __init__(self) -> None:
                self.calls = 0

            async def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
                self.calls += 1
                if self.calls < 3:
                    # The query had not registered on the server yet.
                    return None
                confirmed.set()
                return "finished"

        control = LateControl()
        executor = AsyncClickHouseExecutor(client, control)
        task = asyncio.create_task(executor.execute(query(cancellation=signal)))
        await client.started.wait()
        signal.set()
        with pytest.raises(CompiledQueryError) as exc:
            await task
        assert category(exc) == "aborted"
        # The request does not wait for the retries.
        assert control.calls == 1
        await asyncio.wait_for(confirmed.wait(), timeout=2)
        assert control.calls == 3
        await asyncio.sleep(0.2)
        # Confirmation stops the retries.
        assert control.calls == 3

    asyncio.run(run())


def test_sync_bridge_cancellation_retries_when_first_kill_precedes_registration() -> None:
    started = threading.Event()
    register = threading.Event()
    registered = threading.Event()
    stopped = threading.Event()
    signal = threading.Event()
    attempts: list[bool] = []

    class SubmittingClient:
        def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            started.set()
            assert register.wait(2)
            registered.set()
            assert stopped.wait(2)
            return cast(DriverResult, Result())

    class LateControl:
        def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            attempts.append(registered.is_set())
            if registered.is_set():
                stopped.set()
                return "finished"
            return None

    async def run() -> None:
        executor = AsyncFromSyncClickHouseExecutor(
            SubmittingClient(), LateControl(), max_concurrent=1
        )
        task = asyncio.create_task(executor.execute(query(cancellation=signal)))
        while not started.is_set():
            await asyncio.sleep(0.005)
        signal.set()
        with pytest.raises(CompiledQueryError) as exc:
            await task
        assert category(exc) == "aborted"
        # The first KILL preceded registration and matched nothing.
        assert attempts == [False]
        register.set()
        deadline = time.monotonic() + 2
        while not stopped.is_set() and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        # A later attempt reached the registered query and stopped it.
        assert True in attempts
        await executor.aclose()

    try:
        asyncio.run(run())
    finally:
        register.set()
        stopped.set()


def test_sync_bridge_retries_outlast_max_execution_time_while_the_driver_runs() -> None:
    """max_execution_time bounds execution on the server, not a slow submission."""
    from hypequery.datasets.planner import query_settings

    started = threading.Event()
    register = threading.Event()
    registered = threading.Event()
    stopped = threading.Event()
    signal = threading.Event()

    class SlowSubmittingClient:
        def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            started.set()
            assert register.wait(5)
            registered.set()
            assert stopped.wait(5)
            return cast(DriverResult, Result())

    class LateControl:
        def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            if registered.is_set():
                stopped.set()
                return "finished"
            return None

    async def run() -> None:
        executor = AsyncFromSyncClickHouseExecutor(
            SlowSubmittingClient(), LateControl(), max_concurrent=1
        )
        compiled = CompiledQuery(
            "SELECT 1 AS value",
            {},
            cancellation=signal,
            settings=query_settings(max_execution_time=1),
        )
        task = asyncio.create_task(executor.execute(compiled))
        while not started.is_set():
            await asyncio.sleep(0.005)
        signal.set()
        with pytest.raises(CompiledQueryError):
            await task
        # Submission finishes well after the server-side time limit (and the
        # last backed-off attempt inside it) has passed.
        await asyncio.sleep(2.5)
        register.set()
        deadline = time.monotonic() + 4
        while not stopped.is_set() and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        assert stopped.is_set(), "the late-registering query escaped cancellation"
        await executor.aclose()

    try:
        asyncio.run(run())
    finally:
        register.set()
        stopped.set()


def test_sync_bridge_aclose_keeps_the_control_worker_until_queries_stop() -> None:
    """Closing right after an unconfirmed KILL must still let the retries reach the query."""

    started = threading.Event()
    register = threading.Event()
    registered = threading.Event()
    stopped = threading.Event()
    signal = threading.Event()
    attempts: list[bool] = []

    class SubmittingClient:
        def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            started.set()
            assert register.wait(2)
            registered.set()
            # Without a KILL this blocks until the server's own time limit.
            assert stopped.wait(2)
            return cast(DriverResult, Result())

    class LateControl:
        def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            attempts.append(registered.is_set())
            if registered.is_set():
                stopped.set()
                return "finished"
            return None

    async def run() -> None:
        executor = AsyncFromSyncClickHouseExecutor(
            SubmittingClient(), LateControl(), max_concurrent=1
        )
        task = asyncio.create_task(executor.execute(query(cancellation=signal)))
        while not started.is_set():
            await asyncio.sleep(0.005)
        signal.set()
        with pytest.raises(CompiledQueryError):
            await task
        assert attempts == [False]
        register.set()
        # Shutdown must not disable the retries: the query registers late and
        # a later KILL, sent through the still-open control worker, stops it.
        await asyncio.wait_for(executor.aclose(), timeout=1.5)
        assert stopped.is_set()
        assert True in attempts

    try:
        asyncio.run(run())
    finally:
        register.set()
        stopped.set()


def _refused() -> Exception:
    from clickhouse_connect.driver.exceptions import DatabaseError

    error = DatabaseError("Not enough privileges: SELECT ON system.processes")
    error.name = "ACCESS_DENIED"
    return error


@pytest.fixture
def refused_kill_log(monkeypatch: pytest.MonkeyPatch, caplog: pytest.LogCaptureFixture):  # type: ignore[no-untyped-def]
    from hypequery.execution.utils import refused_kill

    monkeypatch.setattr(refused_kill, "_reported", False)
    caplog.set_level("ERROR", logger="hypequery.execution.cancellation")
    return caplog


def _refusals(caplog: pytest.LogCaptureFixture) -> int:
    return sum("refused KILL QUERY" in record.getMessage() for record in caplog.records)


def test_a_refused_sync_kill_stops_retrying_and_says_so_once(
    refused_kill_log: pytest.LogCaptureFixture,
) -> None:
    from hypequery.execution import ClickHouseExecutor

    started = threading.Event()
    release = threading.Event()
    attempts: list[int] = []

    class SlowClient:
        def query(self, *_args: object, **_kwargs: object) -> DriverResult:
            started.set()
            assert release.wait(2)
            return cast(DriverResult, Result())

    class RefusingControl:
        def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
            attempts.append(1)
            raise _refused()

    executor = ClickHouseExecutor(SlowClient(), control_client=RefusingControl())
    for _ in range(2):
        started.clear()
        release.clear()
        signal = threading.Event()
        trigger = threading.Timer(0.05, signal.set)
        trigger.start()
        # The query outlives the KILL, then finishes on its own.
        threading.Timer(0.4, release.set).start()
        with pytest.raises(CompiledQueryError) as exc:
            executor.execute(query(cancellation=signal))
        assert category(exc) == "aborted"
    assert len(attempts) == 2
    assert _refusals(refused_kill_log) == 1


@pytest.mark.parametrize("bridge", [False, True])
def test_a_refused_async_kill_schedules_no_retries(
    bridge: bool, refused_kill_log: pytest.LogCaptureFixture
) -> None:
    async def run() -> None:
        signal = threading.Event()
        attempts: list[int] = []

        if bridge:
            client = SyncClient()

            class RefusingSyncControl:
                def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
                    attempts.append(1)
                    raise _refused()

            executor: AsyncClickHouseExecutor | AsyncFromSyncClickHouseExecutor = (
                AsyncFromSyncClickHouseExecutor(client, RefusingSyncControl())
            )
            started = asyncio.to_thread(client.started.wait, 2)
        else:
            async_client = AsyncClient()

            class RefusingControl:
                async def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
                    attempts.append(1)
                    raise _refused()

            executor = AsyncClickHouseExecutor(async_client, RefusingControl())
            started = async_client.started.wait()
        task = asyncio.create_task(executor.execute(query(cancellation=signal)))
        await started
        signal.set()
        with pytest.raises(CompiledQueryError) as exc:
            await task
        assert category(exc) == "aborted"
        await asyncio.sleep(0.3)
        assert len(attempts) == 1
        assert _refusals(refused_kill_log) == 1
        if bridge:
            client.released.set()
            await executor.aclose()
        else:
            await executor.aclose()

    asyncio.run(run())


class _NeverConfirmingControl:
    def __init__(self) -> None:
        self.calls = 0

    async def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
        self.calls += 1
        # No match: not registered yet, or already gone. KILL cannot tell.
        return None


class _CancelOnCloseClient(AsyncClient):
    def get_client_setting(self, key: str) -> str | None:
        return "1" if key == "cancel_http_readonly_queries_on_client_close" else None


def test_native_async_retries_stop_with_the_request_when_the_server_cancels_on_close() -> None:
    async def run() -> None:
        signal = threading.Event()
        client = _CancelOnCloseClient()
        control = _NeverConfirmingControl()
        executor = AsyncClickHouseExecutor(client, control)
        task = asyncio.create_task(executor.execute(query(cancellation=signal)))
        await client.started.wait()
        signal.set()
        with pytest.raises(CompiledQueryError):
            await task
        assert client.cancelled.is_set()
        await asyncio.sleep(0.3)
        # The closed request ended the query on the server: one KILL, no retries.
        assert control.calls == 1
        assert not executor._retries
        await executor.aclose()

    asyncio.run(run())


def test_native_async_aclose_stops_outstanding_retries() -> None:
    async def run() -> None:
        signal = threading.Event()
        client = AsyncClient()
        control = _NeverConfirmingControl()
        executor = AsyncClickHouseExecutor(client, control)
        task = asyncio.create_task(executor.execute(query(cancellation=signal)))
        await client.started.wait()
        signal.set()
        with pytest.raises(CompiledQueryError):
            await task
        await asyncio.sleep(0.1)
        assert executor._retries
        await executor.aclose()
        assert not executor._retries
        calls = control.calls
        await asyncio.sleep(0.3)
        assert control.calls == calls

    asyncio.run(run())


def test_sync_bridge_aclose_stops_outstanding_retries() -> None:
    async def run() -> None:
        signal = threading.Event()
        release = threading.Event()
        started = threading.Event()
        calls: list[int] = []

        class SlowClient:
            def query(self, *_args: object, **_kwargs: object) -> DriverResult:
                started.set()
                assert release.wait(3)
                return cast(DriverResult, Result())

        class NeverConfirming:
            def command(self, _cmd: str, _parameters: dict[str, str]) -> object:
                calls.append(1)
                return None

        executor = AsyncFromSyncClickHouseExecutor(SlowClient(), NeverConfirming())
        task = asyncio.create_task(executor.execute(query(cancellation=signal)))
        await asyncio.to_thread(started.wait, 2)
        signal.set()
        with pytest.raises(CompiledQueryError):
            await task
        assert executor._retries
        closing = asyncio.create_task(executor.aclose())
        await asyncio.sleep(0.1)
        release.set()
        await closing
        assert not executor._retries
        count = len(calls)
        await asyncio.sleep(0.3)
        assert len(calls) == count

    asyncio.run(run())
