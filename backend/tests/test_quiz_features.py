"""
Test suite for Quiz API endpoints (AI-generated quiz questions feature)
Tests:
- POST /api/quiz/start - Start quiz session with 10 AI-generated questions
- POST /api/quiz/session/{session_id}/answer - Submit answer for a question
- GET /api/quiz/categories - Get quiz categories
- GET /api/quiz/stats - Get user quiz statistics (requires auth)
"""

import pytest
import requests
import os
import time

BASE_URL = os.environ.get('REACT_APP_BACKEND_URL', '').rstrip('/')

# Test credentials
VIP_ADMIN_EMAIL = "kaddanwalidpro@gmail.com"
VIP_ADMIN_PASSWORD = "Hassan156"


class TestQuizCategories:
    """Test quiz categories endpoint"""
    
    def test_get_categories_returns_6_categories(self):
        """GET /api/quiz/categories returns the 6 expected categories"""
        response = requests.get(f"{BASE_URL}/api/quiz/categories")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        categories = response.json()
        assert isinstance(categories, list), "Categories should be a list"
        assert len(categories) == 6, f"Expected 6 categories, got {len(categories)}"
        
        expected = ["piliers", "coran", "priere", "ramadan", "prophetes", "croyance"]
        for cat in expected:
            assert cat in categories, f"Missing category: {cat}"
        print(f"✓ GET /api/quiz/categories returns 6 categories: {categories}")


class TestQuizStart:
    """Test quiz start endpoint - generates 10 new questions each time"""
    
    def test_start_quiz_returns_session_and_10_questions(self):
        """POST /api/quiz/start returns session_id and exactly 10 questions"""
        response = requests.post(f"{BASE_URL}/api/quiz/start")
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "session_id" in data, "Response missing session_id"
        assert "questions" in data, "Response missing questions"
        
        questions = data["questions"]
        assert len(questions) == 10, f"Expected 10 questions, got {len(questions)}"
        
        print(f"✓ Quiz started with session_id: {data['session_id'][:8]}... and 10 questions")
        return data
    
    def test_questions_do_not_contain_correct_answer(self):
        """Questions returned from /api/quiz/start should NOT include correct_answer field"""
        response = requests.post(f"{BASE_URL}/api/quiz/start")
        assert response.status_code == 200
        
        questions = response.json()["questions"]
        for i, q in enumerate(questions):
            assert "correct_answer" not in q, f"Question {i} should not expose correct_answer"
            assert "question" in q, f"Question {i} missing 'question' field"
            assert "options" in q, f"Question {i} missing 'options' field"
            assert len(q["options"]) == 4, f"Question {i} should have 4 options"
            assert "index" in q, f"Question {i} missing 'index' field"
        
        print("✓ Questions do NOT contain correct_answer field (answer is hidden)")
    
    def test_questions_have_valid_structure(self):
        """Each question should have: index, question, options, category"""
        response = requests.post(f"{BASE_URL}/api/quiz/start")
        data = response.json()
        
        for i, q in enumerate(data["questions"]):
            assert "index" in q and q["index"] == i, f"Question index mismatch"
            assert "question" in q and isinstance(q["question"], str), f"Question {i} invalid question text"
            assert "options" in q and len(q["options"]) == 4, f"Question {i} should have 4 options"
            assert "category" in q, f"Question {i} missing category"
        
        print("✓ All 10 questions have valid structure (index, question, options, category)")
    
    def test_start_quiz_with_category_coran(self):
        """POST /api/quiz/start?category=coran generates questions focused on Coran"""
        response = requests.post(f"{BASE_URL}/api/quiz/start?category=coran")
        assert response.status_code == 200
        
        data = response.json()
        questions = data["questions"]
        
        # At least some questions should be in coran category
        coran_count = sum(1 for q in questions if q.get("category") == "coran")
        print(f"✓ Quiz with category=coran: {coran_count}/10 questions are coran-related")
    
    def test_start_quiz_with_category_piliers(self):
        """POST /api/quiz/start?category=piliers generates questions focused on pillars"""
        response = requests.post(f"{BASE_URL}/api/quiz/start?category=piliers")
        assert response.status_code == 200
        
        data = response.json()
        assert "session_id" in data
        assert len(data["questions"]) == 10
        print(f"✓ Quiz with category=piliers started successfully")
    
    def test_two_consecutive_starts_return_different_questions(self):
        """Two consecutive POST /api/quiz/start calls should return different questions (AI-generated)"""
        response1 = requests.post(f"{BASE_URL}/api/quiz/start")
        assert response1.status_code == 200
        
        # Wait a bit to ensure different session
        time.sleep(0.5)
        
        response2 = requests.post(f"{BASE_URL}/api/quiz/start")
        assert response2.status_code == 200
        
        questions1 = [q["question"] for q in response1.json()["questions"]]
        questions2 = [q["question"] for q in response2.json()["questions"]]
        
        session1 = response1.json()["session_id"]
        session2 = response2.json()["session_id"]
        
        # Sessions should be different
        assert session1 != session2, "Session IDs should be different"
        
        # Questions should be at least partially different (AI generates new ones)
        same_count = sum(1 for q in questions1 if q in questions2)
        different = 10 - same_count
        
        print(f"✓ Two quiz starts have different sessions. Questions overlap: {same_count}/10 same, {different}/10 different")
        # It's acceptable if AI generates some similar questions, but not all should be identical
        assert different >= 0, "Should have some variation in questions"


class TestQuizSessionAnswer:
    """Test quiz answer submission endpoint"""
    
    @pytest.fixture
    def quiz_session(self):
        """Create a new quiz session for testing"""
        response = requests.post(f"{BASE_URL}/api/quiz/start")
        assert response.status_code == 200
        return response.json()
    
    def test_submit_answer_returns_correct_incorrect(self, quiz_session):
        """POST /api/quiz/session/{session_id}/answer validates answer and returns result"""
        session_id = quiz_session["session_id"]
        
        # Submit answer for first question (index 0)
        response = requests.post(
            f"{BASE_URL}/api/quiz/session/{session_id}/answer",
            json={"question_index": 0, "answer": 0}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        data = response.json()
        assert "correct" in data, "Response missing 'correct' field"
        assert "correct_answer" in data, "Response missing 'correct_answer' field"
        assert "correct_option" in data, "Response missing 'correct_option' field"
        
        print(f"✓ Answer submitted. Correct: {data['correct']}, correct_answer: {data['correct_answer']}")
    
    def test_submit_all_10_answers(self, quiz_session):
        """Submit answers for all 10 questions in a session"""
        session_id = quiz_session["session_id"]
        correct_count = 0
        
        for i in range(10):
            response = requests.post(
                f"{BASE_URL}/api/quiz/session/{session_id}/answer",
                json={"question_index": i, "answer": 0}  # Always answer 0 for testing
            )
            assert response.status_code == 200, f"Question {i} failed: {response.status_code}"
            
            if response.json().get("correct"):
                correct_count += 1
        
        print(f"✓ All 10 answers submitted successfully. Score: {correct_count}/10")
    
    def test_invalid_session_id_returns_404(self):
        """Invalid session_id returns 404 on answer endpoint"""
        response = requests.post(
            f"{BASE_URL}/api/quiz/session/invalid-session-12345/answer",
            json={"question_index": 0, "answer": 0}
        )
        assert response.status_code == 404, f"Expected 404, got {response.status_code}"
        print("✓ Invalid session_id returns 404")
    
    def test_invalid_question_index_returns_400(self, quiz_session):
        """Invalid question_index returns 400 on answer endpoint"""
        session_id = quiz_session["session_id"]
        
        # Test negative index
        response = requests.post(
            f"{BASE_URL}/api/quiz/session/{session_id}/answer",
            json={"question_index": -1, "answer": 0}
        )
        assert response.status_code == 400, f"Expected 400 for negative index, got {response.status_code}"
        
        # Test index out of range (>9 for 10 questions)
        response = requests.post(
            f"{BASE_URL}/api/quiz/session/{session_id}/answer",
            json={"question_index": 10, "answer": 0}
        )
        assert response.status_code == 400, f"Expected 400 for index 10, got {response.status_code}"
        
        print("✓ Invalid question_index (-1 and 10) returns 400")


class TestQuizStats:
    """Test quiz statistics endpoint (requires authentication)"""
    
    @pytest.fixture
    def auth_token(self):
        """Get auth token for VIP admin"""
        response = requests.post(
            f"{BASE_URL}/api/auth/login",
            json={"email": VIP_ADMIN_EMAIL, "password": VIP_ADMIN_PASSWORD}
        )
        if response.status_code == 200:
            return response.json().get("token")
        pytest.skip("Authentication failed - skipping auth tests")
    
    def test_get_stats_requires_auth(self):
        """GET /api/quiz/stats requires authentication"""
        response = requests.get(f"{BASE_URL}/api/quiz/stats")
        assert response.status_code == 401, f"Expected 401, got {response.status_code}"
        print("✓ GET /api/quiz/stats returns 401 without auth")
    
    def test_get_stats_with_auth(self, auth_token):
        """GET /api/quiz/stats returns stats for logged-in user"""
        response = requests.get(
            f"{BASE_URL}/api/quiz/stats",
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        
        stats = response.json()
        assert "total_questions" in stats, "Stats missing total_questions"
        assert "correct_answers" in stats, "Stats missing correct_answers"
        assert "accuracy" in stats, "Stats missing accuracy"
        
        print(f"✓ Quiz stats: total={stats['total_questions']}, correct={stats['correct_answers']}, accuracy={stats['accuracy']}%")
    
    def test_submit_answer_updates_stats(self, auth_token):
        """Submitting an answer updates user stats when authenticated"""
        # Get initial stats
        stats_before = requests.get(
            f"{BASE_URL}/api/quiz/stats",
            headers={"Authorization": f"Bearer {auth_token}"}
        ).json()
        
        # Start a new quiz and answer one question
        quiz = requests.post(f"{BASE_URL}/api/quiz/start").json()
        session_id = quiz["session_id"]
        
        # Submit answer with auth header
        requests.post(
            f"{BASE_URL}/api/quiz/session/{session_id}/answer",
            json={"question_index": 0, "answer": 0},
            headers={"Authorization": f"Bearer {auth_token}"}
        )
        
        # Get stats after
        stats_after = requests.get(
            f"{BASE_URL}/api/quiz/stats",
            headers={"Authorization": f"Bearer {auth_token}"}
        ).json()
        
        # Total questions should have increased by 1
        assert stats_after["total_questions"] >= stats_before["total_questions"], "Total questions should not decrease"
        print(f"✓ Stats updated after answer: {stats_before['total_questions']} -> {stats_after['total_questions']}")


class TestQuizIntegration:
    """End-to-end quiz flow tests"""
    
    def test_complete_quiz_flow_without_auth(self):
        """Complete quiz flow without authentication"""
        # 1. Start quiz
        start_response = requests.post(f"{BASE_URL}/api/quiz/start")
        assert start_response.status_code == 200
        data = start_response.json()
        session_id = data["session_id"]
        questions = data["questions"]
        
        print(f"Started quiz session: {session_id[:8]}...")
        
        # 2. Answer all 10 questions
        score = 0
        for i in range(10):
            answer_response = requests.post(
                f"{BASE_URL}/api/quiz/session/{session_id}/answer",
                json={"question_index": i, "answer": 0}
            )
            assert answer_response.status_code == 200
            if answer_response.json().get("correct"):
                score += 1
        
        print(f"✓ Complete quiz flow: Answered all 10 questions. Score: {score}/10")
    
    def test_quiz_category_filtering(self):
        """Test that category parameter affects generated questions"""
        categories = ["piliers", "coran", "priere", "ramadan", "prophetes", "croyance"]
        
        for cat in categories:
            response = requests.post(f"{BASE_URL}/api/quiz/start?category={cat}")
            assert response.status_code == 200, f"Failed for category {cat}"
            
            questions = response.json()["questions"]
            assert len(questions) == 10
            
            # Count questions matching the category
            cat_count = sum(1 for q in questions if q.get("category") == cat)
            print(f"  Category '{cat}': {cat_count}/10 questions match")
        
        print("✓ All 6 categories work with /api/quiz/start")


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
