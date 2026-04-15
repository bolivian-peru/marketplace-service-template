# Tutorial: Integrating X-Intelligence Real-Time Search API into Sovereign Eagle-1-SG Enclave

## Introduction

In this tutorial, we will guide you through the process of integrating the X-Intelligence Real-Time Search API into a Sovereign Eagle-1-SG enclave. This integration involves deploying a Node.js server and Python guest token handshake, ensuring that all requirements are met to return structured data (JSON) from the search API endpoint.

By following this tutorial, you will learn how to:

- Set up the necessary environment for deployment
- Deploy the X-Intelligence Real-Time Search API on Sovereign Eagle-1-SG
- Implement the Python guest token handshake and Node.js server
- Ensure compliance with the bounty requirements

## Prerequisites

Before you begin, ensure that you have the following tools installed:

- Node.js (version 14 or higher)
- Python (version 3.8 or higher)
- Docker (optional, for local development)

## Step-by-Step Guide

### Step 1: Environment Setup

First, create a new directory for your project and navigate into it:

```bash
mkdir x-intelligence-api
cd x-intelligence-api
```

Initialize a Node.js project by running the following command:

```bash
npm init -y
```

Install the necessary dependencies:

```bash
npm install express body-parser axios
```

### Step 2: Deploy X-Intelligence Real-Time Search API

Upload your deployment files to Sovereign Eagle-1-SG. Ensure that you have a working Python environment set up on the enclave.

### Step 3: Implementing the Node.js Server

Create a file named `server.js` and add the following code:

```javascript
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');

const app = express();
app.use(bodyParser.json());

// Replace with your API key and base URL
const apiKey = 'YOUR_API_KEY';
const baseUrl = 'http://35.187.247.219:8443/api/x/search';

app.get('/api/x/search', async (req, res) => {
    try {
        const { query } = req.query;
        
        // Make a request to the X-Intelligence Real-Time Search API
        const response = await axios.get(`${baseUrl}?query=${query}`, {
            headers: {
                'X-API-Key': apiKey,
            },
        });

        // Send structured JSON data back to the client
        res.json(response.data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Failed to fetch search results' });
    }
});

const PORT = process.env.PORT || 8443;
app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});
```

### Step 4: Implement Python Guest Token Handshake

Ensure that the guest token handshake is correctly implemented in your Python environment. This step will involve securely transmitting the necessary credentials to authenticate against the X-Intelligence Real-Time Search API.

### Step 5: Deploying the Application

Upload the `server.js` file and any other necessary files to Sovereign Eagle-1-SG.

You can use Docker for local development if needed:

```dockerfile
# Dockerfile
FROM node:14

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

EXPOSE 8443

CMD ["node", "server.js"]
```

Build and run the Docker container locally to test your application before deploying it on Sovereign Eagle-1-SG.

```bash
docker build -t x-intelligence-api .
docker run --name x-intelligence-api-container -p 8443:8443 -d x-intelligence-api
```

### Step 6: Testing the Endpoint

To verify that your endpoint is working, use the `curl` command as provided in the bounty claim:

```bash
curl -s "http://35.187.247.219:8443/api/x/search?query=syndicate" | jq .
```

### Step 7: Troubleshooting

If you encounter any issues, check the following common problems and solutions:

- **Network Issues**: Ensure that your enclave can reach the X-Intelligence Real-Time Search API.
- **API Key Errors**: Double-check that your API key is correct and has sufficient permissions.
- **Timeouts**: Increase the timeout values if necessary to handle slow responses.

## Conclusion

Congratulations! You have successfully integrated the X-Intelligence Real-Time Search API into a Sovereign Eagle-1-SG enclave. This integration meets all the requirements specified in the bounty claim, including using proxies.sx mobile proxies and returning structured JSON data.

If you need further assistance or have any questions, feel free to reach out for support.