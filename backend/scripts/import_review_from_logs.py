"""
从日志文件中提取历史面试记录，导入到 review 数据库
用法：python -m scripts.import_review_from_logs
"""
import os
import re
import sys
import time
from pathlib import Path
from typing import List, Dict, Any
from datetime import datetime

# Add backend to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from services.storage import review
from core.logger import get_logger

logger = get_logger(__name__)


def parse_log_file(log_path: str) -> List[Dict[str, Any]]:
    """
    解析日志文件，提取面试会话
    返回会话列表，每个会话包含 turns
    """
    sessions = []
    current_session = None
    current_turns = []
    current_qa = {}

    with open(log_path, 'r', encoding='utf-8', errors='ignore') as f:
        for line in f:
            # 检测会话开始：INTERVIEW_START
            if 'INTERVIEW_START' in line:
                # 如果有正在记录的 session，先保存
                if current_session and current_turns:
                    current_session['turns'] = current_turns
                    sessions.append(current_session)

                # 提取时间戳
                ts_match = re.search(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
                if ts_match:
                    dt = datetime.strptime(ts_match.group(1), '%Y-%m-%d %H:%M:%S')
                    started_at = dt.timestamp()
                else:
                    started_at = time.time()

                current_session = {
                    'started_at': started_at,
                    'ended_at': None,
                    'source': 'log_import',
                }
                current_turns = []
                current_qa = {}

            # 检测会话结束：INTERVIEW_STOP
            elif current_session and 'INTERVIEW_STOP' in line:
                # 保存当前 QA（如果有）
                if current_qa.get('question'):
                    current_turns.append(current_qa)
                    current_qa = {}

                ts_match = re.search(r'(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})', line)
                if ts_match:
                    dt = datetime.strptime(ts_match.group(1), '%Y-%m-%d %H:%M:%S')
                    current_session['ended_at'] = dt.timestamp()

            # 提取 ASR_QUESTION：面试官提的问题
            elif current_session and 'ASR_QUESTION' in line and 'text=' in line:
                # 保存上一个 QA
                if current_qa.get('question'):
                    current_turns.append(current_qa)

                # 提取问题文本
                text_match = re.search(r"text='([^']*)'", line)
                if text_match:
                    question_text = text_match.group(1)
                    # 去掉连续追问的前缀
                    if '以下内容来自同一轮实时面试' in question_text:
                        # 提取最关键的部分
                        parts = question_text.split('连续追问：')
                        if len(parts) > 1:
                            # 取连续追问的最后一条
                            追问s = parts[1].strip().split('\n')
                            if 追问s:
                                question_text = 追问s[-1].split('. ', 1)[-1] if '. ' in 追问s[-1] else 追问s[-1]
                        else:
                            # 取主问题
                            main_q = question_text.split('主问题：')
                            if len(main_q) > 1:
                                question_text = main_q[1].split('\n')[0]

                    current_qa = {
                        'question': question_text[:500],
                        'answer': '',
                        'candidate_answer': '',
                    }

            # 提取 ANSWER_DONE：LLM 给出的参考答案（answer_len）
            elif current_session and current_qa and 'ANSWER_DONE' in line and 'answer_len=' in line:
                # 这里只能记录答案存在，实际文本在流式输出中，这里只标记有答案
                current_qa['answer'] = '(系统参考答案)'

    # 保存最后一个 session
    if current_session:
        if current_qa.get('question'):
            current_turns.append(current_qa)
        if current_turns:
            current_session['turns'] = current_turns
            sessions.append(current_session)

    return sessions


def import_sessions_to_db(sessions: List[Dict[str, Any]]) -> int:
    """
    导入会话到数据库
    返回成功导入的会话数
    """
    imported_count = 0

    for sess in sessions:
        turns = sess.get('turns', [])
        if not turns:
            continue

        try:
            # 创建 session
            session_id = review.create_session(
                started_at=sess['started_at'],
                interviewer_enabled=True,
                candidate_enabled=True,
            )

            # 添加 turns
            for idx, turn in enumerate(turns, start=1):
                review.add_turn(
                    session_id=session_id,
                    qa_id=f"log_import_{session_id}_{idx}",
                    seq=idx,
                    question_text=turn.get('question', ''),
                    candidate_answer_text=turn.get('candidate_answer', ''),
                    reference_answer_text=turn.get('answer', ''),
                    duration_ms=0,
                    is_partial=False,
                    analysis_status='pending',
                )

            # 结束 session
            ended_at = sess.get('ended_at') or (sess['started_at'] + len(turns) * 300)
            review.end_session(session_id=session_id, ended_at=ended_at)

            imported_count += 1
            logger.info(f"Imported session {session_id} with {len(turns)} turns")

        except Exception as e:
            logger.error(f"Failed to import session: {e}")

    return imported_count


def main():
    """主函数"""
    backend_dir = Path(__file__).parent.parent
    log_dir = backend_dir.parent / 'log'

    if not log_dir.exists():
        print(f"日志目录不存在: {log_dir}")
        return

    print(f"正在扫描日志目录: {log_dir}")

    all_sessions = []
    # 只处理 interview.log 开头的日志文件
    log_files = sorted(log_dir.glob('interview.log*'))

    for log_file in log_files:
        print(f"解析: {log_file.name}")
        try:
            sessions = parse_log_file(str(log_file))
            all_sessions.extend(sessions)
            print(f"  发现 {len(sessions)} 个会话")
        except Exception as e:
            print(f"  解析失败: {e}")

    print(f"\n总共发现 {len(all_sessions)} 个会话")

    if not all_sessions:
        print("没有可导入的会话")
        return

    # 过滤有效会话：至少有 2 个 turn（过滤掉只是测试的会话）
    valid_sessions = [s for s in all_sessions if len(s.get('turns', [])) >= 2]
    print(f"有效会话（至少 2 个问答）: {len(valid_sessions)}")

    if not valid_sessions:
        print("没有有效会话可导入")
        return

    # 导入到数据库
    print("\n开始导入到数据库...")
    imported = import_sessions_to_db(valid_sessions)
    print(f"[OK] 成功导入 {imported} 个会话")

    # 显示统计
    try:
        from services.storage import review
        total = len(review.get_sessions())
        print(f"\n数据库中现有 {total} 场面试记录")
    except Exception:
        print("\n导入完成")


if __name__ == '__main__':
    main()
