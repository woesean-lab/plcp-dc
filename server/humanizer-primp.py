import json
import sys

import primp


MAX_RESPONSE_BYTES = 2 * 1024 * 1024


def main():
    request = json.load(sys.stdin)
    body = request.get("body")

    # Humanizer intentionally follows the target transport behavior: primp is
    # used without an explicit browser profile and TLS verification is disabled.
    with primp.Client(
        proxy=request["proxy"],
        timeout=15,
        verify=False,
        follow_redirects=False,
    ) as client:
        response = client.request(
            request.get("method", "GET"),
            request["url"],
            headers=request.get("headers") or {},
            content=None if body is None else body.encode("utf-8"),
        )

    response_body = response.text
    if len(response_body.encode("utf-8")) > MAX_RESPONSE_BYTES:
        raise RuntimeError("Discord response was too large")

    print(json.dumps({
        "status": response.status_code,
        "headers": dict(response.headers),
        "body": response_body,
    }, separators=(",", ":")))


if __name__ == "__main__":
    main()
