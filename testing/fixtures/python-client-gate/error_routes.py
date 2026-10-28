"""Failure-only test routes; no data or execution escape hatch."""

from hypequery.serve import Api, Call, ServeError, ServeResponse

#: The statuses the error scenarios request at `/v1/failure/<status>`.
STATUSES = (429, 500, 503)


class ErrorRoutes:
    @staticmethod
    def failing(status: int):
        async def fail(call: Call) -> ServeResponse:
            if status == 429:
                raise ServeError(
                    429, "RATE_LIMITED", "Rate limit exceeded", headers={"Retry-After": "1"}
                )
            if status == 503:
                raise ServeError(503, "SERVICE_UNAVAILABLE", "Temporarily unavailable")
            raise RuntimeError("GATE_PRIVATE_DRIVER_TEXT")

        return fail

    def install(self, api: Api) -> None:
        for status in STATUSES:
            api.add_route("POST", f"/v1/failure/{status}", self.failing(status))
