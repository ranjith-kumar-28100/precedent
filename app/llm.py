"""Agent LLM client: any OpenAI-compatible chat-completions endpoint (Azure OpenAI v1) over httpx."""
import json
import re
import time

import httpx

from . import config


CALLS = {"agent": 0}
SPEND = {"usd": 0.0, "prompt": 0, "completion": 0}
# list prices per million tokens for the agent model (override in .env if your region differs)
_PRICE_IN, _PRICE_OUT = float(config.env("AGENT_PRICE_IN_PER_M", "2.0")), float(config.env("AGENT_PRICE_OUT_PER_M", "8.0"))
BUDGET_USD = float(config.env("AGENT_BUDGET_USD", "3.0"))


class BudgetExceeded(RuntimeError):
    pass


def _meter(usage: dict) -> None:
    SPEND["prompt"] += usage.get("prompt_tokens", 0)
    SPEND["completion"] += usage.get("completion_tokens", 0)
    SPEND["usd"] = (SPEND["prompt"] * _PRICE_IN + SPEND["completion"] * _PRICE_OUT) / 1e6


def _endpoint() -> tuple[str, dict]:
    headers = {"Content-Type": "application/json", "api-key": config.LLM_API_KEY,
               "Authorization": f"Bearer {config.LLM_API_KEY}"}
    return f"{config.LLM_BASE_URL.rstrip('/')}/chat/completions", headers


def chat(messages: list[dict], *, json_mode: bool = False, temperature: float = 0.2,
         max_tokens: int = 1200, timeout: float = 240) -> str:
    url, headers = _endpoint()
    body = {"model": config.LLM_MODEL, "messages": messages, "temperature": temperature,
            "max_tokens": max_tokens}
    if json_mode:
        body["response_format"] = {"type": "json_object"}
    r = httpx.post(url, headers=headers, json=body, timeout=timeout)
    r.raise_for_status()
    return r.json()["choices"][0]["message"]["content"] or ""


def parse_json(text: str) -> dict:
    """Small models wrap JSON in prose or fences; pull out the first object."""
    text = re.sub(r"<think>.*?</think>", "", text, flags=re.S)
    m = re.search(r"\{.*\}", text, flags=re.S)
    if not m:
        raise ValueError(f"no JSON object in: {text[:200]!r}")
    return json.loads(m.group(0))


def chat_json(messages: list[dict], retries: int = 2, **kw) -> dict:
    last: Exception | None = None
    for _ in range(retries + 1):
        try:
            return parse_json(chat(messages, json_mode=True, **kw))
        except (ValueError, json.JSONDecodeError, httpx.HTTPError) as e:
            last = e
    raise RuntimeError(f"LLM did not return valid JSON: {last}")


def chat_message(messages: list[dict], tools: list[dict] | None = None, *, temperature: float = 0.2,
                 max_tokens: int = 1400, timeout: float = 240) -> dict:
    """One chat turn that may return tool calls. Returns the raw assistant message dict."""
    url, headers = _endpoint()
    body = {"model": config.LLM_MODEL, "messages": messages, "temperature": temperature,
            "max_tokens": max_tokens}
    if tools:
        body["tools"] = tools
        body["tool_choice"] = "auto"
    if SPEND["usd"] >= BUDGET_USD:
        raise BudgetExceeded(f"agent LLM budget of ${BUDGET_USD:.2f} reached; raise AGENT_BUDGET_USD to continue")
    for attempt in range(6):  # throttled (429/5xx) or dropped connection (laptop sleep, wifi): back off, retry
        try:
            CALLS["agent"] += 1
            r = httpx.post(url, headers=headers, json=body, timeout=timeout)
        except httpx.TransportError:
            time.sleep(min(30, 3 * 2 ** attempt))
            continue
        if r.status_code in (429, 500, 502, 503):
            time.sleep(min(30, 3 * 2 ** attempt))
            continue
        r.raise_for_status()
        data = r.json()
        _meter(data.get("usage") or {})
        return data["choices"][0]["message"]
    raise RuntimeError("LLM unavailable after retries")
