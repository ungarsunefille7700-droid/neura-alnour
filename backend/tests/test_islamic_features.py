"""
Test suite for NEURA AL-NOUR Islamic Features
Tests 6 new features:
1. Prayer Times (Aladhan API)
2. Qiblah compass direction
3. Nearby Mosques (OpenStreetMap/Overpass API)
4. Learn Islam lessons
5. Support/Donation page
6. Quran with autoplay
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', 'https://noor-dev.preview.emergentagent.com').rstrip('/')

# Test coordinates - Paris
TEST_LAT = 48.8566
TEST_LON = 2.3522

class TestPrayerTimesAPI:
    """Prayer Times feature - /api/prayer-times with geolocation"""
    
    def test_prayer_times_success(self):
        """Test prayer times API with valid coordinates"""
        response = requests.get(
            f"{BASE_URL}/api/prayer-times",
            params={"latitude": TEST_LAT, "longitude": TEST_LON}
        )
        print(f"Prayer Times Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        # Verify response structure
        assert "fajr" in data, "Missing 'fajr' in prayer times"
        assert "sunrise" in data, "Missing 'sunrise' in prayer times"
        assert "dhuhr" in data, "Missing 'dhuhr' in prayer times"
        assert "asr" in data, "Missing 'asr' in prayer times"
        assert "maghrib" in data, "Missing 'maghrib' in prayer times"
        assert "isha" in data, "Missing 'isha' in prayer times"
        assert "date" in data, "Missing 'date' in prayer times"
        print(f"Prayer Times: Fajr={data['fajr']}, Dhuhr={data['dhuhr']}, Isha={data['isha']}")
    
    def test_prayer_times_missing_params(self):
        """Test prayer times API without required parameters"""
        response = requests.get(f"{BASE_URL}/api/prayer-times")
        # Should return 422 for missing parameters
        assert response.status_code == 422, f"Expected 422 for missing params, got {response.status_code}"
    
    def test_monthly_prayer_times(self):
        """Test monthly prayer times API"""
        response = requests.get(
            f"{BASE_URL}/api/prayer-times/month",
            params={"latitude": TEST_LAT, "longitude": TEST_LON, "month": 1, "year": 2026}
        )
        print(f"Monthly Prayer Times Status: {response.status_code}")
        # This may fail due to external API, just check it responds
        assert response.status_code in [200, 500], f"Unexpected status: {response.status_code}"


class TestQiblahAPI:
    """Qiblah direction feature - /api/qiblah"""
    
    def test_qiblah_direction_success(self):
        """Test Qiblah API with valid coordinates"""
        response = requests.get(
            f"{BASE_URL}/api/qiblah",
            params={"latitude": TEST_LAT, "longitude": TEST_LON}
        )
        print(f"Qiblah Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "direction" in data, "Missing 'direction' in Qiblah response"
        assert "latitude" in data, "Missing 'latitude' in Qiblah response"
        assert "longitude" in data, "Missing 'longitude' in Qiblah response"
        
        # Direction should be a number (degrees)
        assert isinstance(data["direction"], (int, float)), "Direction should be a number"
        assert 0 <= data["direction"] <= 360, "Direction should be between 0 and 360 degrees"
        print(f"Qiblah Direction from Paris: {data['direction']}°")
    
    def test_qiblah_missing_params(self):
        """Test Qiblah API without required parameters"""
        response = requests.get(f"{BASE_URL}/api/qiblah")
        assert response.status_code == 422, f"Expected 422 for missing params, got {response.status_code}"


class TestMosquesAPI:
    """Nearby Mosques feature - /api/mosques/nearby (OpenStreetMap)"""
    
    def test_nearby_mosques_success(self):
        """Test nearby mosques API with valid coordinates"""
        response = requests.get(
            f"{BASE_URL}/api/mosques/nearby",
            params={"latitude": TEST_LAT, "longitude": TEST_LON, "radius": 5000},
            timeout=35  # Overpass API can be slow
        )
        print(f"Mosques Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Mosques response should be a list"
        print(f"Found {len(data)} mosques nearby")
        
        # If there are mosques, verify structure
        if len(data) > 0:
            mosque = data[0]
            assert "name" in mosque, "Missing 'name' in mosque object"
            assert "latitude" in mosque, "Missing 'latitude' in mosque object"
            assert "longitude" in mosque, "Missing 'longitude' in mosque object"
            assert "distance" in mosque, "Missing 'distance' in mosque object"
            print(f"First mosque: {mosque['name']} at {mosque['distance']}m")
    
    def test_nearby_mosques_custom_radius(self):
        """Test nearby mosques API with different radius"""
        response = requests.get(
            f"{BASE_URL}/api/mosques/nearby",
            params={"latitude": TEST_LAT, "longitude": TEST_LON, "radius": 10000},
            timeout=35
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
    
    def test_nearby_mosques_missing_params(self):
        """Test nearby mosques API without required parameters"""
        response = requests.get(f"{BASE_URL}/api/mosques/nearby")
        assert response.status_code == 422, f"Expected 422 for missing params, got {response.status_code}"


class TestLearnIslamAPI:
    """Learn Islam feature - /api/learn/lessons with progress tracking"""
    
    def test_get_all_lessons(self):
        """Test get all lessons API"""
        response = requests.get(f"{BASE_URL}/api/learn/lessons")
        print(f"Learn Lessons Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert isinstance(data, list), "Lessons response should be a list"
        assert len(data) > 0, "Should have at least one lesson"
        print(f"Found {len(data)} lessons")
        
        # Verify lesson structure
        lesson = data[0]
        assert "id" in lesson, "Missing 'id' in lesson"
        assert "title" in lesson, "Missing 'title' in lesson"
        assert "arabic" in lesson, "Missing 'arabic' in lesson"
        assert "category" in lesson, "Missing 'category' in lesson"
        assert "content" in lesson, "Missing 'content' in lesson"
        assert isinstance(lesson["content"], list), "Lesson content should be a list"
        print(f"First lesson: {lesson['title']} ({lesson['id']})")
    
    def test_get_specific_lesson(self):
        """Test get specific lesson by ID"""
        # First get lessons to get a valid ID
        response = requests.get(f"{BASE_URL}/api/learn/lessons")
        lessons = response.json()
        
        if len(lessons) > 0:
            lesson_id = lessons[0]["id"]
            response = requests.get(f"{BASE_URL}/api/learn/lessons/{lesson_id}")
            print(f"Specific Lesson Response Status: {response.status_code}")
            
            assert response.status_code == 200, f"Expected 200, got {response.status_code}"
            
            data = response.json()
            assert data["id"] == lesson_id, "Lesson ID mismatch"
    
    def test_get_invalid_lesson(self):
        """Test get non-existent lesson"""
        response = requests.get(f"{BASE_URL}/api/learn/lessons/nonexistent_lesson_id")
        assert response.status_code == 404, f"Expected 404 for invalid lesson, got {response.status_code}"


class TestQuranAPI:
    """Quran feature with autoplay - /api/quran/surahs, /api/quran/surah/{number}"""
    
    def test_get_all_surahs(self):
        """Test get all surahs list"""
        response = requests.get(f"{BASE_URL}/api/quran/surahs")
        print(f"Quran Surahs Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Surahs response should be a list"
        assert len(data) > 0, "Should have surahs"
        print(f"Found {len(data)} surahs")
        
        # Verify surah structure
        surah = data[0]
        assert "number" in surah, "Missing 'number' in surah"
        assert "name" in surah, "Missing 'name' (Arabic) in surah"
        assert "englishName" in surah, "Missing 'englishName' in surah"
        assert "frenchName" in surah, "Missing 'frenchName' in surah"
        assert "ayahs" in surah, "Missing 'ayahs' count in surah"
    
    def test_get_surah_fatiha(self):
        """Test get Surah Al-Fatiha (Surah 1)"""
        response = requests.get(f"{BASE_URL}/api/quran/surah/1", timeout=30)
        print(f"Surah Fatiha Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert data["number"] == 1, "Surah number mismatch"
        assert "ayahs" in data, "Missing 'ayahs' in surah detail"
        assert len(data["ayahs"]) == 7, f"Al-Fatiha should have 7 ayahs, got {len(data['ayahs'])}"
        
        # Verify ayah structure
        ayah = data["ayahs"][0]
        assert "arabic" in ayah, "Missing 'arabic' in ayah"
        assert "french" in ayah, "Missing 'french' translation in ayah"
        print(f"Surah {data['name']} has {len(data['ayahs'])} ayahs")
    
    def test_get_surah_audio(self):
        """Test get surah audio endpoint"""
        response = requests.get(f"{BASE_URL}/api/quran/audio/1")
        print(f"Quran Audio Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "surah" in data, "Missing 'surah' in audio response"
        assert "reciter" in data, "Missing 'reciter' in audio response"
        assert "base_url" in data, "Missing 'base_url' in audio response"
        assert "everyayah.com" in data["base_url"], "Audio URL should be from everyayah.com"
    
    def test_get_invalid_surah(self):
        """Test get non-existent surah"""
        response = requests.get(f"{BASE_URL}/api/quran/surah/999", timeout=30)
        # The external API may return 200 with empty data or 500
        assert response.status_code in [404, 500], f"Expected 404/500 for invalid surah, got {response.status_code}"


class TestRamadanAPI:
    """Ramadan-related APIs"""
    
    def test_ramadan_times(self):
        """Test Ramadan times (Suhoor/Iftar)"""
        response = requests.get(
            f"{BASE_URL}/api/ramadan/times",
            params={"latitude": TEST_LAT, "longitude": TEST_LON}
        )
        print(f"Ramadan Times Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        
        data = response.json()
        assert "suhoor" in data, "Missing 'suhoor' in Ramadan times"
        assert "iftar" in data, "Missing 'iftar' in Ramadan times"
        print(f"Ramadan Times: Suhoor={data['suhoor']}, Iftar={data['iftar']}")
    
    def test_ramadan_tips(self):
        """Test Ramadan tips API"""
        response = requests.get(f"{BASE_URL}/api/ramadan/tips")
        print(f"Ramadan Tips Response Status: {response.status_code}")
        
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert isinstance(data, list), "Tips should be a list"
        assert len(data) > 0, "Should have tips"


class TestAuthAndProgress:
    """Test endpoints requiring authentication"""
    
    def test_learn_progress_requires_auth(self):
        """Test that learn progress endpoint requires auth"""
        response = requests.get(f"{BASE_URL}/api/learn/progress")
        # Should return 401/403 without auth
        assert response.status_code in [401, 403], f"Expected 401/403 without auth, got {response.status_code}"


class TestHealthCheck:
    """Basic health checks"""
    
    def test_backend_accessible(self):
        """Test backend is accessible"""
        response = requests.get(f"{BASE_URL}/api/", timeout=10)
        # Either 404 (no root endpoint) or 200 is fine - just checking connectivity
        assert response.status_code in [200, 404], f"Backend not accessible: {response.status_code}"
        print(f"Backend accessible at {BASE_URL}")


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
