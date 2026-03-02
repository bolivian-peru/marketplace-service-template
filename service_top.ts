/**
 * Service Router — Marketplace API
 *
 * Exposes:
 *   GET /api/run       (Google Maps Lead Generator)
 *   GET /api/details   (Google Maps Place details)
 *   GET /api/jobs      (Job Market Intelligence)
 *   GET /api/reviews/* (Google Reviews & Business Data)
 *   GET /api/airbnb/*  (Airbnb Market Intelligence)
 *   GET /api/reddit/*  (Reddit Intelligence)
 *   GET /api/instagram/* (Instagram Intelligence + AI Vision)
 *   GET /api/linkedin/* (LinkedIn Enrichment)
 */

import { Hono } from 'hono';
import { proxyFetch, getProxy } from './proxy';
import { extractPayment, verifyPayment, build402Response } from './payment';
import { scrapeIndeed, scrapeLinkedIn, type JobListing } from './scrapers/job-scraper';
import { fetchReviews, fetchBusinessDetails, fetchReviewSummary, searchBusinesses } from './scrapers/reviews';
import { scrapeGoogleMaps, extractDetailedBusiness } from './scrapers/maps-scraper';
import { researchRouter } from './routes/research';
import { trendingRouter } from './routes/trending';
import { searchAirbnb, getListingDetail, getListingReviews, getMarketStats } from './scrapers/airbnb-scraper';
import { 
  scrapeLinkedInPerson, 
  scrapeLinkedInCompany, 
  searchLinkedInPeople, 
  findCompanyEmployees 
} from './scrapers/linkedin-enrichment';
import { getProfile, getPosts, analyzeProfile, analyzeImages, auditProfile } from './scrapers/instagram-scraper';
import { searchReddit, getSubreddit, getTrending, getComments } from './scrapers/reddit-scraper';

export const serviceRouter = new Hono();

// ─── TREND INTELLIGENCE ROUTES (Bounty #70) ─────────
serviceRouter.route('/research', researchRouter);
serviceRouter.route('/trending', trendingRouter);

const SERVICE_NAME = 'job-market-intelligence';
const PRICE_USDC = 0.005;
