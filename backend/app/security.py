import asyncio
import hashlib
import hmac
import json
import os
import secrets
import time
from collections import Counter
from dataclasses import dataclass
from http.cookies import CookieError, SimpleCookie
from typing import Literal
from urllib.parse import urlparse

from fastapi import HTTPException
from pydantic import BaseModel, ConfigDict, Field
from starlette.responses import JSONResponse


class Account(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,40}$")
    role: Literal["viewer", "operator"]
    key_hash: str = Field(pattern=r"^[a-f0-9]{64}$")


class Login(BaseModel):
    model_config = ConfigDict(extra="forbid")
    user_id: str = Field(min_length=1, max_length=40)
    access_key: str = Field(min_length=32, max_length=200)


@dataclass(frozen=True)
class Principal:
    user_id: str
    role: str


@dataclass(frozen=True)
class Session:
    principal: Principal
    expires_at: float


class Security:
    cookie_name = "boiler_session"
    body_limit = 8192
    session_limit = 100
    connection_limit = 32
    user_connection_limit = 4
    model_limit = 2

    def __init__(self):
        origin = os.getenv("APP_PUBLIC_ORIGIN", "")
        parsed = urlparse(origin)
        if (parsed.scheme not in ("http", "https") or not parsed.hostname or parsed.username or parsed.password
                or parsed.path or parsed.query or parsed.fragment):
            raise ValueError("APP_PUBLIC_ORIGIN must be an exact http(s) origin without a path")
        if parsed.scheme == "http" and parsed.hostname not in ("127.0.0.1", "localhost", "::1"):
            raise ValueError("Non-loopback APP_PUBLIC_ORIGIN requires HTTPS")
        self.origin = origin
        self.hostname = parsed.hostname
        self.secure_cookie = parsed.scheme == "https"
        try:
            records = json.loads(os.environ["AUTH_USERS_JSON"])
            accounts = [Account.model_validate(record) for record in records]
        except (KeyError, ValueError, TypeError):
            raise ValueError("AUTH_USERS_JSON requires valid user_id, role and SHA-256 key_hash records") from None
        if not 1 <= len(accounts) <= 50 or len({account.user_id for account in accounts}) != len(accounts):
            raise ValueError("AUTH_USERS_JSON requires 1..50 unique users")
        if len({account.key_hash for account in accounts}) != len(accounts):
            raise ValueError("Each user requires a distinct access key")
        self.accounts = {account.user_id: account for account in accounts}
        self.session_seconds = int(os.getenv("AUTH_SESSION_SECONDS", "1800"))
        if not 60 <= self.session_seconds <= 3600:
            raise ValueError("AUTH_SESSION_SECONDS must be between 60 and 3600")
        self.sessions = {}
        self.buckets = {}
        self.connections = Counter()
        self.model_tasks = set()

    def rate(self, key, limit, period=60):
        now = time.monotonic()
        self.buckets = {name: value for name, value in self.buckets.items() if value[1] > now}
        count, expires = self.buckets.get(key, (0, now + period))
        if count >= limit or (key not in self.buckets and len(self.buckets) >= 2048):
            raise HTTPException(429, "Request limit reached; retry later", headers={"Retry-After": str(period)})
        self.buckets[key] = (count + 1, expires)

    def login(self, request: Login):
        account = self.accounts.get(request.user_id)
        supplied = hashlib.sha256(request.access_key.encode()).hexdigest()
        expected = account.key_hash if account else "0" * 64
        if not hmac.compare_digest(supplied, expected) or account is None:
            raise HTTPException(401, "Invalid login credentials")
        now = time.time()
        self.sessions = {key: value for key, value in self.sessions.items() if value.expires_at > now}
        if len(self.sessions) >= self.session_limit or sum(s.principal.user_id == account.user_id for s in self.sessions.values()) >= 5:
            raise HTTPException(429, "Active session limit reached")
        token = secrets.token_urlsafe(32)
        principal = Principal(account.user_id, account.role)
        self.sessions[hashlib.sha256(token.encode()).hexdigest()] = Session(principal, now + self.session_seconds)
        return token, principal

    def session_key(self, scope):
        raw = dict(scope.get("headers", [])).get(b"cookie", b"").decode("latin-1")
        cookie = SimpleCookie()
        try:
            cookie.load(raw)
        except CookieError:
            return None
        token = cookie.get(self.cookie_name)
        if token is None or len(token.value) > 100:
            return None
        return hashlib.sha256(token.value.encode()).hexdigest()

    def principal(self, scope):
        key = self.session_key(scope)
        session = self.sessions.get(key)
        if session is None:
            raise HTTPException(401, "Login required")
        if session.expires_at <= time.time():
            self.sessions.pop(key, None)
            raise HTTPException(401, "Session expired; log in again")
        return session.principal

    def logout(self, scope):
        self.sessions.pop(self.session_key(scope), None)

    @staticmethod
    def operator(principal):
        if principal.role != "operator":
            raise HTTPException(403, "Operator role required")

    def websocket_open(self, scope):
        headers = dict(scope.get("headers", []))
        if headers.get(b"origin", b"").decode("latin-1") != self.origin:
            raise HTTPException(403, "Origin not allowed")
        principal = self.principal(scope)
        if sum(self.connections.values()) >= self.connection_limit or self.connections[principal.user_id] >= self.user_connection_limit:
            raise HTTPException(429, "WebSocket connection limit reached")
        self.connections[principal.user_id] += 1
        return principal

    def websocket_close(self, principal):
        self.connections[principal.user_id] -= 1
        if self.connections[principal.user_id] <= 0:
            del self.connections[principal.user_id]

    async def model_work(self, principal, callback):
        self.operator(principal)
        self.rate(("model", principal.user_id), 12)
        if len(self.model_tasks) >= self.model_limit:
            raise HTTPException(429, "Model capacity reached; retry later", headers={"Retry-After": "5"})
        task = asyncio.create_task(asyncio.to_thread(callback))
        self.model_tasks.add(task)

        def finished(completed):
            self.model_tasks.discard(completed)
            if not completed.cancelled():
                completed.exception()

        task.add_done_callback(finished)
        return await asyncio.shield(task)


class SecurityMiddleware:
    def __init__(self, app, owner):
        self.app = app
        self.owner = owner

    async def __call__(self, scope, receive, send):
        if scope["type"] not in ("http", "websocket"):
            return await self.app(scope, receive, send)
        security = self.owner.state.security
        headers = dict(scope.get("headers", []))
        try:
            host = urlparse("http://" + headers.get(b"host", b"").decode("latin-1")).hostname
        except ValueError:
            host = None
        if host != security.hostname:
            if scope["type"] == "websocket":
                return await send({"type": "websocket.close", "code": 1008})
            return await JSONResponse({"detail": "Host not allowed"}, status_code=400)(scope, receive, send)
        if scope["type"] == "websocket":
            return await self.app(scope, receive, send)

        async def secured_send(message):
            if message["type"] == "http.response.start":
                message["headers"] = list(message.get("headers", [])) + [
                    (b"cache-control", b"no-store"), (b"x-content-type-options", b"nosniff"),
                    (b"x-frame-options", b"DENY"), (b"referrer-policy", b"no-referrer"),
                    (b"content-security-policy", b"default-src 'none'; frame-ancestors 'none'")]
            await send(message)

        try:
            method, path = scope["method"], scope["path"]
            client = scope.get("client") or ("unknown", 0)
            security.rate(("http", client[0]), 600)
            if method not in ("GET", "HEAD", "OPTIONS"):
                if headers.get(b"origin", b"").decode("latin-1") != security.origin:
                    raise HTTPException(403, "Origin not allowed")
                if method == "POST" and headers.get(b"content-type", b"").split(b";")[0] != b"application/json":
                    raise HTTPException(415, "JSON request required")
            if path == "/api/session" and method == "POST":
                security.rate(("login", client[0]), 10)
            elif (path, method) != ("/api/health", "GET"):
                principal = security.principal(scope)
                scope.setdefault("state", {})["principal"] = principal
                security.rate(("user", principal.user_id), 480)
            body = bytearray()
            deadline = time.monotonic() + 5
            while True:
                try:
                    message = await asyncio.wait_for(receive(), timeout=max(0, deadline - time.monotonic()))
                except TimeoutError:
                    raise HTTPException(408, "Request body timeout") from None
                if message["type"] == "http.disconnect":
                    return
                body.extend(message.get("body", b""))
                if len(body) > security.body_limit:
                    raise HTTPException(413, "Request body too large")
                if not message.get("more_body", False):
                    break
            delivered = False

            async def buffered_receive():
                nonlocal delivered
                if not delivered:
                    delivered = True
                    return {"type": "http.request", "body": bytes(body), "more_body": False}
                return await receive()

            await self.app(scope, buffered_receive, secured_send)
        except HTTPException as error:
            await JSONResponse({"detail": error.detail}, status_code=error.status_code, headers=error.headers)(scope, receive, secured_send)
