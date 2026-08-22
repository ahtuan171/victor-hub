"""Create the single v0.1 account.

    uv run python -m app.scripts.seed_user

There is no registration endpoint and no password reset — `.claude/rules/tech-defaults.md` locks the
Auth row to "login + access token only", and constitution VII says one creator means one creator.
This script is therefore the *only* thing in the system that writes a `creator` row, which makes it
also the only way to change that account's password.

Re-running it against the seeded address is supported and updates the password. That is deliberate:
without it, a forgotten password would need a hand-written SQL `UPDATE` against production, and the
alternative — adding a reset endpoint — is exactly the scope the tech defaults rule out.
"""

import sys

from pydantic import EmailStr, Field
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlmodel import Session, func, select

from app.api.auth import normalise_email
from app.auth import MAX_PASSWORD_BYTES, PasswordTooLongError, hash_password
from app.db import get_engine
from app.models import Creator


class SeedSettings(BaseSettings):
    """The two variables this script reads, and nothing else.

    Deliberately *not* fields on `app.config.Settings`. Two reasons, both about blast radius:

    * Required there, the API would refuse to boot on a deployment that has no seed credentials —
      which is every deployment after the first run.
    * Optional there, every running API process would hold the account's plaintext password in
      memory for its whole lifetime, in an object that gets logged whenever settings are dumped.

    It is still a settings model rather than `os.environ`, because the credentials live in the
    repository's `.env` and a bare `os.environ` read would not see them unless they were also
    exported — which is a confusing failure to debug.
    """

    model_config = SettingsConfigDict(
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    seed_creator_email: EmailStr
    seed_creator_password: str = Field(min_length=1)


def _fail(message: str) -> None:
    """Print to stderr and exit non-zero, so a failed seed cannot look like a successful one."""
    print(f"error: {message}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    settings = SeedSettings()
    email = normalise_email(settings.seed_creator_email)
    password = settings.seed_creator_password

    # bcrypt refuses over-72-byte passwords rather than truncating them. Refuse here too, with a
    # message that says what to do: truncating would let two different passwords open this account,
    # and letting bcrypt's own ValueError escape from a seed script reads as a bug in the tool.
    try:
        password_hash = hash_password(password)
    except PasswordTooLongError:
        # ASCII only in anything printed: the Windows console is cp1252 by default and renders an
        # em dash as a literal "?", which makes a correct error message look like a broken one.
        _fail(
            f"SEED_CREATOR_PASSWORD is {len(password.encode('utf-8'))} bytes; bcrypt accepts at "
            f"most {MAX_PASSWORD_BYTES}. Note that this counts UTF-8 bytes, not characters: emoji "
            "and accented letters cost more than one each. Choose a shorter password."
        )
        return

    with Session(get_engine()) as session:
        existing = session.exec(select(Creator).where(Creator.email == email)).one_or_none()

        if existing is not None:
            existing.password_hash = password_hash
            session.add(existing)
            session.commit()
            print(f"Updated the password for {email}.")
            return

        # There is exactly one account. Silently adding a second would half-work — both could log
        # in, and because no table in this schema has an owner column (INV-4, constitution VII)
        # they would share every row.
        total = session.exec(select(func.count()).select_from(Creator)).one()
        if total:
            other = session.exec(select(Creator.email)).first()
            _fail(
                f"an account already exists ({other}), and v0.1 has exactly one creator. To change "
                "its password, set SEED_CREATOR_EMAIL to that address and re-run. To replace the "
                "account, delete the row first. Note that content items are not owned by it and "
                "will survive."
            )
            return

        session.add(Creator(email=email, password_hash=password_hash))
        session.commit()
        print(f"Created the account for {email}.")


if __name__ == "__main__":
    main()
