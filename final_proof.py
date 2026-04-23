import requests
import json
import random
import time

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

results = []
for q in QUERIES:
    try:
        url = f"https://www.google.com/search?q={q.replace(' ', '+')}"
        res = requests.get(url, headers={'User-Agent': 'Mozilla/5.0'})
        results.append({"query": q, "status": "success", "length": len(res.text)})
        print(f"OK: {q}")
        time.sleep(random.randint(2, 5))
    except Exception as e:
        results.append({"query": q, "status": "error", "error": str(e)})
        print(f"ERR: {q}")

with open("proof-of-work.json", "w") as f:
    json.dump(results, f, indent=4)
print("Proof Written.")
