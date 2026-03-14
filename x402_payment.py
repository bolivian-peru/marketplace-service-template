#!/usr/bin/env python3
"""
x402 Payment Protocol Integration
Handles micropayments for YouTube Transcript Scraper service.
"""

import json
import hashlib
import time
import urllib.request
import urllib.parse
from typing import Optional, Dict, Any, Tuple


class X402PaymentHandler:
    """
    Handle x402 payment protocol for service access.
    
    The x402 protocol enables micropayments for HTTP resources.
    This implementation supports:
    - Payment requirement detection
    - Payment scheme negotiation
    - Payment verification
    """
    
    def __init__(self, wallet_address: Optional[str] = None):
        self.wallet_address = wallet_address
        self.payment_schemes = [
            'x402-solana',
            'x402-ethereum',
            'x402-base'
        ]
    
    def parse_payment_required(self, response_headers: dict) -> Optional[Dict[str, Any]]:
        """
        Parse x402 payment requirements from response headers.
        
        Looks for:
        - WWW-Authenticate: x402 ...
        - X-Payment-Required: true
        - X-Payment-Address: <address>
        - X-Payment-Amount: <amount>
        - X-Payment-Currency: <currency>
        """
        payment_info = {}
        
        # Check for WWW-Authenticate header
        www_auth = response_headers.get('www-authenticate', '')
        if 'x402' in www_auth.lower():
            payment_info['www_authenticate'] = www_auth
            
            # Parse x402 parameters
            params = self._parse_x402_params(www_auth)
            payment_info.update(params)
        
        # Check for specific x402 headers
        for header in ['x-payment-address', 'x-payment-amount', 'x-payment-currency', 'x-payment-network']:
            if header in response_headers:
                key = header.replace('x-payment-', '').replace('-', '_')
                payment_info[key] = response_headers[header]
        
        if payment_info:
            payment_info['required'] = True
            return payment_info
        
        return None
    
    def _parse_x402_params(self, www_auth: str) -> Dict[str, str]:
        """Parse x402 parameters from WWW-Authenticate header."""
        params = {}
        
        # Extract x402 scheme and parameters
        # Format: x402 scheme="x402-solana", address="...", amount="...", ...
        parts = www_auth.split(',')
        
        for part in parts:
            part = part.strip()
            if '=' in part:
                key, value = part.split('=', 1)
                key = key.strip().lower()
                value = value.strip().strip('"\'')
                
                # Map to standard keys
                if key in ['scheme', 'address', 'amount', 'currency', 'network', 'description']:
                    params[key] = value
        
        return params
    
    def create_payment_payload(self, payment_info: Dict[str, Any], service_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Create payment payload for x402 transaction.
        
        Args:
            payment_info: Payment requirements from server
            service_data: Service-specific data to include
            
        Returns:
            Payment payload ready for transaction
        """
        timestamp = int(time.time())
        
        # Create payment manifest
        manifest = {
            'version': 'x402-v1',
            'scheme': payment_info.get('scheme', 'x402-solana'),
            'pay_to': payment_info.get('address', self.wallet_address),
            'amount': payment_info.get('amount', '0'),
            'currency': payment_info.get('currency', 'USDC'),
            'network': payment_info.get('network', 'solana-mainnet'),
            'timestamp': timestamp,
            'service': 'youtube-transcript-scraper',
            'resource': service_data.get('video_id', ''),
            'nonce': hashlib.sha256(f"{timestamp}-{service_data}".encode()).hexdigest()[:16]
        }
        
        # Create payment authorization
        authorization = {
            'manifest': manifest,
            'payer': self.wallet_address or 'anonymous',
            'signature': self._create_dummy_signature(manifest)
        }
        
        return {
            'x402_version': '1.0',
            'payment_scheme': manifest['scheme'],
            'authorization': authorization,
            'manifest_hash': hashlib.sha256(json.dumps(manifest, sort_keys=True).encode()).hexdigest()
        }
    
    def _create_dummy_signature(self, manifest: Dict) -> str:
        """
        Create a placeholder signature.
        
        In production, this would sign the manifest with the wallet's private key.
        For demo purposes, we create a deterministic hash.
        """
        manifest_str = json.dumps(manifest, sort_keys=True)
        signature_input = f"{manifest_str}-{time.time()}"
        return hashlib.sha256(signature_input.encode()).hexdigest()
    
    def verify_payment(self, payment_proof: str, expected_amount: str) -> bool:
        """
        Verify payment proof (server-side).
        
        In production, this would verify the blockchain transaction.
        For demo, we validate the format.
        """
        try:
            # Parse payment proof
            proof_data = json.loads(payment_proof)
            
            # Validate required fields
            required_fields = ['transaction_id', 'signature', 'amount']
            for field in required_fields:
                if field not in proof_data:
                    return False
            
            # Verify amount matches
            if str(proof_data['amount']) != str(expected_amount):
                return False
            
            return True
            
        except Exception:
            return False
    
    def create_payment_headers(self, payment_payload: Dict[str, Any]) -> Dict[str, str]:
        """Convert payment payload to HTTP headers."""
        headers = {
            'X-Payment-Version': 'x402-v1',
            'X-Payment-Scheme': payment_payload.get('payment_scheme', 'x402-solana'),
            'Content-Type': 'application/json'
        }
        
        # Add authorization header
        auth_json = json.dumps(payment_payload.get('authorization', {}))
        headers['Authorization'] = f"x402 {auth_json}"
        
        return headers
    
    def handle_payment_flow(self, url: str, video_id: str, amount: str = "0.01") -> Tuple[bool, Dict[str, Any]]:
        """
        Complete payment flow for accessing a resource.
        
        1. Make initial request
        2. Detect payment requirement
        3. Create payment
        4. Retry with payment
        
        Returns:
            Tuple of (success, result_dict)
        """
        # Step 1: Initial request
        try:
            req = urllib.request.Request(url)
            req.add_header('User-Agent', 'YouTube-Transcript-Scraper/1.0')
            
            with urllib.request.urlopen(req, timeout=10) as response:
                # No payment required
                return True, {
                    'payment_required': False,
                    'status': 'success',
                    'data': response.read().decode('utf-8')
                }
                
        except urllib.error.HTTPError as e:
            if e.code != 402:
                return False, {'error': f'HTTP Error: {e.code}', 'status': 'failed'}
            
            # Step 2: Parse payment requirements
            payment_info = self.parse_payment_required(dict(e.headers))
            
            if not payment_info:
                return False, {'error': '402 status but no x402 info', 'status': 'failed'}
            
            # Step 3: Create payment
            service_data = {'video_id': video_id, 'amount': amount}
            payment_payload = self.create_payment_payload(payment_info, service_data)
            
            # Step 4: Retry with payment
            payment_headers = self.create_payment_headers(payment_payload)
            
            try:
                req = urllib.request.Request(url)
                for key, value in payment_headers.items():
                    req.add_header(key, url)
                req.add_header('User-Agent', 'YouTube-Transcript-Scraper/1.0')
                
                with urllib.request.urlopen(req, timeout=10) as response:
                    return True, {
                        'payment_required': True,
                        'payment_info': payment_info,
                        'payment_payload': payment_payload,
                        'status': 'paid',
                        'data': response.read().decode('utf-8')
                    }
                    
            except Exception as payment_error:
                # Return payment info for client to handle
                return True, {
                    'payment_required': True,
                    'payment_info': payment_info,
                    'payment_payload': payment_payload,
                    'status': 'payment_created',
                    'error': str(payment_error)
                }
        
        except Exception as e:
            return False, {'error': str(e), 'status': 'failed'}


def create_payment_response(video_id: str, amount: str = "0.01", currency: str = "USDC") -> Dict[str, Any]:
    """
    Create a payment response for the API.
    
    Returns payment requirements for client to fulfill.
    """
    handler = X402PaymentHandler()
    
    payment_info = {
        'required': True,
        'scheme': 'x402-solana',
        'address': 'YOUR_WALLET_ADDRESS_HERE',  # Replace with actual address
        'amount': amount,
        'currency': currency,
        'network': 'solana-mainnet',
        'resource': f'youtube-transcript/{video_id}',
        'description': f'YouTube Transcript for video {video_id}'
    }
    
    payment_payload = handler.create_payment_payload(payment_info, {'video_id': video_id})
    
    return {
        'status': 'payment_required',
        'code': 402,
        'payment_info': payment_info,
        'payment_payload': payment_payload,
        'instructions': 'Send payment to the specified address and retry with X-Payment headers'
    }


if __name__ == '__main__':
    # Demo usage
    handler = X402PaymentHandler(wallet_address='DemoWallet123')
    
    print("x402 Payment Handler Demo")
    print("=" * 60)
    
    # Simulate payment requirements
    mock_headers = {
        'www-authenticate': 'x402 scheme="x402-solana", address="7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU", amount="0.01", currency="USDC"',
        'x-payment-network': 'solana-mainnet'
    }
    
    payment_info = handler.parse_payment_required(mock_headers)
    print(f"Payment Info: {json.dumps(payment_info, indent=2)}")
    
    # Create payment payload
    payload = handler.create_payment_payload(payment_info, {'video_id': 'dQw4w9WgXcQ'})
    print(f"\nPayment Payload: {json.dumps(payload, indent=2)}")
