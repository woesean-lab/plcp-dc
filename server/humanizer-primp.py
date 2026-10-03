import base64
import json
import re
import sys

import primp


MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DISCORD_API_BASE = "https://discord.com/api/v10"


def response_text(response):
    body = response.text
    if len(body.encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise RuntimeError("Discord response was too large")
    return body


def require_json(response, label):
    body = response_text(response)
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"{label} returned HTTP {response.status_code}")
    try:
        return json.loads(body)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"{label} returned invalid JSON") from error


def get_build_number(client):
    response = client.get("https://discord.com/app", headers={
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
    })
    body = response_text(response)
    if response.status_code < 200 or response.status_code >= 300:
        raise RuntimeError(f"Discord app returned HTTP {response.status_code}")
    match = re.search(r'"BUILD_NUMBER"\s*:\s*"?(\d+)"?', body)
    if not match:
        raise RuntimeError("Discord client build number could not be resolved")
    return int(match.group(1))


def get_identity(client, properties):
    encoded_properties = base64.b64encode(
        json.dumps(properties, separators=(",", ":")).encode("utf-8")
    ).decode("ascii")
    headers = {
        "Accept": "*/*",
        "Accept-Language": f'{properties.get("system_locale", "en-US")},en;q=0.9',
        "Referer": "https://discord.com/app",
        "User-Agent": properties["browser_user_agent"],
        "X-Debug-Options": "bugReporterEnabled",
        "X-Discord-Locale": properties.get("system_locale", "en-US"),
        "X-Discord-Timezone": "Europe/Istanbul",
        "X-Super-Properties": encoded_properties,
    }
    experiments = require_json(
        client.get(f"{DISCORD_API_BASE}/experiments", headers=headers),
        "Discord experiments",
    )
    fingerprint = str(experiments.get("fingerprint") or "").strip()
    if not fingerprint:
        raise RuntimeError("Discord experiments did not return a fingerprint")

    apex_headers = {**headers, "X-Fingerprint": fingerprint}
    apex = require_json(
        client.get(f"{DISCORD_API_BASE}/apex/experiments?surface=2", headers=apex_headers),
        "Discord Apex experiments",
    )
    installation_id = str(apex.get("installation") or "").strip()
    if not installation_id:
        raise RuntimeError("Discord Apex experiments did not return an installation ID")
    return fingerprint, installation_id


def main():
    request = json.load(sys.stdin)

    # Humanizer intentionally follows the target transport behavior: primp is
    # used without an explicit browser profile and TLS verification is disabled.
    with primp.Client(
        proxy=request["proxy"],
        timeout=15,
        verify=False,
        follow_redirects=False,
    ) as client:
        operation = request.get("operation", "request")
        if operation == "build-number":
            print(json.dumps({"buildNumber": get_build_number(client)}, separators=(",", ":")))
            return
        if operation == "identity":
            fingerprint, installation_id = get_identity(client, request["properties"])
            print(json.dumps({
                "fingerprint": fingerprint,
                "installationId": installation_id,
            }, separators=(",", ":")))
            return
        if operation != "request":
            raise RuntimeError("Unsupported Humanizer primp operation")

        body = request.get("body")
        response = client.request(
            request.get("method", "GET"),
            request["url"],
            headers=request.get("headers") or {},
            content=None if body is None else body.encode("utf-8"),
        )

    response_body = response_text(response)

    print(json.dumps({
        "status": response.status_code,
        "headers": dict(response.headers),
        "body": response_body,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
