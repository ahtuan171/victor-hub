"""The one place that talks to Hugging Face.

`httpx2` against the OpenAI-compatible router endpoint rather than the `huggingface_hub`
`InferenceClient`: the router speaks a shape this project already knows, it adds no dependency
(httpx2 is already here for Nominatim), and it keeps mypy's `disallow_any_unimported` happy
without chasing stubs for an SDK used for exactly one call.

Async because a model round trip is seconds, not milliseconds, and a sync call would hold a
threadpool worker for the whole of it.
"""

from typing import Any

import httpx2 as httpx

from app.config import get_settings

# Hugging Face Inference Providers, OpenAI-compatible surface.
HF_ROUTER_URL = "https://router.huggingface.co/v1/chat/completions"

# Generous: a cold provider plus a long generation. The frontend shows a working state for the
# duration, so the cost of waiting is visible rather than mysterious.
TIMEOUT_SECONDS = 120.0


class AIError(Exception):
    """Raised when the provider cannot be reached, refuses the request, or answers with a body
    this module cannot read.

    One exception type for every upstream failure: the route turns it into a 502 with the message
    intact, and the console renders that message. A caller never needs to tell the failures apart —
    they all mean "no answer this time".
    """


def _require_config() -> tuple[str, str]:
    """Token and model, or a message naming exactly what is missing.

    The same shape as the R2 settings check: an unconfigured provider fails with an instruction,
    not with a stack trace from inside an HTTP library.
    """
    settings = get_settings()
    missing = [
        name
        for name, value in (("HF_TOKEN", settings.hf_token), ("HF_MODEL", settings.hf_model))
        if not value.strip()
    ]
    if missing:
        raise AIError(
            "Travel Intelligence is not configured. Set "
            + " and ".join(missing)
            + " in the repository .env, then restart the backend."
        )
    return settings.hf_token, settings.hf_model


def _extract_content(payload: Any) -> str:
    """Pull the assistant message out of a chat-completions body, defensively.

    Providers behind the router are not uniform, and a malformed body should surface as an AIError
    the console can show rather than a KeyError in the server log.
    """
    if not isinstance(payload, dict):
        raise AIError("The model provider returned an unexpected response body.")

    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        error = payload.get("error")
        if error:
            raise AIError(f"The model provider refused the request: {error}")
        raise AIError("The model provider returned no completion.")

    message = choices[0].get("message") if isinstance(choices[0], dict) else None
    content = message.get("content") if isinstance(message, dict) else None

    if not isinstance(content, str) or not content.strip():
        # Measured 2026-08-22: every Qwen3 model on the router runs with thinking mode on and no
        # way to turn it off from the request — `chat_template_kwargs: {enable_thinking: false}`
        # is accepted and ignored. The reasoning lands in `reasoning_content` and eats the token
        # budget, so a short `max_tokens` returns a completion whose visible half is empty. Saying
        # that outright beats "empty completion", which sends the reader looking at the prompt.
        reasoning = message.get("reasoning_content") if isinstance(message, dict) else None
        if isinstance(reasoning, str) and reasoning.strip():
            raise AIError(
                "The model spent its whole token budget on internal reasoning and returned no "
                "answer. This model runs in thinking mode. Set HF_MODEL to a non-thinking model "
                "(Qwen/Qwen2.5-72B-Instruct or meta-llama/Llama-3.1-8B-Instruct), or raise "
                "max_tokens."
            )
        raise AIError("The model returned an empty completion.")

    return content.strip()


async def complete(messages: list[dict[str, str]], *, max_tokens: int = 800) -> str:
    """Send a conversation, return the assistant's reply as text.

    `messages` is already in provider shape — `{"role": ..., "content": ...}` — because the caller
    is the only place that decides what a conversation contains, and translating twice would put
    that decision in two files.
    """
    token, model = _require_config()

    try:
        async with httpx.AsyncClient(timeout=TIMEOUT_SECONDS) as client:
            response = await client.post(
                HF_ROUTER_URL,
                headers={"Authorization": f"Bearer {token}"},
                json={
                    "model": model,
                    "messages": messages,
                    "max_tokens": max_tokens,
                    # Low but not zero: the voice should be consistent between runs without the
                    # answers becoming identical boilerplate.
                    "temperature": 0.4,
                },
            )
    except httpx.TimeoutException as exc:
        raise AIError(
            f"The model provider did not answer within {int(TIMEOUT_SECONDS)} seconds."
        ) from exc
    except httpx.HTTPError as exc:
        raise AIError(f"Could not reach the model provider: {exc}") from exc

    if response.status_code == 401:
        raise AIError("Hugging Face rejected HF_TOKEN. Check the token and its permissions.")
    if response.status_code == 404:
        raise AIError(
            f"No provider serves '{model}'. Pick a different HF_MODEL — check the model page on "
            "huggingface.co for which inference providers are available."
        )
    if response.status_code >= 400:
        raise AIError(f"The model provider answered {response.status_code}: {response.text[:300]}")

    try:
        payload: Any = response.json()
    except ValueError as exc:
        raise AIError("The model provider answered with something that is not JSON.") from exc

    return _extract_content(payload)


__all__ = ["AIError", "complete"]
