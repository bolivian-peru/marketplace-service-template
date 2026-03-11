# 部署指南

## Vercel部署

```bash
# 安装Vercel CLI
npm i -g vercel

# 部署
vercel --prod
```

## 环境变量

```
PROXIES_SX_URL=your-proxy-url
X402_WALLET=your-wallet-address
```

## 测试

```bash
# 健康检查
curl https://your-app.vercel.app/health

# 搜索测试
curl "https://your-app.vercel.app/api/marketplace/search?query=iphone"
```
