"""LLMゲートウェイ・registry・routing の unit（FR-45・設計 §3・doc/テスト/S_AIジョブ.md §6）。

外部 LLM 未接続＝FakeChat 注入（決定的）。物理モデル名は config 由来（キーは dev/prod 同一）。
"""
from __future__ import annotations

import pytest

from app.core.config import get_settings
from app.infra.llm import gateway, registry


def test_s_tc_201_registry_phase1_keys():
    """S-TC-201: Phase1 の論理キーが存在・free・enabled・物理は config 由来。"""
    s = get_settings()
    light = registry.get("qwen3-light")
    swallow = registry.get("qwen3-swallow")
    assert light.provider == "openai_compat" and light.billing == "free" and light.enabled
    assert light.external is False and light.model == s.llm_model_light
    assert swallow.model == s.llm_model_swallow and swallow.billing == "free"


def test_s_tc_202_routing_priority():
    """S-TC-202: 明示 model ＞ task_type 既定 ＞ グローバル既定。"""
    assert registry.resolve_key("info_summarize", None) == "qwen3-light"       # task 既定
    assert registry.resolve_key("info_summarize", "qwen3-swallow") == "qwen3-swallow"  # 明示優先
    assert registry.resolve_key("unknown_task", None) == "qwen3-light"          # グローバル既定


def test_s_tc_203_guardrail_unknown_key():
    """S-TC-203: registry に無いキーは LLMConfigError（422 に写像）。"""
    with pytest.raises(gateway.LLMConfigError):
        registry.resolve_key("info_summarize", "bogus")
    with pytest.raises(gateway.LLMConfigError):
        registry.get("bogus")


def test_s_tc_204_fakechat_deterministic():
    """S-TC-204: FakeChat＝決定的な要約テキスト＋usage を返す（provider/model が解決結果と一致）。"""
    gateway.set_chat_client(gateway.FakeChat())
    try:
        messages = [
            {"role": "system", "content": "要約せよ"},
            {"role": "user", "content": "競合A社が値下げした 詳細は続く"},
        ]
        r = gateway.complete("info_summarize", messages)
        assert r.text and r.text.startswith("[要約]")
        assert r.input_tokens > 0 and r.output_tokens > 0
        assert r.provider == "openai_compat"
        assert r.model == get_settings().llm_model_light  # info_summarize 既定=qwen3-light の物理
        assert r.finish_reason == "stop"
        # 決定的＝同入力で同結果
        assert gateway.complete("info_summarize", messages).text == r.text
    finally:
        gateway.set_chat_client(None)


def test_s_tc_205_unavailable_on_unreachable():
    """S-TC-205: 実プロバイダ到達不能は LLMUnavailable。"""
    client = gateway.OpenAICompatibleChat(base_url="http://127.0.0.1:1/v1", timeout=0.2)
    with pytest.raises(gateway.LLMUnavailable):
        client.complete([{"role": "user", "content": "x"}], model="dummy")


def test_s_tc_206_list_models_enabled_set():
    """S-TC-206: list_models＝会社の有効集合で絞る・既定フラグ・billing/external 付き。"""
    # 会社で qwen3-light のみ ON。
    models = registry.list_models("info_summarize", enabled_keys={"qwen3-light"})
    keys = [m["key"] for m in models]
    assert keys == ["qwen3-light"]  # swallow は会社 OFF で出ない
    m = models[0]
    assert m["is_default"] is True and m["billing"] == "free" and m["external"] is False
    # enabled_keys=None なら registry 既定 enabled 全部（light+swallow）。
    all_keys = {m["key"] for m in registry.list_models("info_summarize")}
    assert {"qwen3-light", "qwen3-swallow"} <= all_keys
