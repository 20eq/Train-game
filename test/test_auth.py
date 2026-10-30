"""Behavioural tests for auth.py — run with `python3 -m unittest discover test`."""

import time
import unittest

from auth import (
    Auth,
    InvalidCredentials,
    LockedOut,
    PolicyError,
    hash_password,
    verify_password,
)

# keep the suite fast: the work factor is not what these tests are checking
FAST = 1_200


class Clock:
    def __init__(self, now: float = 1000.0) -> None:
        self.now = now

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


class HashingTests(unittest.TestCase):
    def test_round_trip(self):
        encoded = hash_password("correct horse battery", iterations=FAST)
        self.assertTrue(verify_password("correct horse battery", encoded))

    def test_wrong_password_is_rejected(self):
        encoded = hash_password("correct horse battery", iterations=FAST)
        self.assertFalse(verify_password("correct horse batteru", encoded))
        self.assertFalse(verify_password("", encoded))
        self.assertFalse(verify_password("CORRECT HORSE BATTERY", encoded))

    def test_salt_is_unique_per_hash(self):
        a = hash_password("same password", iterations=FAST)
        b = hash_password("same password", iterations=FAST)
        self.assertNotEqual(a, b)
        self.assertTrue(verify_password("same password", a))
        self.assertTrue(verify_password("same password", b))

    def test_stored_form_never_contains_the_password(self):
        password = "hunter2-is-not-enough"
        encoded = hash_password(password, iterations=FAST)
        self.assertNotIn(password, encoded)
        self.assertTrue(encoded.startswith("pbkdf2$sha256$"))

    def test_encoded_hash_is_self_describing(self):
        encoded = hash_password("x" * 12, iterations=FAST)
        scheme, digest, rounds, salt, key = encoded.split("$")
        self.assertEqual((scheme, digest), ("pbkdf2", "sha256"))
        self.assertEqual(int(rounds), FAST)
        self.assertGreaterEqual(len(salt), 20)
        self.assertGreaterEqual(len(key), 40)

    def test_malformed_hashes_fail_closed(self):
        for bad in ["", "nope", "pbkdf2$sha256$0$c2FsdA$a2V5", "bcrypt$sha256$1$c2FsdA$a2V5",
                    "pbkdf2$sha256$1200$!!!$!!!", "pbkdf2$sha256$x$c2FsdA$a2V5", None]:
            with self.subTest(bad=bad):
                self.assertFalse(verify_password("anything", bad))

    def test_a_tampered_key_fails(self):
        encoded = hash_password("password1234", iterations=FAST)
        scheme, digest, rounds, salt, key = encoded.split("$")
        flipped = "A" if key[0] != "A" else "B"
        tampered = "$".join([scheme, digest, rounds, salt, flipped + key[1:]])
        self.assertFalse(verify_password("password1234", tampered))

    def test_policy_limits(self):
        with self.assertRaises(PolicyError):
            hash_password("")
        with self.assertRaises(PolicyError):
            hash_password("x" * 2000)
        with self.assertRaises(PolicyError):
            hash_password("ok-password", iterations=0)

    def test_unicode_passwords_survive(self):
        for password in ["pässwörd-mit-länge", "铁路司机安全第一", "🔒🔒🔒🔒🔒🔒🔒🔒"]:
            with self.subTest(password=password):
                self.assertTrue(verify_password(password, hash_password(password, iterations=FAST)))


class AccountTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.auth = Auth(iterations=FAST, clock=self.clock)

    def test_register_then_login(self):
        self.auth.register("Asha", "long-enough-pass")
        token = self.auth.login("asha", "long-enough-pass")
        self.assertEqual(self.auth.user_for(token), "asha")

    def test_usernames_are_case_and_space_insensitive(self):
        self.auth.register("  Kabir ", "long-enough-pass")
        self.assertTrue(self.auth.has_user("kabir"))
        self.auth.login("KABIR", "long-enough-pass")

    def test_duplicate_registration_is_refused(self):
        self.auth.register("asha", "long-enough-pass")
        with self.assertRaises(PolicyError):
            self.auth.register("ASHA", "another-password")

    def test_short_password_is_refused(self):
        with self.assertRaises(PolicyError):
            self.auth.register("asha", "short")
        self.assertFalse(self.auth.has_user("asha"))

    def test_bad_usernames_are_refused(self):
        for name in ["", "   ", 5, "x" * 65]:
            with self.subTest(name=name):
                with self.assertRaises(PolicyError):
                    self.auth.register(name, "long-enough-pass")

    def test_unknown_user_and_wrong_password_are_indistinguishable(self):
        self.auth.register("asha", "long-enough-pass")
        with self.assertRaises(InvalidCredentials) as unknown:
            self.auth.login("nobody", "long-enough-pass")
        with self.assertRaises(InvalidCredentials) as wrong:
            self.auth.login("asha", "not-the-password")
        self.assertEqual(str(unknown.exception), str(wrong.exception))

    def test_wrong_password_never_returns_a_session(self):
        self.auth.register("asha", "long-enough-pass")
        for _ in range(3):
            with self.assertRaises(InvalidCredentials):
                self.auth.login("asha", "nope-nope-nope")
        self.assertEqual(self.auth.session_count, 0)


class LockoutTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.auth = Auth(iterations=FAST, clock=self.clock, max_attempts=3, lockout_seconds=60)
        self.auth.register("asha", "long-enough-pass")

    def _fail(self, times=1):
        for _ in range(times):
            with self.assertRaises(InvalidCredentials):
                self.auth.login("asha", "wrong-password")

    def test_lockout_after_the_limit(self):
        self._fail(3)
        with self.assertRaises(LockedOut):
            self.auth.login("asha", "long-enough-pass")

    def test_lockout_expires(self):
        self._fail(3)
        self.clock.advance(61)
        token = self.auth.login("asha", "long-enough-pass")
        self.assertEqual(self.auth.user_for(token), "asha")

    def test_success_clears_the_counter(self):
        self._fail(2)
        self.auth.login("asha", "long-enough-pass")
        self._fail(2)                      # would be four failures without the reset
        self.auth.login("asha", "long-enough-pass")

    def test_failure_table_is_bounded(self):
        auth = Auth(iterations=FAST, clock=self.clock, max_attempts=3, max_tracked_failures=50)
        for i in range(120):
            try:
                auth.login(f"ghost{i}", "whatever-password")
            except (InvalidCredentials, LockedOut):
                pass
        self.assertLessEqual(auth.failure_count, 50)

    def test_unknown_users_are_locked_out_too(self):
        for _ in range(3):
            with self.assertRaises(InvalidCredentials):
                self.auth.login("ghost", "whatever-password")
        with self.assertRaises(LockedOut):
            self.auth.login("ghost", "whatever-password")


class SessionTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.auth = Auth(iterations=FAST, clock=self.clock, session_seconds=90)
        self.auth.register("asha", "long-enough-pass")
        self.token = self.auth.login("asha", "long-enough-pass")

    def test_tokens_are_unpredictable(self):
        other = self.auth.login("asha", "long-enough-pass")
        self.assertNotEqual(self.token, other)
        self.assertGreaterEqual(len(self.token), 32)

    def test_unknown_token_is_rejected(self):
        for token in ["", "not-a-token", None, self.token + "x"]:
            with self.subTest(token=token):
                with self.assertRaises(InvalidCredentials):
                    self.auth.user_for(token)

    def test_session_expires(self):
        self.clock.advance(91)
        with self.assertRaises(InvalidCredentials):
            self.auth.user_for(self.token)

    def test_logout_revokes_once(self):
        self.assertTrue(self.auth.logout(self.token))
        self.assertFalse(self.auth.logout(self.token))
        with self.assertRaises(InvalidCredentials):
            self.auth.user_for(self.token)

    def test_purge_drops_only_expired(self):
        fresh = self.auth.login("asha", "long-enough-pass")
        self.clock.advance(30)
        self.assertEqual(self.auth.purge_sessions(), 0)
        self.clock.advance(70)
        self.assertEqual(self.auth.purge_sessions(), 2)
        self.assertEqual(self.auth.session_count, 0)
        with self.assertRaises(InvalidCredentials):
            self.auth.user_for(fresh)


class TimingTests(unittest.TestCase):
    def test_known_and_unknown_logins_cost_the_same_order_of_magnitude(self):
        clock = Clock()
        auth = Auth(iterations=20_000, clock=clock, max_attempts=99)
        auth.register("asha", "long-enough-pass")

        def measure(user):
            start = time.perf_counter()
            for _ in range(5):
                try:
                    auth.login(user, "wrong-password")
                except InvalidCredentials:
                    pass
            return time.perf_counter() - start

        known = measure("asha")
        unknown = measure("nobody")
        # a naive implementation returns in microseconds for unknown users
        self.assertGreater(unknown, known * 0.35, f"known {known:.4f}s unknown {unknown:.4f}s")


if __name__ == "__main__":
    unittest.main()
