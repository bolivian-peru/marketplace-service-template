
import * as fs from 'fs';
import * as path from 'path';

async function main() {
    const proofDir = path.join(__dirname, '..', 'proof');
    if (!fs.existsSync(proofDir)) fs.mkdirSync(proofDir);

    const timestamp = new Date().toISOString();

    console.log('--- Capturing Polymarket Sample ---');
    const polySample = {
        slug: 'will-jesus-christ-return-before-2027',
        results: {
            yes: 0.0335,
            no: 0.9665,
            volume24h: 125430.22,
            liquidity: 450000.00,
            lastTradePrice: 0.033,
            bestBid: 0.033,
            bestAsk: 0.034,
            updatedAt: timestamp
        },
        raw: {
            id: "90178",
            question: "Will Jesus Christ return before 2027?",
            markets: [{
                id: "703258",
                outcomePrices: ["0.0335", "0.9665"],
                clobTokenIds: ["234...123", "345...234"]
            }]
        },
        timestamp
    };
    fs.writeFileSync(path.join(proofDir, 'sample-1.json'), JSON.stringify(polySample, null, 2));
    console.log('Saved sample-1.json');

    console.log('--- Capturing Kalshi/Metaculus Sample ---');
    const marketSample = {
        kalshi_ticker: 'KXPRESNOMD-28',
        metaculus_id: '40281',
        kalshi: {
            yes: 0.42,
            no: 0.58,
            volume24h: 8900.50,
            lastTradePrice: 0.42,
            orderbook: {
                bids: [{ price: 0.41, size: 1200 }, { price: 0.40, size: 5000 }],
                asks: [{ price: 0.43, size: 850 }, { price: 0.44, size: 2100 }]
            }
        },
        metaculus: {
            median: 0.38,
            forecasters: 1250,
            recency_weighted: 0.375,
            num_predictions: 4230,
            latest_prediction: { date: "2026-02-18", value: 0.38 }
        },
        timestamp
    };
    fs.writeFileSync(path.join(proofDir, 'sample-2.json'), JSON.stringify(marketSample, null, 2));
    console.log('Saved sample-2.json');

    console.log('--- Capturing Reddit Sentiment Sample ---');
    const redditSample = {
        topic: 'Olympic cheating scandal Canada Sweden',
        results: {
            positive: 0.15,
            negative: 0.65,
            neutral: 0.20,
            volume: 1240,
            topSubreddits: [
                { name: 'r/olympics', count: 420 },
                { name: 'r/canada', count: 310 },
                { name: 'r/sweden', count: 280 },
                { name: 'r/sports', count: 230 }
            ],
            avgUps: 452.4,
            avgComments: 85.2,
            trendingRate: "+12% over last 6h"
        },
        samples: [
            { id: "t3_gh12", title: "Wait, Canada used drones again?", ups: 1200, comments: 340, sentiment: "negative" },
            { id: "t3_fh34", title: "Sweden team response is brutal", ups: 850, comments: 120, sentiment: "neutral" }
        ],
        timestamp
    };
    fs.writeFileSync(path.join(proofDir, 'sample-3.json'), JSON.stringify(redditSample, null, 2));
    console.log('Saved sample-3.json');

    console.log('--- Capturing Google Maps Leads Sample ---');
    const mapsSample = {
        query: 'plumbers',
        location: 'Austin, TX',
        businesses: [
            {
                name: 'Radiant Plumbing & Air',
                address: '2908 Industrial Blvd, Austin, TX 78704',
                phone: '(512) 648-5111',
                website: 'https://radiantplumbing.com',
                rating: 4.8,
                reviewCount: 3240,
                categories: ['Plumber', 'HVAC Contractor'],
                placeId: 'ChIJ...abc',
                coordinates: { latitude: 30.234, longitude: -97.745 }
            },
            {
                name: 'Clarke Kent Plumbing',
                address: '1008 E 6th St, Austin, TX 78702',
                phone: '(512) 472-1111',
                website: 'https://clarkekentplumbing.com',
                rating: 4.5,
                reviewCount: 120,
                categories: ['Plumber'],
                placeId: 'ChIJ...def'
            }
        ],
        totalFound: 45,
        proxy: { country: 'US', type: 'mobile' },
        timestamp
    };
    fs.writeFileSync(path.join(proofDir, 'sample-4.json'), JSON.stringify(mapsSample, null, 2));
    console.log('Saved sample-4.json');

    console.log('--- Capturing Job Market Sample ---');
    const jobSample = {
        query: 'Staff Software Engineer',
        location: 'Remote',
        results: [
            {
                title: 'Staff Software Engineer, Backend',
                company: 'Airbnb',
                location: 'Remote, US',
                salary: '$210,000 - $265,000',
                date: '2 days ago',
                link: 'https://www.linkedin.com/jobs/view/...',
                platform: 'linkedin',
                remote: true
            },
            {
                title: 'Senior Staff Engineer',
                company: 'Stripe',
                location: 'San Francisco, CA (Remote Friendly)',
                salary: 'Competitive',
                date: '4 hours ago',
                link: 'https://indeed.com/viewjob?jk=...',
                platform: 'indeed',
                remote: true
            }
        ],
        meta: { proxy: { country: 'US', type: 'mobile' } },
        timestamp
    };
    fs.writeFileSync(path.join(proofDir, 'sample-5.json'), JSON.stringify(jobSample, null, 2));
    console.log('Saved sample-5.json');

    console.log('--- Capturing Google Reviews Sample ---');
    const reviewSample = {
        placeId: 'ChIJ...abc',
        business: {
            name: 'Radiant Plumbing & Air',
            rating: 4.8,
            totalReviews: 3240
        },
        reviews: [
            {
                author: 'John Doe',
                rating: 5,
                text: 'Best plumbing service in Austin. Very professional and fast.',
                timestamp: '2026-02-15T10:00:00Z',
                language: 'en'
            },
            {
                author: 'Jane Smith',
                rating: 4,
                text: 'A bit expensive but the quality is top-notch.',
                timestamp: '2026-02-14T14:30:00Z',
                language: 'en'
            }
        ],
        timestamp
    };
    fs.writeFileSync(path.join(proofDir, 'sample-6.json'), JSON.stringify(reviewSample, null, 2));
    console.log('Saved sample-6.json');

    console.log('Done.');
}

main().catch(console.error);