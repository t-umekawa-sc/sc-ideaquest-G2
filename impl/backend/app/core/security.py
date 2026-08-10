"""セキュリティ基盤（§3.4 core/security.py＝Argon2id・セッション・CSRF）。

- パスワードハッシュ＝Argon2id（m=19MiB, t=2, p=1・OWASP 下限ベースライン・ADR-0001 §2.5）。
- 不透明トークン（セッション/CSRF）＝CSPRNG（A.0）。
- セッションストア＝Redis `sess:{token}`（idle スライディング/絶対上限・ADR-0001 §2.2）。
- ログインのレート制限＝(IP+login_id) 固定窓（ADR-0001 §2.6）。
CSRF ヘッダ一致の検証は core/deps.py（リクエストガード）側で行う。
"""
from __future__ import annotations

import hashlib
import json
import secrets
import time

import redis
from argon2 import PasswordHasher
from argon2 import exceptions as argon2_exc

from app.core.config import get_settings
from app.core.errors import AppError

# --- パスワード（Argon2id・ADR §2.5） -------------------------------------------------
_ph = PasswordHasher(memory_cost=19456, time_cost=2, parallelism=1)
# 存在しないアカウントでもタイミング差を作らないためのダミーハッシュ
_DUMMY_HASH = _ph.hash("x" * 24)


def hash_password(password: str) -> str:
    return _ph.hash(password)


def verify_password(password: str, password_hash: str | None) -> bool:
    """PW 照合。password_hash が None（未設定）でも必ずダミー照合を行い時間差を作らない。"""
    target = password_hash or _DUMMY_HASH
    try:
        _ph.verify(target, password)
    except (argon2_exc.VerifyMismatchError, argon2_exc.InvalidHashError):
        return False
    # 未設定アカウントは照合成功扱いにしない（列挙耐性・A.1）
    return password_hash is not None


def generate_token(n_bytes: int = 32) -> str:
    """CSPRNG による不透明トークン（意味を埋め込まない・A.0）。"""
    return secrets.token_urlsafe(n_bytes)


def generate_otp(length: int) -> str:
    """CSPRNG による数字 OTP（先頭ゼロ許容・ADR-0004 §2.2）。低エントロピーは失敗上限＋TTL で守る。"""
    return str(secrets.randbelow(10 ** length)).zfill(length)


def hash_token(token: str) -> str:
    """高エントロピー乱数トークンのハッシュ（SHA-256 hex・ADR-0002 §2.1）。

    設定リンクトークン/OTP は 256bit 乱数で総当り不能なため、遅いハッシュ（Argon2）は不要。
    保存・照合はハッシュのみで行い、平文は永続化しない（セキュリティ一覧 3）。
    """
    return hashlib.sha256(token.encode()).hexdigest()


# --- セッションストア（Redis・ADR §2.2） -----------------------------------------------
_SESS_PREFIX = "sess:"
_ACCT_SESS_PREFIX = "acct_sess:"  # account_id -> そのアカウントの有効セッショントークン集合


def _sess_key(token: str) -> str:
    return f"{_SESS_PREFIX}{token}"


def _acct_sess_key(account_id: str) -> str:
    return f"{_ACCT_SESS_PREFIX}{account_id}"


def create_session(r: redis.Redis, payload: dict) -> str:
    """新しいセッションを作成しトークンを返す。認証成功のたびに新トークン（固定化対策・A.0）。

    account_id ごとの逆引き集合（`acct_sess:{account_id}`）にもトークンを登録する。
    PW再設定完了・logout-all 等の「全セッション破棄」（A.9-③）で列挙するため。
    """
    s = get_settings()
    token = generate_token()
    data = {**payload, "created_at": int(time.time())}
    r.set(_sess_key(token), json.dumps(data), ex=s.session_idle_ttl_seconds)
    account_id = payload.get("account_id")
    if account_id:
        akey = _acct_sess_key(account_id)
        r.sadd(akey, token)
        # 逆引き集合は絶対上限で失効（掃除しきれない残骸を溜めない）
        r.expire(akey, s.session_absolute_ttl_seconds)
    return token


def delete_account_sessions(r: redis.Redis, account_id: str) -> int:
    """当該アカウントの全アクティブセッションを破棄（A.9-③）。破棄件数を返す。"""
    akey = _acct_sess_key(account_id)
    tokens = r.smembers(akey)
    for token in tokens:
        r.delete(_sess_key(token))
    r.delete(akey)
    return len(tokens)


def read_session(r: redis.Redis, token: str) -> dict | None:
    """セッション取得。絶対TTL 超過なら破棄して None。生存ならアイドルTTLをスライディング延長。"""
    s = get_settings()
    raw = r.get(_sess_key(token))
    if raw is None:
        return None
    data = json.loads(raw)
    if int(time.time()) - int(data.get("created_at", 0)) > s.session_absolute_ttl_seconds:
        r.delete(_sess_key(token))
        return None
    r.expire(_sess_key(token), s.session_idle_ttl_seconds)
    return data


def delete_session(r: redis.Redis, token: str) -> None:
    raw = r.get(_sess_key(token))
    if raw is not None:
        account_id = json.loads(raw).get("account_id")
        if account_id:
            r.srem(_acct_sess_key(account_id), token)
    r.delete(_sess_key(token))


# --- pre-auth ／ OTP（Redis・ADR-0004 §2.2） -------------------------------------------
# pre-auth は「未MFA中間状態」＝本セッションと別実体・最小権限（A.0）。login OTP も同レコードに
# 一体で保持（10分の揮発値・自動失効・otp_challenges テーブルは password_setup 専用に留める）。
_PREAUTH_PREFIX = "preauth:"


def _preauth_key(token: str) -> str:
    return f"{_PREAUTH_PREFIX}{token}"


def create_preauth(r: redis.Redis, account_id: str, company_id: str, otp_hash: str) -> str:
    """pre-auth を作成しトークンを返す。OTP ハッシュ・失敗回数・resend 可能時刻を内包する。"""
    s = get_settings()
    token = generate_token()
    now = int(time.time())
    data = {
        "account_id": account_id,
        "company_id": company_id,
        "otp_hash": otp_hash,
        "otp_expires_at": now + s.otp_ttl_seconds,
        "attempts": 0,
        "resend_available_at": now + s.otp_resend_cooldown_seconds,
    }
    r.set(_preauth_key(token), json.dumps(data), ex=s.preauth_ttl_seconds)
    return token


def read_preauth(r: redis.Redis, token: str | None) -> dict | None:
    if not token:
        return None
    raw = r.get(_preauth_key(token))
    return json.loads(raw) if raw is not None else None


def save_preauth(r: redis.Redis, token: str, data: dict) -> None:
    """更新を書き戻す。**TTL は据え置き**（pre-auth の 10分上限を resend 等で延ばさない・ADR-0004 §2.2）。"""
    r.set(_preauth_key(token), json.dumps(data), keepttl=True)


def delete_preauth(r: redis.Redis, token: str) -> None:
    r.delete(_preauth_key(token))


# --- ログインのレート制限（Redis 固定窓・ADR §2.6） -------------------------------------
def check_login_rate_limit(r: redis.Redis, ip: str, login_id: str) -> None:
    """(IP+login_id) 単位の固定窓。上限超過で 429。総当りの一次抑止（ロックは MFA スライス）。"""
    s = get_settings()
    key = f"login_fail:{ip}:{login_id}"
    count = r.incr(key)
    if count == 1:
        r.expire(key, s.login_rate_limit_window_seconds)
    if count > s.login_rate_limit_max:
        raise AppError(429, "rate_limited", detail=f"retry after {r.ttl(key)}s")


# --- アカウント一時ロック（Redis・第二層防御・ADR-0005） --------------------------------
# 失敗計数・ロック・通知クールダウンはいずれも短命の揮発値で自動解除（TTL）が本質＝Redis に置く
# （ADR-0005 §2.7）。ロックは (IP+login_id) 単位＝攻撃元 IP からの当該 ID への試行だけを止め、
# 被害者本人（別 IP）のログインは妨げない＝可用性 DoS を回避（§2.2）。
def _lock_streak_key(ip: str, login_id: str) -> str:
    return f"login_fail_streak:{ip}:{login_id}"


def _lock_key(ip: str, login_id: str) -> str:
    return f"login_lock:{ip}:{login_id}"


def is_login_locked(r: redis.Redis, ip: str, login_id: str) -> bool:
    """(IP+login_id) がロック中か。ロック中は資格照合に到達させない（§2.3）。"""
    return r.exists(_lock_key(ip, login_id)) == 1


def register_login_failure(r: redis.Redis, ip: str, login_id: str) -> bool:
    """認証失敗を (IP+login_id) 単位で計数。閾値到達でロックを張り True（新規発火）を返す。

    ロック TTL は発火時に一度だけ設定＝以後の追加試行で延長しない（§2.2）。本関数は
    `is_login_locked` が偽（未ロック）のときのみ呼ばれる前提（発火判定は count==max の一度きり）。
    """
    s = get_settings()
    streak_key = _lock_streak_key(ip, login_id)
    count = r.incr(streak_key)
    if count == 1:
        r.expire(streak_key, s.login_lock_ttl_seconds)  # 計数窓＝ロック期間と同じ
    if count >= s.login_lock_max_attempts:
        r.set(_lock_key(ip, login_id), "1", ex=s.login_lock_ttl_seconds)
        r.delete(streak_key)  # 発火でリセット（§2.2）
        return True
    return False


def clear_login_lock(r: redis.Redis, ip: str, login_id: str) -> None:
    """認証成功で当該 (IP+login_id) の失敗計数とロックを解除（§2.2）。"""
    r.delete(_lock_streak_key(ip, login_id), _lock_key(ip, login_id))


def clear_login_locks_for_login_id(r: redis.Redis, login_id: str) -> None:
    """PW 再設定成功時に当該 login_id のロック/計数を一掃（§2.5(b)）。

    (IP+login_id) 単位ゆえ IP は不定なので SCAN で全 IP 分を削除する（PW 再設定は稀イベント）。
    """
    for pattern in (f"login_fail_streak:*:{login_id}", f"login_lock:*:{login_id}"):
        for key in r.scan_iter(match=pattern):
            r.delete(key)


def should_send_lock_notification(r: redis.Redis, account_id: str) -> bool:
    """ロック通知メールのスロットル（§2.4）。1通/`login_lock_notify_cooldown_seconds`/account。

    送信可なら True を返し、同時にクールダウンキーを張る（NX+EX で原子的）。メール爆撃対策で、
    IP を回されての再発火では 2 通目以降を送らない。
    """
    s = get_settings()
    key = f"lock_notified:{account_id}"
    return bool(r.set(key, "1", nx=True, ex=s.login_lock_notify_cooldown_seconds))


def within_pw_request_rate_limit(r: redis.Redis, ip: str, company_code: str, login_id: str) -> bool:
    """PW再設定要求のレート制限（ADR-0002 §2.3）。超過なら False を返す（例外は投げない）。

    列挙耐性のため、超過しても応答は 202 のまま（呼び出し側が送信だけをスキップする）。
    ログインの 429（例外）とは扱いが異なる。
    """
    s = get_settings()
    key = f"pw_req:{ip}:{company_code}:{login_id}"
    count = r.incr(key)
    if count == 1:
        r.expire(key, s.pw_request_rate_limit_window_seconds)
    return count <= s.pw_request_rate_limit_max
