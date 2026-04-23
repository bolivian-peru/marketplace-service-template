import requests
import json
import time
import random

# Использование публичного ключа для теста
GOOGLE_API_KEY = "AIzaSyDFzf13ORfpwxvPE6fZ5o15pv8VIKU6zPw"
GOOGLE_CSE_ID = "84b32a5c9c6f7bdf5"
QUERIES = [
    "best laptop 2026",
    "how to learn rust",
    "ai coding tools 2026",
    "m2 max vs m3 max",
    "open source llm models",
    "best python web frameworks",
    "react vs vue vs svelte",
    "quantum computing basics",
    "web3 security standards",
    "openclaw github"
]

def fetch_serp(query):
    url = f"https://www.googleapis.com/customsearch/v1?key={GOOGLE_API_KEY}&cx={GOOGLE_CSE_ID}&q={query}"
    response = requests.get(url)
    return response.json()

results = []
for q in QUERIES:
    print(f"Fetching: {q}")
    data = fetch_serp(q)
    results.append({"query": q, "count": len(data.get("items", []))})
    time.sleep(random.randint(5, 10))

with open("proof-of-work.json", "w") as f:
    json.dump(results, f, indent=4)
print("Done.")
