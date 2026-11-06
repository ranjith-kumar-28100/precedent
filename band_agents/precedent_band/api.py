"""Thin async HTTP client for the Precedent backend."""
import os

import httpx

BASE = os.environ.get("PRECEDENT_API", "http://localhost:8000")


class PrecedentApi:
    def __init__(self, base: str = BASE):
        self.base = base.rstrip("/") + "/api"
        self._vendors: list[dict] | None = None

    async def _req(self, method: str, path: str, **kw):
        async with httpx.AsyncClient(timeout=180) as c:
            r = await c.request(method, self.base + path, **kw)
            r.raise_for_status()
            return r.json()

    async def vendors(self):
        if self._vendors is None:
            self._vendors = await self._req("GET", "/vendors")
        return self._vendors

    async def brief(self, vendor_id, objective, use_memory):
        return await self._req("POST", "/brief", json={"vendor_id": vendor_id, "objective": objective,
                                                       "context": "", "use_memory": use_memory})

    async def outcome(self, payload):
        return await self._req("POST", "/outcome", json=payload)

    async def memory(self, vendor_id):
        return await self._req("GET", f"/memory/{vendor_id}")
