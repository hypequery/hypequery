"""Language-neutral streaming HTTP fixtures (streaming-v1) against Python serve.

Streams need a host that writes them as they are produced, `to_asgi_app`; the
fixtures run there, with and without a `ProductionProfile`. Every other host
answers a stream request with the page it always served, which is what the
fixtures require of an endpoint that does not stream.
"""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import pyarrow as pa
import pytest

from hypequery.datasets import (
    CompiledQuery,
    CompiledQueryError,
    Dataset,
    DatasetLimits,
    create_dataset_client,
    dimension,
    measure,
)
from hypequery.datasets.aggregations import count
from hypequery.datasets.client import ResultScalar
from hypequery.serve import (
    EndpointPolicy,
    HttpSecurity,
    Principal,
    ProductionProfile,
    add_dataset_endpoint,
    create_api,
)
from serve_transports import TRANSPORTS, serve_client

FIXTURES = json.loads(
    (
        Path(__file__).resolve().parents[3] / "specs/serve-http/fixtures/streaming-v1/cases.json"
    ).read_text()
)
APP = FIXTURES["app"]
PATH = f"/datasets/{APP['dataset']}/query"


@dataclass(frozen=True)
class Rows:
    columns: tuple[str, ...]
    rows: tuple[tuple[ResultScalar, ...], ...]


def _selected(compiled: CompiledQuery) -> tuple[tuple[str, ...], list[dict[str, Any]]]:
    columns = tuple(re.findall(r" AS `([^`]+)`", compiled.sql.split(" FROM ", 1)[0]))
    match = re.search(r"LIMIT (\d+)(?: OFFSET (\d+))?$", compiled.sql)
    assert match
    return columns, APP["rows"][int(match[2] or 0) :][: int(match[1])]


class _RowStream:
    def __init__(self, compiled: CompiledQuery, fail_after: int | None) -> None:
        self.columns, self._rows = _selected(compiled)
        self._fail_after = fail_after

    def __iter__(self) -> Iterator[Rows]:
        size = APP["batchSize"]
        for index, start in enumerate(range(0, len(self._rows), size)):
            if self._fail_after is not None and index >= self._fail_after:
                raise CompiledQueryError("internal", "", code=None)
            chunk = self._rows[start : start + size]
            yield Rows(self.columns, tuple(tuple(row[c] for c in self.columns) for row in chunk))

    def close(self) -> None:
        pass


class _ArrowStream:
    def __init__(self, compiled: CompiledQuery) -> None:
        columns, rows = _selected(compiled)
        self._table = pa.table({column: [row[column] for row in rows] for column in columns})
        self.schema = self._table.schema

    def __iter__(self) -> Iterator[pa.RecordBatch]:
        return iter(self._table.to_batches(max_chunksize=APP["batchSize"]))

    def close(self) -> None:
        pass


@dataclass
class Executor:
    fail_after: int | None = None

    def execute(self, compiled: CompiledQuery) -> Rows:
        columns, rows = _selected(compiled)
        return Rows(columns, tuple(tuple(row[c] for c in columns) for row in rows))

    def stream(self, compiled: CompiledQuery) -> _RowStream:
        return _RowStream(compiled, self.fail_after)

    def stream_arrow(self, compiled: CompiledQuery) -> _ArrowStream:
        return _ArrowStream(compiled)


def app(case: dict[str, Any], transport: str) -> Any:
    dataset = Dataset(
        name=APP["dataset"],
        source=APP["source"],
        dimensions={APP["dimension"]: dimension("string", column=APP["column"])},
        measures={APP["measure"]: measure(count(APP["measureField"]))},
        limits=DatasetLimits(max_result_size=APP["maxResultSize"]),
    )
    api = create_api(
        auth=lambda credential: (
            Principal(subject="alice") if credential.value == APP["credential"] else None
        ),
        security=HttpSecurity(allowed_hosts=("testserver",)),
        production=ProductionProfile() if transport.endswith("-production") else None,
    )
    policy = EndpointPolicy(
        max_limit=APP["pageCap"],
        stream_max_rows=None if case.get("stream") is False else APP["streamMaxRows"],
    )
    client = create_dataset_client(executor=Executor(case.get("failAfterBatches")))
    add_dataset_endpoint(api, PATH, dataset=dataset, client=client, policy=policy)
    return serve_client(transport.removesuffix("-production"), api)


def post(case: dict[str, Any], transport: str) -> Any:
    headers = {"content-type": "application/json"}
    if case.get("accept"):
        headers["accept"] = case["accept"]
    if case.get("credential") != "none":
        headers["authorization"] = f"Bearer {APP['credential']}"
    return app(case, transport).post(
        PATH, headers=headers, content=json.dumps(case["json"]).encode()
    )


def assert_public(value: object) -> None:
    if isinstance(value, dict):
        for key, child in value.items():
            assert key not in FIXTURES["forbiddenPublicKeys"]
            assert_public(child)
    elif isinstance(value, list):
        for child in value:
            assert_public(child)


@pytest.mark.parametrize("transport", ["asgi", "asgi-production"])
@pytest.mark.parametrize("case", FIXTURES["cases"], ids=[case["id"] for case in FIXTURES["cases"]])
def test_streaming_fixture(case: dict[str, Any], transport: str) -> None:
    response = post(case, transport)
    expected = case["expect"]
    assert response.status_code == expected["status"]
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-request-id"]
    content_type = response.headers["content-type"].split(";")[0]
    assert content_type == expected["contentType"]

    if content_type == "application/json":
        body = response.json()
        assert_public(body)
        if "data" in expected:
            assert body["data"] == expected["data"]
        if "errorType" in expected:
            assert body["error"]["type"] == expected["errorType"]
        return

    if content_type == "application/vnd.apache.arrow.stream":
        # Python's client yields record batches; serve encodes them, so the
        # fixture's bytes are TypeScript's. The rows and the IPC framing match.
        table = pa.ipc.open_stream(response.content).read_all()
        assert table.column_names == [APP["dimension"], APP["measure"]]
        assert table.num_rows == APP["streamMaxRows"]
        assert response.content.endswith(b"\xff\xff\xff\xff\x00\x00\x00\x00")
        return

    text = response.text
    for forbidden in expected.get("forbiddenText", []):
        assert forbidden not in text
    assert text.endswith("\n")
    frames = [json.loads(line) for line in text.splitlines()]
    assert_public(frames)
    assert frames[0]["type"] == "start"
    if expected.get("meta") is False:
        assert "meta" not in frames[0]
    if expected.get("meta") is True:
        assert isinstance(frames[0]["meta"], dict)
    row_frames = [f for f in frames if f["type"] == "rows"]
    assert frames[1 : 1 + len(row_frames)] == row_frames
    assert [row for f in row_frames for row in f["data"]] == expected["rows"]
    if "batches" in expected:
        assert len(row_frames) == expected["batches"]
    assert len(frames) == len(row_frames) + 2
    last = frames[-1]
    if "end" in expected:
        assert last == {"type": "end", **expected["end"]}
    if "errorFrame" in expected:
        assert last["type"] == "error"
        assert last["error"]["type"] == expected["errorFrame"]


SYNC_HOSTS = [name for name in TRANSPORTS if name not in ("core", "asgi")]


@pytest.mark.parametrize("transport", SYNC_HOSTS)
def test_a_host_that_cannot_stream_answers_a_page(transport: str) -> None:
    case = {"accept": "application/x-ndjson", "json": {"dimensions": [APP["dimension"]]}}
    response = post(case, transport)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert len(response.json()["data"]) == APP["pageCap"]


def test_a_stream_cap_above_the_dataset_ceiling_is_refused() -> None:
    dataset = Dataset(
        name="orders",
        source="orders",
        dimensions={"country": dimension("string")},
        measures={"total": measure(count("id"))},
        limits=DatasetLimits(max_result_size=10),
    )
    api = create_api(auth=lambda credential: None)
    with pytest.raises(ValueError, match=r"stream_max_rows \(11\) exceeds"):
        add_dataset_endpoint(
            api,
            "/q",
            dataset=dataset,
            client=create_dataset_client(executor=Executor()),
            policy=EndpointPolicy(stream_max_rows=11),
        )


def test_a_production_byte_ceiling_ends_the_stream_with_an_error_frame() -> None:
    case = {"accept": "application/x-ndjson", "json": {"dimensions": [APP["dimension"]]}}
    dataset = Dataset(
        name=APP["dataset"],
        source=APP["source"],
        dimensions={APP["dimension"]: dimension("string", column=APP["column"])},
        measures={APP["measure"]: measure(count(APP["measureField"]))},
        limits=DatasetLimits(max_result_size=APP["maxResultSize"]),
    )
    api = create_api(
        auth=lambda credential: Principal(subject="alice"),
        security=HttpSecurity(allowed_hosts=("testserver",)),
        production=ProductionProfile(max_result_bytes=1024),
    )
    add_dataset_endpoint(
        api,
        PATH,
        dataset=dataset,
        client=create_dataset_client(executor=Executor()),
        policy=EndpointPolicy(stream_max_rows=APP["streamMaxRows"]),
    )
    client = serve_client("asgi", api)
    small = client.post(
        PATH,
        headers={
            "accept": case["accept"],
            "authorization": "Bearer x",
            "content-type": "application/json",
        },
        content=json.dumps(case["json"]).encode(),
    )
    assert json.loads(small.text.splitlines()[-1])["type"] == "end"

    api = create_api(
        auth=lambda credential: Principal(subject="alice"),
        security=HttpSecurity(allowed_hosts=("testserver",)),
        production=ProductionProfile(max_result_bytes=1024),
    )
    wide = Dataset(
        name=APP["dataset"],
        source=APP["source"],
        dimensions={APP["dimension"]: dimension("string", column=APP["column"])},
        measures={APP["measure"]: measure(count(APP["measureField"]))},
    )
    add_dataset_endpoint(
        api,
        PATH,
        dataset=wide,
        client=create_dataset_client(executor=_Wide()),
        policy=EndpointPolicy(stream_max_rows=1000),
    )
    response = serve_client("asgi", api).post(
        PATH,
        headers={
            "accept": case["accept"],
            "authorization": "Bearer x",
            "content-type": "application/json",
        },
        content=json.dumps(case["json"]).encode(),
    )
    frames = [json.loads(line) for line in response.text.splitlines()]
    assert frames[-1] == {
        "type": "error",
        "error": {"type": "PAYLOAD_TOO_LARGE", "message": "The response exceeds its byte limit."},
    }
    assert len(response.content) <= 1024 + len(response.text.splitlines()[-1]) + 1


class _Wide(Executor):
    """Many rows, so a small byte ceiling is crossed partway."""

    def stream(self, compiled: CompiledQuery) -> Any:
        columns, _ = _selected(compiled)

        class _Stream:
            def __init__(self) -> None:
                self.columns = columns

            def __iter__(self) -> Iterator[Rows]:
                for start in range(0, 1000, 50):
                    yield Rows(
                        columns,
                        tuple((f"country-{i}", i) for i in range(start, start + 50)),
                    )

            def close(self) -> None:
                pass

        return _Stream()


# --- cleanup races -------------------------------------------------------------


def test_a_stream_cancelled_while_opening_closes_only_after_it_opened() -> None:
    import asyncio
    import time

    from hypequery.serve.core.work import RequestWork
    from hypequery.serve.utils.stream_batches import client_batches

    events: list[str] = []

    class SlowStream:
        def __enter__(self) -> SlowStream:
            time.sleep(0.2)
            events.append("entered")
            return self

        def __iter__(self) -> Iterator[Rows]:
            return iter(())

        def close(self) -> None:
            events.append("closed")

    async def run() -> None:
        work = RequestWork()
        batches = client_batches(work, object(), lambda client: SlowStream())  # type: ignore[arg-type]
        opening = asyncio.ensure_future(anext(batches))
        await asyncio.sleep(0.05)
        work.cancel()
        opening.cancel()
        with pytest.raises(asyncio.CancelledError):
            await opening
        for _ in range(100):
            if "closed" in events:
                break
            await asyncio.sleep(0.01)

    asyncio.run(run())
    # Closing first would have found nothing open and left the stream open.
    assert events == ["entered", "closed"]


def test_asgi_closes_a_stream_whose_headers_could_not_be_sent() -> None:
    import asyncio

    from hypequery.serve.asgi import _write
    from hypequery.serve.core.messages import ServeResponse

    closed: list[bool] = []

    class Body:
        def __aiter__(self) -> Any:
            return self

        async def __anext__(self) -> bytes:
            raise StopAsyncIteration

        async def aclose(self) -> None:
            closed.append(True)

    async def send(message: Any) -> None:
        raise OSError("client gone")

    async def run() -> None:
        with pytest.raises(OSError, match="client gone"):
            await _write(ServeResponse.streamed(Body(), "application/x-ndjson"), send)

    asyncio.run(run())
    assert closed == [True]


def test_closing_a_streamed_body_before_reading_ends_its_query() -> None:
    import asyncio
    from collections.abc import AsyncGenerator

    from hypequery.serve.core.endpoints import _Prefixed

    ended: list[bool] = []

    async def body() -> AsyncGenerator[bytes, None]:
        try:
            yield b"start"
            yield b"rows"
        finally:
            ended.append(True)

    async def run() -> None:
        rest = body()
        first = await anext(rest)
        # A host that never iterates still closes the response.
        await _Prefixed(first, rest).aclose()

    asyncio.run(run())
    assert ended == [True]
