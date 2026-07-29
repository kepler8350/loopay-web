import os
workers = 1
threads = 4
timeout = 120
bind = "0.0.0.0:" + os.environ.get("PORT", "8080")

def post_fork(server, worker):
    """gunicorn worker 시작 후 APScheduler 실행"""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        import atexit

        def _job():
            try:
                import sys
                sys.path.insert(0, '/app')
                from app import _auto_confirm_paid_matches, app as flask_app, get_now

                with flask_app.app_context():
                    from app import get_db
                    now = get_now()
                    # 14:00~14:00:59 구간에만 미입금 처리 (초 단위로 정확히)
                    # 매 10초 실행이므로 14:00:00~14:00:59 사이에 반드시 실행됨
                    _now_key = now.strftime('%Y%m%d%H%M')  # 분 단위 중복 방지
                    db = get_db()
                    try:
                        row = db.execute(
                            "SELECT value FROM system_settings WHERE key='last_scheduler_run'"
                        ).fetchone()
                        if row and row['value'] == _now_key:
                            db.close()
                            return
                        db.execute(
                            "INSERT OR REPLACE INTO system_settings(key,value) VALUES('last_scheduler_run',?)",
                            (_now_key,)
                        )
                        db.commit()
                        _auto_confirm_paid_matches(db)
                        db.commit()
                    except Exception:
                        try: db.rollback()
                        except: pass
                    finally:
                        try: db.close()
                        except: pass
            except Exception:
                pass

        sched = BackgroundScheduler(
            timezone='Asia/Seoul',
            job_defaults={'misfire_grace_time': 5, 'coalesce': True, 'max_instances': 1}
        )
        # 매 10초마다 실행 → 14:00:00~14:00:09 사이에 반드시 처리됨
        sched.add_job(_job, 'interval', seconds=10, id='auto_process', replace_existing=True)
        sched.start()
        atexit.register(lambda: sched.shutdown(wait=False))
    except Exception:
        pass
