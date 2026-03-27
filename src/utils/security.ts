/**
 * NemoClaw Security Utils
 */

export function maskSecrets(obj: any): any {
    if (!obj || typeof obj !== 'object') return obj;
    
    const json = JSON.stringify(obj);
    const masked = json
        .replace(/[a-fA-F0-9]{32,}/g, '[MASKED_SECRET]') // UUIDs and long hex
        .replace(/(sk-ant-|sk-)[a-zA-Z0-9]{20,}/g, '[MASKED_API_KEY]'); // AI keys
    
    return JSON.parse(masked);
}
