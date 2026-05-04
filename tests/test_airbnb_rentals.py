

"""
Tests for Airbnb & Short-Term Rental Intelligence API
"""

import unittest
from unittest.mock import patch, MagicMock
import os
import json
from datetime import datetime

from src.airbnb.rentals import (
    AirbnbScraper,
    AirbnbListing,
    AirbnbReview,
    MarketStats,
    airbnb_scraper
)

class TestAirbnbRentals(unittest.TestCase):
    """Test cases for Airbnb rentals module"""

    def setUp(self):
        """Set up test fixtures"""
        self.scraper = AirbnbScraper()

        # Sample HTML for testing
        self.sample_search_html = """
        <html>
            <body>
                <div data-testid="card-container">
                    <a href="/rooms/12345678">
                        <div data-testid="listing-card-title">Test Listing</div>
                        <div data-testid="listing-card-subtitle">Entire apartment</div>
                        <div data-testid="price-availability-row">$150 per night</div>
                        <div data-testid="rating">4.8 (250 reviews)</div>
                    </a>
                </div>
            </body>
        </html>
        """

        self.sample_detail_html = """
        <html>
            <body>
                <h1>Test Listing</h1>
                <div data-testid="price-availability-row">$150 per night</div>
                <div data-testid="rating">4.8 (250 reviews)</div>
                <div data-testid="host-info">
                    <span data-testid="host-name">Test Host</span>
                    <span>Superhost</span>
                </div>
                <div data-section-id="AMENITIES_DEFAULT">
                    <div role="button">WiFi</div>
                    <div role="button">Kitchen</div>
                </div>
            </body>
        </html>
        """

        self.sample_reviews_html = """
        <html>
            <body>
                <div data-testid="pdp-review">
                    <span class="l1ovpqfx">Test User</span>
                    <span class="od11thwi">March 2024</span>
                    <div aria-label="5 out of 5 stars">★★★★★</div>
                    <div class="f12phz7m">Great place!</div>
                </div>
            </body>
        </html>
        """

    @patch('src.airbnb.rentals.proxy_fetch')
    def test_search_listings(self, mock_fetch):
        """Test the search_listings method"""
        # Mock the response
        mock_response = MagicMock()
        mock_response.text = self.sample_search_html
        mock_response.status_code = 200
        mock_fetch.return_value = mock_response

        # Call the method
        listings = self.scraper.search_listings(
            location="Test Location",
            checkin="2026-03-01",
            checkout="2026-03-07",
            guests=2,
            limit=10
        )

        # Assertions
        self.assertEqual(len(listings), 1)
        self.assertIsInstance(listings[0], AirbnbListing)
        self.assertEqual(listings[0].title, "Test Listing")
        self.assertEqual(listings[0].price_per_night, 150)
        self.assertEqual(listings[0].rating, 4.8)
        self.assertEqual(listings[0].reviews_count, 250)

    @patch('src.airbnb.rentals.proxy_fetch')
    def test_get_listing_details(self, mock_fetch):
        """Test the get_listing_details method"""
        # Mock the response
        mock_response = MagicMock()
        mock_response.text = self.sample_detail_html
        mock_response.status_code = 200
        mock_fetch.return_value = mock_response

        # Call the method
        listing = self.scraper.get_listing_details("12345678")

        # Assertions
        self.assertIsNotNone(listing)
        self.assertIsInstance(listing, AirbnbListing)
        self.assertEqual(listing.title, "Test Listing")
        self.assertEqual(listing.price_per_night, 150)
        self.assertEqual(listing.host_name, "Test Host")
        self.assertTrue(listing.superhost)

    @patch('src.airbnb.rentals.proxy_fetch')
    def test_get_listing_reviews(self, mock_fetch):
        """Test the get_listing_reviews method"""
        # Mock the response
        mock_response = MagicMock()
        mock_response.text = self.sample_reviews_html
        mock_response.status_code = 200
        mock_fetch.return_value = mock_response

        # Call the method
        reviews = self.scraper.get_listing_reviews("12345678", limit=10)

        # Assertions
        self.assertEqual(len(reviews), 1)
        self.assertIsInstance(reviews[0], AirbnbReview)
        self.assertEqual(reviews[0].author, "Test User")
        self.assertEqual(reviews[0].rating, 5.0)
        self.assertEqual(reviews[0].text, "Great place!")

    @patch('src.airbnb.rentals.AirbnbScraper.search_listings')
    def test_get_market_stats(self, mock_search):
        """Test the get_market_stats method"""
        # Mock the search results
        mock_listing = AirbnbListing(
            id="12345678",
            title="Test Listing",
            type="Entire apartment",
            price_per_night=150,
            total_price=None,
            currency="USD",
            rating=4.8,
            reviews_count=250,
            superhost=True,
            bedrooms=1,
            bathrooms=1,
            max_guests=4,
            amenities=["WiFi", "Kitchen"],
            images=["https://example.com/image.jpg"],
            url="https://airbnb.com/rooms/12345678",
            lat=25.7907,
            lng=-80.1301
        )
        mock_search.return_value = [mock_listing]

        # Call the method
        stats = self.scraper.get_market_stats(
            location="Test Location",
            checkin="2026-03-01",
            checkout="2026-03-07",
            guests=2
        )

        # Assertions
        self.assertIsInstance(stats, MarketStats)
        self.assertEqual(stats.location, "Test Location")
        self.assertEqual(stats.avg_daily_rate, 150)
        self.assertEqual(stats.total_listings, 1)
        self.assertEqual(stats.avg_rating, 4.8)
        self.assertEqual(stats.superhost_pct, 100.0)

    def test_parse_listing_card(self):
        """Test the _parse_listing_card method"""
        from bs4 import BeautifulSoup

        soup = BeautifulSoup(self.sample_search_html, 'html.parser')
        card = soup.find('div', {'data-testid': 'card-container'})

        listing = self.scraper._parse_listing_card(str(card))

        self.assertIsNotNone(listing)
        self.assertIsInstance(listing, AirbnbListing)
        self.assertEqual(listing.title, "Test Listing")
        self.assertEqual(listing.type, "Entire apartment")
        self.assertEqual(listing.price_per_night, 150)
        self.assertEqual(listing.rating, 4.8)
        self.assertEqual(listing.reviews_count, 250)

    def test_parse_listing_data(self):
        """Test the _parse_listing_data method"""
        listing_data = {
            "id": "12345678",
            "name": "Test Listing",
            "roomTypeCategory": "Entire apartment",
            "pricingQuote": {
                "rate": {
                    "amount": 150
                }
            },
            "avgRating": 4.8,
            "reviewsCount": 250,
            "isSuperhost": True,
            "bedrooms": 1,
            "bathrooms": 1,
            "personCapacity": 4,
            "previewAmenities": ["WiFi", "Kitchen"],
            "contextualPictures": [
                {"picture": "https://example.com/image.jpg"}
            ],
            "coordinate": {
                "latitude": 25.7907,
                "longitude": -80.1301
            }
        }

        listing = self.scraper._parse_listing_data(listing_data)

        self.assertIsNotNone(listing)
        self.assertIsInstance(listing, AirbnbListing)
        self.assertEqual(listing.title, "Test Listing")
        self.assertEqual(listing.type, "Entire apartment")
        self.assertEqual(listing.price_per_night, 150)
        self.assertEqual(listing.rating, 4.8)
        self.assertEqual(listing.reviews_count, 250)
        self.assertTrue(listing.superhost)

if __name__ == '__main__':
    unittest.main()
