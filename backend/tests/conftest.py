"""pytest 全局夹具。

必须在任何测试 import main/core 之前执行：把日志目录指到系统临时目录，
避免测试进程（import main 会触发 setup_logging）把转录/答案/错误日志
写进项目根目录 log/ 污染生产日志。
"""

import os
import tempfile

_TEST_LOG_DIR = os.path.join(tempfile.gettempdir(), "ia-test-logs")

import core.logger as _logger  # noqa: E402

_logger.LOG_DIR = _TEST_LOG_DIR
