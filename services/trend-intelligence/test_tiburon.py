import requests
import json

def test_health():
    r = requests.get("http://127.0.0.1:9502/health")
    assert r.status_code == 200
    data = r.json()
    assert data["ia_loaded"] == True
    print("✅ Health test passed")

def test_analyze():
    r = requests.get("http://127.0.0.1:9502/analyze/Python")
    assert r.status_code == 200
    assert "Modo Tiburón Supremo" in r.text
    print("✅ Analyze test passed")

if __name__ == "__main__":
    test_health()
    test_analyze()
    print("🎯 Todos los tests pasaron!")