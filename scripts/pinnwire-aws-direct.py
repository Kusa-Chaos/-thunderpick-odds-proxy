#!/usr/bin/env python3
"""Collect authorized PinnWire prices using an encrypted AWS SSM parameter.

Never writes or prints the credential. Fail-closed: nonzero exit lets the
existing GitHub quote artifact serve as an independent fallback.
"""
import json
import os
import subprocess
import sys

import boto3

PARAMETER = "/thunderpick/pinnwire-api-key"


def main():
    try:
        response = boto3.client("ssm", region_name="us-east-2").get_parameter(
            Name=PARAMETER, WithDecryption=True
        )
        key = response["Parameter"]["Value"]
        if not isinstance(key, str) or not key:
            raise ValueError("Missing key")
    except Exception as exc:
        print("PINNWIRE_AWS_PARAMETER_UNAVAILABLE", type(exc).__name__)
        return 1

    child_env = os.environ.copy()
    child_env["PINNWIRE_API_KEY"] = key
    del key
    try:
        completed = subprocess.run(
            ["node", "scripts/pinnwire-direct.mjs"],
            env=child_env,
            timeout=45,
            check=False,
        )
    except (OSError, subprocess.TimeoutExpired) as exc:
        print("PINNWIRE_AWS_COLLECTOR_ERROR", type(exc).__name__)
        return 1
    finally:
        child_env.pop("PINNWIRE_API_KEY", None)

    if completed.returncode != 0:
        print("PINNWIRE_AWS_COLLECTOR_EXIT", completed.returncode)
        return 1
    try:
        with open("data/direct-sources-latest.json", encoding="utf-8") as file:
            health = json.load(file)["providerHealth"]["pinnwire"]
        if (
            health.get("ok") is True
            and health.get("status") == 200
            and isinstance(health.get("acceptedEvents"), int)
            and health["acceptedEvents"] > 0
        ):
            print(
                "PINNWIRE_AWS_DIRECT_HEALTH",
                "events", health["acceptedEvents"],
                "markets", health.get("acceptedMarkets", 0),
            )
            return 0
    except (OSError, KeyError, ValueError, TypeError):
        pass
    print("PINNWIRE_AWS_DIRECT_UNUSABLE")
    return 1


if __name__ == "__main__":
    sys.exit(main())
