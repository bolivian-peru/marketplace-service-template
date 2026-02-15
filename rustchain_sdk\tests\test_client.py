"""
Test suite for RustChain SDK
"""

import pytest
from unittest.mock import Mock, patch
from rustchain import RustChainClient, NodeInfo, Epoch, Miner, WalletBalance


@pytest.fixture
def client():
    """Create test client"""
    return RustChainClient(base_url="https://test.example.com", verify_ssl=False)


class TestNodeInfo:
    """Tests for NodeInfo"""
    
    def test_create_node_info(self):
        node = NodeInfo(status="healthy", timestamp="2026-02-16T03:00:00Z")
        assert node.status == "healthy"
        assert node.timestamp == "2026-02-16T03:00:00Z"
    
    def test_node_info_to_dict(self):
        node = NodeInfo(status="healthy", timestamp="2026-02-16T03:00:00Z")
        data = node.to_dict()
        assert data['status'] == "healthy"
        assert data['timestamp'] == "2026-02-16T03:00:00Z"


class TestEpoch:
    """Tests for Epoch"""
    
    def test_create_epoch(self):
        epoch = Epoch(
            epoch_number=177,
            start_time="2026-02-16T00:00:00Z",
            end_time="2026-02-16T01:00:00Z",
            total_attestations=1500
        )
        assert epoch.epoch_number == 177
        assert epoch.total_attestations == 1500


class TestMiner:
    """Tests for Miner"""
    
    def test_create_miner(self):
        miner = Miner(
            miner_id="eafc6f14...",
            device_arch="G4",
            device_family="PowerPC",
            antiquity_multiplier=2.5,
            last_attest=1771013121,
            epochs_active=1200
        )
        assert miner.device_arch == "G4"
        assert miner.antiquity_multiplier == 2.5


class TestWalletBalance:
    """Tests for WalletBalance"""
    
    def test_create_balance(self):
        balance = WalletBalance(
            miner_id="wallet123",
            balance=100.5,
            last_updated="2026-02-16T03:00:00Z"
        )
        assert balance.balance == 100.5


class TestRustChainClient:
    """Tests for RustChainClient"""
    
    def test_create_client(self, client):
        assert client.base_url == "https://test.example.com"
        assert client.verify_ssl is False
        assert client.timeout == 30
    
    def test_repr(self, client):
        repr_str = repr(client)
        assert "RustChainClient" in repr_str
        assert "test.example.com" in repr_str
    
    @patch('requests.Session.request')
    def test_health_success(self, mock_request, client):
        mock_response = Mock()
        mock_response.json.return_value = {"status": "healthy", "timestamp": "2026-02-16T03:00:00Z"}
        mock_response.text = '{"status": "healthy", "timestamp": "2026-02-16T03:00:00Z"}'
        mock_request.return_value = mock_response
        
        health = client.health()
        
        assert health.status == "healthy"
        mock_request.assert_called_once()
    
    @patch('requests.Session.request')
    def test_get_miners(self, mock_request, client):
        mock_response = Mock()
        mock_response.json.return_value = [
            {"miner": "abc123", "device_arch": "G4", "antiquity_multiplier": 2.5},
            {"miner": "def456", "device_arch": "x86_64", "antiquity_multiplier": 1.0}
        ]
        mock_response.text = '[{"miner": "abc123", "device_arch": "G4"}]'
        mock_request.return_value = mock_response
        
        miners = client.get_miners()
        
        assert len(miners) == 2
        assert miners[0].device_arch == "G4"
        assert miners[0].antiquity_multiplier == 2.5
    
    @patch('requests.Session.request')
    def test_get_balance(self, mock_request, client):
        mock_response = Mock()
        mock_response.json.return_value = {"balance": 150.75}
        mock_response.text = '{"balance": 150.75}'
        mock_request.return_value = mock_response
        
        balance = client.get_balance("wallet123")
        
        assert balance.balance == 150.75
    
    def test_ping_success(self, client):
        with patch.object(client, 'health') as mock_health:
            mock_health.return_value = NodeInfo(status="healthy", timestamp="")
            assert client.ping() is True
    
    def test_ping_failure(self, client):
        with patch.object(client, 'health') as mock_health:
            mock_health.side_effect = Exception("Connection failed")
            assert client.ping() is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
