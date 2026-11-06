"""Thin Band wiring: turns an async text->text handler into a no-LLM LangGraph agent."""
from typing import Awaitable, Callable

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, MessagesState, StateGraph

from .commands import split_sender, strip_mentions


def make_graph_factory(handler: Callable[[str], Awaitable[str]]):
    def build_graph(band_tools):
        post = next(t for t in band_tools if t.name == "band_send_message")

        async def respond(state: MessagesState):
            if not state["messages"]:
                return {"messages": []}
            sender, body = split_sender(str(state["messages"][-1].content))
            try:
                reply = await handler(strip_mentions(body))
            except Exception as e:  # keep the agent alive; report in-room
                reply = f"Error talking to Precedent API: {e}"
            await post.ainvoke({"content": reply, "mentions": [sender] if sender else []})
            return {"messages": []}

        g = StateGraph(MessagesState)
        g.add_node("respond", respond)
        g.add_edge(START, "respond")
        g.add_edge("respond", END)
        return g.compile(checkpointer=InMemorySaver())

    return build_graph
