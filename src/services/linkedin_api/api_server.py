#!/usr/bin/env python3
# LinkedIn People & Company Enrichment API
import os
import requests
from flask import Flask, request, jsonify
from datetime import datetime

app = Flask(__name__)

PROXY_API_KEY = os.environ.get('PROXY_SX_API_KEY', '')

class LinkedInScraper:
    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15',
        })
    
    def get_person(self, profile_url: str) -> dict:
        # Demo data
        return {
            'name': 'John Doe',
            'headline': 'Senior Engineer at TechCorp',
            'location': 'San Francisco Bay Area',
            'current_company': {
                'name': 'TechCorp',
                'title': 'Senior Engineer',
                'started': '2023-01'
            },
            'previous_companies': [
                {'name': 'StartupXYZ', 'title': 'Engineer', 'period': '2021-2023'}
            ],
            'education': [
                {'school': 'Stanford University', 'degree': 'MS Computer Science'}
            ],
            'skills': ['Python', 'System Design', 'Machine Learning'],
            'connections': '500+',
            'profile_url': profile_url
        }
    
    def get_company(self, company_url: str) -> dict:
        return {
            'name': 'TechCorp',
            'industry': 'Technology',
            'size': '100-500 employees',
            'website': 'https://techcorp.com',
            'headquarters': 'San Francisco, CA',
            'description': 'Building the future of technology.',
            'job_openings': 25,
            'tech_stack': ['Python', 'React', 'AWS', 'PostgreSQL']
        }

scraper = LinkedInScraper()

@app.route('/health')
def health():
    return jsonify({'status': 'ok', 'timestamp': datetime.now().isoformat()})

@app.route('/api/linkedin/person')
def get_person():
    url = request.args.get('url', '')
    if not url:
        return jsonify({'error': 'url required'}), 400
    data = scraper.get_person(url)
    return jsonify(data)

@app.route('/api/linkedin/company')
def get_company():
    url = request.args.get('url', '')
    if not url:
        return jsonify({'error': 'url required'}), 400
    data = scraper.get_company(url)
    return jsonify(data)

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    print(f'LinkedIn API starting on port {port}')
    app.run(host='0.0.0.0', port=port)
