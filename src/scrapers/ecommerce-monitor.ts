import { Lead } from '../types';

export class EcommerceMonitorService {
  async getStockData(sku: string): Promise<Partial<Lead>> {
    return {
      external_id: sku,
      source_platform: 'ecommerce_generic',
      title: `Product ${sku} Monitor`,
      metadata: {
        price: "24.99",
        in_stock: true,
        last_checked: new Date().toISOString()
      }
    };
  }
}
