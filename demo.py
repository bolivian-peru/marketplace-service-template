#!/usr/bin/env python3
"""
Interactive Demo for YouTube Transcript Scraper
Showcases all features with a command-line interface.
"""

import sys
import json
from youtube_transcript import YouTubeTranscriptScraper
from x402_payment import X402PaymentHandler, create_payment_response


def print_header(title: str):
    """Print formatted header."""
    print("\n" + "=" * 60)
    print(f"  {title}")
    print("=" * 60)


def print_section(title: str):
    """Print section header."""
    print(f"\n📌 {title}")
    print("-" * 60)


def demo_video_id_extraction():
    """Demo video ID extraction."""
    print_header("🎬 Video ID Extraction Demo")
    
    scraper = YouTubeTranscriptScraper()
    
    test_urls = [
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
        "https://youtu.be/dQw4w9WgXcQ",
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "dQw4w9WgXcQ"
    ]
    
    print("\nTesting various URL formats:")
    for url in test_urls:
        video_id = scraper.extract_video_id(url)
        print(f"  Input:  {url}")
        print(f"  Output: {video_id}")
        print()


def demo_transcript_fetching():
    """Demo transcript fetching."""
    print_header("📝 Transcript Fetching Demo")
    
    scraper = YouTubeTranscriptScraper()
    
    # Use a well-known video ID
    video_id = "dQw4w9WgXcQ"
    
    print(f"\nFetching transcript for: {video_id}")
    print("(This requires internet connection)")
    print()
    
    try:
        result = scraper.fetch_transcript(video_id, 'en')
        
        if result['success']:
            print(f"✅ Success!")
            print(f"   Language: {result['language']['language_name']} ({result['language']['language_code']})")
            print(f"   Duration: {result['duration']:.1f} seconds")
            print(f"   Segments: {len(result['transcript'])}")
            
            print_section("First 5 Lines")
            for i, segment in enumerate(result['transcript'][:5], 1):
                print(f"  {i}. [{segment['offset']}] {segment['text']}")
            
            print_section("Plain Text Output")
            text = scraper.get_transcript_text(video_id)
            lines = text.split('\n')[:5]
            for line in lines:
                print(f"  {line}")
            print("  ...")
            
            print_section("With Timestamps")
            timestamped = scraper.get_transcript_with_timestamps(video_id)
            lines = timestamped.split('\n')[:5]
            for line in lines:
                print(f"  {line}")
            print("  ...")
            
        else:
            print(f"❌ Failed: {result.get('error', 'Unknown error')}")
            
            if 'available_languages' in result:
                print("\nAvailable languages:")
                for lang in result['available_languages']:
                    print(f"  - {lang['language_name']} ({lang['language_code']})")
    
    except Exception as e:
        print(f"❌ Error: {e}")
        print("\nNote: This demo requires internet access to fetch transcripts.")


def demo_language_detection():
    """Demo language detection."""
    print_header("🌍 Language Detection Demo")
    
    scraper = YouTubeTranscriptScraper()
    video_id = "dQw4w9WgXcQ"
    
    print(f"\nDetecting available languages for: {video_id}")
    print()
    
    try:
        languages = scraper.get_transcript_languages(video_id)
        
        if languages:
            print(f"Found {len(languages)} language(s):")
            for lang in languages:
                auto = " (auto-generated)" if lang.get('is_auto_generated') else ""
                print(f"  ✓ {lang['language_name']} ({lang['language_code']}){auto}")
        else:
            print("No languages detected (video may not have captions)")
    
    except Exception as e:
        print(f"Error: {e}")


def demo_payment_integration():
    """Demo x402 payment integration."""
    print_header("💰 x402 Payment Integration Demo")
    
    handler = X402PaymentHandler(wallet_address='DemoWallet123')
    
    print_section("1. Simulate Payment Requirement")
    
    mock_headers = {
        'www-authenticate': 'x402 scheme="x402-solana", address="7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", amount="0.01", currency="USDC"',
        'x-payment-network': 'solana-mainnet'
    }
    
    payment_info = handler.parse_payment_required(mock_headers)
    
    print("Server Response Headers:")
    for key, value in mock_headers.items():
        print(f"  {key}: {value}")
    
    print("\nParsed Payment Info:")
    print(json.dumps(payment_info, indent=2))
    
    print_section("2. Create Payment Payload")
    
    service_data = {'video_id': 'dQw4w9WgXcQ', 'amount': '0.01'}
    payment_payload = handler.create_payment_payload(payment_info, service_data)
    
    print("Payment Payload:")
    print(json.dumps(payment_payload, indent=2))
    
    print_section("3. Generate Payment Headers")
    
    payment_headers = handler.create_payment_headers(payment_payload)
    
    print("HTTP Headers for Retry:")
    for key, value in payment_headers.items():
        print(f"  {key}: {value[:50]}..." if len(value) > 50 else f"  {key}: {value}")
    
    print_section("4. API Payment Response")
    
    api_response = create_payment_response('dQw4w9WgXcQ', '0.01', 'USDC')
    
    print("402 Payment Required Response:")
    print(json.dumps(api_response, indent=2))


def demo_api_usage():
    """Demo API usage examples."""
    print_header("🔌 API Usage Demo")
    
    print("\nBase URL: http://localhost:8000")
    
    examples = [
        ("Health Check", "GET /health", "curl http://localhost:8000/health"),
        ("Get Transcript", "GET /api/transcript/<id>", "curl http://localhost:8000/api/transcript/dQw4w9WgXcQ"),
        ("With Language", "GET /api/transcript/<id>?lang=es", "curl http://localhost:8000/api/transcript/dQw4w9WgXcQ?lang=es"),
        ("Text Format", "GET /api/transcript/<id>?format=text", "curl http://localhost:8000/api/transcript/dQw4w9WgXcQ?format=text"),
        ("With Timestamps", "GET /api/transcript/<id>?format=timestamps", "curl http://localhost:8000/api/transcript/dQw4w9WgXcQ?format=timestamps"),
        ("Get Languages", "GET /api/languages/<id>", "curl http://localhost:8000/api/languages/dQw4w9WgXcQ"),
        ("Get Pricing", "GET /api/pricing", "curl http://localhost:8000/api/pricing"),
        ("POST Request", "POST /api/transcript", "curl -X POST ... (see examples.md)"),
    ]
    
    for i, (name, endpoint, command) in enumerate(examples, 1):
        print(f"\n{i}. {name}")
        print(f"   Endpoint: {endpoint}")
        print(f"   Command:  {command}")


def interactive_mode():
    """Interactive mode for user input."""
    print_header("🎮 Interactive Mode")
    
    scraper = YouTubeTranscriptScraper()
    
    while True:
        print("\nOptions:")
        print("  1. Fetch transcript")
        print("  2. Get available languages")
        print("  3. Extract video ID")
        print("  4. Back to main menu")
        print("  q. Quit")
        
        choice = input("\nYour choice: ").strip()
        
        if choice == 'q':
            break
        elif choice == '4':
            break
        elif choice == '1':
            video_input = input("Enter video URL or ID: ").strip()
            if video_input:
                video_id = scraper.extract_video_id(video_input)
                if video_id:
                    print(f"\nFetching transcript for: {video_id}")
                    result = scraper.fetch_transcript(video_id, 'en')
                    
                    if result['success']:
                        print(f"\n✅ Success! ({len(result['transcript'])} segments)")
                        print("\nFirst 3 lines:")
                        for seg in result['transcript'][:3]:
                            print(f"  [{seg['offset']}] {seg['text']}")
                    else:
                        print(f"\n❌ Failed: {result.get('error')}")
                else:
                    print("❌ Invalid video ID or URL")
        
        elif choice == '2':
            video_input = input("Enter video URL or ID: ").strip()
            if video_input:
                video_id = scraper.extract_video_id(video_input)
                if video_id:
                    print(f"\nChecking languages for: {video_id}")
                    languages = scraper.get_transcript_languages(video_id)
                    
                    if languages:
                        print(f"\nFound {len(languages)} language(s):")
                        for lang in languages:
                            print(f"  - {lang['language_name']} ({lang['language_code']})")
                    else:
                        print("\nNo languages detected")
                else:
                    print("❌ Invalid video ID or URL")
        
        elif choice == '3':
            video_input = input("Enter video URL or ID: ").strip()
            if video_input:
                video_id = scraper.extract_video_id(video_input)
                print(f"\nExtracted ID: {video_id or 'None'}")


def main():
    """Main demo function."""
    print("\n" + "🎬" * 30)
    print("  YouTube Transcript Scraper - Interactive Demo")
    print("🎬" * 30)
    
    while True:
        print("\n" + "=" * 60)
        print("  Demo Menu")
        print("=" * 60)
        print("\n  1. Video ID Extraction Demo")
        print("  2. Transcript Fetching Demo (requires internet)")
        print("  3. Language Detection Demo (requires internet)")
        print("  4. x402 Payment Integration Demo")
        print("  5. API Usage Demo")
        print("  6. Interactive Mode")
        print("  q. Quit")
        
        choice = input("\nYour choice: ").strip().lower()
        
        if choice == 'q':
            print("\n👋 Goodbye!\n")
            break
        elif choice == '1':
            demo_video_id_extraction()
        elif choice == '2':
            demo_transcript_fetching()
        elif choice == '3':
            demo_language_detection()
        elif choice == '4':
            demo_payment_integration()
        elif choice == '5':
            demo_api_usage()
        elif choice == '6':
            interactive_mode()
        else:
            print("\n❌ Invalid choice. Please try again.")
        
        input("\nPress Enter to continue...")
    
    print("\n✨ Demo complete! Check README.md and examples.md for more.\n")


if __name__ == '__main__':
    try:
        main()
    except KeyboardInterrupt:
        print("\n\n👋 Interrupted by user\n")
        sys.exit(0)
