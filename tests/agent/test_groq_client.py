from types import SimpleNamespace as NS

from analyzer.agent.groq_client import GroqClient


def chunk(content=None, calls=None):
    return NS(choices=[NS(delta=NS(content=content, tool_calls=calls))])


def tc(index, id=None, name=None, args=None):
    return NS(index=index, id=id, function=NS(name=name, arguments=args))


class FakeSDK:
    def __init__(self, chunks):
        self.chunks, self.kwargs = chunks, None
        self.chat = NS(completions=NS(create=self.create))

    def create(self, **kw):
        self.kwargs = kw
        return iter(self.chunks)


def test_streaming_tool_call_accumulation_across_chunks():
    sdk = FakeSDK([
        NS(choices=[]),  # usage-only chunk is ignored
        chunk("Let me "), chunk("look."),
        chunk(calls=[tc(0, "call_a", "get_history", '{"met')]),
        chunk(calls=[tc(1, "call_b", "search_messages", "")]),
        chunk(calls=[tc(0, None, None, 'ric": "message_share"}')]),
        chunk(calls=[tc(1, None, None, '{"query": "hi"}')]),
    ])
    out = list(GroqClient("k", "m", client=sdk).chat([{"role": "user", "content": "x"}],
                                                      [{"type": "function", "function": {"name": "t"}}]))
    assert [d for d in out if d["type"] == "token"] == [{"type": "token", "text": "Let me "},
                                                         {"type": "token", "text": "look."}]
    calls = out[-1]
    assert calls["type"] == "tool_calls" and out.count(calls) == 1
    assert calls["calls"] == [
        {"id": "call_a", "name": "get_history", "arguments": '{"metric": "message_share"}'},
        {"id": "call_b", "name": "search_messages", "arguments": '{"query": "hi"}'}]
    assert sdk.kwargs["stream"] is True and sdk.kwargs["tool_choice"] == "auto"


def test_streaming_text_only_yields_no_tool_calls():
    out = list(GroqClient("k", "m", client=FakeSDK([chunk("hi")])).chat([], []))
    assert out == [{"type": "token", "text": "hi"}]
