import { Request, Response } from 'express';
import axios from 'axios';

interface AppStoreConfig {
  baseUrl: string;
  country: string;
  language: string;
}

interface RankingParams {
  category?: string;
  genre?: string;
  country?: string;
  limit?: number;
}

interface AppDetailsParams {
  appId: string;
  country?: string;
}

interface SearchParams {
  term: string;
  country?: string;
  limit?: number;
  entity?: string;
}

const APP_STORE_CONFIG: AppStoreConfig = {
  baseUrl: 'https://itunes.apple.com',
  country: 'us',
  language: 'en'
};

const PLAY_STORE_CONFIG = {
  baseUrl: 'https://play.googleapis.com/store/apps',
  country: 'us',
  language: 'en'
};

class AppStoreIntelligenceHandler {
  // Apple App Store Rankings
  async getAppStoreRankings(req: Request, res: Response) {
    try {
      const { category = 'overall', genre = '6014', country = 'us', limit = '100' } = req.query as RankingParams;
      
      const response = await axios.get(`${APP_STORE_CONFIG.baseUrl}/${country}/rss/topfreeapplications/limit=${limit}/genre=${genre}/json`);
      
      const rankings = response.data.feed.entry.map((app: any, index: number) => ({
        rank: index + 1,
        appId: app.id.attributes['im:id'],
        name: app['im:name'].label,
        artist: app['im:artist'].label,
        category: app.category.attributes.label,
        image: app['im:image'][2].label,
        price: app['im:price'].label,
        releaseDate: app['im:releaseDate'].label,
        summary: app.summary?.label,
        link: app.link.attributes.href
      }));

      res.json({
        success: true,
        data: {
          store: 'apple',
          category,
          country,
          rankings
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch App Store rankings',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Google Play Store Rankings
  async getPlayStoreRankings(req: Request, res: Response) {
    try {
      const { category = 'APPLICATION', country = 'us', limit = 100 } = req.query;
      
      // Note: This is a simplified implementation. In production, you'd use Google Play Developer API
      // or a third-party service that provides Play Store data
      const mockRankings = Array.from({ length: Number(limit) }, (_, index) => ({
        rank: index + 1,
        packageName: `com.example.app${index + 1}`,
        title: `Sample App ${index + 1}`,
        developer: `Developer ${index + 1}`,
        category: category,
        rating: (Math.random() * 2 + 3).toFixed(1),
        installs: Math.floor(Math.random() * 1000000) + 10000,
        price: index % 3 === 0 ? 'Free' : `$${(Math.random() * 10 + 0.99).toFixed(2)}`,
        iconUrl: `https://via.placeholder.com/512x512?text=App${index + 1}`,
        lastUpdated: new Date(Date.now() - Math.random() * 30 * 24 * 60 * 60 * 1000).toISOString()
      }));

      res.json({
        success: true,
        data: {
          store: 'google_play',
          category,
          country,
          rankings: mockRankings
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch Play Store rankings',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // App Store App Details
  async getAppStoreAppDetails(req: Request, res: Response) {
    try {
      const { appId } = req.params;
      const { country = 'us' } = req.query as AppDetailsParams;

      const response = await axios.get(`${APP_STORE_CONFIG.baseUrl}/lookup`, {
        params: {
          id: appId,
          country: country
        }
      });

      if (response.data.resultCount === 0) {
        return res.status(404).json({
          success: false,
          error: 'App not found'
        });
      }

      const app = response.data.results[0];
      const appDetails = {
        appId: app.trackId,
        name: app.trackName,
        bundleId: app.bundleId,
        artist: app.artistName,
        description: app.description,
        version: app.version,
        price: app.price,
        currency: app.currency,
        genres: app.genres,
        primaryGenre: app.primaryGenreName,
        rating: app.averageUserRating,
        ratingCount: app.userRatingCount,
        contentAdvisoryRating: app.contentAdvisoryRating,
        screenshots: app.screenshotUrls,
        ipadScreenshots: app.ipadScreenshotUrls,
        artworkUrl: app.artworkUrl512,
        releaseDate: app.releaseDate,
        currentVersionReleaseDate: app.currentVersionReleaseDate,
        minimumOsVersion: app.minimumOsVersion,
        fileSizeBytes: app.fileSizeBytes,
        languageCodesISO2A: app.languageCodesISO2A,
        supportedDevices: app.supportedDevices,
        isGameCenterEnabled: app.isGameCenterEnabled,
        advisories: app.advisories,
        trackViewUrl: app.trackViewUrl
      };

      res.json({
        success: true,
        data: {
          store: 'apple',
          app: appDetails
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch app details',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // App Store Search
  async searchAppStore(req: Request, res: Response) {
    try {
      const { term, country = 'us', limit = '50', entity = 'software' } = req.query as SearchParams;

      if (!term) {
        return res.status(400).json({
          success: false,
          error: 'Search term is required'
        });
      }

      const response = await axios.get(`${APP_STORE_CONFIG.baseUrl}/search`, {
        params: {
          term: term,
          country: country,
          limit: limit,
          entity: entity
        }
      });

      const searchResults = response.data.results.map((app: any) => ({
        appId: app.trackId,
        name: app.trackName,
        bundleId: app.bundleId,
        artist: app.artistName,
        genre: app.primaryGenreName,
        price: app.price,
        currency: app.currency,
        rating: app.averageUserRating,
        ratingCount: app.userRatingCount,
        artworkUrl: app.artworkUrl100,
        releaseDate: app.releaseDate,
        version: app.version,
        description: app.description?.substring(0, 200) + '...',
        trackViewUrl: app.trackViewUrl
      }));

      res.json({
        success: true,
        data: {
          store: 'apple',
          searchTerm: term,
          resultCount: response.data.resultCount,
          results: searchResults
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to search App Store',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Trending Apps (combination of top free, top paid, top grossing)
  async getTrendingApps(req: Request, res: Response) {
    try {
      const { country = 'us', limit = '50' } = req.query;
      
      const [topFree, topPaid, topGrossing] = await Promise.all([
        axios.get(`${APP_STORE_CONFIG.baseUrl}/${country}/rss/topfreeapplications/limit=${limit}/json`),
        axios.get(`${APP_STORE_CONFIG.baseUrl}/${country}/rss/toppaidapplications/limit=${limit}/json`),
        axios.get(`${APP_STORE_CONFIG.baseUrl}/${country}/rss/topgrossingapplications/limit=${limit}/json`)
      ]);

      const formatApps = (apps: any[], category: string) => {
        return apps.map((app: any, index: number) => ({
          rank: index + 1,
          category: category,
          appId: app.id.attributes['im:id'],
          name: app['im:name'].label,
          artist: app['im:artist'].label,
          genre: app.category.attributes.label,
          image: app['im:image'][2].label,
          price: app['im:price'].label,
          releaseDate: app['im:releaseDate'].label,
          summary: app.summary?.label,
          link: app.link.attributes.href
        }));
      };

      const trending = {
        topFree: formatApps(topFree.data.feed.entry, 'free'),
        topPaid: formatApps(topPaid.data.feed.entry, 'paid'),
        topGrossing: formatApps(topGrossing.data.feed.entry, 'grossing')
      };

      res.json({
        success: true,
        data: {
          store: 'apple',
          country,
          trending
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch trending apps',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // Categories list
  async getCategories(req: Request, res: Response) {
    try {
      const appStoreCategories = [
        { id: '6014', name: 'Games' },
        { id: '6000', name: 'Business' },
        { id: '6001', name: 'Weather' },
        { id: '6002', name: 'Utilities' },
        { id: '6003', name: 'Travel' },
        { id: '6004', name: 'Sports' },
        { id: '6005', name: 'Social Networking' },
        { id: '6006', name: 'Reference' },
        { id: '6007', name: 'Productivity' },
        { id: '6008', name: 'Photo & Video' },
        { id: '6009', name: 'News' },
        { id: '6010', name: 'Navigation' },
        { id: '6011', name: 'Music' },
        { id: '6012', name: 'Lifestyle' },
        { id: '6013', name: 'Health & Fitness' },
        { id: '6015', name: 'Finance' },
        { id: '6016', name: 'Entertainment' },
        { id: '6017', name: 'Education' },
        { id: '6018', name: 'Books' },
        { id: '6020', name: 'Medical' },
        { id: '6021', name: 'Magazines & Newspapers' },
        { id: '6022', name: 'Catalogs' },
        { id: '6023', name: 'Food & Drink' },
        { id: '6024', name: 'Shopping' }
      ];

      const playStoreCategories = [
        'ART_AND_DESIGN', 'AUTO_AND_VEHICLES', 'BEAUTY', 'BOOKS_AND_REFERENCE',
        'BUSINESS', 'COMICS', 'COMMUNICATION', 'DATING', 'EDUCATION', 'ENTERTAINMENT',
        'EVENTS', 'FINANCE', 'FOOD_AND_DRINK', 'HEALTH_AND_FITNESS', 'HOUSE_AND_HOME',
        'LIBRARIES_AND_DEMO', 'LIFESTYLE', 'MAPS_AND_NAVIGATION', 'MEDICAL', 'MUSIC_AND_AUDIO',
        'NEWS_AND_MAGAZINES', 'PARENTING', 'PERSONALIZATION', 'PHOTOGRAPHY', 'PRODUCTIVITY',
        'SHOPPING', 'SOCIAL', 'SPORTS', 'TOOLS', 'TRAVEL_AND_LOCAL', 'VIDEO_PLAYERS',
        'WEATHER', 'GAME'
      ];

      res.json({
        success: true,
        data: {
          appStore: appStoreCategories,
          playStore: playStoreCategories
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to fetch categories',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  // App comparison
  async compareApps(req: Request, res: Response) {
    try {
      const { appIds } = req.body;
      
      if (!appIds || !Array.isArray(appIds) || appIds.length === 0) {
        return res.status(400).json({
          success: false,
          error: 'App IDs array is required'
        });
      }

      const appDetails = await Promise.all(
        appIds.map(async (appId: string) => {
          try {
            const response = await axios.get(`${APP_STORE_CONFIG.baseUrl}/lookup`, {
              params: { id: appId }
            });
            return response.data.results[0];
          } catch (error) {
            return null;
          }
        })
      );

      const comparison = appDetails.filter(app => app !== null).map(app => ({
        appId: app.trackId,
        name: app.trackName,
        artist: app.artistName,
        price: app.price,
        rating: app.averageUserRating,
        ratingCount: app.userRatingCount,
        version: app.version,
        fileSizeBytes: app.fileSizeBytes,
        minimumOsVersion: app.minimumOsVersion,
        releaseDate: app.releaseDate,
        genre: app.primaryGenreName,
        contentRating: app.contentAdvisoryRating,
        artworkUrl: app.artworkUrl512
      }));

      res.json({
        success: true,
        data: {
          comparison,
          metrics: {
            totalApps: comparison.length,
            averageRating: (comparison.reduce((sum, app) => sum + (app.rating || 0), 0) / comparison.length).toFixed(2),
            averagePrice: (comparison.reduce((sum, app) => sum + app.price, 0) / comparison.length).toFixed(2)
          }
        }
      });
    } catch (error) {
      res.status(500).json({
        success: false,
        error: 'Failed to compare apps',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }
}

const appStoreIntelligence = new AppStoreIntelligenceHandler();

export const getAppStoreRankings = appStoreIntelligence.getAppStoreRankings.bind(appStoreIntelligence);
export const getPlayStoreRankings = appStoreIntelligence.getPlayStoreRankings.bind(appStoreIntelligence);
export const getAppStoreAppDetails = appStoreIntelligence.getAppStoreAppDetails.bind(appStoreIntelligence);
export const searchAppStore = appStoreIntelligence.searchAppStore.bind(appStoreIntelligence);
export const getTrendingApps = appStoreIntelligence.getTrendingApps.bind(appStoreIntelligence);
export const getCategories = appStoreIntelligence.getCategories.bind(appStoreIntelligence);
export const compareApps = appStoreIntelligence.compareApps.bind(appStoreIntelligence);