"""Failure-only test routes; no data or execution escape hatch."""

from hypequery.serve import ServeError, ServeRouter


class ErrorRoutes:
    async def fail(self, status: int) -> None:
        if status == 429:
            raise ServeError(
                429, "RATE_LIMITED", "Rate limit exceeded", headers={"Retry-After": "1"}
            )
        if status == 503:
            raise ServeError(503, "SERVICE_UNAVAILABLE", "Temporarily unavailable")
        if status == 500:
            raise RuntimeError("GATE_PRIVATE_DRIVER_TEXT")
        raise ServeError(404, "NOT_FOUND", "No test case")

    def install(self, router: ServeRouter) -> None:
        router.add_api_route("/v1/failure/{status}", self.fail, methods=["POST"])
