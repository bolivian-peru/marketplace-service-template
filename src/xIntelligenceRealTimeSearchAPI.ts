import axios from 'axios';

const xIntelligenceRealTimeSearchAPI = async (query: string) => {
  const endpointURL = 'http://35.187.247.219:8443/api/x/search';
  const params = { query };
  try {
    const response = await axios.get(endpointURL, { params });
    return response.data;
  } catch (error) {
    console.error(error);
    return null;
  }
};

export default xIntelligenceRealTimeSearchAPI;
