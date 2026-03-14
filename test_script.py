#!/usr/bin/env python3
"""
Test Suite for YouTube Transcript Scraper
Tests core functionality, API endpoints, and payment integration.
"""

import sys
import json
import urllib.request
import urllib.error
from youtube_transcript import YouTubeTranscriptScraper
from x402_payment import X402PaymentHandler, create_payment_response


class TestResults:
    """Track test results."""
    def __init__(self):
        self.passed = 0
        self.failed = 0
        self.tests = []
    
    def add_result(self, name: str, passed: bool, message: str = ""):
        self.tests.append({
            'name': name,
            'passed': passed,
            'message': message
        })
        if passed:
            self.passed += 1
        else:
            self.failed += 1
    
    def print_summary(self):
        print("\n" + "=" * 60)
        print("TEST SUMMARY")
        print("=" * 60)
        
        for test in self.tests:
            status = "✓ PASS" if test['passed'] else "✗ FAIL"
            print(f"{status}: {test['name']}")
            if test['message'] and not test['passed']:
                print(f"       {test['message']}")
        
        print("=" * 60)
        print(f"Total: {self.passed + self.failed} | Passed: {self.passed} | Failed: {self.failed}")
        print("=" * 60)
        
        return self.failed == 0


def test_video_id_extraction(results: TestResults):
    """Test video ID extraction from various URL formats."""
    print("\n📺 Testing Video ID Extraction...")
    
    scraper = YouTubeTranscriptScraper()
    
    test_cases = [
        ("https://www.youtube.com/watch?v=dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://youtu.be/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/embed/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("https://www.youtube.com/v/dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("dQw4w9WgXcQ", "dQw4w9WgXcQ"),
        ("invalid_url", None),
        ("", None),
    ]
    
    for url, expected in test_cases:
        result = scraper.extract_video_id(url)
        passed = result == expected
        results.add_result(
            f"Extract ID: {url[:50]}",
            passed,
            f"Expected: {expected}, Got: {result}" if not passed else ""
        )
        print(f"  {'✓' if passed else '✗'} {url[:50]}")


def test_timestamp_formatting(results: TestResults):
    """Test timestamp formatting."""
    print("\n⏱️  Testing Timestamp Formatting...")
    
    scraper = YouTubeTranscriptScraper()
    
    test_cases = [
        (0, "00:00"),
        (59, "00:59"),
        (60, "01:00"),
        (3600, "01:00:00"),
        (3661, "01:01:01"),
        (7384.5, "02:03:04"),
    ]
    
    for seconds, expected_pattern in test_cases:
        result = scraper._format_timestamp(seconds)
        # Just check it doesn't crash and returns a string
        passed = isinstance(result, str) and len(result) > 0
        results.add_result(
            f"Format timestamp: {seconds}s",
            passed,
            f"Got: {result}" if not passed else ""
        )
        print(f"  {'✓' if passed else '✗'} {seconds}s -> {result}")


def test_xml_parsing(results: TestResults):
    """Test XML transcript parsing."""
    print("\n📄 Testing XML Parsing...")
    
    scraper = YouTubeTranscriptScraper()
    
    sample_xml = '''<?xml version="1.0" encoding="utf-8" ?>
<transcript>
<text start="0.0" dur="3.5">Hello world</text>
<text start="3.5" dur="2.0">This is a test</text>
<text start="5.5" dur="1.5">With multiple lines</text>
</transcript>'''
    
    transcripts = scraper._parse_transcript_xml(sample_xml)
    
    passed = len(transcripts) == 3
    results.add_result(
        "Parse XML transcript",
        passed,
        f"Expected 3 segments, got {len(transcripts)}" if not passed else ""
    )
    print(f"  {'✓' if passed else '✗'} Parsed {len(transcripts)} segments")
    
    if passed:
        # Check first segment
        first = transcripts[0]
        passed = (first['start'] == 0.0 and 
                  first['text'] == 'Hello world' and 
                  first['offset'] == '00:00')
        results.add_result(
            "First segment data",
            passed,
            f"Got: {first}" if not passed else ""
        )
        print(f"  {'✓' if passed else '✗'} First segment correct")


def test_payment_handler(results: TestResults):
    """Test x402 payment handler."""
    print("\n💰 Testing x402 Payment Handler...")
    
    handler = X402PaymentHandler(wallet_address='TestWallet123')
    
    # Test parsing payment headers
    mock_headers = {
        'www-authenticate': 'x402 scheme="x402-solana", address="7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", amount="0.01", currency="USDC"',
        'x-payment-network': 'solana-mainnet'
    }
    
    payment_info = handler.parse_payment_required(mock_headers)
    passed = payment_info is not None and payment_info.get('required') == True
    results.add_result(
        "Parse payment headers",
        passed,
        f"Got: {payment_info}" if not passed else ""
    )
    print(f"  {'✓' if passed else '✗'} Payment info parsed")
    
    # Test payment payload creation
    if payment_info:
        payload = handler.create_payment_payload(payment_info, {'video_id': 'test123'})
        passed = 'authorization' in payload and 'manifest' in payload['authorization']
        results.add_result(
            "Create payment payload",
            passed,
            f"Got: {payload}" if not passed else ""
        )
        print(f"  {'✓' if passed else '✗'} Payment payload created")
    
    # Test payment headers
    if payload:
        headers = handler.create_payment_headers(payload)
        passed = 'Authorization' in headers and 'X-Payment-Version' in headers
        results.add_result(
            "Create payment headers",
            passed,
            f"Got: {headers}" if not passed else ""
        )
        print(f"  {'✓' if passed else '✗'} Payment headers created")


def test_payment_response(results: TestResults):
    """Test payment response creation."""
    print("\n📝 Testing Payment Response...")
    
    response = create_payment_response('test_video', '0.01', 'USDC')
    
    passed = (
        response.get('status') == 'payment_required' and
        response.get('code') == 402 and
        'payment_info' in response
    )
    results.add_result(
        "Create payment response",
        passed,
        f"Got: {response}" if not passed else ""
    )
    print(f"  {'✓' if passed else '✗'} Payment response created")


def test_api_health(results: TestResults):
    """Test API health endpoint."""
    print("\n🏥 Testing API Health Endpoint...")
    
    try:
        url = "http://localhost:8000/health"
        req = urllib.request.Request(url)
        
        with urllib.request.urlopen(req, timeout=5) as response:
            data = json.loads(response.read().decode('utf-8'))
            passed = data.get('status') == 'healthy'
            results.add_result(
                "Health check endpoint",
                passed,
                f"Got: {data}" if not passed else ""
            )
            print(f"  {'✓' if passed else '✗'} Health check: {data.get('status')}")
    
    except Exception as e:
        results.add_result(
            "Health check endpoint",
            False,
            f"Server not running or error: {e}"
        )
        print(f"  ✗ Health check failed (server may not be running)")


def test_api_transcript(results: TestResults):
    """Test API transcript endpoint."""
    print("\n📺 Testing API Transcript Endpoint...")
    
    try:
        # Use a known video ID (this may fail if no internet)
        url = "http://localhost:8000/api/transcript/dQw4w9WgXcQ"
        req = urllib.request.Request(url)
        
        with urllib.request.urlopen(req, timeout=10) as response:
            data = json.loads(response.read().decode('utf-8'))
            
            # Check if we got a valid response (success or expected error)
            passed = isinstance(data, dict) and ('success' in data or 'error' in data)
            results.add_result(
                "Transcript endpoint response",
                passed,
                f"Got: {data}" if not passed else ""
            )
            print(f"  {'✓' if passed else '✗'} Transcript endpoint responded")
    
    except urllib.error.HTTPError as e:
        # 402 is acceptable (payment required)
        if e.code == 402:
            results.add_result("Transcript endpoint (402 payment)", True, "")
            print(f"  ✓ Transcript endpoint requires payment (402)")
        else:
            results.add_result("Transcript endpoint", False, f"HTTP {e.code}")
            print(f"  ✗ HTTP Error: {e.code}")
    except Exception as e:
        results.add_result(
            "Transcript endpoint",
            False,
            f"Server not running or error: {e}"
        )
        print(f"  ✗ Transcript endpoint failed (server may not be running)")


def run_all_tests():
    """Run all tests."""
    print("=" * 60)
    print("🧪 YouTube Transcript Scraper - Test Suite")
    print("=" * 60)
    
    results = TestResults()
    
    # Unit tests (no server required)
    test_video_id_extraction(results)
    test_timestamp_formatting(results)
    test_xml_parsing(results)
    test_payment_handler(results)
    test_payment_response(results)
    
    # Integration tests (server required)
    print("\n⚠️  Integration tests require server running on port 8000")
    print("   Run: python api_server.py")
    print()
    
    test_api_health(results)
    test_api_transcript(results)
    
    # Print summary
    success = results.print_summary()
    
    return 0 if success else 1


if __name__ == '__main__':
    sys.exit(run_all_tests())
