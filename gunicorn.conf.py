import os
workers = 1
threads = 4
timeout = 120
bind = "0.0.0.0:" + os.environ.get("PORT", "8080")
# APScheduler는 app.py 모듈 레벨에서 _start_scheduler()로 시작 (10초 간격)
