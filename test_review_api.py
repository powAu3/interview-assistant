"""测试面试复盘 API 是否工作"""
import requests
import json

BASE_URL = "http://localhost:8000"

def test_get_config():
    """测试获取配置"""
    print("=== 测试 GET /api/config ===")
    try:
        resp = requests.get(f"{BASE_URL}/api/config", timeout=5)
        resp.raise_for_status()
        config = resp.json()

        print(f"review_enabled: {config.get('review_enabled')}")
        print(f"review_model_index: {config.get('review_model_index')}")
        print("✓ 获取配置成功")
        return config
    except Exception as e:
        print(f"✗ 获取配置失败: {e}")
        return None

def test_update_config():
    """测试更新配置"""
    print("\n=== 测试 POST /api/config ===")
    try:
        # 开启面试复盘
        resp = requests.post(
            f"{BASE_URL}/api/config",
            json={"review_enabled": True},
            headers={"Content-Type": "application/json"},
            timeout=5
        )
        resp.raise_for_status()
        config = resp.json()

        print(f"更新后 review_enabled: {config.get('review_enabled')}")
        print("✓ 更新配置成功")
        return config
    except Exception as e:
        print(f"✗ 更新配置失败: {e}")
        return None

def test_review_sessions():
    """测试复盘会话列表"""
    print("\n=== 测试 GET /api/review/sessions ===")
    try:
        resp = requests.get(f"{BASE_URL}/api/review/sessions", timeout=5)
        resp.raise_for_status()
        sessions = resp.json()

        print(f"会话数量: {len(sessions)}")
        if sessions:
            print(f"最新会话 ID: {sessions[0].get('id')}")
        print("✓ 获取会话列表成功")
        return sessions
    except Exception as e:
        print(f"✗ 获取会话列表失败: {e}")
        return None

if __name__ == "__main__":
    print("请确保后端服务已启动 (python start.py --mode network)\n")

    config = test_get_config()
    if config:
        test_update_config()
        test_review_sessions()
