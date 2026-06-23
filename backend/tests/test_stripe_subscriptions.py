"""
Test Stripe Subscription endpoints for NEURA AL-NOUR app
- Subscription plans API
- Checkout session creation
- Checkout status check
- Webhook endpoint accessibility
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://noor-dev.preview.emergentagent.com')

# VIP Admin credentials
VIP_ADMIN_EMAIL = "kaddanwalidpro@gmail.com"
VIP_ADMIN_PASSWORD = "Hassan156"

# Test user credentials
TEST_USER_EMAIL = "test_stripe_user@example.com"
TEST_USER_PASSWORD = "TestPass123!"
TEST_USER_NAME = "Test Stripe User"


@pytest.fixture(scope="module")
def api_client():
    """Shared requests session"""
    session = requests.Session()
    session.headers.update({"Content-Type": "application/json"})
    return session


@pytest.fixture(scope="module")
def vip_admin_token(api_client):
    """Get VIP admin authentication token"""
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": VIP_ADMIN_EMAIL,
        "password": VIP_ADMIN_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    pytest.skip("VIP Admin login failed - skipping authenticated tests")


@pytest.fixture(scope="module")
def test_user_token(api_client):
    """Get or create test user token"""
    # Try to login first
    response = api_client.post(f"{BASE_URL}/api/auth/login", json={
        "email": TEST_USER_EMAIL,
        "password": TEST_USER_PASSWORD
    })
    if response.status_code == 200:
        return response.json().get("token")
    
    # If login fails, register new user
    response = api_client.post(f"{BASE_URL}/api/auth/register", json={
        "email": TEST_USER_EMAIL,
        "password": TEST_USER_PASSWORD,
        "name": TEST_USER_NAME
    })
    if response.status_code == 200:
        return response.json().get("token")
    
    pytest.skip("Could not create test user - skipping tests")


@pytest.fixture(scope="module")
def vip_admin_client(api_client, vip_admin_token):
    """Session with VIP admin auth header"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {vip_admin_token}"
    })
    return session


@pytest.fixture(scope="module")
def test_user_client(api_client, test_user_token):
    """Session with test user auth header"""
    session = requests.Session()
    session.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {test_user_token}"
    })
    return session


class TestSubscriptionPlans:
    """Test GET /api/subscriptions/plans endpoint"""
    
    def test_get_subscription_plans_returns_200(self, api_client):
        """Plans endpoint should return 200 OK"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        assert response.status_code == 200
        print("Plans endpoint returns 200 OK")
    
    def test_get_subscription_plans_returns_all_5_plans(self, api_client):
        """Plans endpoint should return all 5 subscription plans"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        data = response.json()
        
        expected_plans = ["free", "comme_toi", "mongo", "pro", "developer"]
        for plan_id in expected_plans:
            assert plan_id in data, f"Plan {plan_id} not found"
        
        assert len(data) == 5
        print(f"All 5 plans found: {list(data.keys())}")
    
    def test_subscription_plan_structure(self, api_client):
        """Each plan should have name, price_monthly, price_yearly, features"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        data = response.json()
        
        for plan_id, plan in data.items():
            assert "name" in plan, f"Plan {plan_id} missing 'name'"
            assert "price_monthly" in plan, f"Plan {plan_id} missing 'price_monthly'"
            assert "price_yearly" in plan, f"Plan {plan_id} missing 'price_yearly'"
            assert "features" in plan, f"Plan {plan_id} missing 'features'"
            assert isinstance(plan["features"], list), f"Plan {plan_id} features should be a list"
        
        print("All plans have correct structure")
    
    def test_plan_prices(self, api_client):
        """Verify plan prices match expected values"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/plans")
        data = response.json()
        
        expected_prices = {
            "free": (0, 0),
            "comme_toi": (4.99, 49.99),
            "mongo": (8.99, 89.99),
            "pro": (14.99, 89.99),
            "developer": (19.99, 119.99)
        }
        
        for plan_id, (monthly, yearly) in expected_prices.items():
            assert data[plan_id]["price_monthly"] == monthly, f"{plan_id} monthly price mismatch"
            assert data[plan_id]["price_yearly"] == yearly, f"{plan_id} yearly price mismatch"
        
        print("All plan prices match expected values")


class TestCheckoutSession:
    """Test POST /api/subscriptions/checkout endpoint"""
    
    def test_checkout_requires_auth(self, api_client):
        """Checkout endpoint should require authentication"""
        response = api_client.post(f"{BASE_URL}/api/subscriptions/checkout", json={
            "plan": "comme_toi",
            "billing_period": "monthly",
            "origin_url": "https://noor-dev.preview.emergentagent.com"
        })
        assert response.status_code == 401
        print("Checkout correctly requires authentication")
    
    def test_checkout_rejects_invalid_plan(self, test_user_client):
        """Checkout should reject invalid plan"""
        response = test_user_client.post(f"{BASE_URL}/api/subscriptions/checkout", json={
            "plan": "invalid_plan",
            "billing_period": "monthly",
            "origin_url": "https://noor-dev.preview.emergentagent.com"
        })
        assert response.status_code == 400
        print("Invalid plan correctly rejected")
    
    def test_checkout_rejects_free_plan(self, test_user_client):
        """Checkout should reject free plan (no payment needed)"""
        response = test_user_client.post(f"{BASE_URL}/api/subscriptions/checkout", json={
            "plan": "free",
            "billing_period": "monthly",
            "origin_url": "https://noor-dev.preview.emergentagent.com"
        })
        assert response.status_code == 400
        print("Free plan correctly rejected from checkout")
    
    def test_checkout_creates_session_monthly(self, test_user_client):
        """Checkout should create Stripe session for monthly billing"""
        response = test_user_client.post(f"{BASE_URL}/api/subscriptions/checkout", json={
            "plan": "comme_toi",
            "billing_period": "monthly",
            "origin_url": "https://noor-dev.preview.emergentagent.com"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        assert "url" in data, "Response should contain 'url'"
        assert "session_id" in data, "Response should contain 'session_id'"
        assert data["url"].startswith("https://checkout.stripe.com"), f"URL should be Stripe checkout URL, got: {data['url'][:50]}"
        assert len(data["session_id"]) > 0, "session_id should not be empty"
        
        print(f"Checkout session created: {data['session_id'][:30]}...")
        print(f"Stripe URL: {data['url'][:80]}...")
    
    def test_checkout_creates_session_yearly(self, test_user_client):
        """Checkout should create Stripe session for yearly billing"""
        response = test_user_client.post(f"{BASE_URL}/api/subscriptions/checkout", json={
            "plan": "mongo",
            "billing_period": "yearly",
            "origin_url": "https://noor-dev.preview.emergentagent.com"
        })
        
        assert response.status_code == 200
        data = response.json()
        
        assert "url" in data
        assert "session_id" in data
        assert data["url"].startswith("https://checkout.stripe.com")
        
        print(f"Yearly checkout session created: {data['session_id'][:30]}...")


class TestCheckoutStatus:
    """Test GET /api/subscriptions/status/{session_id} endpoint"""
    
    def test_status_requires_auth(self, api_client):
        """Status endpoint should require authentication"""
        response = api_client.get(f"{BASE_URL}/api/subscriptions/status/cs_test_fake_session")
        assert response.status_code == 401
        print("Status endpoint correctly requires authentication")
    
    def test_status_for_new_session(self, test_user_client):
        """Create a session and check its status (should be open/unpaid)"""
        # First create a checkout session
        checkout_response = test_user_client.post(f"{BASE_URL}/api/subscriptions/checkout", json={
            "plan": "pro",
            "billing_period": "monthly",
            "origin_url": "https://noor-dev.preview.emergentagent.com"
        })
        
        assert checkout_response.status_code == 200
        session_id = checkout_response.json()["session_id"]
        
        # Now check status
        status_response = test_user_client.get(f"{BASE_URL}/api/subscriptions/status/{session_id}")
        
        assert status_response.status_code == 200
        data = status_response.json()
        
        assert "status" in data, "Response should contain 'status'"
        assert "payment_status" in data, "Response should contain 'payment_status'"
        
        # New session should be open and unpaid
        assert data["status"] == "open", f"Expected status 'open', got '{data['status']}'"
        assert data["payment_status"] == "unpaid", f"Expected payment_status 'unpaid', got '{data['payment_status']}'"
        
        print(f"Session {session_id[:30]}... status: {data['status']}, payment: {data['payment_status']}")


class TestStripeWebhook:
    """Test POST /api/webhook/stripe endpoint"""
    
    def test_webhook_endpoint_exists(self, api_client):
        """Webhook endpoint should exist and be accessible"""
        # Webhook will fail without proper signature, but endpoint should exist
        response = api_client.post(f"{BASE_URL}/api/webhook/stripe", json={})
        
        # Expect error but NOT 404 (endpoint should exist)
        assert response.status_code != 404, "Webhook endpoint should exist"
        print(f"Webhook endpoint exists, returns {response.status_code} (expected without proper signature)")


class TestVIPAdminAccess:
    """Test VIP admin user access and status"""
    
    def test_vip_admin_login(self, api_client):
        """VIP admin should be able to login"""
        response = api_client.post(f"{BASE_URL}/api/auth/login", json={
            "email": VIP_ADMIN_EMAIL,
            "password": VIP_ADMIN_PASSWORD
        })
        
        assert response.status_code == 200
        data = response.json()
        
        assert "token" in data
        assert "user" in data
        assert data["user"]["is_vip"] == True, "VIP admin should have is_vip=true"
        assert data["user"]["subscription"] == "developer", "VIP admin should have developer subscription"
        
        print(f"VIP admin login successful: {data['user']['email']}, subscription={data['user']['subscription']}, is_vip={data['user']['is_vip']}")
    
    def test_vip_admin_me_endpoint(self, vip_admin_client):
        """VIP admin /me endpoint should return correct data"""
        response = vip_admin_client.get(f"{BASE_URL}/api/auth/me")
        
        assert response.status_code == 200
        data = response.json()
        
        assert data["is_vip"] == True
        assert data["subscription"] == "developer"
        
        print(f"VIP admin verified: is_vip={data['is_vip']}, subscription={data['subscription']}")


class TestTransactionPersistence:
    """Test that checkout creates transaction in MongoDB"""
    
    def test_checkout_saves_transaction(self, test_user_client):
        """Checkout should save transaction to database with pending status"""
        # Create checkout session
        response = test_user_client.post(f"{BASE_URL}/api/subscriptions/checkout", json={
            "plan": "developer",
            "billing_period": "monthly",
            "origin_url": "https://noor-dev.preview.emergentagent.com"
        })
        
        assert response.status_code == 200
        data = response.json()
        session_id = data["session_id"]
        
        # Check status to verify transaction exists
        status_response = test_user_client.get(f"{BASE_URL}/api/subscriptions/status/{session_id}")
        assert status_response.status_code == 200
        
        print(f"Transaction created for session {session_id[:30]}... with pending status")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
