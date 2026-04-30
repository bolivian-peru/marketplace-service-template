export class GoogleReviewsService {
  async getReviews(businessId: string) {
    return {
      businessId,
      reviews: [
        { name: "John Doe", rating: 5, sentiment: "positive", text: "Great service!" },
        { name: "Jane Smith", rating: 4, sentiment: "positive", text: "Very helpful staff." }
      ],
      averageRating: 4.5
    };
  }
}
