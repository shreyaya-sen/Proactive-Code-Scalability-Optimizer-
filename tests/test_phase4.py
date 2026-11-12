import pytest

from analyzer.phase4 import PATTERNS, make_input
from analyzer.secret_scanner import scan_text


def test_make_input_has_requested_size():
    for pattern in PATTERNS:
        assert len(make_input(pattern, 50)) == 50


def test_make_input_is_repeatable():
    assert make_input("random", 100) == make_input("random", 100)


def test_make_input_rejects_unknown_pattern():
    with pytest.raises(ValueError):
        make_input("nonsense", 10)


def test_scan_finds_and_masks_a_key():
    text = 'GROQ_API_KEY = "gsk_' + "a" * 30 + '"\n'
    result = scan_text(text)

    assert result["count"] == 1
    assert result["findings"][0]["line"] == 1
    assert "a" * 10 not in result["findings"][0]["masked_value"]


def test_scan_ignores_placeholders():
    assert scan_text('API_KEY = "your_api_key_here"')["count"] == 0


def test_scan_clean_code_has_no_findings():
    assert scan_text("def add(a, b):\n    return a + b\n")["count"] == 0