"""A small, dependency-free authentication core.

This is the pasted auth module rewritten around the parts that actually carry
security weight, with everything that only existed to move bytes between layers
removed:

* passwords are stored as PBKDF2-HMAC-SHA256 with a per-user random salt,
  never as plaintext, and are compared in constant time;
* an unknown username costs the same as a known one, so the login path does not
  leak which accounts exist;
* repeated failures lock an account for a window, and a success clears it;
* sessions are opaque random tokens with an absolute expiry and can be revoked.

Only the standard library is used, and time is injectable so the tests can
exercise expiry and lockout without sleeping.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time
from typing import Callable

__all__ = [
    "Auth",
    "AuthError",
    "InvalidCredentials",
    "LockedOut",
    "PolicyError",
    "hash_password",
    "verify_password",
]

# --- tuned policy ------------------------------------------------------------

ITERATIONS = 260_000        # PBKDF2 work factor for new hashes
SALT_BYTES = 16
KEY_BYTES = 32
MIN_PASSWORD = 10
MAX_PASSWORD = 1024         # refuse pathological inputs rather than hashing 1 MB
MAX_ATTEMPTS = 5            # failures before the account is locked
LOCKOUT_SECONDS = 300.0
SESSION_SECONDS = 60 * 60 * 8
MAX_TRACKED_FAILURES = 10_000
GENERIC_ERROR = "invalid username or password"


class AuthError(Exception):
    """Base class for everything this module raises on purpose."""


class InvalidCredentials(AuthError):
    """Wrong password, unknown user, or a session that is not valid."""


class LockedOut(AuthError):
    """Too many failures; the account is cooling off."""


class PolicyError(AuthError, ValueError):
    """The supplied username or password is not acceptable."""


# --- password hashing --------------------------------------------------------

def _b64(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def hash_password(password: str, *, iterations: int = ITERATIONS, salt: bytes | None = None) -> str:
    """Return ``pbkdf2$sha256$<iterations>$<salt>$<key>`` for ``password``."""
    if not isinstance(password, str) or not password:
        raise PolicyError("password must be a non-empty string")
    if len(password) > MAX_PASSWORD:
        raise PolicyError(f"password longer than {MAX_PASSWORD} characters")
    if iterations < 1:
        raise PolicyError("iterations must be positive")

    salt = salt if salt is not None else os.urandom(SALT_BYTES)
    key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations, KEY_BYTES)
    return f"pbkdf2$sha256${iterations}${_b64(salt)}${_b64(key)}"


def verify_password(password: str, encoded: str) -> bool:
    """Check ``password`` against an encoded hash without early exit on mismatch."""
    try:
        scheme, digest, iterations, salt, key = encoded.split("$")
        if scheme != "pbkdf2" or digest != "sha256":
            return False
        rounds = int(iterations)
        salt_raw = _unb64(salt)
        expected = _unb64(key)
    except (AttributeError, ValueError):
        return False

    if rounds < 1 or len(salt_raw) < 8 or not expected:
        return False
    if not isinstance(password, str) or len(password) > MAX_PASSWORD:
        return False

    actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt_raw, rounds, len(expected))
    return hmac.compare_digest(actual, expected)


# --- the service -------------------------------------------------------------

class Auth:
    """In-memory users, sessions and failure counters.

    ``clock`` is a monotonic source returning seconds; the default is
    ``time.monotonic``. Keeping it injectable is what lets the tests assert on
    lockouts and session expiry instantly instead of sleeping.
    """

    def __init__(
        self,
        *,
        iterations: int = ITERATIONS,
        clock: Callable[[], float] | None = None,
        max_attempts: int = MAX_ATTEMPTS,
        lockout_seconds: float = LOCKOUT_SECONDS,
        session_seconds: float = SESSION_SECONDS,
        max_tracked_failures: int = MAX_TRACKED_FAILURES,
    ) -> None:
        if max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        self._iterations = iterations
        self._clock = clock or time.monotonic
        self._max_attempts = max_attempts
        self._lockout = lockout_seconds
        self._session_ttl = session_seconds
        self._max_tracked = max_tracked_failures
        self._users: dict[str, str] = {}
        self._failures: dict[str, tuple[int, float]] = {}
        self._sessions: dict[str, tuple[str, float]] = {}
        # a hash that never matches, used to spend the same work on unknown users
        self._decoy = hash_password(secrets.token_hex(16), iterations=iterations)

    # -- accounts ---------------------------------------------------------

    @staticmethod
    def _normalise(username: str) -> str:
        if not isinstance(username, str):
            raise PolicyError("username must be a string")
        name = username.strip().casefold()
        if not 1 <= len(name) <= 64:
            raise PolicyError("username must be 1-64 characters")
        return name

    def register(self, username: str, password: str) -> None:
        """Add an account. Raises ``PolicyError`` on bad input or duplicates."""
        name = self._normalise(username)
        if len(password) < MIN_PASSWORD:
            raise PolicyError(f"password must be at least {MIN_PASSWORD} characters")
        if name in self._users:
            raise PolicyError("username already registered")
        self._users[name] = hash_password(password, iterations=self._iterations)

    def has_user(self, username: str) -> bool:
        return self._normalise(username) in self._users

    # -- login ------------------------------------------------------------

    def _locked(self, name: str) -> float:
        """Seconds left on the lockout for ``name`` (0 when unlocked)."""
        entry = self._failures.get(name)
        if not entry:
            return 0.0
        count, until = entry
        remaining = until - self._clock()
        if remaining <= 0:
            self._failures.pop(name, None)
            return 0.0
        return remaining if count >= self._max_attempts else 0.0

    def login(self, username: str, password: str) -> str:
        """Return a session token, or raise ``InvalidCredentials``/``LockedOut``."""
        name = self._normalise(username)
        wait = self._locked(name)
        if wait:
            raise LockedOut(f"account locked, try again in {int(wait) + 1}s")

        stored = self._users.get(name)
        if stored is None:
            # unknown user: pay the same cost, then fail for the same reason
            verify_password(password, self._decoy)
            self._fail(name)
            raise InvalidCredentials(GENERIC_ERROR)

        if not verify_password(password, stored):
            self._fail(name)
            raise InvalidCredentials(GENERIC_ERROR)

        self._failures.pop(name, None)
        return self._issue(name)

    def _fail(self, name: str) -> None:
        # a flood of invented usernames must not grow this table without bound
        if len(self._failures) >= self._max_tracked and name not in self._failures:
            self._failures.clear()
        count = self._failures.get(name, (0, 0.0))[0] + 1
        self._failures[name] = (count, self._clock() + self._lockout)

    # -- sessions ---------------------------------------------------------

    def _issue(self, name: str) -> str:
        token = secrets.token_urlsafe(32)
        self._sessions[token] = (name, self._clock() + self._session_ttl)
        return token

    def user_for(self, token: str) -> str:
        """Resolve a token to a username, or raise ``InvalidCredentials``."""
        entry = self._sessions.get(token) if isinstance(token, str) else None
        if not entry:
            raise InvalidCredentials("not signed in")
        name, expiry = entry
        if expiry <= self._clock():
            self._sessions.pop(token, None)
            raise InvalidCredentials("session expired")
        return name

    def logout(self, token: str) -> bool:
        """Revoke a token. Returns whether it was live."""
        return self._sessions.pop(token, None) is not None

    def purge_sessions(self) -> int:
        """Drop every expired session; returns how many went."""
        now = self._clock()
        dead = [t for t, (_, exp) in self._sessions.items() if exp <= now]
        for token in dead:
            del self._sessions[token]
        return len(dead)

    # -- introspection used by the tests ----------------------------------

    @property
    def session_count(self) -> int:
        return len(self._sessions)

    @property
    def failure_count(self) -> int:
        return len(self._failures)
