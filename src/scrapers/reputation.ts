export class ReputationService {
  async getReputation(entityId: string) {
    return {
      entity_id: entityId,
      trust_score: 88,
      total_reviews: 1240,
      recent_flags: 0
    };
  }
}
