import requests

proxy = "http://172.26.176.1:7897"
proxies = {"http": proxy, "https": proxy}
url = "https://www.google.com/search?q=Python+automation&hl=en"
headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36"
}

r = requests.get(url, proxies=proxies, headers=headers)
with open('dump.html', 'w') as f:
    f.write(r.text)
print(f"Status: {r.status_code}")
print(f"H3 count: {r.text.count('<h3')}")
