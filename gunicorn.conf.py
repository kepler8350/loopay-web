import os
workers = 1
threads = 4
timeout = 120
bind = "0.0.0.0:" + os.environ.get("PORT", "8080")

def post_fork(server, worker):
    """gunicorn worker 시작 후 APScheduler 실행"""
    try:
        from apscheduler.schedulers.background import BackgroundScheduler
        import atexit, datetime

        def _job():
            try:
                # 현재 앱 컨텍스트에서 스케줄러 실행
                import sys
                sys.path.insert(0, '/app')
                # DB 직접 import
                from db import get_db
                from app import _auto_confirm_paid_matches, app as flask_app, get_now

                # 중복 방지
                _now_key = get_now().strftime('%Y%m%d%H%M')
                with flask_app.app_context():
                    db = get_db()
                    try:
                        row = db.execute("SELECT value FROM system_settings WHERE key='last_scheduler_run'").fetchone()
                        if row and row['value'] == _now_key:
                            return
                        db.execute("INSERT OR REPLACE INTO system_settings(key,value) VALUES('last_scheduler_run',?)", (_now_key,))
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

        sched = BackgroundScheduler(timezone='Asia/Seoul',
                                    job_defaults={'misfire_grace_time':30,'coalesce':True,'max_instances':1})
        sched.add_job(_job, 'cron', minute='*', id='auto_process', replace_existing=True)
        sched.start()
        atexit.register(lambda: sched.shutdown(wait=False))
    except Exception:
        pass
