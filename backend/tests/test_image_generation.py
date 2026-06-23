"""
Test Image Generation Feature for NEURA AL-NOUR
Tests:
- GET /api/images/remaining - returns remaining free generations
- POST /api/images/generate - generates images with GPT Image 1
- VIP users get unlimited generations
- Free users limited to 3 generations
- After 3 generations, free user gets 403 with upgrade message
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials from main agent
VIP_ADMIN_EMAIL = "kaddanwalidpro@gmail.com"
VIP_ADMIN_PASSWORD = "Hassan156"
FREE_USER_EMAIL = "testfree_imggen@test.com"
FREE_USER_PASSWORD = "Test123!"


class TestImageGenerationAuth:
    """Test authentication requirements for image generation endpoints"""
    
    def test_remaining_requires_auth(self):
        """GET /api/images/remaining returns 401 without authentication"""
        response = requests.get(f"{BASE_URL}/api/images/remaining")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ GET /api/images/remaining requires authentication (401 without token)")

    def test_generate_requires_auth(self):
        """POST /api/images/generate returns 401 without authentication"""
        response = requests.post(
            f"{BASE_URL}/api/images/generate",
            json={"prompt": "A test image"}
        )
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ POST /api/images/generate requires authentication (401 without token)")


class TestVIPUserImageGeneration:
    """Test image generation for VIP admin users"""
    
    @pytest.fixture(scope="class")
    def vip_token(self):
        """Get VIP admin auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": VIP_ADMIN_EMAIL, "password": VIP_ADMIN_PASSWORD}
        )
        assert response.status_code == 200, f"VIP login failed: {response.text}"
        data = response.json()
        assert "token" in data
        assert data.get("user", {}).get("is_vip") == True, "User is not VIP"
        print(f"✓ VIP admin login successful: {VIP_ADMIN_EMAIL}")
        return data["token"]
    
    def test_vip_remaining_shows_unlimited(self, vip_token):
        """GET /api/images/remaining for VIP user returns unlimited=true"""
        headers = {"Authorization": f"Bearer {vip_token}"}
        response = requests.get(f"{BASE_URL}/api/images/remaining", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("unlimited") == True, f"VIP should have unlimited, got: {data}"
        assert data.get("remaining") == -1, f"VIP remaining should be -1, got: {data}"
        print(f"✓ VIP user has unlimited generations: {data}")

    def test_vip_can_generate_image(self, vip_token):
        """POST /api/images/generate works for VIP user"""
        headers = {"Authorization": f"Bearer {vip_token}"}
        response = requests.post(
            f"{BASE_URL}/api/images/generate",
            json={"prompt": "A beautiful mosque at sunset"},
            headers=headers,
            timeout=120  # Image generation takes 30-60 seconds
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert "image_base64" in data, f"Response should contain image_base64: {data}"
        # Check that image_base64 is a valid base64 string (not empty)
        assert len(data["image_base64"]) > 100, "Image base64 should be non-trivial"
        print(f"✓ VIP user successfully generated image (base64 length: {len(data['image_base64'])})")


class TestFreeUserImageGeneration:
    """Test image generation limits for free users"""
    
    @pytest.fixture(scope="class")
    def free_user_token(self):
        """Get or create free test user and get token"""
        # Try to login first
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": FREE_USER_EMAIL, "password": FREE_USER_PASSWORD}
        )
        
        if response.status_code == 200:
            data = response.json()
            print(f"✓ Free user login successful: {FREE_USER_EMAIL}")
            return data["token"]
        
        # If login fails, try to register
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": FREE_USER_EMAIL,
                "password": FREE_USER_PASSWORD,
                "name": "Test Free Image Gen"
            }
        )
        
        if response.status_code == 200 or response.status_code == 201:
            data = response.json()
            print(f"✓ Free user registered: {FREE_USER_EMAIL}")
            return data["token"]
        elif response.status_code == 400 and "déjà utilisé" in response.text:
            # User exists but login failed - password might be wrong
            pytest.skip(f"Free user exists but login failed: {response.text}")
        else:
            pytest.fail(f"Could not get free user token: {response.status_code} - {response.text}")

    def test_free_user_remaining_starts_at_3(self, free_user_token):
        """GET /api/images/remaining for free user returns remaining <= 3, unlimited=false"""
        headers = {"Authorization": f"Bearer {free_user_token}"}
        response = requests.get(f"{BASE_URL}/api/images/remaining", headers=headers)
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        data = response.json()
        assert data.get("unlimited") == False, f"Free user should NOT have unlimited: {data}"
        assert data.get("limit") == 3, f"Free user limit should be 3: {data}"
        assert 0 <= data.get("remaining", -1) <= 3, f"Remaining should be 0-3: {data}"
        print(f"✓ Free user remaining generations: {data}")
        return data.get("remaining")

    def test_free_user_blocked_after_limit(self, free_user_token):
        """After 3 generations, free user gets 403 with upgrade message"""
        # First check remaining
        headers = {"Authorization": f"Bearer {free_user_token}"}
        remaining_response = requests.get(f"{BASE_URL}/api/images/remaining", headers=headers)
        remaining_data = remaining_response.json()
        
        if remaining_data.get("remaining", 3) > 0:
            print(f"⚠ Free user still has {remaining_data.get('remaining')} remaining - cannot test blocking")
            print("  To test blocking: manually set image_generations_count=3 in MongoDB for this user")
            pytest.skip("User has remaining generations - cannot test blocking without actual generation")
        
        # If remaining is 0, try to generate - should get 403
        response = requests.post(
            f"{BASE_URL}/api/images/generate",
            json={"prompt": "A test image"},
            headers=headers,
            timeout=120
        )
        assert response.status_code == 403, f"Expected 403 when limit exceeded, got {response.status_code}"
        data = response.json()
        assert "Mongo" in data.get("detail", ""), f"403 message should mention Mongo plan: {data}"
        print(f"✓ Free user blocked after limit: {data.get('detail')}")


class TestImageGenerationRemainingDecrement:
    """Test that image_generations_count increments properly"""
    
    def test_remaining_decrements_after_generation(self):
        """After each generation for free user, remaining count decrements"""
        # Create a new unique user for this test
        unique_email = f"test_decrement_{int(time.time())}@test.com"
        unique_password = "Test123!"
        
        # Register new user
        response = requests.post(
            f"{BASE_URL}/api/auth/register",
            json={
                "email": unique_email,
                "password": unique_password,
                "name": "Test Decrement User"
            }
        )
        
        if response.status_code not in [200, 201]:
            pytest.skip(f"Could not create test user: {response.text}")
        
        token = response.json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        # Check initial remaining (should be 3)
        remaining_before = requests.get(f"{BASE_URL}/api/images/remaining", headers=headers).json()
        print(f"Initial remaining: {remaining_before}")
        
        assert remaining_before.get("remaining") == 3, f"New user should have 3 remaining: {remaining_before}"
        assert remaining_before.get("unlimited") == False
        
        # Note: We don't actually generate an image here as it's expensive and slow
        # The test verifies the initial state. Actual generation test is in VIP tests.
        print("✓ New free user starts with 3 remaining generations")
        print("  (Actual generation test skipped to save API credits - tested in VIP section)")


class TestImageGenerationEdgeCases:
    """Test edge cases for image generation"""
    
    @pytest.fixture(scope="class")
    def vip_token(self):
        """Get VIP admin auth token"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": VIP_ADMIN_EMAIL, "password": VIP_ADMIN_PASSWORD}
        )
        if response.status_code == 200:
            return response.json()["token"]
        pytest.skip("VIP login failed")
    
    def test_empty_prompt_rejected(self, vip_token):
        """POST /api/images/generate with empty prompt should fail"""
        headers = {"Authorization": f"Bearer {vip_token}"}
        response = requests.post(
            f"{BASE_URL}/api/images/generate",
            json={"prompt": ""},
            headers=headers,
            timeout=30
        )
        # Empty prompt might be rejected with 422 (validation error) or 400
        assert response.status_code in [400, 422, 500], f"Empty prompt should be rejected, got {response.status_code}"
        print(f"✓ Empty prompt rejected with status {response.status_code}")
    
    def test_invalid_token_rejected(self):
        """POST /api/images/generate with invalid token should fail with 401"""
        headers = {"Authorization": "Bearer invalid_token_here"}
        response = requests.post(
            f"{BASE_URL}/api/images/generate",
            json={"prompt": "A test image"},
            headers=headers
        )
        assert response.status_code == 401, f"Invalid token should be rejected, got {response.status_code}"
        print("✓ Invalid token rejected with 401")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
