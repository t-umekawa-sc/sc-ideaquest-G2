"""論理モデルキー registry＝キー→物理（provider/model/params/external/billing/enabled）（FR-45・設計 §3.4/§4.1）。

**なぜキー方式**＝機能側が provider/base_url/量子化などの物理を知ると抽象化が崩れ dev/prod 差で壊れる。
論理キー（例 `qwen3-light`）なら機能側は"どの LLM か"だけを選び、物理は本 registry（config 由来）に閉じる。
キー名は dev/prod 同一・物理モデル名だけ config（env）で差し替える。

**カタログ（本 registry）と会社有効化（`company_ai_model_settings`・§5.58）の2階層**＝本 registry は
"存在し得る全キー"、会社で実際に使えるかは会社 ON/OFF で決まる。`list_models` は会社の有効集合で絞る。
"""
from __future__ import annotations

from dataclasses import dataclass, field

from app.core.config import get_settings


@dataclass(frozen=True)
class ModelSpec:
    """論理モデルキー1件の解決結果（物理＋メタ）。"""

    key: str
    provider: str          # 'openai_compat'（Phase1）／将来 'anthropic' 等
    model: str             # 物理モデル名（config 由来・dev/prod で可変）
    external: bool         # True=外部クラウド送信（opt-in ゲート・設計 §10）
    billing: str           # 'free'（自社ホスト）/'paid'（外部従量）
    enabled: bool          # registry 既定の有効性（会社 ON/OFF は別レイヤ §5.58）
    label: str = ""        # ピッカー表示名（key を出さず表示名で選ばせる・設計§9.2）
    description: str = ""  # 用途説明（ピッカー副文・設計§9.2）
    params: dict = field(default_factory=dict)  # 温度/最大トークン等の既定


# task_type → 既定の論理キー（設計 §3.3）。明示 model が無ければこれを使う。
_TASK_DEFAULTS: dict[str, str] = {
    "info_summarize": "qwen3-light",   # 初版の縦1本
    "iso_generate": "qwen3-swallow",   # 2本目（高品質日本語）
    "strategy_align_semantic": "qwen3-light",
    "info_contradiction": "qwen3-light",
    "concept_premise_check": "qwen3-light",
}

# 論理キーが解決できない task_type / 明示なしのグローバル既定。
_GLOBAL_DEFAULT_KEY = "qwen3-light"


def _catalog() -> dict[str, ModelSpec]:
    """論理キーのカタログ（物理は config 由来＝毎回組み立て＝env 差し替えに追随）。"""
    s = get_settings()
    return {
        "qwen3-light": ModelSpec(
            key="qwen3-light", provider="openai_compat", model=s.llm_model_light,
            external=False, billing="free", enabled=True,
            label="高速（軽量）",
            description="要約・短文整形・分類など軽めの処理に向く。",
            params={"temperature": 0.3},
        ),
        "qwen3-swallow": ModelSpec(
            key="qwen3-swallow", provider="openai_compat", model=s.llm_model_swallow,
            external=False, billing="free", enabled=True,
            label="高品質（日本語）",
            description="アイデア整形・説明文生成・長めの要約に向く。",
            params={"temperature": 0.4},
        ),
    }


def catalog_billing() -> dict[str, str]:
    """論理キー→billing（free/paid）。会社の実効有効集合を app 層が組むのに使う（§4.2）。"""
    return {k: s.billing for k, s in _catalog().items()}


def catalog_meta() -> dict[str, dict]:
    """論理キー→表示メタ（billing/label/description）。管理一覧（admin）が表示名を付すのに使う（DRY・§9.2）。"""
    return {k: {"billing": s.billing, "label": s.label, "description": s.description}
            for k, s in _catalog().items()}


def get(key: str) -> ModelSpec:
    """論理キーの解決（存在しない/無効は LLMConfigError）。"""
    from app.infra.llm.gateway import LLMConfigError  # 遅延 import（循環回避）

    spec = _catalog().get(key)
    if spec is None or not spec.enabled:
        raise LLMConfigError(f"unknown or disabled model key: {key}")
    return spec


def resolve_key(task_type: str, requested: str | None) -> str:
    """解決優先順位＝① 明示 requested ＞ ② task_type 既定 ＞ ③ グローバル既定（設計 §3.4）。

    明示 requested はカタログに存在し enabled であること（不正/無効は LLMConfigError）。
    """
    if requested:
        get(requested)  # 存在/有効性の検証（副作用で例外）
        return requested
    return _TASK_DEFAULTS.get(task_type, _GLOBAL_DEFAULT_KEY)


def resolve(task_type: str, requested: str | None) -> ModelSpec:
    """task_type と任意の明示キーから物理 ModelSpec を解決する（gateway が呼ぶ）。"""
    return get(resolve_key(task_type, requested))


def list_models(task_type: str | None = None, *, enabled_keys: set[str] | None = None) -> list[dict]:
    """`GET /ai-models` 用＝会社で有効な論理キーを返す（設計 §3.4・S.2）。

    `enabled_keys`＝会社 ON の集合（`company_ai_model_settings` 由来）。None なら registry 既定 enabled のみ。
    `task_type` 指定時はその既定キーに `is_default` を立てる。
    """
    default_key = _TASK_DEFAULTS.get(task_type, _GLOBAL_DEFAULT_KEY) if task_type else None
    out: list[dict] = []
    for key, spec in _catalog().items():
        if not spec.enabled:
            continue
        if enabled_keys is not None and key not in enabled_keys:
            continue
        out.append({
            "key": spec.key,
            "provider": spec.provider,
            "external": spec.external,
            "billing": spec.billing,
            "label": spec.label,
            "description": spec.description,
            "is_default": key == default_key,
        })
    return out
