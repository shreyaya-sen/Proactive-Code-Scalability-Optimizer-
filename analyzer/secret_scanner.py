"""Find likely hardcoded secrets. Values are always masked in the output."""

import re

PATTERNS = [
    ("groq_api_key", re.compile(r"gsk_[A-Za-z0-9]{20,}")),
    ("openai_style_key", re.compile(r"sk-[A-Za-z0-9_-]{20,}")),
    ("aws_access_key_id", re.compile(r"AKIA[0-9A-Z]{16}")),
    ("github_token", re.compile(r"gh[pousr]_[A-Za-z0-9]{36,}")),
    (
        "private_key_block",
        re.compile(
            r"-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----"
        ),
    ),
    (
        "hardcoded_credential",
        re.compile(
            r"""(?i)\b[\w-]*(?:api[_-]?key|secret|token|password|passwd|pwd)"""
            r"""[\w-]*\s*[:=]\s*["']([^"'\s]{8,})["']"""
        ),
    ),
]

PLACEHOLDER_HINTS = (
    "your", "example", "placeholder", "changeme", "xxxx", "<", "todo",
)


def mask(value):
    if len(value) <= 6:
        return "*" * len(value)

    return value[:3] + "******"


def scan_text(text):
    findings = []

    for line_number, line in enumerate(text.splitlines(), start=1):
        used_spans = []

        for category, pattern in PATTERNS:
            for match in pattern.finditer(line):
                value = match.group(1) if match.groups() else match.group(0)
                start, end = match.span()

                if any(start < b and a < end for a, b in used_spans):
                    continue

                if category == "hardcoded_credential" and any(
                    hint in value.lower() for hint in PLACEHOLDER_HINTS
                ):
                    continue

                used_spans.append((start, end))
                findings.append({
                    "line": line_number,
                    "category": category,
                    "masked_value": mask(value),
                    "evidence_type": "static",
                    "message": "Possible hardcoded secret.",
                })

    return {
        "status": "success",
        "count": len(findings),
        "findings": findings,
        "limitation": (
            "Pattern matching can miss secrets and can flag harmless "
            "text. Review each finding."
        ),
    }
