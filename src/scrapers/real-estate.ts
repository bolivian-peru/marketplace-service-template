export class RealEstateService {
  async getProperty(propertyId: string) {
    return {
      property_id: propertyId,
      price: 450000,
      bedrooms: 3,
      bathrooms: 2,
      status: "Active"
    };
  }
}
