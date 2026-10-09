"""Local credential initialization without replacing existing configuration."""
import argparse
import hashlib
import json
import os
import secrets
import sys
from pathlib import Path


def reset_user(parser, user_id):
    if "AUTH_USERS_JSON" in os.environ:
        parser.error("AUTH_USERS_JSON 환경 변수가 파일보다 우선합니다. PowerShell에서 Remove-Item Env:AUTH_USERS_JSON 후 다시 실행하세요.")
    path = Path(".env.security")
    if not path.is_file():
        parser.error("기존 로그인 설정이 없습니다. npm start로 먼저 시작하세요.")
    from dotenv import dotenv_values, set_key
    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
    from backend.app.security import Account

    try:
        records = json.loads(dotenv_values(path, interpolate=False).get("AUTH_USERS_JSON", ""))
        if not isinstance(records, list) or not 1 <= len(records) <= 50:
            raise ValueError
        accounts = [Account.model_validate(record) for record in records]
        if len({item.user_id for item in accounts}) != len(accounts) or len({item.key_hash for item in accounts}) != len(accounts):
            raise ValueError
    except (OSError, ValueError, TypeError):
        parser.error("기존 계정 설정을 읽거나 검증하지 못했습니다. 파일을 변경하지 않았습니다.")
    selected = [record for record in records if record["user_id"] == user_id]
    if len(selected) != 1:
        parser.error("재발급할 사용자가 없습니다. 기존 계정과 Kafka 설정은 변경하지 않았습니다.")
    key = secrets.token_urlsafe(32)
    selected[0]["key_hash"] = hashlib.sha256(key.encode()).hexdigest()
    try:
        set_key(path, "AUTH_USERS_JSON", json.dumps(records), quote_mode="always")
    except OSError:
        parser.error("새 키를 저장하지 못했습니다. 파일 권한을 확인하세요.")
    print("개인 접근 키를 새로 발급했습니다. 이전 키는 재시작한 앱에서 사용할 수 없습니다.")
    print(f"User ID: {user_id}\nAccess key: {key}\n")
    print("이 Access key를 로그인 화면에 입력하고 안전한 곳에 보관하세요. 키 원문은 파일이나 로그에 저장하지 않습니다.")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default="http://127.0.0.1:5173")
    parser.add_argument("--reset-user", help="기존 사용자의 개인 키만 재발급")
    args = parser.parse_args()
    if args.reset_user:
        reset_user(parser, args.reset_user)
        return
    from urllib.parse import urlparse
    parsed = urlparse(args.origin)
    if parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.path or parsed.query or parsed.fragment or parsed.username:
        parser.error("Origin must have scheme and host, with no path")
    if parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
        parser.error("Non-loopback origin requires HTTPS")
    credentials = [("operator", "operator", secrets.token_urlsafe(32)), ("viewer", "viewer", secrets.token_urlsafe(32))]
    accounts = [{"user_id": user, "role": role, "key_hash": hashlib.sha256(key.encode()).hexdigest()} for user, role, key in credentials]
    lines = [f"APP_PUBLIC_ORIGIN={args.origin}", "AUTH_SESSION_SECONDS=1800",
             "AUTH_USERS_JSON='" + json.dumps(accounts) + "'", "KAFKA_SECURITY_PROTOCOL=SASL_PLAINTEXT"]
    for role in ("ADMIN", "PRODUCER", "CONSUMER"):
        lines.append(f"KAFKA_{role}_PASSWORD={secrets.token_urlsafe(32)}")
    try:
        with Path(".env.security").open("x", encoding="utf-8") as target:
            target.write("\n".join(lines) + "\n")
    except FileExistsError:
        parser.error(".env.security already exists; no credentials changed")
    print("Created .env.security. Save these personal access keys now; they are shown only once.")
    for user, _, key in credentials:
        print(f"User ID: {user}\nAccess key: {key}\n")
    print("Do not commit or share .env.security or access keys.")


if __name__ == "__main__":
    main()
