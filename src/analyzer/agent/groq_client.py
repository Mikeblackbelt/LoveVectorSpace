"""Thin wrapper over the official `groq` SDK (OpenAI-compatible chat.completions).

Verified against the installed SDK signature: create(model, messages, tools, tool_choice, stream,
max_completion_tokens, temperature, parallel_tool_calls). Tools are
[{"type": "function", "function": {"name", "description", "parameters"}}], tool_choice="auto",
and tool results go back as {"role": "tool", "tool_call_id", "content"}.

`chat` yields normalised deltas so the loop (and test fakes) never touch SDK types:
  {"type": "token", "text": str}
  {"type": "tool_calls", "calls": [{"id", "name", "arguments": str}]}   (once, at the end)
"""
from __future__ import annotations

import os
from collections.abc import Iterator
from typing import Any

DEFAULT_MODEL = "llama-3.3-70b-versatile"  # overridden by GROQ_MODEL


class GroqClient:
    def __init__(self, api_key: str, model: str | None = None, client: Any = None):
        self.model = model or os.environ.get("GROQ_MODEL") or DEFAULT_MODEL
        if client is None:
            from groq import Groq
            client = Groq(api_key=api_key)
        self._client = client

    def chat(self, messages: list[dict], tools: list[dict], stream: bool = True) -> Iterator[dict]:
        kwargs: dict[str, Any] = {"model": self.model, "messages": messages, "stream": stream,
                                  "temperature": 0.4}
        if tools:
            kwargs["tools"] = tools
            kwargs["tool_choice"] = "auto"
        resp = self._client.chat.completions.create(**kwargs)
        if not stream:
            msg = resp.choices[0].message
            if msg.content:
                yield {"type": "token", "text": msg.content}
            if msg.tool_calls:
                yield {"type": "tool_calls", "calls": [
                    {"id": c.id, "name": c.function.name, "arguments": c.function.arguments or "{}"}
                    for c in msg.tool_calls]}
            return
        acc: dict[int, dict] = {}
        for chunk in resp:
            if not chunk.choices:
                continue
            delta = chunk.choices[0].delta
            if getattr(delta, "content", None):
                yield {"type": "token", "text": delta.content}
            for tc in getattr(delta, "tool_calls", None) or []:
                slot = acc.setdefault(tc.index, {"id": "", "name": "", "arguments": ""})
                if tc.id:
                    slot["id"] = tc.id
                if tc.function:
                    slot["name"] += tc.function.name or ""
                    slot["arguments"] += tc.function.arguments or ""
        if acc:
            yield {"type": "tool_calls", "calls": [acc[i] for i in sorted(acc)]}


def client_factory_from_env():
    """Zero-arg factory yielding a GroqClient, or None when GROQ_API_KEY is unset."""
    key = os.environ.get("GROQ_API_KEY")
    if not key:
        return None
    return lambda: GroqClient(key, os.environ.get("GROQ_MODEL"))
