# Proof of Working Scraper Output

Real data collected from Google Trends RSS and Google News RSS on 2026-02-22.

## Samples

| File | Source | Query/Geo | Results |
|------|--------|-----------|---------|
| `sample-1-trends.json` | Google Trends RSS | US trending | 10 trends |
| `sample-2-news-search.json` | Google News RSS | "artificial intelligence" | 10 articles |
| `sample-3-trends-gb.json` | Google Trends RSS | GB trending | 10 trends |

## Method

- Sources: Google Trends RSS (trends.google.com/trending/rss), Google News RSS (news.google.com/rss)
- No proxy required for RSS feeds (public endpoints)
- Collected: 2026-02-22 ~08:35 UTC
- Server IP: 79.137.184.124 (Aeza, Amsterdam)

## Data Fields

Trends: title, approx_traffic, news_headline, news_url
News: title, link, pubDate, source
