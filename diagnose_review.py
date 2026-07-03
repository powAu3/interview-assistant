#!/usr/bin/env python3
"""快速诊断面试复盘 API"""
import sys
import os

# 添加 backend 到路径
sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

def test_config_update():
    """测试配置更新逻辑"""
    print("=== 测试配置更新 ===\n")

    from api.common.router import ConfigUpdate
    from core.config import get_config, update_config

    # 1. 当前配置
    cfg = get_config()
    print(f"当前 review_enabled: {cfg.review_enabled}")
    print(f"当前 review_model_index: {cfg.review_model_index}")

    # 2. 测试 ConfigUpdate 模型
    print("\n--- 测试 ConfigUpdate 模型 ---")
    update_data = ConfigUpdate(review_enabled=True, review_model_index=1)
    print(f"✓ ConfigUpdate 创建成功")
    print(f"  review_enabled: {update_data.review_enabled}")
    print(f"  review_model_index: {update_data.review_model_index}")

    # 3. 测试序列化
    data_dict = update_data.model_dump(exclude_none=True)
    print(f"\n✓ 序列化: {data_dict}")

    # 4. 测试更新配置
    print("\n--- 测试更新配置 ---")
    try:
        update_config(review_enabled=True, review_model_index=2)
        print("✓ 更新配置成功")

        cfg_after = get_config()
        print(f"更新后 review_enabled: {cfg_after.review_enabled}")
        print(f"更新后 review_model_index: {cfg_after.review_model_index}")

        # 恢复原状态
        update_config(review_enabled=False, review_model_index=0)
        print("\n✓ 已恢复原配置")

    except Exception as e:
        print(f"✗ 更新配置失败: {e}")
        import traceback
        traceback.print_exc()
        return False

    return True

def test_api_payload():
    """测试 API payload"""
    print("\n=== 测试 API Payload ===\n")

    from api.common.config_payload import build_config_payload
    from core.config import get_config

    cfg = get_config()
    payload = build_config_payload(cfg)

    print(f"review_enabled 在 payload 中: {'review_enabled' in payload}")
    print(f"review_model_index 在 payload 中: {'review_model_index' in payload}")

    if 'review_enabled' in payload:
        print(f"✓ review_enabled: {payload['review_enabled']}")
    else:
        print("✗ review_enabled 缺失!")

    if 'review_model_index' in payload:
        print(f"✓ review_model_index: {payload['review_model_index']}")
    else:
        print("✗ review_model_index 缺失!")

    return 'review_enabled' in payload and 'review_model_index' in payload

if __name__ == "__main__":
    print("面试复盘 API 诊断\n" + "="*50 + "\n")

    success = True
    success = test_config_update() and success
    success = test_api_payload() and success

    print("\n" + "="*50)
    if success:
        print("✓ 所有测试通过")
        print("\n请确保后端服务已重启以加载新的 API 定义！")
        sys.exit(0)
    else:
        print("✗ 部分测试失败")
        sys.exit(1)
