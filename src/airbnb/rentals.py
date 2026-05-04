

"""
Airbnb & Short-Term Rental Intelligence API
-------------------------------------------
API for extracting Airbnb property listings, pricing, availability calendars,
reviews, and host data for any market. Calculate average daily rates,
occupancy estimates, and revenue potential by neighborhood.
"""

import os
import json
import time
import random
import re
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional, Union
from dataclasses import dataclass

import requests
from bs4 import BeautifulSoup
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException

from ..proxy import get_proxy, proxy_fetch

# Constants
AIRBNB_BASE_URL = "https://www.airbnb.com"
AIRBNB_API_KEY = "d306zoyjsyarp7ifhu67rjxn52tv0t20"  # Airbnb's public API key
MOBILE_USER_AGENT = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
DEFAULT_TIMEOUT = 30
MAX_RETRIES = 3
RETRY_DELAY = 2

@dataclass
class AirbnbListing:
    """Data class for Airbnb listing information"""
    id: str
    title: str
    type: str
    price_per_night: Optional[float]
    total_price: Optional[float]
    currency: str
    rating: Optional[float]
    reviews_count: Optional[int]
    superhost: bool
    bedrooms: int
    bathrooms: int
    max_guests: int
    amenities: List[str]
    images: List[str]
    url: str
    lat: Optional[float]
    lng: Optional[float]
    description: Optional[str] = None
    neighborhood: Optional[str] = None
    host_name: Optional[str] = None
    host_superhost: bool = False
    host_response_rate: Optional[str] = None
    host_response_time: Optional[str] = None
    house_rules: Optional[List[str]] = None
    check_in_time: Optional[str] = None
    check_out_time: Optional[str] = None
    cancellation_policy: Optional[str] = None

@dataclass
class AirbnbReview:
    """Data class for Airbnb review information"""
    author: str
    rating: Optional[float]
    date: str
    text: str
    response: Optional[str] = None

@dataclass
class MarketStats:
    """Data class for market statistics"""
    location: str
    avg_daily_rate: Optional[float]
    median_daily_rate: Optional[float]
    total_listings: int
    avg_rating: Optional[float]
    superhost_pct: Optional[float]
    price_distribution: Dict[str, int]
    property_types: Dict[str, int]
    occupancy_estimate: Optional[float] = None
    revenue_potential: Optional[float] = None

class AirbnbScraper:
    """Main Airbnb scraper class with mobile proxy support"""

    def __init__(self):
        self.proxy = get_proxy()
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': MOBILE_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
        })

    def _get_mobile_proxy_headers(self) -> Dict[str, str]:
        """Get headers for mobile proxy requests"""
        return {
            'User-Agent': MOBILE_USER_AGENT,
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'en-US,en;q=0.5',
            'Accept-Encoding': 'gzip, deflate',
            'Connection': 'keep-alive',
            'Cache-Control': 'no-cache',
            'X-Forwarded-For': self.proxy.get('ip', ''),
        }

    def _make_request(self, url: str, use_selenium: bool = False) -> str:
        """
        Make a request to Airbnb with mobile proxy support
        Args:
            url: URL to request
            use_selenium: Whether to use Selenium for JavaScript rendering
        Returns:
            HTML content
        """
        headers = self._get_mobile_proxy_headers()

        for attempt in range(MAX_RETRIES):
            try:
                if use_selenium:
                    return self._make_selenium_request(url)

                response = proxy_fetch(url, headers=headers, timeout=DEFAULT_TIMEOUT)
                if response.status_code == 403:
                    raise Exception(f"Airbnb blocked the request (403). Proxy IP may be flagged: {self.proxy.get('ip')}")

                response.raise_for_status()
                return response.text

            except Exception as e:
                if attempt == MAX_RETRIES - 1:
                    raise Exception(f"Failed to fetch {url} after {MAX_RETRIES} attempts: {str(e)}")

                delay = RETRY_DELAY * (attempt + 1)
                print(f"Attempt {attempt + 1} failed for {url}. Retrying in {delay} seconds...")
                time.sleep(delay)

        raise Exception(f"Failed to fetch {url} after {MAX_RETRIES} attempts")

    def _make_selenium_request(self, url: str) -> str:
        """Make a request using Selenium with mobile emulation"""
        try:
            chrome_options = Options()
            chrome_options.add_argument("--headless")
            chrome_options.add_argument("--disable-gpu")
            chrome_options.add_argument("--window-size=375,812")  # iPhone X dimensions
            chrome_options.add_argument("--disable-dev-shm-usage")
            chrome_options.add_argument("--no-sandbox")

            # Mobile emulation
            mobile_emulation = {
                "deviceMetrics": {"width": 375, "height": 812, "pixelRatio": 3.0},
                "userAgent": MOBILE_USER_AGENT
            }
            chrome_options.add_experimental_option("mobileEmulation", mobile_emulation)

            driver = webdriver.Chrome(options=chrome_options)
            driver.get(url)

            # Wait for page to load
            WebDriverWait(driver, DEFAULT_TIMEOUT).until(
                EC.presence_of_element_located((By.TAG_NAME, "body"))
            )

            html = driver.page_source
            driver.quit()
            return html

        except (TimeoutException, WebDriverException) as e:
            raise Exception(f"Selenium request failed: {str(e)}")

    def _extract_listing_from_script(self, html: str) -> List[Dict[str, Any]]:
        """
        Extract listing data from embedded JSON in the HTML
        Args:
            html: HTML content
        Returns:
            List of listing data dictionaries
        """
        soup = BeautifulSoup(html, 'html.parser')

        # Look for script tags containing listing data
        script_tags = soup.find_all('script', type='application/json')

        for script in script_tags:
            try:
                data = json.loads(script.string)
                if 'searchResults' in data:
                    return data['searchResults']
            except (json.JSONDecodeError, KeyError):
                continue

        return []

    def _parse_listing_card(self, card_html: str) -> Optional[AirbnbListing]:
        """
        Parse a single listing card from HTML
        Args:
            card_html: HTML content of a listing card
        Returns:
            AirbnbListing object or None if parsing fails
        """
        soup = BeautifulSoup(card_html, 'html.parser')

        # Extract listing ID
        listing_id = None
        id_element = soup.find('a', href=True)
        if id_element and '/rooms/' in id_element['href']:
            listing_id = id_element['href'].split('/rooms/')[-1].split('?')[0]

        if not listing_id:
            return None

        # Title
        title = soup.find('div', {'data-testid': 'listing-card-title'})
        title = title.get_text(strip=True) if title else ''

        # Type
        listing_type = soup.find('div', {'data-testid': 'listing-card-subtitle'})
        listing_type = listing_type.get_text(strip=True) if listing_type else ''

        # Price
        price_per_night = None
        price_element = soup.find('div', {'data-testid': 'price-availability-row'})
        if price_element:
            price_text = price_element.get_text(strip=True)
            price_match = re.search(r'\$(\d[\d,]*)', price_text)
            if price_match:
                price_per_night = float(price_match.group(1).replace(',', ''))

        # Rating
        rating = None
        rating_element = soup.find('div', {'data-testid': 'rating'})
        if rating_element:
            rating_text = rating_element.get_text(strip=True)
            rating_match = re.search(r'(\d+\.\d+)', rating_text)
            if rating_match:
                rating = float(rating_match.group(1))

        # Reviews count
        reviews_count = None
        reviews_element = soup.find('div', {'data-testid': 'reviews'})
        if reviews_element:
            reviews_text = reviews_element.get_text(strip=True)
            reviews_match = re.search(r'(\d+)', reviews_text)
            if reviews_match:
                reviews_count = int(reviews_match.group(1))

        # Superhost
        superhost = 'superhost' in card_html.lower()

        # Bedrooms, bathrooms, guests
        bedrooms = 0
        bathrooms = 0
        max_guests = 2  # Default

        specs = soup.find_all('li')
        for spec in specs:
            text = spec.get_text(strip=True).lower()
            if 'bedroom' in text:
                bedrooms_match = re.search(r'(\d+)', text)
                if bedrooms_match:
                    bedrooms = int(bedrooms_match.group(1))
            elif 'bathroom' in text:
                bathrooms_match = re.search(r'(\d+)', text)
                if bathrooms_match:
                    bathrooms = int(bathrooms_match.group(1))
            elif 'guest' in text:
                guests_match = re.search(r'(\d+)', text)
                if guests_match:
                    max_guests = int(guests_match.group(1))

        # Amenities
        amenities = []
        amenity_elements = soup.find_all('div', {'data-testid': 'amenity'})
        for amenity in amenity_elements:
            amenity_text = amenity.get_text(strip=True)
            if amenity_text and amenity_text not in amenities:
                amenities.append(amenity_text)

        # Images
        images = []
        img_elements = soup.find_all('img', {'src': True})
        for img in img_elements:
            src = img['src']
            if 'a0.muscache.com' in src and src not in images:
                images.append(src)

        # URL
        url = f"{AIRBNB_BASE_URL}/rooms/{listing_id}"

        return AirbnbListing(
            id=listing_id,
            title=title,
            type=listing_type,
            price_per_night=price_per_night,
            total_price=None,
            currency='USD',
            rating=rating,
            reviews_count=reviews_count,
            superhost=superhost,
            bedrooms=bedrooms,
            bathrooms=bathrooms,
            max_guests=max_guests,
            amenities=amenities[:10],  # Limit to 10 amenities
            images=images[:5],  # Limit to 5 images
            url=url,
            lat=None,
            lng=None
        )

    def search_listings(
        self,
        location: str,
        checkin: str,
        checkout: str,
        guests: int = 2,
        price_min: Optional[float] = None,
        price_max: Optional[float] = None,
        limit: int = 20
    ) -> List[AirbnbListing]:
        """
        Search for Airbnb listings in a specific location
        Args:
            location: Location to search (e.g., "Miami Beach")
            checkin: Check-in date (YYYY-MM-DD)
            checkout: Check-out date (YYYY-MM-DD)
            guests: Number of guests
            price_min: Minimum price per night
            price_max: Maximum price per night
            limit: Maximum number of results to return
        Returns:
            List of AirbnbListing objects
        """
        # Validate dates
        try:
            checkin_date = datetime.strptime(checkin, "%Y-%m-%d")
            checkout_date = datetime.strptime(checkout, "%Y-%m-%d")
            if checkout_date <= checkin_date:
                raise ValueError("Checkout date must be after checkin date")
        except ValueError as e:
            raise ValueError(f"Invalid date format: {str(e)}")

        # Build search URL
        params = {
            'search_mode': 'regular_search',
            'location': location,
            'checkin': checkin,
            'checkout': checkout,
            'adults': str(max(1, guests)),
        }

        if price_min:
            params['price_min'] = str(price_min)
        if price_max:
            params['price_max'] = str(price_max)

        url = f"{AIRBNB_BASE_URL}/s/{location.replace(' ', '-')}/homes"

        # Make request with JavaScript rendering
        html = self._make_request(url, use_selenium=True)

        # Parse listings
        listings = []
        soup = BeautifulSoup(html, 'html.parser')

        # Try to extract from script tags first
        script_listings = self._extract_listing_from_script(html)
        if script_listings:
            for listing_data in script_listings:
                if 'listing' in listing_data:
                    listing = self._parse_listing_data(listing_data['listing'])
                    if listing:
                        listings.append(listing)
        else:
            # Fallback to parsing listing cards
            listing_cards = soup.find_all('div', {'data-testid': 'card-container'})
            for card in listing_cards[:limit]:
                listing = self._parse_listing_card(str(card))
                if listing:
                    listings.append(listing)

        return listings[:limit]

    def _parse_listing_data(self, listing_data: Dict[str, Any]) -> Optional[AirbnbListing]:
        """
        Parse listing data from Airbnb's API response
        Args:
            listing_data: Dictionary containing listing data
        Returns:
            AirbnbListing object or None if parsing fails
        """
        try:
            listing_id = str(listing_data.get('id', listing_data.get('listingId', '')))
            if not listing_id:
                return None

            title = listing_data.get('name', listing_data.get('title', ''))
            listing_type = listing_data.get('roomTypeCategory', listing_data.get('propertyType', ''))

            # Price
            price_per_night = None
            pricing = listing_data.get('pricingQuote', {})
            if pricing:
                rate = pricing.get('rate', {})
                if rate:
                    price_per_night = float(rate.get('amount', 0))

            # Rating
            rating = None
            if listing_data.get('avgRating'):
                rating = float(listing_data['avgRating'])

            # Reviews count
            reviews_count = None
            if listing_data.get('reviewsCount'):
                reviews_count = int(listing_data['reviewsCount'])

            # Superhost
            superhost = listing_data.get('isSuperhost', False)

            # Bedrooms, bathrooms, guests
            bedrooms = int(listing_data.get('bedrooms', 0))
            bathrooms = int(listing_data.get('bathrooms', 0))
            max_guests = int(listing_data.get('personCapacity', listing_data.get('maxGuests', 2)))

            # Amenities
            amenities = listing_data.get('previewAmenities', [])
            if isinstance(amenities, list):
                amenities = [str(a) for a in amenities[:10]]  # Limit to 10 amenities
            else:
                amenities = []

            # Images
            images = []
            pictures = listing_data.get('contextualPictures', [])
            if isinstance(pictures, list):
                for pic in pictures[:5]:  # Limit to 5 images
                    if pic.get('picture'):
                        images.append(pic['picture'])
                    elif pic.get('large'):
                        images.append(pic['large'])
                    elif pic.get('url'):
                        images.append(pic['url'])

            # Coordinates
            lat = None
            lng = None
            coordinate = listing_data.get('coordinate', {})
            if coordinate:
                lat = float(coordinate.get('latitude', 0))
                lng = float(coordinate.get('longitude', 0))

            # URL
            url = f"{AIRBNB_BASE_URL}/rooms/{listing_id}"

            return AirbnbListing(
                id=listing_id,
                title=title,
                type=listing_type,
                price_per_night=price_per_night,
                total_price=None,
                currency='USD',
                rating=rating,
                reviews_count=reviews_count,
                superhost=superhost,
                bedrooms=bedrooms,
                bathrooms=bathrooms,
                max_guests=max_guests,
                amenities=amenities,
                images=images,
                url=url,
                lat=lat,
                lng=lng
            )

        except Exception as e:
            print(f"Error parsing listing data: {str(e)}")
            return None

    def get_listing_details(self, listing_id: str) -> Optional[AirbnbListing]:
        """
        Get detailed information for a specific listing
        Args:
            listing_id: Airbnb listing ID
        Returns:
            AirbnbListing object with detailed information or None if not found
        """
        url = f"{AIRBNB_BASE_URL}/rooms/{listing_id}"

        # Make request with JavaScript rendering
        html = self._make_request(url, use_selenium=True)

        # Parse details
        soup = BeautifulSoup(html, 'html.parser')

        # Try to extract from JSON-LD
        json_ld = None
        script_tag = soup.find('script', type='application/ld+json')
        if script_tag:
            try:
                data = json.loads(script_tag.string)
                if isinstance(data, list) and len(data) > 0:
                    json_ld = data[0]
                elif isinstance(data, dict):
                    json_ld = data
            except json.JSONDecodeError:
                pass

        # Title
        title = ''
        if json_ld and json_ld.get('name'):
            title = json_ld['name']
        else:
            h1 = soup.find('h1')
            if h1:
                title = h1.get_text(strip=True)

        # Description
        description = ''
        desc_section = soup.find('div', {'data-section-id': 'DESCRIPTION_DEFAULT'})
        if desc_section:
            description = desc_section.get_text(strip=True)[:2000]  # Limit to 2000 chars

        # Price
        price_per_night = None
        price_element = soup.find('div', {'data-testid': 'price-availability-row'})
        if price_element:
            price_text = price_element.get_text(strip=True)
            price_match = re.search(r'\$(\d[\d,]*)', price_text)
            if price_match:
                price_per_night = float(price_match.group(1).replace(',', ''))

        # Rating
        rating = None
        if json_ld and json_ld.get('aggregateRating', {}).get('ratingValue'):
            rating = float(json_ld['aggregateRating']['ratingValue'])
        else:
            rating_element = soup.find('div', {'data-testid': 'rating'})
            if rating_element:
                rating_text = rating_element.get_text(strip=True)
                rating_match = re.search(r'(\d+\.\d+)', rating_text)
                if rating_match:
                    rating = float(rating_match.group(1))

        # Reviews count
        reviews_count = None
        if json_ld and json_ld.get('aggregateRating', {}).get('reviewCount'):
            reviews_count = int(json_ld['aggregateRating']['reviewCount'])
        else:
            reviews_element = soup.find('div', {'data-testid': 'reviews'})
            if reviews_element:
                reviews_text = reviews_element.get_text(strip=True)
                reviews_match = re.search(r'(\d+)', reviews_text)
                if reviews_match:
                    reviews_count = int(reviews_match.group(1))

        # Type
        listing_type = ''
        type_element = soup.find('div', {'data-testid': 'listing-type'})
        if type_element:
            listing_type = type_element.get_text(strip=True)

        # Host information
        host_name = ''
        host_superhost = False
        host_response_rate = None
        host_response_time = None

        host_element = soup.find('div', {'data-testid': 'host-info'})
        if host_element:
            host_name_element = host_element.find('span', {'data-testid': 'host-name'})
            if host_name_element:
                host_name = host_name_element.get_text(strip=True)

            superhost_element = host_element.find('span', string='Superhost')
            if superhost_element:
                host_superhost = True

            response_rate_element = host_element.find(string='Response rate:')
            if response_rate_element:
                response_rate_text = response_rate_element.parent.get_text(strip=True)
                host_response_rate = response_rate_text.split(':')[-1].strip()

            response_time_element = host_element.find(string='Response time:')
            if response_time_element:
                response_time_text = response_time_element.parent.get_text(strip=True)
                host_response_time = response_time_text.split(':')[-1].strip()

        # Bedrooms, bathrooms, guests
        bedrooms = 0
        bathrooms = 0
        max_guests = 2

        specs = soup.find_all('li')
        for spec in specs:
            text = spec.get_text(strip=True).lower()
            if 'bedroom' in text:
                bedrooms_match = re.search(r'(\d+)', text)
                if bedrooms_match:
                    bedrooms = int(bedrooms_match.group(1))
            elif 'bathroom' in text:
                bathrooms_match = re.search(r'(\d+)', text)
                if bathrooms_match:
                    bathrooms = int(bathrooms_match.group(1))
            elif 'guest' in text:
                guests_match = re.search(r'(\d+)', text)
                if guests_match:
                    max_guests = int(guests_match.group(1))

        # Amenities
        amenities = []
        amenity_section = soup.find('div', {'data-section-id': 'AMENITIES_DEFAULT'})
        if amenity_section:
            amenity_items = amenity_section.find_all('div', {'role': 'button'})
            for item in amenity_items:
                amenity_text = item.get_text(strip=True)
                if amenity_text and amenity_text not in amenities:
                    amenities.append(amenity_text)

        # Images
        images = []
        img_elements = soup.find_all('img', {'src': True})
        for img in img_elements:
            src = img['src']
            if 'a0.muscache.com' in src and src not in images:
                images.append(src)

        # House rules
        house_rules = []
        rules_section = soup.find('div', {'data-section-id': 'POLICIES_DEFAULT'})
        if rules_section:
            rule_items = rules_section.find_all('div', {'role': 'button'})
            for item in rule_items:
                rule_text = item.get_text(strip=True)
                if rule_text and rule_text not in house_rules:
                    house_rules.append(rule_text)

        # Check-in/out times
        check_in_time = None
        check_out_time = None

        time_elements = soup.find_all('div', {'data-testid': 'structured-listing-page-details'})
        for element in time_elements:
            text = element.get_text(strip=True)
            if 'Check-in' in text:
                check_in_time = text.split('Check-in')[-1].strip()
            elif 'Check-out' in text:
                check_out_time = text.split('Check-out')[-1].strip()

        # Cancellation policy
        cancellation_policy = None
        cancel_element = soup.find(string='Cancellation policy:')
        if cancel_element:
            cancel_text = cancel_element.parent.get_text(strip=True)
            cancellation_policy = cancel_text.split('Cancellation policy:')[-1].strip()

        # Neighborhood
        neighborhood = None
        location_section = soup.find('div', {'data-section-id': 'LOCATION_DEFAULT'})
        if location_section:
            h3 = location_section.find('h3')
            if h3:
                neighborhood = h3.get_text(strip=True)

        return AirbnbListing(
            id=listing_id,
            title=title,
            type=listing_type,
            price_per_night=price_per_night,
            total_price=None,
            currency='USD',
            rating=rating,
            reviews_count=reviews_count,
            superhost=host_superhost,
            bedrooms=bedrooms,
            bathrooms=bathrooms,
            max_guests=max_guests,
            amenities=amenities[:20],  # Limit to 20 amenities
            images=images[:10],  # Limit to 10 images
            url=f"{AIRBNB_BASE_URL}/rooms/{listing_id}",
            lat=None,
            lng=None,
            description=description[:3000] if description else None,
            neighborhood=neighborhood,
            host_name=host_name if host_name else None,
            host_superhost=host_superhost,
            host_response_rate=host_response_rate,
            host_response_time=host_response_time,
            house_rules=house_rules[:10] if house_rules else None,
            check_in_time=check_in_time,
            check_out_time=check_out_time,
            cancellation_policy=cancellation_policy
        )

    def get_listing_reviews(self, listing_id: str, limit: int = 10) -> List[AirbnbReview]:
        """
        Get reviews for a specific listing
        Args:
            listing_id: Airbnb listing ID
            limit: Maximum number of reviews to return
        Returns:
            List of AirbnbReview objects
        """
        url = f"{AIRBNB_BASE_URL}/rooms/{listing_id}/reviews"

        # Make request with JavaScript rendering
        html = self._make_request(url, use_selenium=True)

        # Parse reviews
        reviews = []
        soup = BeautifulSoup(html, 'html.parser')

        # Find review blocks
        review_blocks = soup.find_all('div', {'data-testid': 'pdp-review'})
        for block in review_blocks[:limit]:
            try:
                # Author
                author_element = block.find('span', {'class': 'l1ovpqfx'})
                author = author_element.get_text(strip=True) if author_element else 'Guest'

                # Date
                date_element = block.find('span', {'class': 'od11thwi'})
                date = date_element.get_text(strip=True) if date_element else ''

                # Rating
                rating_element = block.find('div', {'aria-label': True})
                rating = None
                if rating_element:
                    aria_label = rating_element['aria-label']
                    rating_match = re.search(r'(\d+\.\d+)', aria_label)
                    if rating_match:
                        rating = float(rating_match.group(1))

                # Text
                text_element = block.find('div', {'class': 'f12phz7m'})
                text = text_element.get_text(strip=True) if text_element else ''

                # Response
                response = None
                response_element = block.find('div', {'class': 'l1q8mbjy'})
                if response_element:
                    response = response_element.get_text(strip=True)

                reviews.append(AirbnbReview(
                    author=author,
                    rating=rating,
                    date=date,
                    text=text,
                    response=response
                ))

            except Exception as e:
                print(f"Error parsing review: {str(e)}")
                continue

        return reviews[:limit]

    def get_market_stats(
        self,
        location: str,
        checkin: str,
        checkout: str,
        guests: int = 2
    ) -> MarketStats:
        """
        Get market statistics for a specific location
        Args:
            location: Location to analyze
            checkin: Check-in date
            checkout: Check-out date
            guests: Number of guests
        Returns:
            MarketStats object with market data
        """
        # Search for listings to get market data
        listings = self.search_listings(
            location=location,
            checkin=checkin,
            checkout=checkout,
            guests=guests,
            limit=100  # Get more listings for better stats
        )

        if not listings:
            return MarketStats(
                location=location,
                avg_daily_rate=None,
                median_daily_rate=None,
                total_listings=0,
                avg_rating=None,
                superhost_pct=None,
                price_distribution={
                    'under_100': 0,
                    'range_100_200': 0,
                    'range_200_300': 0,
                    'range_300_500': 0,
                    'over_500': 0
                },
                property_types={}
            )

        # Calculate statistics
        prices = [l.price_per_night for l in listings if l.price_per_night]
        ratings = [l.rating for l in listings if l.rating]
        superhosts = sum(1 for l in listings if l.superhost)

        avg_daily_rate = sum(prices) / len(prices) if prices else None
        median_daily_rate = sorted(prices)[len(prices)//2] if prices else None
        avg_rating = sum(ratings) / len(ratings) if ratings else None
        superhost_pct = (superhosts / len(listings)) * 100 if listings else None

        # Price distribution
        price_distribution = {
            'under_100': 0,
            'range_100_200': 0,
            'range_200_300': 0,
            'range_300_500': 0,
            'over_500': 0
        }

        for price in prices:
            if price < 100:
                price_distribution['under_100'] += 1
            elif 100 <= price < 200:
                price_distribution['range_100_200'] += 1
            elif 200 <= price < 300:
                price_distribution['range_200_300'] += 1
            elif 300 <= price < 500:
                price_distribution['range_300_500'] += 1
            else:
                price_distribution['over_500'] += 1

        # Property types
        property_types = {}
        for listing in listings:
            if listing.type:
                property_types[listing.type] = property_types.get(listing.type, 0) + 1

        # Calculate occupancy estimate (simple heuristic)
        # This is a placeholder - in a real implementation you'd use historical data
        occupancy_estimate = 70.0  # Default estimate

        # Calculate revenue potential (simple heuristic)
        # This is a placeholder - in a real implementation you'd use historical data
        avg_nights = 5  # Average stay length
        revenue_potential = (avg_daily_rate * avg_nights * occupancy_estimate / 100) if avg_daily_rate else None

        return MarketStats(
            location=location,
            avg_daily_rate=avg_daily_rate,
            median_daily_rate=median_daily_rate,
            total_listings=len(listings),
            avg_rating=avg_rating,
            superhost_pct=superhost_pct,
            price_distribution=price_distribution,
            property_types=property_types,
            occupancy_estimate=occupancy_estimate,
            revenue_potential=revenue_potential
        )

# Create a global instance of the scraper
airbnb_scraper = AirbnbScraper()
