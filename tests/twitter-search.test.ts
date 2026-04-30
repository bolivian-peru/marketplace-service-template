

import { TwitterSearchService } from '../src/scrapers/twitter-search-service';
import { TwitterResult } from '../src/types';
import axios from 'axios';

const mockGet = jest.fn();
jest.mock('axios', () => ({
  default: {
    get: mockGet,
  },
}));

describe('TwitterSearchService', () => {
  let service: TwitterSearchService;

  beforeAll(() => {
    process.env.TWITTER_BEARER_TOKEN = 'test_token';
    service = new TwitterSearchService();
  });

  afterAll(() => {
    delete process.env.TWITTER_BEARER_TOKEN;
  });

  it('should parse Twitter API response into TwitterResult format', async () => {
    const mockTwitterApiResponse = {
      data: [
        {
          id: '12345',
          text: 'This is a test tweet.',
          author_id: '1111',
          created_at: '2023-01-01T10:00:00.000Z',
          public_metrics: {
            retweet_count: 10,
            reply_count: 5,
            like_count: 100,
            quote_count: 2,
          },
        },
      ],
      includes: {
        users: [
          {
            id: '1111',
            username: 'testuser',
          },
        ],
      },
      meta: {
        newest_id: '12345',
        oldest_id: '12345',
        result_count: 1,
      },
    };

    mockGet.mockResolvedValueOnce({ data: mockTwitterApiResponse });

    const expected: TwitterResult[] = [
      {
        tweetId: '12345',
        author: 'testuser',
        text: 'This is a test tweet.',
        url: 'https://twitter.com/testuser/status/12345',
        likes: 100,
        retweets: 10,
        engagementScore: 110,
        publishedAt: '2023-01-01T10:00:00.000Z',
        platform: 'twitter',
      },
    ];

    const result = await service.search('test query');
    expect(result).toEqual(expected);
  });

  it('should handle multiple tweets and users', async () => {
    const mockTwitterApiResponse = {
      data: [
        {
          id: '1',
          text: 'Tweet 1 by user A',
          author_id: 'A',
          created_at: '2023-01-01T10:00:00.000Z',
          public_metrics: { retweet_count: 1, reply_count: 0, like_count: 10, quote_count: 0 },
        },
        {
          id: '2',
          text: 'Tweet 2 by user B',
          author_id: 'B',
          created_at: '2023-01-01T11:00:00.000Z',
          public_metrics: { retweet_count: 5, reply_count: 1, like_count: 50, quote_count: 1 },
        },
      ],
      includes: {
        users: [
          { id: 'A', username: 'userA' },
          { id: 'B', username: 'userB' },
        ],
      },
      meta: { newest_id: '2', oldest_id: '1', result_count: 2 },
    };

    mockGet.mockResolvedValueOnce({ data: mockTwitterApiResponse });

    const expected: TwitterResult[] = [
      {
        tweetId: '1',
        author: 'userA',
        text: 'Tweet 1 by user A',
        url: 'https://twitter.com/userA/status/1',
        likes: 10,
        retweets: 1,
        engagementScore: 11,
        publishedAt: '2023-01-01T10:00:00.000Z',
        platform: 'twitter',
      },
      {
        tweetId: '2',
        author: 'userB',
        text: 'Tweet 2 by user B',
        url: 'https://twitter.com/userB/status/2',
        likes: 50,
        retweets: 5,
        engagementScore: 55,
        publishedAt: '2023-01-01T11:00:00.000Z',
        platform: 'twitter',
      },
    ];

    const result = await service.search('another query');
    expect(result).toEqual(expected);
  });

  it('should handle missing user information gracefully', async () => {
    const mockTwitterApiResponse = {
      data: [
        {
          id: '3',
          text: 'Tweet without known author.',
          author_id: 'C',
          created_at: '2023-01-01T12:00:00.000Z',
          public_metrics: { retweet_count: 0, reply_count: 0, like_count: 5, quote_count: 0 },
        },
      ],
      includes: { users: [] }, // No user C
      meta: { newest_id: '3', oldest_id: '3', result_count: 1 },
    };

    mockGet.mockResolvedValueOnce({ data: mockTwitterApiResponse });

    const expected: TwitterResult[] = [
      {
        tweetId: '3',
        author: null,
        text: 'Tweet without known author.',
        url: 'https://twitter.com/null/status/3', // URL will use 'null' for author
        likes: 5,
        retweets: 0,
        engagementScore: 5,
        publishedAt: '2023-01-01T12:00:00.000Z',
        platform: 'twitter',
      },
    ];

    const result = await service.search('query C');
    expect(result).toEqual(expected);
  });
});

