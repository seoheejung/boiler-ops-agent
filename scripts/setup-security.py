"""Local credential initialization without replacing existing configuration."""
import argparse
import hashlib
import json
import secrets
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default="http://127.0.0.1:5173")
    args = parser.parse_args()
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
