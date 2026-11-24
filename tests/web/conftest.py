import time
from dataclasses import dataclass, field

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from analyzer.accounts.passwords import Passwords
from analyzer.web.app import create_app
from analyzer.web.settings import AppSettings

from .fakes import FakeFactory

PASSWORD = "Tangerine-Rocket-42"
APP_ORIGIN = "https://app.example"
EXT_ID = "abcdefghijklmnopabcdefghijklmnop"
GOOGLE_WEB = "web-client.apps.googleusercontent.com"
GOOGLE_NATIVE = "native-client.apps.googleusercontent.com"
APPLE_AUD = "app.lovevectorspace.demo"


@dataclass
class RecordingMailer:
    sent: list = field(default_factory=list)

    def send(self, to, subject, text, link):
        self.sent.append({"to": to, "subject": subject, "link": link})

    def token_for(self, to, kind):
        path = "/auth/verify" if kind == "verify" else "/auth/reset"
        links = [m["link"] for m in self.sent if m["to"] == to and path in m["link"]]
        return links[-1].split("#token=", 1)[1]


class Idp:
    """Locally generated RSA key standing in for Google/Apple JWKS."""

    _shared_key = None

    def __init__(self, kid="k1"):
        self.kid = kid
        if Idp._shared_key is None:
            Idp._shared_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        self.key = Idp._shared_key
        self.fetches = 0

    def jwks(self):
        jwk = jwt.algorithms.RSAAlgorithm.to_jwk(self.key.public_key(), as_dict=True)
        jwk.update({"kid": self.kid, "alg": "RS256", "use": "sig"})
        return {"keys": [jwk]}

    def fetch(self, url):
        self.fetches += 1
        return self.jwks()

    def token(self, *, iss="https://accounts.google.com", aud=GOOGLE_NATIVE, sub="g-1", email="new@example.com",
              email_verified=True, exp_in=600, key=None, nonce=None, name=None):
        now = int(time.time())
        claims = {"iss": iss, "aud": aud, "sub": sub, "iat": now, "exp": now + exp_in, "email": email,
                  "email_verified": email_verified}
        if nonce:
            claims["nonce"] = nonce
        if name:
            claims["name"] = name
        return jwt.encode(claims, key or self.key, algorithm="RS256", headers={"kid": self.kid})


def make_settings(tmp_path, **over):
    base = dict(master_key="test-master-key-0123456789abcdef", jwt_secret="j" * 48, data_dir=str(tmp_path / "data"),
                app_origin=APP_ORIGIN, extension_id=EXT_ID, frontend_dist=str(tmp_path / "dist"),
                google_client_id=GOOGLE_WEB, google_client_secret="google-secret",
                google_client_ids=GOOGLE_NATIVE, apple_client_ids=APPLE_AUD, admin_email="admin@example.com",
                sse_heartbeat_s=0.2, native_nonce_required=False)   # nonce tests opt in (production default: on)
    base.update(over)
    return AppSettings(_env_file=None, **base)


FAST_PW = Passwords(time_cost=1, memory_cost=1024, parallelism=1)


class Harness:
    def __init__(self, tmp_path, google_transport=None, **over):
        self.settings = make_settings(tmp_path, **over)
        self.factory = FakeFactory()
        self.mailer = RecordingMailer()
        self.idp = Idp()
        self.app = create_app(self.settings, self.factory, mailer=self.mailer, fetch=self.idp.fetch,
                              passwords=FAST_PW, google_transport=google_transport)
        self.accounts = self.app.state.accounts

    def client(self, **kw):
        return TestClient(self.app, base_url="https://testserver", **kw)

    def invite(self, email=None):
        return self.accounts.invites.create(f"inv{len(self.accounts.invites.list())}x", None, email, 14)["code"]

    def signup(self, c, email, password=PASSWORD, native=True, **extra):
        code = self.invite()
        headers = {"X-Client": "native"} if native else {}
        r = c.post("/api/auth/signup", json={"email": email, "password": password, "invite_code": code, **extra},
                   headers=headers)
        assert r.status_code == 201, r.text
        return r.json()


def auth(token):
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def h(tmp_path):
    return Harness(tmp_path)


@pytest.fixture
def client(h):
    with h.client() as c:
        yield c


@pytest.fixture
def alice(h, client):
    return h.signup(client, "alice@example.com")


@pytest.fixture
def bob(h, client):
    return h.signup(client, "bob@example.com")
