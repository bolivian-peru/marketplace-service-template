import { Lead } from '../types';

export class JobMarketService {
  async getListingData(jobId: string): Promise<Partial<Lead>> {
    return {
      external_id: jobId,
      source_platform: 'job_board_aggregator',
      title: "Senior AI Engineer Role",
      metadata: {
        salary: "40,000",
        location: "Remote",
        skills: ["TypeScript", "Python", "LLMs"]
      }
    };
  }
}
