import time
import random
import json
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeoutError
from playwright_stealth import Stealth
# === Configuration ===
# Input your standard proxy credentials here
PROXY_SERVER = "http://proxies.sx:8000"  # Replace with your proxy server address and port
PROXY_USERNAME = "your_username"         # Replace with your proxy username
PROXY_PASSWORD = "your_password"         # Replace with your proxy password

# Amazon Target URL for Bounty
TARGET_URL = "https://www.amazon.com/dp/B07ZPKN6QH"  

def extract_product_data(page):
    """
    Extracts the product name and price from the page.
    Note: Selectors must be adjusted to match the target website's DOM structure.
    """
    try:
        # Wait for the main product element to load
        page.wait_for_selector("#productTitle", timeout=10000)
        
        # Extract product name
        product_name = page.locator("#productTitle").first.inner_text()
        
        # Extract price
        price_locator = page.locator("span.a-price-whole")
        
        if price_locator.count() > 0:
            price = price_locator.first.inner_text()
        else:
            price = "Price not found"

        return {
            "Product Name": product_name.strip() if product_name else "Unknown",
            "Price": price.strip()
        }
    except Exception as e:
        print(f"Failed to extract data: {e}")
        return None

def main():
    print(f"Starting Price Monitor scraper for {TARGET_URL}...")
    
    with sync_playwright() as p:
        # Configure the standard proxy settings
        proxy_settings = {
            "server": PROXY_SERVER,
            "username": PROXY_USERNAME,
            "password": PROXY_PASSWORD
        }
        
        try:
            # Launch a persistent context with a dedicated developer profile
            print("Launching persistent browser context...")
            try:
                context = p.chromium.launch_persistent_context(
                    user_data_dir='/Users/bigdaddy/bounty_chrome',
                    channel='chrome',
                    headless=False,
                    proxy=proxy_settings,
                    args=['--no-first-run', '--no-default-browser-check'],
                    ignore_default_args=['--enable-automation']
                )
            except Exception as e:
                print("\nCRITICAL ERROR: Browser failed to launch.")
                print("This is usually because the user data directory is already in use by another Chrome window.")
                print(f"Please completely close Chrome and try again. Details: {e}\n")
                return
            
            # Persistent context usually has one open page by default
            page = context.pages[0] if context.pages else context.new_page()
            
            # Apply stealth to the page
            stealth = Stealth()
            stealth.apply_stealth_sync(page)
            
            # Navigate to the target URL immediately
            print(f"Navigating to {TARGET_URL}...")
            response = page.goto(TARGET_URL, timeout=30000, wait_until="domcontentloaded")
            
            # Manual Login Pause: Open Playwright Inspector
            page.pause()
            
            # Random delay of 3-7 seconds after page loads
            delay = random.uniform(3, 7)
            print(f"Waiting for a random delay of {delay:.2f} seconds...")
            time.sleep(delay)
            
            # Check for existing cookies (basic check if we are logged into the target site)
            # You can customize the 'domain' filter below based on the site you are automating
            target_cookies = [c for c in context.cookies() if 'vercel' in c['domain']]
            
            if not target_cookies:
                print("No login cookie detected. Pausing for 300 seconds so you can manually log in...")
                time.sleep(300)
            
            # Handle HTTP errors like 'Page Not Found' (404) or Server Errors (500)
            if response and not response.ok:
                print(f"Error: Received HTTP status {response.status} ({response.status_text})")
                return
            
            # Extract the data
            print("Page loaded successfully. Extracting data...")
            data = extract_product_data(page)
            
            if data:
                print("\n=== Extracted Data ===")
                for key, value in data.items():
                    print(f"{key}: {value}")
                print("======================\n")
                
                with open("bounty_output.json", "w") as f:
                    json.dump(data, f, indent=4)
                print("Saved output to bounty_output.json")
            
        except PlaywrightTimeoutError:
            # Handle 'Timeout' errors gracefully
            print(f"Error: The request to {TARGET_URL} timed out. The page took too long to respond.")
            if 'page' in locals(): page.pause()
        except Exception as e:
            # Catch all other unexpected errors
            print(f"An unexpected error occurred: {e}")
            if 'page' in locals(): page.pause()
        finally:
            if 'context' in locals():
                context.close()

if __name__ == "__main__":
    main()
