import axios from 'axios';

export interface ProxyInfo {
  ip: string;
  country: string;
  carrier: string;
}

export const getProxyConfig = () => {
  // 模拟从环境变量或配置中获取移动代理
  return {
    host: process.env.PROXY_HOST || 'proxy.mobile-provider.com',
    port: parseInt(process.env.PROXY_PORT || '8888'),
    auth: {
      username: process.env.PROXY_USERNAME || '',
      password: process.env.PROXY_PASSWORD || ''
    }
  };
};

export const fetchWithMobileProxy = async (url: string) => {
  const proxy = getProxyConfig();
  // 在实际生产中，这里会配置 axios 使用移动代理
  // 为了演示，我们模拟返回结果并附带代理元数据
  return axios.get(url, {
    /* proxy, */
    headers: {
      'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
    }
  });
};

export const getProxyMetadata = (): ProxyInfo => {
  return {
    ip: "172.56.21.44",
    country: "US",
    carrier: "Verizon"
  };
};
