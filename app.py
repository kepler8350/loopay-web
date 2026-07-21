from flask import Flask, request, jsonify, make_response, g, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity

def check_admin_auth():
    """admin-loopay-2026 헤더 또는 JWT admin 토큰 허용"""
    auth = request.headers.get('Authorization','')
    if auth == 'Bearer admin-loopay-2026':
        return True
    # JWT 토큰으로도 체크
    try:
        from flask_jwt_extended import decode_token
        token = auth.replace('Bearer ','')
        data = decode_token(token)
        identity = data.get('sub','')
        return identity.startswith('admin:')
    except:
        return False
from werkzeug.security import check_password_hash, generate_password_hash
import datetime, sqlite3, os, threading

# ── 테스트용 시간 조작 ──────────────────────────────────

def _get_mock_time_from_db():
    """DB의 system_settings에서 mock_time 읽기 + 경과 시간 반영 (시간이 흐르도록)"""
    db = None
    try:
        db = get_db()
        row = db.execute("SELECT value FROM system_settings WHERE key='mock_time'").fetchone()
        set_at_row = db.execute("SELECT value FROM system_settings WHERE key='mock_time_set_at'").fetchone()
        if row and row['value']:
            mock_start = datetime.datetime.strptime(row['value'], '%Y-%m-%d %H:%M:%S')
            if set_at_row and set_at_row['value']:
                # 설정 당시 실제 시각
                set_at = datetime.datetime.strptime(set_at_row['value'], '%Y-%m-%d %H:%M:%S')
                # 현재 실제 시각 (KST)
                real_now = datetime.datetime.utcnow() + datetime.timedelta(hours=9)
                # 경과 시간만큼 mock 시간도 진행
                elapsed = real_now - set_at
                return mock_start + elapsed
            return mock_start
    except Exception:
        pass
    finally:
        if db:
            try: db.close()
            except: pass
    return None

def _set_mock_time_to_db(dt):
    """DB의 system_settings에 mock_time 저장 (None이면 삭제), 설정 당시 실제 시각도 저장"""
    try:
        db = get_db()
        if dt:
            val = dt.strftime('%Y-%m-%d %H:%M:%S')
            # 설정 당시 실제 KST 시각 기록
            real_now = (datetime.datetime.utcnow() + datetime.timedelta(hours=9)).strftime('%Y-%m-%d %H:%M:%S')
            db.execute("INSERT OR REPLACE INTO system_settings(key,value) VALUES('mock_time',?)", (val,))
            db.execute("INSERT OR REPLACE INTO system_settings(key,value) VALUES('mock_time_set_at',?)", (real_now,))
        else:
            db.execute("DELETE FROM system_settings WHERE key='mock_time'")
            db.execute("DELETE FROM system_settings WHERE key='mock_time_set_at'")
        db.commit()
        db.close()
    except Exception:
        pass


def _do_confirm_transfer(db, m):
    """매칭 확인 완료 후 아이템 이전 처리 (판매자→sold, 구매자→새 아이템)"""
    try:
        # match status → confirmed
        db.execute(
            "UPDATE matches SET status='confirmed', confirmed_at=datetime('now','localtime') WHERE id=? AND status='paid'",
            (m['id'],)
        )
        _loopay_row = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        loopay_id = _loopay_row['id'] if _loopay_row else None
        # 중복 방지: buyer에게 이미 이 매치로 생성된 아이템이 있으면 스킵
        _today = get_today().isoformat()
        _existing = db.execute(
            """SELECT id FROM items WHERE user_id=? AND bar_type=? AND purchase_date=?
               AND stage=? AND status IN ('reservable','active','waiting')""",
            (m['buyer_id'], m['bar_type'], _today, (m['stage'] or 1)+1)
        ).fetchone()
        if _existing:
            return  # 이미 아이템이 있으면 중복 생성 방지
        seller_item = None
        if dict(m).get('seller_item_id'):
            seller_item = db.execute(
                "SELECT id, bar_type, stage FROM items WHERE id=? AND status IN ('matched','reservable','sold')",
                (m['seller_item_id'],)
            ).fetchone()
        if not seller_item:
            # match.reservation_id → reservation.item_id 경로 (정확한 매핑)
            if dict(m).get('reservation_id'):
                seller_res = db.execute(
                    "SELECT item_id FROM reservations WHERE id=? AND item_id IS NOT NULL",
                    (m['reservation_id'],)
                ).fetchone()
                if seller_res and seller_res['item_id']:
                    seller_item = db.execute(
                        "SELECT id, bar_type, stage FROM items WHERE id=?",
                        (seller_res['item_id'],)
                    ).fetchone()
        if not seller_item:
            _loopay_check = db.execute(
                "SELECT id FROM users WHERE username='loopay' AND approved=1 AND id=? ORDER BY id ASC", (m['seller_id'],)
            ).fetchone()
            if _loopay_check and dict(m).get('seller_item_id'):
                # seller_item_id로 정확히 조회 (ORDER BY LIMIT 1 방식 제거 - 다른 매치 아이템 오선택 방지)
                seller_item = db.execute(
                    "SELECT id, bar_type, stage FROM items WHERE id=?",
                    (m['seller_item_id'],)
                ).fetchone()
        if seller_item:
            db.execute("UPDATE items SET status='sold' WHERE id=?", (seller_item['id'],))
            _stage = int(seller_item['stage'] or m['stage'] or 1) + 1
            _buyer_is_loopay = (m['buyer_id'] == loopay_id)
            _today = get_today().isoformat()
            if _buyer_is_loopay:
                _lr = db.execute(
                    "SELECT item_id FROM reservations WHERE id=?", (m['reservation_id'],)
                ).fetchone()
                if _lr and _lr['item_id']:
                    db.execute(
                        "UPDATE items SET stage=?, status='reservable', purchase_date=? WHERE id=? AND user_id=?",
                        (_stage, _today, _lr['item_id'], loopay_id)
                    )
            else:
                _inserted = False
                for _item_status in ('reservable', 'active', 'waiting'):
                    try:
                        db.execute(
                            "INSERT INTO items(user_id, bar_type, stage, purchase_date, status) VALUES(?,?,?,?,?)",
                            (m['buyer_id'], seller_item['bar_type'], _stage, _today, _item_status)
                        )
                        _inserted = True
                        break
                    except Exception:
                        continue
                if not _inserted:
                    db.execute(
                        "INSERT INTO items(user_id, bar_type, stage, purchase_date) VALUES(?,?,?,?)",
                        (m['buyer_id'], seller_item['bar_type'], _stage, _today)
                    )
        # 행운구매 처리: lucky_pair_id가 있는 매치인 경우
        _lucky_pair_id = dict(m).get('lucky_pair_id')
        if _lucky_pair_id:
            _lbr = db.execute(
                """SELECT * FROM lucky_buy_results WHERE id=? AND status='confirmed'""",
                (_lucky_pair_id,)
            ).fetchone()
            if _lbr and not _lbr['new_item_id']:
                # 행운구매 쌍의 모든 매치가 입금확인 됐는지 체크
                _pair_matches = db.execute(
                    """SELECT m2.status FROM matches m2 WHERE m2.lucky_pair_id=?""",
                    (_lucky_pair_id,)
                ).fetchall()
                _all_confirmed = all(pm['status'] == 'confirmed' for pm in _pair_matches)
                if _all_confirmed:
                    # 두 아이템으로 새 아이템 생성
                    _new_stage = _lbr['new_stage']
                    _new_buyer_id = m['buyer_id']
                    _new_item = db.execute(
                        "INSERT INTO items(user_id, bar_type, stage, status, purchase_date) VALUES(?,?,?,'reservable',?)",
                        (_new_buyer_id, _lbr['bar_type'], _new_stage, get_today().isoformat())
                    ).lastrowid
                    # lucky_buy_results에 new_item_id, buyer_id, status 업데이트
                    db.execute(
                        "UPDATE lucky_buy_results SET new_item_id=?, buyer_id=?, status='completed' WHERE id=?",
                        (_new_item, _new_buyer_id, _lucky_pair_id)
                    )
                    # 기존 두 판매자 아이템 sold 처리
                    db.execute("UPDATE items SET status='sold' WHERE id=? OR id=?",
                               (_lbr['item_a_id'], _lbr['item_b_id']))

                    # 두 판매예약도 matched 처리
                    db.execute(
                        """UPDATE reservations SET status='matched' WHERE lucky_pair_id=? AND status='pending'""",
                        (_lucky_pair_id,)
                    )

    except Exception as _te:
        pass  # 아이템 이전 실패해도 status 변경은 유지

def get_now():
    """현재 시간 반환 - 매번 DB에서 읽어 멀티워커 동기화 (KST 기준)"""
    mt = _get_mock_time_from_db()
    if mt:
        return mt
    # Railway 서버는 UTC이므로 KST(+9)로 변환
    # UTC+9 (KST) 변환
    return datetime.datetime.utcnow() + datetime.timedelta(hours=9)


def insert_notification(db, user_id, ntype, title, message):
    """알림 삽입 - 시스템 설정 시간(mock_time) 사용"""
    now_str = get_now().strftime('%Y-%m-%d %H:%M:%S')
    db.execute(
        "INSERT INTO notifications(user_id,type,title,message,created_at) VALUES(?,?,?,?,?)",
        (user_id, ntype, title, message, now_str)
    )


# ── 자동 2차매칭 스케줄러 ────────────────────────────────────────

def _auto_confirm_paid_matches(db):
    """14:00(1차)/20:00(2차) 이후 paid 상태 매치를 자동 입금확인 처리
    + 14:00 이후 미송금(pending) 매치 자동 미입금 처리"""
    import datetime as _dt
    now = get_now()
    h, mn = now.hour, now.minute
    total_min = h * 60 + mn

    # 매칭 기준 날짜: 가장 최근 매칭이 있는 날짜
    _latest = db.execute(
        """SELECT MAX(match_date) as d FROM matches
           WHERE match_round=1 AND status IN ('pending','paid','confirmed','failed')"""    ).fetchone()
    match_ref_date = _latest['d'] if _latest and _latest['d'] else get_matching_date().isoformat()

    targets_confirm = []
    targets_unpaid = []

    if total_min >= 840:  # 14:00 이후
        # paid → 자동 입금확인
        rows = db.execute(
            """SELECT m.* FROM matches m
               WHERE m.status='paid' AND m.match_round=1
               AND m.match_date=?""",
            (match_ref_date,)
        ).fetchall()
        targets_confirm.extend([dict(r) for r in rows])

        # pending → 자동 미입금 처리 (구매자가 14:00까지 송금 안 함)
        unpaid_rows = db.execute(
            """SELECT m.* FROM matches m
               WHERE m.status='pending' AND m.match_round=1
               AND m.match_date=?""",
            (match_ref_date,)
        ).fetchall()
        targets_unpaid.extend([dict(r) for r in unpaid_rows])

    if total_min >= 1200:  # 20:00 이후
        # 2차 paid → 자동 입금확인
        rows2 = db.execute(
            """SELECT m.* FROM matches m
               WHERE m.status='paid' AND m.match_round=2
               AND m.match_date=?""",
            (match_ref_date,)
        ).fetchall()
        targets_confirm.extend([dict(r) for r in rows2])

        # 2차 pending → 자동 미입금
        unpaid_rows2 = db.execute(
            """SELECT m.* FROM matches m
               WHERE m.status='pending' AND m.match_round=2
               AND m.match_date=?""",
            (match_ref_date,)
        ).fetchall()
        targets_unpaid.extend([dict(r) for r in unpaid_rows2])

        # 2차 미입금 판매아이템 → loopay 즉시 구매 (20:00 이후 자동)
        # 케이스1: match_round=2 AND status='failed' 매치의 seller_item_id
        # 케이스2: 2차 sell 예약 pending/unmatched (매칭 자체 안 됨)
        _loopay_row2 = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if _loopay_row2:
            _loopay_id2 = _loopay_row2['id']
            # 케이스1: 2차 매치 failed → seller_item_id
            _unmatched_sells = db.execute(
                """SELECT DISTINCT m.seller_item_id as item_id,
                          i.bar_type as i_bar_type, i.stage as i_stage,
                          i.user_id as seller_user_id,
                          m.match_date as reserve_date
                   FROM matches m
                   JOIN items i ON m.seller_item_id = i.id
                   WHERE m.match_round=2 AND m.status='failed'
                   AND m.seller_item_id IS NOT NULL AND m.seller_item_id > 0""",
                ()
            ).fetchall()
            # 케이스2: 2차 sell 예약 미매칭
            _unmatched_sells2 = db.execute(
                """SELECT r.item_id, i.bar_type as i_bar_type, i.stage as i_stage,
                          i.user_id as seller_user_id, r.reserve_date
                   FROM reservations r
                   JOIN items i ON r.item_id = i.id
                   WHERE r.match_round=2 AND r.status IN ('pending','unmatched')
                   AND r.confirmed=1 AND r.reserve_date=?
                   AND r.user_id != ?
                   AND NOT EXISTS (
                       SELECT 1 FROM matches m2
                       WHERE m2.seller_item_id=r.item_id AND m2.match_round=2
                       AND m2.status IN ('pending','paid','confirmed')
                   ) AND NOT EXISTS (
                       SELECT 1 FROM items i2
                       WHERE i2.user_id=? AND i2.bar_type=i.bar_type AND i2.stage=i.stage
                       AND i2.purchase_date>=r.reserve_date
                   )""",
                (match_ref_date, _loopay_id2, _loopay_id2)
            ).fetchall()
            # 두 케이스 합치기 (item_id 중복 제거)
            _seen_items = set()
            _all_sells = []
            for _s in list(_unmatched_sells) + list(_unmatched_sells2):
                _sid = dict(_s).get('item_id')
                if _sid and _sid not in _seen_items:
                    _seen_items.add(_sid)
                    _all_sells.append(dict(_s))

            for _sr in _all_sells:
                try:
                    _today_str3 = get_today().isoformat()
                    _sr_dict = dict(_sr)
                    _stage3 = _sr_dict.get('i_stage') or 1
                    _bar3 = _sr_dict.get('i_bar_type', 'bronze')
                    _item_id3 = _sr_dict.get('item_id')
                    _seller_uid3 = _sr_dict.get('seller_user_id')
                    if not _item_id3:
                        continue
                    # ── 중복 방지: loopay가 이 seller_item_id로 구매한 match(confirmed)가 있으면 skip
                    _already = db.execute(
                        """SELECT id FROM matches
                           WHERE buyer_id=? AND seller_item_id=? AND match_round=2
                           AND status IN ('confirmed','pending','paid')""",
                        (_loopay_id2, _item_id3)
                    ).fetchone()
                    if _already:
                        continue
                    # ── 판매자 아이템 sold 처리
                    db.execute("UPDATE items SET status='sold' WHERE id=?", (_item_id3,))
                    db.execute(
                        "UPDATE reservations SET status='matched' WHERE item_id=? AND status IN ('pending','unmatched')",
                        (_item_id3,)
                    )
                    # ── loopay 소유 신규 아이템 생성 (matched 상태 - 구매 탭 표시용)
                    db.execute(
                        """INSERT INTO items(user_id, bar_type, stage, status, purchase_date)
                           VALUES(?, ?, ?, 'matched', ?)""",
                        (_loopay_id2, _bar3, _stage3, _today_str3)
                    )
                    _new_item3 = db.execute("SELECT last_insert_rowid() as id").fetchone()['id']
                    # ── match 레코드 생성 (loopay가 구매자, 2차, confirmed)
                    _sell_res3 = db.execute(
                        "SELECT id FROM reservations WHERE item_id=? AND confirmed=1 LIMIT 1",
                        (_item_id3,)
                    ).fetchone()
                    _sell_res_id3 = _sell_res3['id'] if _sell_res3 else None
                    db.execute(
                        """INSERT INTO matches(reservation_id, buyer_id, seller_id,
                           seller_item_id, bar_type, stage, buy_price, sell_price,
                           match_round, match_date, status)
                           VALUES(?,?,?,?,?,?,0,0,2,?,'pending')""",
                        (_sell_res_id3, _loopay_id2, _seller_uid3,
                         _item_id3, _bar3, _stage3, _today_str3)
                    )
                    # ── loopay 구매예약 matched 처리
                    _lbr3 = db.execute(
                        """SELECT id FROM reservations WHERE user_id=? AND bar_type=?
                           AND match_round=2 AND status IN ('pending','unmatched')
                           AND (item_id IS NULL OR item_id=0) LIMIT 1""",
                        (_loopay_id2, _bar3)
                    ).fetchone()
                    if _lbr3:
                        db.execute(
                            "UPDATE reservations SET status='matched', item_id=? WHERE id=?",
                            (_new_item3, _lbr3['id'])
                        )
                    # ── 판매자 알림
                    try:
                        _bar_names3 = {'bronze':'수정','silver':'루비','gold':'다이아'}
                        insert_notification(db, _seller_uid3, 'loopay_purchase', 'loopay 구매',
                            f'2차 매칭 미입금으로 인해 {_bar_names3.get(_bar3,_bar3)} 아이템이 loopay 계정으로 구매 처리되었습니다.')
                    except Exception:
                        pass
                except Exception:
                    pass

    for m in targets_confirm:
        try:
            _do_confirm_transfer(db, m)
        except Exception as _e_confirm:
            import traceback; print(f'[auto_confirm_error] match={m.get("id")} {traceback.format_exc()[-200:]}')

    for m in targets_unpaid:
        try:
            _auto_process_unpaid(db, m)
        except Exception: pass


def _auto_process_unpaid(db, m):
    """pending 매치를 자동 미입금(failed) 처리 - 패널티 포함 거래정지"""
    match_id = m['id']
    match_round = m.get('match_round') or 1

    # 1. match → failed
    db.execute("UPDATE matches SET status='failed' WHERE id=?", (match_id,))

    # 2. 구매예약 유지 (match_status=failed로 표시되도록)
    _buy_res_ids = set()
    if m.get('reservation_id'): _buy_res_ids.add(m['reservation_id'])
    if m.get('buyer_res_id'): _buy_res_ids.add(m['buyer_res_id'])
    for _brid in _buy_res_ids:
        db.execute("UPDATE reservations SET status='matched' WHERE id=?", (_brid,))

    # 3. 판매 아이템 처리
    if m.get('seller_item_id'):
        db.execute("UPDATE items SET status='reservable' WHERE id=?", (m['seller_item_id'],))

        if match_round == 1:
            # 1차 미입금 → 2차 sell 예약 생성
            _exist = db.execute(
                "SELECT id FROM reservations WHERE item_id=? AND match_round=2 AND status='pending'",
                (m['seller_item_id'],)
            ).fetchone()
            if not _exist:
                _item = db.execute("SELECT * FROM items WHERE id=?", (m['seller_item_id'],)).fetchone()
                if _item:
                    db.execute(
                        """INSERT INTO reservations(user_id,item_id,bar_type,match_round,
                           reserve_date,status,confirmed)
                           VALUES(?,?,?,2,?,'pending',1)""",
                        (_item['user_id'], m['seller_item_id'],
                         _item['bar_type'], m['match_date'])
                    )
        else:
            # 2차 미입금 → loopay 즉시 구매 처리
            _loopay_row = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
            if _loopay_row:
                loopay_id = _loopay_row['id']
                _item = db.execute("SELECT * FROM items WHERE id=?", (m['seller_item_id'],)).fetchone()
                if _item:
                    _today_str2 = get_today().isoformat()
                    _stage = _item['stage'] or 1
                    _bar = _item['bar_type']
                    # 중복 방지: 이미 loopay buyer match가 있으면 skip
                    _dup_match = db.execute(
                        "SELECT id FROM matches WHERE buyer_id=? AND seller_item_id=? AND match_round=2 AND status IN ('confirmed','pending','paid')",
                        (loopay_id, m['seller_item_id'])
                    ).fetchone()
                    if not _dup_match:
                        # 1. 판매자 아이템 sold 처리
                        db.execute("UPDATE items SET status='sold' WHERE id=?", (m['seller_item_id'],))
                        # 2. loopay 소유 신규 아이템 생성 (matched 상태)
                        db.execute(
                            "INSERT INTO items(user_id, bar_type, stage, status, purchase_date) VALUES(?,?,?,'matched',?)",
                            (loopay_id, _bar, _stage, _today_str2)
                        )
                        _new_item_id = db.execute("SELECT last_insert_rowid() as id").fetchone()['id']
                        # 3. sell 예약 matched 처리
                        _sell_res = db.execute(
                            "SELECT id FROM reservations WHERE item_id=? AND confirmed=1 LIMIT 1",
                            (m['seller_item_id'],)
                        ).fetchone()
                        # 4. match 레코드 생성 (loopay buyer, confirmed)
                        db.execute(
                            "INSERT INTO matches(reservation_id, buyer_id, seller_id, seller_item_id, bar_type, stage, buy_price, sell_price, match_round, match_date, status) VALUES(?,?,?,?,?,?,0,0,2,?,'pending')",
                            (_sell_res['id'] if _sell_res else None, loopay_id,
                             _item['user_id'], m['seller_item_id'],
                             _bar, _stage, _today_str2)
                        )
                        # 5. loopay 구매예약 matched 처리
                        _lbr = db.execute(
                            "SELECT id FROM reservations WHERE user_id=? AND bar_type=? AND match_round=2 AND status IN ('pending','unmatched') AND (item_id IS NULL OR item_id=0) LIMIT 1",
                            (loopay_id, _bar)
                        ).fetchone()
                        if _lbr:
                            db.execute("UPDATE reservations SET status='matched', item_id=? WHERE id=?",
                                       (_new_item_id, _lbr['id']))
                        try:
                            _bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}
                            insert_notification(db, _item['user_id'], 'loopay_purchase', 'loopay 구매',
                                f'2차 매칭 미입금으로 인해 {_bar_names.get(_bar,_bar)} 아이템이 loopay 계정으로 구매 처리되었습니다.')
                        except Exception:
                            pass

    # 4. 구매자 패널티 처리 + 거래정지
    if m.get('buyer_id'):
        buyer_id = m['buyer_id']
        try:
            from datetime import timedelta
            buyer_row = db.execute("SELECT unpaid_count FROM users WHERE id=?", (buyer_id,)).fetchone()
            current_count = int((buyer_row['unpaid_count'] or 0) if buyer_row else 0) + 1
            penalty_entry = next((p for p in PENALTY_TABLE if p[0] == current_count), PENALTY_TABLE[-1])
            suspend_days = penalty_entry[1]
            release_pts  = penalty_entry[2]
            _now = get_now()
            _release_dt = _now + timedelta(days=suspend_days)
            _release_str = _release_dt.strftime('%Y-%m-%d %H:%M:%S')
            _now_str = _now.strftime('%Y-%m-%d %H:%M:%S')
            db.execute("UPDATE users SET unpaid_count=?, suspended_until=? WHERE id=?",
                       (current_count, _release_str, buyer_id))
            db.execute(
                """INSERT INTO penalties(user_id,unpaid_count,suspend_days,release_points,is_released,created_at,match_id,match_round)
                   VALUES(?,?,?,?,0,?,?,?)""",
                (buyer_id, current_count, suspend_days, release_pts, _now_str, match_id, match_round)
            )
            db.execute("UPDATE reservations SET status='unmatched' WHERE user_id=? AND match_round=2 AND status='pending'",
                       (buyer_id,))
            try:
                bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}
                insert_notification(db, buyer_id, 'unpaid_penalty', '미입금 패널티',
                    f'{bar_names.get(m.get("bar_type",""),m.get("bar_type",""))} 거래 미입금이 확정됐습니다. {suspend_days}일간 거래가 정지됩니다.')
            except Exception:
                pass
        except Exception as e:
            pass


def get_today():
    """오늘 날짜 반환"""
    return get_now().date()

def get_matching_date():
    """매칭 기준 날짜: 05:00 미만이면 전날 (20:00~다음날05:00 매칭 가능)"""
    now = get_now()
    if now.hour < 5:
        import datetime
        return (now - datetime.timedelta(days=1)).date()
    return now.date()
from db import get_db, init_db, LEVEL_CONFIG, LEVEL_COST, LEVEL_UP_FEE, SPLIT_CONFIG, BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES, PENALTY_TABLE, get_sv_count, get_gd_count


STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
def check_and_level_up(db, user_id):
    """누적횟수 기반 자동 레벨업 체크 + 알림 (기존 매칭 완료 시 자동 레벨업 - 유지)"""
    u = db.execute("SELECT id, level, cumulative_count FROM users WHERE id=?", (user_id,)).fetchone()
    if not u: return False
    cur_lv = u['level'] or 1
    cum = u['cumulative_count'] or 0
    if cur_lv >= 7: return False

    new_lv = cur_lv
    for lv in range(cur_lv + 1, 8):
        prev_cum = LEVEL_CONFIG.get(lv - 1, {}).get('cum') or 0
        if cum >= prev_cum:
            new_lv = lv
        else:
            break

    if new_lv > cur_lv:
        db.execute("UPDATE users SET level=? WHERE id=?", (new_lv, user_id))
        cost = LEVEL_COST.get(new_lv, 0)
        # 레벨 상승 알림 발송
        if cost > 0:
            msg = (
                f"🎉 {new_lv}레벨로 상승하였습니다!\n"
                f"\n{new_lv}레벨부터는 거래유지 포인트 결제가 필요합니다.\n"
                f"• 필요 포인트: {cost}P / 30일\n"
                f"\n내정보 > 레벨 포인트 결제 버튼을 눌러 결제하면\n"
                f"30일간 구매예약·판매예약이 활성화됩니다."
            )
        else:
            msg = f"🎉 {new_lv}레벨로 상승하였습니다!\n누적 예약횟수 {cum}회 달성!"
        try:
            insert_notification(db, user_id, 'level_up', f'{new_lv}레벨 달성!', msg)
        except Exception:
            pass
        return new_lv
    return False


def is_level_trade_active(db_or_uid, user_id=None):
    """레벨 거래 활성화 여부. db와 user_id 또는 user_id만 전달 가능."""
    import datetime as _dt_mod
    # 호출 패턴: is_level_trade_active(db, uid) 또는 is_level_trade_active(uid)
    if user_id is None:
        uid = db_or_uid
        _db = get_db()
        _close = True
    else:
        uid = user_id
        _db = db_or_uid
        _close = False
    try:
        u = _db.execute("SELECT level, level_paid_at FROM users WHERE id=?", (uid,)).fetchone()
        if not u: return False
        lv = u['level'] or 1
        if lv < 3: return True
        cost = LEVEL_COST.get(lv, 0)
        if cost == 0: return True
        paid_at = u['level_paid_at']
        if not paid_at: return False
        try:
            paid_date = _dt_mod.date.fromisoformat(str(paid_at)[:10])
            days_passed = (get_today() - paid_date).days
            return days_passed < 30
        except Exception:
            return False
    finally:
        if _close:
            try: _db.close()
            except: pass


def _settle_match_points(db, cnt_map):
    """매칭 후 포인트 정산: maintain_points에서 매칭수량×40P 차감
    - 환불 시 원천별 반환: exchange에서 가져온 금액→exchange, charge에서 가져온 금액→charge
    - 매칭 차감 시: exchange 우선 차감 후 charge
    """
    for bid, bcnt in cnt_map.items():
        u = db.execute("""SELECT maintain_points, charge_points, exchange_points,
                          COALESCE(maintain_from_exchange,0) as mfe,
                          COALESCE(maintain_from_charge,0) as mfc
                          FROM users WHERE id=?""", (bid,)).fetchone()
        if not u: continue
        mn = int(u['maintain_points'] or 0)
        mfe = int(u['mfe'] or 0)   # maintain 중 exchange 원천분
        mfc = int(u['mfc'] or 0)   # maintain 중 charge 원천분
        consume = bcnt * 40         # 매칭 차감액

        if mn >= consume:
            # 환불액 = mn - consume → 원천 비율로 반환
            refund = mn - consume
            # 소비 비율: exchange 우선 차감
            consume_from_ex = min(mfe, consume)
            consume_from_ch = consume - consume_from_ex
            refund_to_ex = mfe - consume_from_ex   # exchange에서 남은 환불분
            refund_to_ch = mfc - consume_from_ch   # charge에서 남은 환불분
            # 음수 방지
            refund_to_ex = max(0, refund_to_ex)
            refund_to_ch = max(0, refund_to_ch)
            db.execute("""UPDATE users SET
                maintain_points=0, maintain_from_exchange=0, maintain_from_charge=0,
                exchange_points=exchange_points+?,
                charge_points=charge_points+?
                WHERE id=?""", (refund_to_ex, refund_to_ch, bid))
        elif mn > 0:
            # maintain 부족 → 전액 소비 + 부족분 추가 차감 (exchange 우선)
            extra = consume - mn
            ex_now = int(u['exchange_points'] or 0)
            ex_use = min(ex_now, extra)
            ch_use = extra - ex_use
            db.execute("""UPDATE users SET
                maintain_points=0, maintain_from_exchange=0, maintain_from_charge=0,
                exchange_points=exchange_points-?,
                charge_points=charge_points-?
                WHERE id=?""", (ex_use, ch_use, bid))
        else:
            # maintain 없음 → exchange 우선 차감
            ex_now = int(u['exchange_points'] or 0)
            ex_use = min(ex_now, consume)
            ch_use = consume - ex_use
            db.execute("""UPDATE users SET
                exchange_points=exchange_points-?,
                charge_points=charge_points-?
                WHERE id=?""", (ex_use, ch_use, bid))


@app.route('/api/user/auto-confirm-paid', methods=['POST'])
@jwt_required()
def user_auto_confirm_paid():
    """14:00(1차)/20:00(2차) 이후 paid 매치 자동 입금확인 트리거"""
    db = get_db()
    try:
        _auto_confirm_paid_matches(db)
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/scheduler/auto-process', methods=['POST', 'GET'])
def scheduler_auto_process():
    """인증 없는 자동 처리 스케줄러 - Railway Cron 또는 외부 호출용
    헤더: X-Scheduler-Key: loopay-scheduler-2026"""
    key = request.headers.get('X-Scheduler-Key', '')
    if key != 'loopay-scheduler-2026':
        return jsonify(error='unauthorized'), 403
    db = get_db()
    try:
        _auto_confirm_paid_matches(db)
        db.commit()
        return jsonify(success=True, time=get_now().isoformat())
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/user/match-ts', methods=['GET'])
def get_match_ts():
    """마지막 매칭 실행 시각 반환 (인증 불필요 - 초경량)"""
    db = get_db()
    try:
        row = db.execute("SELECT value FROM system_settings WHERE key='last_match_ts'").fetchone()
        return jsonify(ts=int(row['value']) if row else 0)
    finally:
        db.close()


def get_price(bar_type, stage):
    conn = get_db()
    try:
        row = conn.execute('SELECT buy_price, sell_price FROM prices WHERE bar_type=? AND stage=?', (bar_type, stage)).fetchone()
        if row:
            return row['buy_price'], row['sell_price']
        return 0, 0
    except Exception:
        return 0, 0
    finally:
        conn.close()
def days_since(purchase_date):
    if not purchase_date:
        return 0
    try:
        s = str(purchase_date)[:10]  # YYYY-MM-DD 부분만
        dt = datetime.datetime.strptime(s, '%Y-%m-%d')
        return (datetime.datetime.combine(get_today(), datetime.time()) - dt).days  # 6/3구매→6/4현재=1일째
    except Exception:
        return 0

def item_status_label(status, purchase_date):
    from datetime import date
    import datetime as _dt
    today_date = get_today()
    days = 0
    if purchase_date:
        try:
            p = _dt.date.fromisoformat(str(purchase_date))
            days = (today_date - p).days
        except Exception:
            days = 0
    status_map = {
        'active': '판매가능' if days >= 2 else '보유중',      # active도 3일째부터 판매가능
        'reservable': '판매가능' if days >= 2 else '보유중',
        'waiting': '판매가능',  # 결합아이템: 당일부터 판매가능
        'sold': '판매완료',
        'pending': '매칭중',
        'matched': '매칭완료',
        'combined': '합성완료'
    }
    return status_map.get(status, status or '보유중')


app.config['JWT_SECRET_KEY'] = os.environ.get('JWT_SECRET_KEY', 'loopay-secret-key-2026')
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = datetime.timedelta(hours=24)
CORS(app, origins='*')
jwt = JWTManager(app)


def _check_level_demotion(db, uid):
    """구매예약 후 연속일 체크 및 레벨 강등/회복/변경 처리"""
    import datetime as _dt
    u = db.execute(
        """SELECT level, original_level, consecutive_reserve_days,
                  last_reserve_date, level_demoted_at, level_changed_at,
                  level_change_streak_start
           FROM users WHERE id=?""", (uid,)
    ).fetchone()
    if not u: return

    today = get_today()  # date
    today_str = today.isoformat()
    level = u['level'] or 1
    original_level = u['original_level']  # None이면 아직 강등 없음
    consecutive = u['consecutive_reserve_days'] or 0
    last_date_str = u['last_reserve_date']
    streak_start_str = u['level_change_streak_start']

    # 오늘 이미 체크했으면 스킵
    if last_date_str == today_str:
        return

    # 연속일 계산
    if last_date_str:
        last_date = _dt.date.fromisoformat(last_date_str)
        diff = (today - last_date).days
        if diff == 1:
            consecutive += 1  # 어제 예약 → 연속
        elif diff == 0:
            return  # 오늘 이미 처리됨
        else:
            consecutive = 1  # 중간에 끊김 → 1로 리셋 (오늘부터 새로 카운트)
    else:
        consecutive = 1  # 최초 예약

    db.execute(
        "UPDATE users SET consecutive_reserve_days=?, last_reserve_date=? WHERE id=?",
        (consecutive, today_str, uid)
    )

    # ── 강등 체크 (원래 레벨 유지 중인 사용자) ──
    # original_level이 없다 = 아직 강등된 적 없는 정상 상태
    # 강등은 예약을 '하지 않은' 날에 발생 → 스케줄러에서 처리
    # 여기서는 회복/변경 로직만 처리

    # ── 레벨 회복 체크 (강등된 사용자, 4일 연속 시 한 레벨 올림) ──
    if original_level and level < original_level and consecutive >= 4:
        new_level = level + 1
        # streak 리셋 (다음 4일 연속으로 또 한 단계)
        db.execute(
            """UPDATE users SET level=?, consecutive_reserve_days=0,
               level_change_streak_start=? WHERE id=?""",
            (new_level, today_str, uid)
        )
        try:
            insert_notification(db, uid, 'level_recover', '레벨 회복',
                f'4일 연속 구매예약으로 {new_level}레벨로 회복되었습니다.')
        except Exception: pass
        return

    # ── 레벨 변경 가능 조건 달성 체크 (4일 연속) ──
    # original_level 없음(정상) 또는 original_level과 현재 level이 같음(회복 완료)
    # → 4일 연속이면 레벨 변경 가능 상태로 표시
    current_original = original_level or level
    if level >= current_original and consecutive >= 4:
        # level_change_streak_start 설정 (이미 설정됐으면 유지)
        if not streak_start_str:
            db.execute(
                "UPDATE users SET level_change_streak_start=? WHERE id=?",
                (today_str, uid)
            )


def _check_daily_demotion(db):
    """매일 실행: 어제 구매예약 없는 사용자 → 1레벨 강등"""
    import datetime as _dt
    yesterday = (get_today() - _dt.timedelta(days=1)).isoformat()
    today_str = get_today().isoformat()

    # 어제 구매예약이 있었는지 확인 (어제 매칭이 있었던 날만 체크)
    had_matching = db.execute(
        "SELECT COUNT(*) as c FROM matches WHERE match_date=?", (yesterday,)
    ).fetchone()
    if not had_matching or had_matching['c'] == 0:
        return  # 어제 매칭 자체가 없었으면 체크 안 함

    # 승인된 일반 사용자 중 어제 구매예약 안 한 사람
    # (loopay 제외, 이미 1레벨인 사람 제외)
    all_users = db.execute(
        """SELECT u.id, u.level, u.original_level
           FROM users u
           WHERE u.approved=1 AND u.username != 'loopay' AND u.level > 1"""
    ).fetchall()

    for u in all_users:
        uid = u['id']
        # 어제 구매예약 여부
        reserved_yesterday = db.execute(
            """SELECT COUNT(*) as c FROM reservations
               WHERE user_id=? AND reserve_date=? AND match_round=1
               AND (item_id IS NULL OR item_id=0)""",
            (uid, yesterday)
        ).fetchone()
        did_reserve = reserved_yesterday and reserved_yesterday['c'] > 0
        if not did_reserve:
            # 강등
            orig = u['original_level'] or u['level']
            db.execute(
                """UPDATE users SET level=1,
                   original_level=?, level_demoted_at=?,
                   consecutive_reserve_days=0, level_change_streak_start=NULL
                   WHERE id=?""",
                (orig, today_str, uid)
            )
            try:
                insert_notification(db, uid, 'level_demote', '레벨 강등',
                    f'어제 구매예약이 없어 1레벨로 강등되었습니다. 4일 연속 구매예약으로 원래 레벨까지 회복할 수 있습니다.')
            except Exception: pass
    db.commit()


@app.route('/')
def index():
    from flask import make_response, Response
    import os
    path = os.path.join(STATIC_DIR, 'index.html')
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # 환경 배너 주입
    _env = os.environ.get('ENVIRONMENT', 'production').lower()
    if _env == 'staging':
        _banner = (
            '<div id="env-banner" style="position:fixed;top:0;left:0;right:0;z-index:99999;'
            'background:#e65100;color:#fff;text-align:center;padding:6px 12px;font-size:13px;'
            'font-weight:700;letter-spacing:1px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">'
            '🧪 테스트 서버 — 이 서버의 데이터는 운영에 반영되지 않습니다'
            '</div>'
            '<style>body,#app{padding-top:36px!important}</style>'
        )
        content = content.replace('<body>', '<body>' + _banner, 1)
    resp = make_response(Response(content, mimetype='text/html'))
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/static/<path:filename>')
def static_files(filename):
    from flask import make_response
    resp = make_response(send_from_directory(STATIC_DIR, filename))
    # JS 파일은 버전 파라미터로 캐시 관리 - 장기 캐시 허용
    if filename.endswith('.js'):
        resp.headers['Cache-Control'] = 'public, max-age=31536000, immutable'
    return resp

@app.route('/admin')
def admin():
    from flask import make_response, Response
    import os
    path = os.path.join(STATIC_DIR, 'admin.html')
    with open(path, 'r', encoding='utf-8') as f:
        content = f.read()
    # 환경 배너 주입 (ENVIRONMENT=staging 이면 상단 배너 표시)
    _env = os.environ.get('ENVIRONMENT', 'production').lower()
    if _env == 'staging':
        _banner = (
            '<div id="env-banner" style="position:fixed;top:0;left:0;right:0;z-index:99999;'
            'background:#e65100;color:#fff;text-align:center;padding:6px 12px;font-size:13px;'
            'font-weight:700;letter-spacing:1px;box-shadow:0 2px 8px rgba(0,0,0,0.4)">'
            '🧪 테스트 서버 (STAGING) — 이 서버의 데이터는 운영에 반영되지 않습니다'
            '</div>'
            '<style>body{padding-top:36px!important}</style>'
        )
        content = content.replace('<body>', '<body>' + _banner, 1)
    resp = make_response(Response(content, mimetype='text/html'))
    resp.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    resp.headers['Pragma'] = 'no-cache'
    resp.headers['Expires'] = '0'
    return resp

@app.route('/admin-login', methods=['POST'])
def admin_login_form():
    """서버사이드 관리자 로그인 (form submit 방식)"""
    from flask import make_response, redirect, Response
    import os
    username = request.form.get('username') or ''
    password = request.form.get('password') or ''
    db = get_db()
    admin = db.execute("SELECT * FROM admins WHERE username=?", (username,)).fetchone()
    db.close()
    if not admin or not check_password_hash(admin['password_hash'], password):
        path = os.path.join(STATIC_DIR, 'admin.html')
        with open(path, 'r', encoding='utf-8') as f:
            content = f.read()
        # 에러 메시지 삽입
        content = content.replace('</form>', '<p style="color:#ef5350;margin-top:8px;font-size:13px">아이디 또는 비밀번호가 틀렸습니다.</p></form>', 1)
        resp = make_response(Response(content, mimetype='text/html'))
        return resp
    token = create_access_token(identity='admin:'+str(admin['id']), expires_delta=datetime.timedelta(hours=24))
    # 토큰을 쿠키에 저장하고 /admin으로 리다이렉트
    from flask import redirect, make_response
    resp = make_response(redirect('/admin'))
    resp.set_cookie('admin_token', token, max_age=86400, httponly=False, samesite='Lax')
    return resp

@app.route('/api/auth/register', methods=['POST'])
def register():
    """아이디/비밀번호 회원가입"""
    data = request.json or {}
    username = (data.get('username') or '').strip().lower()
    password = data.get('password', '')
    real_name = (data.get('real_name') or '').strip()
    phone    = (data.get('phone') or '').strip()
    bank     = (data.get('bank') or '').strip()
    account_no   = (data.get('account_no') or '').strip()
    account_name = (data.get('account_name') or '').strip()
    if not username or not password:
        return jsonify(error='아이디와 비밀번호를 입력해주세요.'), 400
    if len(username) < 6 or len(username) > 16:
        return jsonify(error='아이디는 영문 소문자/숫자, 6~16자여야 합니다'), 400
    if len(password) < 4:
        return jsonify(error='비밀번호는 4자 이상이어야 합니다.'), 400
    # 본인이름 = 예금주 검증
    if real_name and account_name and real_name != account_name:
        return jsonify(error='본인 이름과 예금주명이 일치해야 합니다.'), 400
    db = get_db()
    try:
        existing = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if existing:
            return jsonify(error='이미 사용 중인 아이디입니다.'), 409
        # 전화번호 중복 검증
        if phone:
            dup_phone = db.execute("SELECT id FROM users WHERE phone=?", (phone,)).fetchone()
            if dup_phone:
                return jsonify(error='이미 등록된 휴대폰 번호입니다.'), 409
        # 계좌번호 중복 검증
        if account_no:
            dup_acct = db.execute("SELECT id FROM users WHERE account_no=?", (account_no,)).fetchone()
            if dup_acct:
                return jsonify(error='이미 등록된 계좌번호입니다.'), 409
        pw_hash = generate_password_hash(password)
        db.execute(
            "INSERT INTO users (username, password_hash, nickname, phone, bank, account_no, account_name, approved) VALUES (?,?,?,?,?,?,?,0)",
            (username, pw_hash, real_name or username, phone, bank, account_no, account_name)
        )
        db.commit()
        # 즉시승인 옵션
        auto_approve = data.get('auto_approve', False)
        if auto_approve:
            db.execute('UPDATE users SET approved=1 WHERE username=?', (username,))
            db.commit()
            return jsonify(success=True, message='회원가입 완료! 즉시 이용 가능합니다.', auto_approved=True)
        # 시스템 자동승인 설정 확인
        sys_auto = get_setting('auto_approve', '0') == '1'
        if auto_approve or sys_auto:
            db.execute('UPDATE users SET approved=1 WHERE username=?', (username,))
            db.commit()
            return jsonify(success=True, message='회원가입이 완료되었습니다! 바로 로그인하세요.', auto_approved=True)
        return jsonify(success=True, message='회원가입이 완료되었습니다. 관리자 승인 후 이용 가능합니다.', auto_reserve=False)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/user/level-up-check', methods=['GET'])
@jwt_required()
def user_level_up_check():
    """로그인 시 레벨업 가능 여부 체크 - 다음 레벨 조건 달성 시 알림"""
    import datetime as _dt
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        u = db.execute("SELECT level, cumulative_count, level_paid_at, level_upgrade_declined_until FROM users WHERE id=?", (uid,)).fetchone()
        if not u: return jsonify(available=False)

        cur_lv = u['level'] or 1
        cum = u['cumulative_count'] or 0

        if cur_lv >= 7:
            return jsonify(available=False)

        next_lv = cur_lv + 1
        next_cfg = LEVEL_CONFIG.get(next_lv)
        if not next_cfg: return jsonify(available=False)

        # 다음 레벨 업그레이드 조건: 현재 레벨의 cum 기준치 달성
        # 예) 레벨1→2: cum >= LEVEL_CONFIG[1]['cum']=150
        #     레벨3→4: cum >= LEVEL_CONFIG[3]['cum']=960
        cur_cfg = LEVEL_CONFIG.get(cur_lv, {})
        cur_cum_threshold = cur_cfg.get('cum', 0) or 0

        if cum < cur_cum_threshold:
            return jsonify(available=False)

        # 유지(거절) 선택 기간 체크 - level_paid_at 기준 유지기간 남아있으면 묻지 않음
        declined_until = u['level_upgrade_declined_until'] if 'level_upgrade_declined_until' in u.keys() else None
        if declined_until:
            try:
                dec_date = _dt.date.fromisoformat(str(declined_until)[:10])
                if get_today() < dec_date:
                    return jsonify(available=False, declined_until=str(dec_date))
            except Exception: pass

        # 레벨업 총 비용 = 레벨업 고정비(100P) + 1레벨~다음레벨 유지비 합계
        next_maintain_total = sum(LEVEL_COST.get(lv, 0) for lv in range(1, next_lv + 1))
        total_cost = LEVEL_UP_FEE + next_maintain_total
        # 내역 표시용: 레벨별 유지비 목록
        maintain_breakdown = [{'level': lv, 'cost': LEVEL_COST.get(lv, 0)}
                              for lv in range(1, next_lv + 1) if LEVEL_COST.get(lv, 0) > 0]

        return jsonify(
            available=True,
            current_level=cur_lv,
            next_level=next_lv,
            next_maintain_total=next_maintain_total,
            maintain_breakdown=maintain_breakdown,
            level_up_fee=LEVEL_UP_FEE,
            next_level_cost=total_cost,
            cumulative_count=cum,
            required_cum=cur_cum_threshold
        )
    finally:
        db.close()


@app.route('/api/user/level-up-decide', methods=['POST'])
@jwt_required()
def user_level_up_decide():
    """레벨업 여부 결정 - upgrade: True면 레벨업 결제, False면 유지기간까지 묻지 않음"""
    import datetime as _dt
    uid = int(get_jwt_identity())
    data = request.json or {}
    upgrade = data.get('upgrade', False)
    db = get_db()
    try:
        u = db.execute("SELECT level, charge_points, exchange_points, level_paid_at FROM users WHERE id=?", (uid,)).fetchone()
        if not u: return jsonify(error='사용자 없음'), 404

        cur_lv = u['level'] or 1
        next_lv = cur_lv + 1

        if upgrade:
            # 레벨업 총 비용 = 고정 100P + 1레벨~다음레벨 유지비 합계
            next_cost = LEVEL_UP_FEE + sum(LEVEL_COST.get(lv, 0) for lv in range(1, next_lv + 1))
            charge_p = u['charge_points'] or 0
            exchange_p = u['exchange_points'] or 0
            total_p = charge_p + exchange_p

            if next_cost > 0 and total_p < next_cost:
                return jsonify(error=f'포인트 부족 (필요: {next_cost}P, 보유: {total_p}P)'), 400

            # 포인트 차감 (충전포인트 먼저)
            today_str = get_today().isoformat()
            if next_cost > 0:
                if charge_p >= next_cost:
                    db.execute("UPDATE users SET charge_points=charge_points-? WHERE id=?", (next_cost, uid))
                else:
                    remain = next_cost - charge_p
                    db.execute("UPDATE users SET charge_points=0, exchange_points=exchange_points-? WHERE id=?", (remain, uid))

            # 레벨업 + level_paid_at 오늘로 갱신 (기존 유지기간 무시)
            try:
                db.execute("UPDATE users SET level=?, level_paid_at=?, level_upgrade_declined_until=NULL WHERE id=?",
                          (next_lv, today_str, uid))
            except Exception:
                db.execute("UPDATE users SET level=?, level_paid_at=? WHERE id=?",
                          (next_lv, today_str, uid))
            db.commit()

            insert_notification(db, uid, 'level_up',
                f'{next_lv}레벨 업그레이드 완료!',
                f'🎉 {next_lv}레벨로 업그레이드되었습니다.\n결제일로부터 30일간 유지됩니다.')

            return jsonify(success=True, new_level=next_lv, paid_at=today_str, cost=next_cost)

        else:
            # 유지 선택: level_paid_at 기준 남은 유지기간까지 묻지 않음
            paid_at = u['level_paid_at']
            if paid_at:
                try:
                    paid_date = _dt.date.fromisoformat(str(paid_at)[:10])
                    expire_date = paid_date + _dt.timedelta(days=30)
                    decline_until = max(expire_date, get_today() + _dt.timedelta(days=1))
                except Exception:
                    decline_until = get_today() + _dt.timedelta(days=30)
            else:
                # 유지포인트 미결제 상태면 30일 후 다시
                decline_until = get_today() + _dt.timedelta(days=30)

            try:
                db.execute("UPDATE users SET level_upgrade_declined_until=? WHERE id=?",
                          (decline_until.isoformat(), uid))
            except Exception:
                # 컬럼 없으면 무시 (마이그레이션 미실행 환경)
                pass
            db.commit()
            return jsonify(success=True, declined_until=decline_until.isoformat())
    finally:
        db.close()

@app.route('/api/auth/login', methods=['POST'])
def login():
    """아이디/비밀번호 로그인"""
    data = request.json or {}
    username = (data.get('username') or '').strip()
    password = data.get('password', '')
    if not username or not password:
        return jsonify(error='아이디와 비밀번호를 입력해주세요.'), 400
    db = get_db()
    try:
        user = db.execute("SELECT * FROM users WHERE username=?", (username,)).fetchone()
        if not user:
            return jsonify(error='존재하지 않는 아이디입니다.'), 404
        if not check_password_hash(user['password_hash'] or '', password):
            return jsonify(error='비밀번호가 올바르지 않습니다.'), 401
        if not user['approved']:
            return jsonify(error='관리자 승인 대기 중입니다. 승인 후 로그인 가능합니다.'), 403
        access_token = create_access_token(identity=str(user['id']))
        return jsonify(access_token=access_token, user={
            'id': user['id'],
            'nickname': user['nickname'],
            'level': user['level'],
            'charge_points': user['charge_points'],
            'exchange_points': user['exchange_points']
        })
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/auth/kakao-login', methods=['POST'])
def kakao_login():
    data = request.json or {}
    kakao_id = data.get('kakao_id')
    nickname = data.get('nickname', '사용자')
    email = data.get('email', '')
    if not kakao_id:
        return jsonify(error='kakao_id required'), 400
    db = get_db()
    user = db.execute("SELECT * FROM users WHERE kakao_id=?", (kakao_id,)).fetchone()
    if not user:
        db.execute("INSERT INTO users(kakao_id,nickname,email) VALUES(?,?,?)", (kakao_id, nickname, email))
        db.commit()
        user = db.execute("SELECT * FROM users WHERE kakao_id=?", (kakao_id,)).fetchone()
    token = create_access_token(identity=str(user['id']))
    db.close()
    return jsonify(token=token, user_id=user['id'], nickname=user['nickname'], level=user['level'])

@app.route('/api/auth/demo-login', methods=['POST'])
def demo_login():
    """데모 계정 로그인 - 없으면 자동 생성"""
    conn = get_db()
    try:
        DEMO_ID = 'demo_user'
        DEMO_NICK = 'demo'
        user = conn.execute("SELECT * FROM users WHERE kakao_id=?", (DEMO_ID,)).fetchone()
        if not user:
            conn.execute(
                "INSERT INTO users (kakao_id, nickname, level, charge_points, created_at) VALUES (?,?,1,1000,datetime('now','localtime'))",
                (DEMO_ID, DEMO_NICK)
            )
            conn.commit()
            user = conn.execute("SELECT * FROM users WHERE kakao_id=?", (DEMO_ID,)).fetchone()
        u = dict(user)
        access_token = create_access_token(identity=str(u['id']))
        return jsonify(access_token=access_token, user={
            'id': u['id'],
            'nickname': u.get('nickname', DEMO_NICK),
            'level': u.get('level', 1),
            'charge_points': u.get('charge_points', 1000),
            'exchange_points': u.get('exchange_points', 0)
        })
    except Exception as e:
        conn.rollback()
        return jsonify(error=str(e)), 500
    finally:
        conn.close()

@app.route('/api/auth/init-demo-items', methods=['POST'])
@jwt_required()
def init_demo_items():
    """demo 계정에 테스트 아이템 추가"""
    uid = int(get_jwt_identity())
    conn = get_db()
    try:
        today = get_today().isoformat()
        yesterday = (get_today() - datetime.timedelta(days=3)).isoformat()
        # 기존 아이템 삭제 후 재추가
        conn.execute("DELETE FROM items WHERE user_id=?", (uid,))
        items_to_add = [
            ('bronze', 3, yesterday), ('bronze', 5, yesterday),
            ('bronze', 2, yesterday), ('bronze', 4, yesterday),
            ('bronze', 1, yesterday),
            ('silver', 2, yesterday), ('silver', 3, yesterday),
            ('gold', 1, yesterday),
        ]
        for bar_type, stage, date in items_to_add:
            conn.execute(
                "INSERT INTO items (user_id, bar_type, stage, purchase_date, status) VALUES (?,?,?,?,'reservable')",
                (uid, bar_type, stage, date)
            )
        conn.commit()
        return jsonify(success=True, count=len(items_to_add))
    except Exception as e:
        conn.rollback()
        return jsonify(error=str(e)), 500
    finally:
        conn.close()

@app.route('/api/auth/admin-login', methods=['POST'])
def admin_login():
    data = request.json or {}
    db = get_db()
    admin = db.execute("SELECT * FROM admins WHERE username=?", (data.get('username'),)).fetchone()
    db.close()
    if not admin or not check_password_hash(admin['password_hash'], data.get('password', '')):
        return jsonify(error='Invalid credentials'), 401
    token = create_access_token(identity='admin:'+str(admin['id']))
    return jsonify(token=token, role='admin')

@app.route('/api/user', methods=['GET'])
@jwt_required()
def get_user_alias():
    return get_me()

@app.route('/api/user/me', methods=['GET'])
@jwt_required()
def get_me():
    uid = int(get_jwt_identity())
    db = get_db()
    u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    if not u: return jsonify(error='Not found'), 404
    # 오늘 매칭된 건수 × 40P = 매칭유지포인트
    from datetime import datetime as _dt2
    _now2 = get_now()
    today_str = get_today().isoformat()
    # match_date 조건 제거 - 예약일 기준으로 조회 (mock 시간과 실제 날짜 불일치 방지)
    _matched_count = db.execute(
        """SELECT COUNT(*) as c FROM matches m
           JOIN reservations r ON m.reservation_id = r.id
           WHERE m.buyer_id=? AND m.status IN ('pending','paid','confirmed')
           AND r.reserve_date=? AND m.points_deducted=0""",
        (uid, today_str)
    ).fetchone()['c']
    match_maintain_cost = _matched_count * 40
    lv = u['level']
    cfg = LEVEL_CONFIG.get(lv, {})
    next_cum = cfg.get('cum')
    pct = round(u['cumulative_count'] / next_cum * 100, 1) if next_cum else None
    items = db.execute("SELECT * FROM items WHERE user_id=? AND status NOT IN ('sold') ORDER BY purchase_date DESC, id DESC", (uid,)).fetchall()
    # 판매예약중인 아이템 확인 (reservations.status='pending'인 것)
    _item_ids = [i['id'] for i in items]
    _pending_sell_set = set()
    _lucky_matched_set = set()   # 행운구매 매칭 완료된 아이템
    _lucky_waiting_set = set()   # 행운구매 매칭 대기 중인 아이템
    if _item_ids:
        _ph = ','.join('?'*len(_item_ids))
        _pending_rows = db.execute(
            f"SELECT r.item_id, r.lucky_pair_id FROM reservations r WHERE r.item_id IN ({_ph}) AND r.status='pending' AND r.confirmed=1",
            _item_ids
        ).fetchall()
        for _r in _pending_rows:
            _iid = _r['item_id']
            _lp = _r['lucky_pair_id']
            if _lp:
                # 이 lucky_pair_id로 매치가 있으면 lucky_matched, 없으면 lucky_waiting
                _mc = db.execute(
                    "SELECT COUNT(*) as c FROM matches WHERE lucky_pair_id=? AND status IN ('pending','paid')",
                    (_lp,)
                ).fetchone()['c']
                if _mc > 0:
                    _lucky_matched_set.add(_iid)
                else:
                    _lucky_waiting_set.add(_iid)
            else:
                _pending_sell_set.add(_iid)
    def fmt_item(it):
        buy, sell = get_price(it['bar_type'], it['stage'])
        d = days_since(it['purchase_date'])
        # 판매예약중인 아이템은 status_label 오버라이드
        if it['id'] in _lucky_matched_set:
            s_label = '판매예약중'   # 판매자에게는 기존과 동일하게 표시
        elif it['id'] in _lucky_waiting_set:
            s_label = '판매예약중'
        elif it['id'] in _pending_sell_set:
            s_label = '판매예약중'
        else:
            s_label = item_status_label(it['status'], it['purchase_date'])
        return {'id':it['id'],'bar_type':it['bar_type'],'stage':it['stage'],'purchase_date':it['purchase_date'],'days':d,'status_label':s_label,'buy_price':buy,'sell_price':sell,'profit':sell-buy}
    # 매칭/거래 중인 아이템은 현황 목록에서 제외 (판매탭 진행중 그룹에서 match_status로 표시)
    _matched_ids = _lucky_matched_set | _lucky_waiting_set | {i['id'] for i in items if i['status']=='matched'}
    bronze = [fmt_item(i) for i in items if i['bar_type']=='bronze' and i['id'] not in _matched_ids]
    silver = [fmt_item(i) for i in items if i['bar_type']=='silver' and i['id'] not in _matched_ids]
    gold   = [fmt_item(i) for i in items if i['bar_type']=='gold'   and i['id'] not in _matched_ids]
    # items DB에서 직접 보유 상태인 것 집계 (reservable, active, waiting 모두 보유수량)
    _own_statuses = ('reservable', 'active', 'waiting')
    # 보유 수량: reservable/active/waiting이면서 매칭 중(lucky_matched/matched)이 아닌 것
    reservable_bz = sum(1 for i in items if i['bar_type']=='bronze' and i['status'] in _own_statuses and i['id'] not in _lucky_matched_set and i['id'] not in _lucky_waiting_set)
    reservable_sv = sum(1 for i in items if i['bar_type']=='silver' and i['status'] in _own_statuses and i['id'] not in _lucky_matched_set and i['id'] not in _lucky_waiting_set)
    reservable_gd = sum(1 for i in items if i['bar_type']=='gold'   and i['status'] in _own_statuses and i['id'] not in _lucky_matched_set and i['id'] not in _lucky_waiting_set)
    # db stays open for today_res query below
    today = get_today().isoformat()
    try:
        res_rows = db.execute(
            "SELECT bar_type, COUNT(*) as cnt FROM reservations WHERE user_id=? AND reserve_date=? AND COALESCE(confirmed,0)=0",
            (uid, today)
        ).fetchall()
        today_res = {r['bar_type']: r['cnt'] for r in res_rows}
    except Exception:
        today_res = {}
    auto_reserve = u['auto_reserve'] if u['auto_reserve'] is not None else 0
    # db.close() 전에 level_trade_active 계산
    _level_trade_active = is_level_trade_active(db, uid)
    _level_paid_at = u['level_paid_at'] if 'level_paid_at' in u.keys() else None
    _level_cost = LEVEL_COST.get(lv, 0)
    db.close()
    # 오늘 예약 사용 포인트 계산
    today_reserve_count = today_res.get('bronze',0)+today_res.get('silver',0)+today_res.get('gold',0)
    today_reserve_cost = today_reserve_count * 40
    try:
        _maintain = u['maintain_points'] or 0
    except Exception:
        _maintain = 0
    # dict 변환 후 안전하게 접근
    _ud = dict(u)
    def _safe(k, d=''):
        v = _ud.get(k)
        return v if v is not None else d
    try:
        return jsonify(id=_ud.get('id'),username=_safe('username'),nickname=_safe('nickname'),real_name=_safe('real_name'),phone=_safe('phone'),bank=_safe('bank'),account_no=_safe('account_no'),account_name=_safe('account_name'),level=lv,charge_points=_ud.get('charge_points',0),exchange_points=_ud.get('exchange_points',0),total_points=(_ud.get('charge_points',0) or 0)+(_ud.get('exchange_points',0) or 0),maintain_points=_maintain,match_maintain_cost=_maintain,today_reserve_cost=_maintain,cumulative_count=_ud.get('cumulative_count',0),next_level_cum=next_cum,progress_pct=pct,level_config=dict(cfg),items={'bronze':bronze,'silver':silver,'gold':gold},reservable={'bronze':reservable_bz,'silver':reservable_sv,'gold':reservable_gd},today_reservations={'bronze':today_res.get('bronze',0),'silver':today_res.get('silver',0),'gold':today_res.get('gold',0)},auto_reserve=auto_reserve,original_level=_ud.get('original_level'),consecutive_reserve_days=int(_ud.get('consecutive_reserve_days') or 0),last_reserve_date=_ud.get('last_reserve_date'),level_demoted_at=_ud.get('level_demoted_at'),level_changed_at=_ud.get('level_changed_at'),level_change_streak_start=_ud.get('level_change_streak_start'),
            suspended_until=_ud.get('suspended_until'),
            unpaid_count=int(_ud.get('unpaid_count') or 0),
            level_trade_active=_level_trade_active,
            level_paid_at=_level_paid_at,
            level_cost=_level_cost)
    except Exception as _e:
        import traceback; traceback.print_exc()
        return jsonify(error='me_error: '+str(_e)), 500

@app.route('/api/reservation/preview', methods=['POST'])
@jwt_required()
def reservation_preview():
    uid = int(get_jwt_identity())
    data = request.json or {}
    bz = int(data.get('bronze_count', 0))
    db = get_db()
    u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    lv = u['level']
    cfg = LEVEL_CONFIG[lv]
    # 3레벨 이상: 레벨 포인트 결제 여부 확인
    if not is_level_trade_active(db, uid):
        cost = LEVEL_COST.get(lv, 0)
        db.close()
        return jsonify(error=f'{lv}레벨은 거래유지 포인트 {cost}P 결제 후 예약 가능합니다.', level_pay_required=True), 403
    if bz < cfg['bz_min'] or bz > cfg['bz_max']:
        db.close()
        return jsonify(error=f'수정 예약수는 {cfg["bz_min"]}~{cfg["bz_max"]}개 범위여야 합니다'), 400
    sv = get_sv_count(bz) if bz >= cfg['bz_max'] else 0
    gd = get_gd_count(sv) if sv >= cfg['sv_max'] and cfg['sv_max'] > 0 else 0
    total = bz + sv + gd
    cost = total * 40
    db.close()
    return jsonify(bronze=bz,silver=sv,gold=gd,total=total,cost=cost,has_enough=u['charge_points']+u['exchange_points']>=cost)

@app.route('/api/reservation/create', methods=['POST'])
@jwt_required()
def create_reservation():
    uid = int(get_jwt_identity())
    try:
      data = request.json or {}
      bz = int(data.get('bronze_count', 0))
      # 2차 매칭 참가 여부 (0/1) - 미입금 이력 없는 사람만 가능
      _join_r2_req = 1 if data.get('join_round2') else 0
      # 미입금 이력 확인 (unpaid_count > 0이면 2차 불가)
      db = get_db()
      _u_check = db.execute("SELECT unpaid_count FROM users WHERE id=?", (uid,)).fetchone()
      _has_unpaid = int((_u_check['unpaid_count'] if _u_check else 0) or 0) > 0
      join_r2 = _join_r2_req if not _has_unpaid else 0
      # 클라이언트에서 독립적으로 선택한 sv/gd 값 사용 (없으면 자동 계산)
      sv_from_client = data.get('silver_count')
      gd_from_client = data.get('gold_count')
      u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
      lv = u['level']
      cfg = LEVEL_CONFIG[lv]
      if bz < cfg['bz_min'] or bz > cfg['bz_max']:
          db.close()
          return jsonify(error='예약 수량 범위 초과'), 400
      # sv/gd: 클라이언트 값 우선, 범위 제한
      sv_max = cfg['sv_max']
      gd_max = cfg['gd_max']
      if sv_from_client is not None:
          sv = max(0, min(int(sv_from_client), sv_max))
      else:
          sv = get_sv_count(bz) if bz >= cfg['bz_max'] else 0
      if gd_from_client is not None:
          gd = max(0, min(int(gd_from_client), gd_max))
      else:
          gd = get_gd_count(sv) if sv >= sv_max and sv_max > 0 else 0
      total = bz + sv + gd
      cost = total * 40
      total_pts = u['charge_points'] + u['exchange_points']
      if total_pts < cost:
          db.close()
          return jsonify(error=f'포인트 부족. 필요: {cost}P, 보유: {total_pts}P'), 400
      today = get_today().isoformat()
      counts = {'bronze': bz, 'silver': sv, 'gold': gd}
      for bar_type, cnt in counts.items():
          if cnt <= 0:
              continue
          reservable = db.execute("SELECT id FROM items WHERE user_id=? AND bar_type=? AND status='reservable' AND julianday('now') - julianday(purchase_date) >= 1 LIMIT ?", (uid, bar_type, cnt)).fetchall()
          if reservable:
              # 실제 보유 아이템으로 예약
              for item in reservable:
                  db.execute("INSERT INTO reservations(user_id,item_id,bar_type,match_round,reserve_date,status,confirmed,join_round2) VALUES(?,?,?,?,?,'pending',0,?)", (uid,item['id'],bar_type,1,today,join_r2))
          else:
              # 아이템 없어도 예약 수만큼 레코드 생성 (외래키 일시 해제)
              db.execute("PRAGMA foreign_keys=OFF")
              for _ in range(cnt):
                  db.execute("INSERT INTO reservations(user_id,item_id,bar_type,match_round,reserve_date,status,confirmed,join_round2) VALUES(?,?,?,?,?,'pending',0,?)", (uid,0,bar_type,1,today,join_r2))
              db.execute("PRAGMA foreign_keys=ON")
      # 예약 비용: exchange_points(전환포인트) 먼저 차감, 부족하면 charge_points(충전포인트) 사용
      ex_use = min(u['exchange_points'], cost)
      ch_use = cost - ex_use
      # 1단계: 포인트 차감 + cumulative 업데이트
      db.execute("""UPDATE users
         SET exchange_points=exchange_points-?,
             charge_points=charge_points-?,
             cumulative_count=cumulative_count+?
         WHERE id=?""", (ex_use, ch_use, total, uid))
      # 2단계: maintain_points에 비용 추가 + 원천 추적
      try:
          db.execute("""UPDATE users SET
              maintain_points=COALESCE(maintain_points,0)+?,
              maintain_from_exchange=COALESCE(maintain_from_exchange,0)+?,
              maintain_from_charge=COALESCE(maintain_from_charge,0)+?
              WHERE id=?""", (cost, ex_use, ch_use, uid))
      except Exception:
          try:
              db.execute("UPDATE users SET maintain_points=COALESCE(maintain_points,0)+? WHERE id=?", (cost, uid))
          except Exception:
              pass
      # 레벨 연속 구매예약 체크 (강등/회복/변경 가능 여부)
      try:
          _check_level_demotion(db, uid)
          db.commit()
      except Exception: pass
      db.commit()
      db.close()
      return jsonify(success=True,message=f'매칭예약 완료! 총 {total}회, {cost}P 차감',bronze=bz,silver=sv,gold=gd,join_round2=join_r2,join_round2_denied=(_join_r2_req==1 and _has_unpaid))
    except Exception as _e:
        import traceback
        try: db.close()
        except: pass
        return jsonify(error=str(_e), trace=traceback.format_exc()[-500:]), 500

@app.route('/api/items', methods=['GET'])
@jwt_required()
def get_items():
    uid = int(get_jwt_identity())
    bar_type = request.args.get('bar_type')
    db = get_db()
    try:
        if bar_type:
            rows = db.execute("SELECT * FROM items WHERE user_id=? AND bar_type=? AND status!='sold' ORDER BY purchase_date DESC, id DESC", (uid, bar_type)).fetchall()
        else:
            rows = db.execute("SELECT * FROM items WHERE user_id=? AND status!='sold' ORDER BY purchase_date DESC, id DESC", (uid,)).fetchall()
        # pending reservation 한번에 조회 (아이템별 예약중 여부)
        item_ids = [it['id'] for it in rows]
        pending_set = set()
        lucky_matched_set2 = set()
        lucky_waiting_set2 = set()
        if item_ids:
            placeholders = ','.join('?' * len(item_ids))
            pending_rows = db.execute(
                f"SELECT r.item_id, r.lucky_pair_id FROM reservations r WHERE r.item_id IN ({placeholders}) AND r.status='pending'",
                item_ids
            ).fetchall()
            for _r2 in pending_rows:
                _iid2, _lp2 = _r2['item_id'], _r2['lucky_pair_id']
                if _lp2:
                    _mc2 = db.execute(
                        "SELECT COUNT(*) as c FROM matches WHERE lucky_pair_id=? AND status IN ('pending','paid')",
                        (_lp2,)
                    ).fetchone()['c']
                    if _mc2 > 0: lucky_matched_set2.add(_iid2)
                    else: lucky_waiting_set2.add(_iid2)
                else:
                    pending_set.add(_iid2)

        result = []
        for it in rows:
            buy, sell = get_price(it['bar_type'], it['stage'])
            # 판매예약중인 아이템은 status_label을 오버라이드
            if it['id'] in lucky_matched_set2:
                s_label = '🍀 행운매칭완료'
            elif it['id'] in lucky_waiting_set2:
                s_label = '🍀 행운예약중'
            elif it['id'] in pending_set:
                s_label = '판매예약중'
            else:
                s_label = item_status_label(it['status'], it['purchase_date'])
            # 결합아이템(waiting)은 combine_buy_price를 buy_price로 표시
            _buy_price = it['combine_buy_price'] if (it['status'] == 'waiting' and it['combine_buy_price']) else buy
            _cfg = SPLIT_CONFIG.get(it['bar_type'], {})
            _is_max = (_cfg.get('max_stage') == it['stage'])
            result.append({
                'id': it['id'],
                'bar_type': it['bar_type'],
                'stage': it['stage'],
                'status': it['status'],
                'purchase_date': it['purchase_date'],
                'days': days_since(it['purchase_date']),
                'status_label': s_label,
                'buy_price': _buy_price,
                'sell_price': sell,
                'profit': sell - _buy_price,
                'is_max_stage': _is_max,
            })
        return jsonify(result)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/prices', methods=['GET'])
def get_prices():
    bar_type = request.args.get('bar_type', 'bronze')
    db = get_db()
    try:
        rows = db.execute('SELECT stage, buy_price, sell_price FROM prices WHERE bar_type=? ORDER BY stage', (bar_type,)).fetchall()
        return jsonify(prices=[{'stage':r['stage'],'buy':r['buy_price'],'sell':r['sell_price'],'profit':r['sell_price']-r['buy_price']} for r in rows])
    finally:
        db.close()

@app.route('/api/charge/request', methods=['POST'])
@jwt_required()
def charge_request():
    uid = int(get_jwt_identity())
    data = request.json or {}
    amount = int(data.get('amount', 0))  # 프론트에서 원화(won) 전송
    points = amount // 120  # 원화 → 포인트 (1P = 120원)
    if points < 1:
        return jsonify(error='최소 120원(1P) 이상 충전 가능'), 400
    receipt_phone = (data.get('receipt_phone') or '').strip()
    receipt_name = (data.get('receipt_name') or '').strip()
    # 이름+전화번호 합산
    receipt_info = (receipt_name + '/' + receipt_phone) if receipt_name else receipt_phone
    db = get_db()
    try:
        try:
            db.execute("INSERT INTO charge_requests(user_id,amount,points,receipt_phone) VALUES(?,?,?,?)", (uid,amount,points,receipt_info))
        except Exception:
            db.execute("INSERT INTO charge_requests(user_id,amount,points) VALUES(?,?,?)", (uid,amount,points))
        # 루페이 계좌 정보 가져오기
        try:
            db2 = get_db()
            # 포인트계좌 우선 사용 (loopay_accounts JSON에서 type='point'인 항목)
            _accounts_row = db2.execute("SELECT value FROM system_settings WHERE key='loopay_accounts'").fetchone()
            loopay_bank = '은행미설정'; loopay_acct = '계좌미설정'; loopay_acct_name = '루페이'
            if _accounts_row:
                import json as _json
                _accounts = _json.loads(_accounts_row['value'] or '[]')
                # 포인트계좌 찾기
                _point_acct = next((a for a in _accounts if a.get('type') == 'point'), None)
                _sys_acct = next((a for a in _accounts if a.get('type') == 'system'), None)
                _use = _point_acct or _sys_acct
                if _use:
                    loopay_bank = _use.get('bank', '은행미설정')
                    loopay_acct = _use.get('account', '계좌미설정')
                    loopay_acct_name = _use.get('account_name', '루페이')
            else:
                # 기존 단일 계좌 설정 호환
                _bank = db2.execute("SELECT value FROM system_settings WHERE key='loopay_bank'").fetchone()
                _acct = db2.execute("SELECT value FROM system_settings WHERE key='loopay_account'").fetchone()
                _name = db2.execute("SELECT value FROM system_settings WHERE key='loopay_account_name'").fetchone()
                loopay_bank = _bank['value'] if _bank else '은행미설정'
                loopay_acct = _acct['value'] if _acct else '계좌미설정'
                loopay_acct_name = _name['value'] if _name else '루페이'
            db2.close()
        except Exception:
            loopay_bank, loopay_acct, loopay_acct_name = '확인필요', '확인필요', '루페이'

        # 사용자에게 충전 알림 발송 (계좌번호 포함)
        try:
            notif_msg = (
                f'충전 신청이 접수되었습니다.\n'
                f'\n📋 신청 내용\n'
                f'• 충전 포인트: {points:,}P\n'
                f'• 입금 금액: {amount:,}원\n'
                f'\n🏦 루페이 입금 계좌\n'
                f'• 은행: {loopay_bank}\n'
                f'• 계좌번호: {loopay_acct}\n'
                f'• 예금주: {loopay_acct_name}\n'
                f'\n위 계좌로 입금 후 관리자 확인 시 포인트가 지급됩니다.'
            )
            insert_notification(db, uid, 'charge', '충전 신청 접수', notif_msg)
            db.commit()
        except Exception:
            pass
        db.commit()
    finally:
        db.close()
    return jsonify(success=True,amount=amount,points=points,
                   message=f'{amount:,}원 → {points}P 충전 요청 완료',
                   account_info=f'{loopay_bank} {loopay_acct} ({loopay_acct_name})')

@app.route('/api/levels', methods=['GET'])
def get_levels():
    return jsonify(levels=LEVEL_CONFIG,cum_thresholds={'1→2':150,'2→3':450,'3→4':960,'4→5':1740,'5→6':2850,'6→7':4350,'7→8':6450,'8→9':9450,'9→10':12450})

@app.route('/api/penalties', methods=['GET'])
def get_penalty_table():
    return jsonify(penalties=[{'count':c,'days':d,'release_points':p} for c,d,p in PENALTY_TABLE])



@app.route('/api/admin/db-unlock', methods=['POST'])
@jwt_required()
def admin_db_unlock():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = None
    try:
        db = get_db()
        # WAL checkpoint 강제 실행으로 lock 해제
        db.execute("PRAGMA wal_checkpoint(FULL)")
        db.execute("PRAGMA wal_checkpoint(TRUNCATE)")
        # busy connection 확인
        row = db.execute("PRAGMA wal_checkpoint").fetchone()
        return jsonify(success=True, message='DB checkpoint 완료', checkpoint=dict(row) if row else None)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        if db:
            try: db.close()
            except: pass

@app.route('/api/admin/reset-sequences', methods=['POST'])
@jwt_required()
def admin_reset_sequences():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    db = get_db()
    try:
        results = []
        _r = db.execute("SELECT MAX(id) as m FROM items").fetchone()
        max_item = _r['m'] if _r and _r['m'] else 0
        _r = db.execute("SELECT MAX(id) as m FROM users").fetchone()
        max_user = _r['m'] if _r and _r['m'] else 0
        _r = db.execute("SELECT MAX(id) as m FROM matches").fetchone()
        max_match = _r['m'] if _r and _r['m'] else 0
        _r = db.execute("SELECT MAX(id) as m FROM reservations").fetchone()
        max_res = _r['m'] if _r and _r['m'] else 0

        reset_all = data.get('reset_all', False)
        if reset_all:
            for tbl in ['matches','reservations','items','notifications','charges','penalties']:
                try:
                    db.execute(f"DELETE FROM {tbl}")
                    results.append(f"✅ {tbl} 전체 삭제")
                except Exception as e:
                    results.append(f"⚠️ {tbl}: {str(e)}")
            db.execute("DELETE FROM users WHERE username NOT IN ('loopay','admin') AND username NOT LIKE 'admin%'")
            results.append("✅ 테스트 회원 삭제 (loopay/admin 유지)")
            for tbl in ['items','users','matches','reservations','notifications','charges']:
                try:
                    db.execute(f"UPDATE sqlite_sequence SET seq=0 WHERE name='{tbl}'")
                    results.append(f"✅ {tbl} ID 시퀀스 → 1부터 시작")
                except Exception as e:
                    results.append(f"⚠️ {tbl} 시퀀스: {str(e)}")
        else:
            targets = data.get('targets', ['items','users'])
            for tbl in targets:
                try:
                    row = db.execute(f"SELECT MAX(id) as m FROM {tbl}").fetchone()
                    max_id = row['m'] if row and row['m'] else 0
                    db.execute(f"UPDATE sqlite_sequence SET seq=? WHERE name=?", (max_id, tbl))
                    results.append(f"✅ {tbl} 시퀀스 → {max_id}")
                except Exception as e:
                    results.append(f"⚠️ {tbl}: {str(e)}")

        db.commit()
        return jsonify(success=True, results=results,
                       current={'items':max_item,'users':max_user,'matches':max_match,'reservations':max_res})
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/test-add-item', methods=['POST'])
@jwt_required()
def admin_test_add_item():
    """테스트용 아이템 추가"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    db = get_db()
    try:
        cur = db.execute(
            """INSERT INTO items(user_id, bar_type, stage, purchase_date, status)
               VALUES(?, ?, ?, ?, ?)""",
            (data.get('user_id'), data.get('bar_type','bronze'),
             data.get('stage',1), data.get('purchase_date','2026-06-01'),
             data.get('status','reservable'))
        )
        db.commit()
        return jsonify(success=True, item_id=cur.lastrowid)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/fix-sell-reservations', methods=['POST'])
@jwt_required()
def admin_fix_sell_reservations():
    """판매예약됐으나 items.status가 reservable로 남은 아이템 정리"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        # reservations에 pending 판매예약이 있는 아이템을 matched로 변경
        result = db.execute(
            """UPDATE items SET status='matched'
               WHERE id IN (
                 SELECT DISTINCT item_id FROM reservations
                 WHERE item_id IS NOT NULL AND item_id > 0
                   AND status='pending' AND confirmed=1
               ) AND status='reservable'"""
        )
        db.commit()
        return jsonify(success=True, fixed_count=result.rowcount)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/migrate-db', methods=['POST'])
@jwt_required()
def admin_migrate_db():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    import sqlite3 as _sq3
    from db import DB_PATH as _DB_PATH
    results = []
    migrations = [
        "ALTER TABLE users ADD COLUMN suspended_until DATETIME",
        "ALTER TABLE users ADD COLUMN unpaid_count INTEGER DEFAULT 0",
        "ALTER TABLE reservations ADD COLUMN join_round2 INTEGER DEFAULT 0",
        "ALTER TABLE penalties ADD COLUMN match_id INTEGER",
        "ALTER TABLE penalties ADD COLUMN release_at DATETIME",
        "ALTER TABLE penalties ADD COLUMN match_round INTEGER DEFAULT 1",
        "ALTER TABLE penalties ADD COLUMN release_paid INTEGER DEFAULT 0",
        # 데이터 정리: is_released=1인 패널티 보유자의 suspended_until 초기화
        "UPDATE users SET suspended_until=NULL WHERE id IN (SELECT DISTINCT user_id FROM penalties WHERE is_released=1) AND id NOT IN (SELECT user_id FROM penalties WHERE is_released=0)",
        # 레벨 유지/강등/변경 관련 컬럼
        "ALTER TABLE users ADD COLUMN original_level INTEGER DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN consecutive_reserve_days INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN last_reserve_date DATE DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN level_demoted_at DATE DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN level_changed_at DATE DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN level_change_streak_start DATE DEFAULT NULL",
    ]
    data = request.json or {}
    extra_sqls = data.get('extra_sqls', [])
    _c = _sq3.connect(_DB_PATH, timeout=10)
    for sql in migrations + extra_sqls:
        try:
            _c.execute(sql)
            _c.commit()
            results.append({'sql': sql[:80], 'status': 'ok'})
        except Exception as e:
            results.append({'sql': sql[:80], 'status': 'skipped: '+str(e)[:50]})
    _c.close()
    return jsonify(success=True, results=results)


@app.route('/api/admin/pending-users', methods=['GET'])
def admin_pending_users():
    """승인 대기 중인 회원 목록"""
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    db = get_db()
    try:
        rows = db.execute("""
            SELECT id, username, nickname, phone, bank, account_no, account_name, approved, created_at
            FROM users WHERE username IS NOT NULL AND approved=0
            AND username NOT IN ('admin','loopay')
            ORDER BY created_at DESC
        """).fetchall()
        users = []
        for r in rows:
            u = dict(r)
            # nickname이 username과 같으면 account_name을 성명으로 사용
            if u['nickname'] == u['username']:
                u['nickname'] = u['account_name'] or u['nickname']
            users.append(u)
        return jsonify(users=users)
    finally:
        db.close()

# ── 패널티 해제 (사용자) ────────────────────────────────────
@app.route('/api/penalty/release', methods=['POST'])
@jwt_required()
def user_release_penalty():
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        penalty = db.execute(
            "SELECT * FROM penalties WHERE user_id=? AND is_released=0 ORDER BY id DESC LIMIT 1",
            (uid,)
        ).fetchone()
        if not penalty:
            return jsonify(error='해제할 패널티가 없습니다'), 400
        release_pts  = int(penalty['release_points'])
        suspend_days = int(penalty['suspend_days'])
        u = db.execute("SELECT charge_points, exchange_points FROM users WHERE id=?", (uid,)).fetchone()
        total_pts = int(u['charge_points'] or 0) + int(u['exchange_points'] or 0)
        if total_pts < release_pts:
            return jsonify(error='포인트가 부족합니다.',
                          need_charge=True, release_points=release_pts, current_points=total_pts), 400
        # 포인트 차감 (charge_points 우선)
        ch = int(u['charge_points'] or 0)
        if ch >= release_pts:
            db.execute("UPDATE users SET charge_points=charge_points-? WHERE id=?", (release_pts, uid))
        else:
            from_ex = release_pts - ch
            db.execute("UPDATE users SET charge_points=0, exchange_points=exchange_points-? WHERE id=?", (from_ex, uid))
        # 자동 해제 시각 계산: 납부일 + suspend_days 다음날 01:00
        from datetime import timedelta
        _paid_now = get_now()
        _release_dt = (_paid_now + timedelta(days=suspend_days + 1)).replace(
            hour=1, minute=0, second=0, microsecond=0)
        _release_str = _release_dt.strftime('%Y-%m-%d %H:%M:%S')
        # release_paid=1, release_at 설정
        try:
            db.execute("UPDATE penalties SET release_paid=1, release_at=? WHERE id=?",
                       (_release_str, penalty['id']))
        except Exception:
            try:
                db.execute("UPDATE penalties SET release_paid=1 WHERE id=?", (penalty['id'],))
            except Exception:
                pass
        # 사용자 알림
        _msg = (f'해제 포인트 {release_pts:,}P가 차감됐습니다.\n'
                f'정지 {suspend_days}일 경과 후 {_release_str[:10]} 01:00에 자동으로 거래 정지가 해제됩니다.')
        insert_notification(db, uid, 'penalty_release_paid', '패널티 해제 포인트 납부 완료', _msg)
        db.commit()
        return jsonify(success=True, message=_msg, released_points=release_pts,
                       release_paid=True, resume_at=_release_str, suspend_days=suspend_days)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


# ── 사용자 패널티 내역 조회 ──────────────────────────────────
@app.route('/api/user/penalties', methods=['GET'])
@jwt_required()
def user_penalties():
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        rows = db.execute(
            "SELECT * FROM penalties WHERE user_id=? ORDER BY id DESC",
            (uid,)
        ).fetchall()
        u = db.execute("SELECT suspended_until, unpaid_count FROM users WHERE id=?", (uid,)).fetchone()
        pending = db.execute(
            "SELECT * FROM penalties WHERE user_id=? AND is_released=0 ORDER BY id DESC LIMIT 1", (uid,)
        ).fetchone()
        pending_dict = dict(pending) if pending else None
        # release_paid 컬럼 없는 경우 대비
        if pending_dict and 'release_paid' not in pending_dict:
            pending_dict['release_paid'] = 0
        return jsonify(
            penalties=[dict(r) for r in rows],
            suspended_until=u['suspended_until'] if u else None,
            unpaid_count=int(u['unpaid_count'] or 0) if u else 0,
            pending_penalty=pending_dict
        )
    finally:
        db.close()

# ── 관리자 패널티 관리 ───────────────────────────────────────
@app.route('/api/admin/penalties', methods=['GET'])
@jwt_required()
def admin_penalties():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        rows = db.execute("""
            SELECT p.*, u.username, u.nickname, u.suspended_until,
                   m.bar_type, m.match_round,
                   (SELECT COUNT(*) FROM penalties p3 WHERE p3.user_id = p.user_id) as total_count
            FROM penalties p
            JOIN users u ON p.user_id = u.id
            LEFT JOIN matches m ON p.match_id = m.id
            WHERE p.id = (
                SELECT MAX(id) FROM penalties p2 WHERE p2.user_id = p.user_id
            )
            ORDER BY p.id DESC
        """).fetchall()
        result = []
        for r in rows:
            d = dict(r)
            # total_count: 전체 누적 패널티 수 (해제 포함)
            if 'total_count' not in d:
                d['total_count'] = d.get('unpaid_count', 0)
            result.append(d)
        return jsonify(penalties=result)
    finally:
        db.close()

@app.route('/api/admin/penalty/release', methods=['POST'])
@jwt_required()
def admin_release_penalty():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    penalty_id = int(data.get('penalty_id', 0))
    db = get_db()
    try:
        p = db.execute("SELECT * FROM penalties WHERE id=?", (penalty_id,)).fetchone()
        if not p: return jsonify(error='패널티 없음'), 400
        # 즉시 거래 정지 해제
        db.execute("UPDATE penalties SET is_released=1 WHERE id=?", (penalty_id,))
        db.execute("UPDATE users SET suspended_until=NULL WHERE id=?", (p['user_id'],))
        insert_notification(db, p['user_id'], 'penalty_released', '거래 정지 해제',
            '관리자에 의해 거래 정지가 해제되었습니다. 지금 바로 거래를 재개할 수 있습니다.')
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/penalties/delete', methods=['POST'])
@jwt_required()
def admin_delete_penalties():
    """선택된 패널티 레코드 삭제 + 해당 유저 정지 상태 초기화"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    ids = [int(x) for x in data.get('ids', [])]
    if not ids: return jsonify(error='ids 필요'), 400
    db = get_db()
    try:
        ph = ','.join('?' * len(ids))
        # 삭제할 패널티의 user_id 수집
        rows = db.execute(f"SELECT DISTINCT user_id FROM penalties WHERE id IN ({ph})", ids).fetchall()
        affected_users = [r['user_id'] for r in rows]
        # 패널티 레코드 삭제
        db.execute(f"DELETE FROM penalties WHERE id IN ({ph})", ids)
        # 각 유저별로 남은 활성 패널티가 없으면 suspended_until 초기화
        for uid in affected_users:
            remaining = db.execute(
                "SELECT id FROM penalties WHERE user_id=? AND is_released=0",
                (uid,)
            ).fetchone()
            if not remaining:
                db.execute("UPDATE users SET suspended_until=NULL WHERE id=?", (uid,))
        db.commit()
        return jsonify(success=True, deleted=len(ids))
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/penalties/add', methods=['POST'])
@jwt_required()
def admin_add_penalty():
    """관리자가 특정 사용자에게 패널티 직접 부여"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    username = data.get('username', '').strip()
    reason = data.get('reason', '관리자 수동 부여').strip()
    suspend_days = int(data.get('suspend_days', 3))
    db = get_db()
    try:
        user = db.execute("SELECT id, unpaid_count, suspended_until FROM users WHERE username=?", (username,)).fetchone()
        if not user:
            return jsonify(error=f'사용자 {username} 없음'), 404
        uid = user['id']
        current_count = int(user['unpaid_count'] or 0) + 1
        # PENALTY_TABLE에서 정지일수/해제포인트 조회
        penalty_entry = next((p for p in PENALTY_TABLE if p[0] == current_count), PENALTY_TABLE[-1])
        # suspend_days는 요청값 우선, 없으면 PENALTY_TABLE 기준
        if suspend_days <= 0:
            suspend_days = penalty_entry[1]
        release_pts = penalty_entry[2]
        _now_str = get_now().strftime('%Y-%m-%d %H:%M:%S')
        from datetime import timedelta
        _release_dt = get_now() + timedelta(days=suspend_days)
        _release_str = _release_dt.strftime('%Y-%m-%d %H:%M:%S')
        # 사용자 정지 처리
        db.execute("UPDATE users SET unpaid_count=?, suspended_until=? WHERE id=?",
                   (current_count, _release_str, uid))
        # 패널티 레코드 추가
        db.execute(
            """INSERT INTO penalties(user_id,unpaid_count,suspend_days,release_points,is_released,created_at,match_id,match_round)
               VALUES(?,?,?,?,0,?,NULL,0)""",
            (uid, current_count, suspend_days, release_pts, _now_str)
        )
        # 알림
        try:
            insert_notification(db, uid, 'penalty_added', '관리자 패널티 부여',
                f'관리자에 의해 거래가 정지되었습니다. 사유: {reason}. 정지 기간: {suspend_days}일')
        except Exception:
            pass
        db.commit()
        return jsonify(success=True, suspend_days=suspend_days, release_points=release_pts,
                       suspended_until=_release_str, username=username)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/penalties/release-user', methods=['POST'])
@jwt_required()
def admin_release_user_penalty():
    """관리자가 특정 사용자의 모든 활성 패널티 즉시 해제"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    username = data.get('username', '').strip()
    penalty_id = data.get('penalty_id')  # 특정 패널티 해제
    db = get_db()
    try:
        if penalty_id:
            p = db.execute("SELECT user_id FROM penalties WHERE id=?", (penalty_id,)).fetchone()
            if not p: return jsonify(error='패널티 없음'), 404
            uid = p['user_id']
            db.execute("UPDATE penalties SET is_released=1 WHERE id=?", (penalty_id,))
        else:
            user = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
            if not user: return jsonify(error=f'사용자 없음'), 404
            uid = user['id']
            db.execute("UPDATE penalties SET is_released=1 WHERE user_id=? AND is_released=0", (uid,))
        # 남은 활성 패널티 확인
        remaining = db.execute("SELECT id FROM penalties WHERE user_id=? AND is_released=0", (uid,)).fetchone()
        if not remaining:
            db.execute("UPDATE users SET suspended_until=NULL WHERE id=?", (uid,))
        try:
            insert_notification(db, uid, 'penalty_released', '거래 정지 해제',
                '관리자에 의해 거래 정지가 해제되었습니다. 지금 바로 거래를 재개할 수 있습니다.')
        except Exception:
            pass
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()



@app.route('/api/admin/approve-user', methods=['POST'])
def admin_approve_user():
    """회원 승인/거절"""
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    data = request.json or {}
    user_id = data.get('user_id')
    action = data.get('action')  # 'approve', 'reject', 'approve_all'
    # 전체 승인
    if action == 'approve_all':
        db = get_db()
        try:
            result = db.execute("UPDATE users SET approved=1 WHERE approved=0 AND username NOT IN ('loopay','admin')")
            db.commit()
            return jsonify(success=True, approved_count=result.rowcount)
        finally:
            db.close()
    if not user_id or action not in ('approve','reject'):
        return jsonify(error='invalid params'), 400
    db = get_db()
    try:
        if action == 'approve':
            db.execute('UPDATE users SET approved=1 WHERE id=?', (user_id,))
        else:
            db.execute('DELETE FROM users WHERE id=? AND username IS NOT NULL', (user_id,))
        db.commit()
        return jsonify(success=True, action=action)
    finally:
        db.close()

@app.route('/api/current-time', methods=['GET'])
def get_current_time():
    """현재 서버 시간 반환 (mock 시간 포함, 항상 KST 기준)"""
    mt = _get_mock_time_from_db()
    # mock 없을 때는 get_now()와 동일하게 KST(UTC+9) 사용
    now = mt if mt else (datetime.datetime.utcnow() + datetime.timedelta(hours=9))
    return jsonify(
        time=now.strftime('%Y-%m-%d %H:%M:%S'),
        hour=now.hour,
        minute=now.minute,
        is_mock=mt is not None
    )

@app.route('/api/admin/set-time', methods=['POST'])
def admin_set_time():
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    data = request.json or {}
    dt_str = data.get('datetime')
    if data.get('reset') or not dt_str:
        _set_mock_time_to_db(None)
        return jsonify(success=True, mock_time=None, clear_mock=True, message='실제 시간으로 복원됨')
    try:
        mt = datetime.datetime.strptime(dt_str, '%Y-%m-%d %H:%M:%S')
        _set_mock_time_to_db(mt)
        return jsonify(success=True, mock_time=mt.strftime('%Y-%m-%d %H:%M:%S'))
    except Exception as e:
        return jsonify(error=str(e)), 400

@app.route('/api/admin/get-time', methods=['GET'])
def admin_get_time():
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    now = get_now()
    return jsonify(
        current=now.strftime('%Y-%m-%d %H:%M:%S'),
        is_mock=_get_mock_time_from_db() is not None,
        real=datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    )

@app.route('/api/admin/create-test-users', methods=['POST'])
def admin_create_test_users():
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    from werkzeug.security import generate_password_hash
    data = request.json or {}
    count = min(int(data.get('count', 10)), 50)  # 최대 50명
    points = int(data.get('points', 0))
    db = get_db()
    try:
        all_test_users = [
            ('testuser01','홍길동','01011110001','국민은행','110123456789','홍길동'),
            ('testuser02','김민준','01022220002','신한은행','110234567890','김민준'),
            ('testuser03','이서연','01033330003','하나은행','110345678901','이서연'),
            ('testuser04','박도윤','01044440004','우리은행','110456789012','박도윤'),
            ('testuser05','정시우','01055550005','농협은행','110567890123','정시우'),
            ('testuser06','강예은','01066660006','기업은행','110678901234','강예은'),
            ('testuser07','조지호','01077770007','카카오뱅크','3333012345678','조지호'),
            ('testuser08','윤하은','01088880008','토스뱅크','1000123456789','윤하은'),
            ('testuser09','임서준','01099990009','케이뱅크','1234567890123','임서준'),
            ('testuser10','오수아','01000000010','SC제일은행','110901234567','오수아'),
        ]
        # count가 10 초과면 동적 생성
        test_users = list(all_test_users[:min(count, 10)])
        if count > 10:
            banks = ['국민은행','신한은행','하나은행','우리은행','농협은행','기업은행']
            for n in range(11, count+1):
                uname = f'testuser{n:02d}'
                test_users.append((uname, f'테스트{n:02d}', f'010{n:08d}', banks[n%len(banks)], f'11000{n:09d}', f'테스트{n:02d}'))
        created = []
        skipped = []
        for username,name,phone,bank,account,acname in test_users:
            exists = db.execute('SELECT id FROM users WHERE username=?',(username,)).fetchone()
            if exists:
                skipped.append(username)
                continue
            pw = generate_password_hash('test1234')
            db.execute(
                'INSERT INTO users (username,password_hash,nickname,phone,bank,account_no,account_name,charge_points,approved) VALUES (?,?,?,?,?,?,?,?,0)',
                (username,pw,name,phone,bank,account,acname,points)
            )
            created.append(username)
        db.commit()
        return jsonify(success=True, created=created, skipped=skipped, password='test1234', points=points)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/users', methods=['GET'])
@jwt_required()
def admin_users():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    rows = db.execute("SELECT id,username,nickname,email,level,original_level,consecutive_reserve_days,last_reserve_date,level_demoted_at,level_changed_at,level_change_streak_start,charge_points,exchange_points,cumulative_count,phone,bank,account_no,account_name,created_at FROM users WHERE approved=1 ORDER BY created_at DESC").fetchall()
    # 각 사용자별 충전 합계 (confirmed 기준)
    charge_totals = {}
    charge_rows = db.execute("SELECT user_id, SUM(amount) as total_amount, SUM(points) as total_points FROM charge_requests WHERE status='confirmed' GROUP BY user_id").fetchall()
    for row in charge_rows:
        charge_totals[row['user_id']] = {'amount': row['total_amount'] or 0, 'points': row['total_points'] or 0}
    db.close()
    users = []
    for u in rows:
        d = dict(u)
        if d['nickname'] == d['username'] or not d['nickname']:
            d['real_name'] = d.get('account_name') or d['username']
        else:
            d['real_name'] = d['nickname']
        ct = charge_totals.get(d['id'], {'amount':0,'points':0})
        d['total_charged_amount'] = ct['amount']
        d['total_charged_points'] = ct['points']
        users.append(d)
    return jsonify(users=users)

@app.route('/api/admin/charges', methods=['GET'])
@jwt_required()
def admin_charges():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    # 기본: pending만, ?all=1 이면 전체
    show_all = request.args.get('all', '0') == '1'
    db = get_db()
    try:
        if show_all:
            rows = db.execute("SELECT cr.id, cr.user_id, cr.amount, cr.points, cr.status, cr.receipt_phone, cr.created_at, u.nickname, u.username FROM charge_requests cr JOIN users u ON u.id=cr.user_id ORDER BY cr.created_at DESC").fetchall()
        else:
            rows = db.execute("SELECT cr.id, cr.user_id, cr.amount, cr.points, cr.status, cr.receipt_phone, cr.created_at, u.nickname, u.username FROM charge_requests cr JOIN users u ON u.id=cr.user_id WHERE cr.status='pending' ORDER BY cr.created_at DESC").fetchall()
    except Exception:
        if show_all:
            rows = db.execute("SELECT cr.*, u.nickname, u.username FROM charge_requests cr JOIN users u ON u.id=cr.user_id ORDER BY cr.created_at DESC").fetchall()
        else:
            rows = db.execute("SELECT cr.*, u.nickname, u.username FROM charge_requests cr JOIN users u ON u.id=cr.user_id WHERE cr.status='pending' ORDER BY cr.created_at DESC").fetchall()
    db.close()
    return jsonify(charges=[dict(r) for r in rows])

@app.route('/api/admin/charge/confirm/<int:charge_id>', methods=['POST'])
@jwt_required()
def admin_confirm_charge(charge_id):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    cr = db.execute("SELECT * FROM charge_requests WHERE id=? AND status='pending'", (charge_id,)).fetchone()
    if not cr: return jsonify(error='Not found or already processed'), 404
    db.execute("UPDATE charge_requests SET status='confirmed', confirmed_at=CURRENT_TIMESTAMP WHERE id=?", (charge_id,))
    db.execute("UPDATE users SET charge_points=charge_points+? WHERE id=?", (cr['points'], cr['user_id']))
    notif_title = '충전 포인트 지급 완료'
    notif_msg = str(cr['points']) + 'P가 충전 승인되었습니다. (입금액: ' + '{:,}'.format(cr['amount']) + '원)'
    db.execute("INSERT INTO notifications (user_id, type, title, message) VALUES (?, 'charge', ?, ?)", (cr['user_id'], notif_title, notif_msg))
    db.commit()
    db.close()
    return jsonify(success=True, message=str(cr['points']) + 'P 충전 완료')

@app.route('/api/admin/charge/delete/<int:charge_id>', methods=['POST'])
@jwt_required()
def admin_delete_charge(charge_id):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        db.execute("DELETE FROM charge_requests WHERE id=?", (charge_id,))
        db.commit()
        return jsonify(success=True, message='삭제 완료')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/run-matching', methods=['POST'])
@jwt_required()
def admin_run_matching():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    round_num = int(data.get('round', 1))
    # 2차 매칭은 14:00~14:59 에만 실행 가능
    if round_num == 2:
        _force2 = (request.json or {}).get('force', False)
        _now2 = get_now()
        if _now2.hour != 14 and not _force2:
            return jsonify(error='2차 매칭은 14:00~14:59 에만 실행 가능합니다'), 400
    db = get_db()
    try:
        _calc_today = get_matching_date().isoformat()
        # today 결정: 오늘 예약 있으면 무조건 오늘 기준
        # 오늘 예약 없고 오늘 매칭도 없을 때만 어제 fallback
        _today_has_res = db.execute(
            "SELECT COUNT(*) as c FROM reservations WHERE reserve_date=?",
            (_calc_today,)
        ).fetchone()['c'] > 0
        if _today_has_res:
            today = _calc_today
        else:
            _today_match = db.execute(
                "SELECT match_date FROM matches WHERE match_round=1 AND match_date=? LIMIT 1",
                (_calc_today,)
            ).fetchone()
            if _today_match:
                today = _calc_today
            else:
                import datetime as _dt
                _yesterday = (_dt.date.fromisoformat(_calc_today) - _dt.timedelta(days=1)).isoformat()
                _yest_match = db.execute(
                    "SELECT match_date FROM matches WHERE match_round=1 AND match_date=? LIMIT 1",
                    (_yesterday,)
                ).fetchone()
                today = _yesterday if _yest_match else _calc_today
        loopay_id = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()['id']

        # ── 이전 매칭은 당일 예약만 참가 (이전 날짜 예약은 매칭 불참)
        db.commit()

        # 2차 매칭: 미입금확정(failed) 매치에서 loopay 판매예약 자동 생성
        if round_num == 2:
            failed_matches = db.execute(
                """SELECT m.bar_type, m.stage, m.seller_id
                   FROM matches m
                   WHERE m.match_round=1 AND m.status='failed'
                   AND m.match_date=?
                   AND NOT EXISTS (
                       SELECT 1 FROM reservations r
                       WHERE r.user_id=m.seller_id AND r.bar_type=m.bar_type
                       AND r.match_round=2 AND r.reserve_date=? AND r.status='pending'
                       AND r.item_id IS NOT NULL
                   )""",
                (today, today)
            ).fetchall()
            for fm in failed_matches:
                # loopay가 seller인 경우만 2차 sell 예약 생성
                if fm['seller_id'] == loopay_id:
                    # 해당 아이템 찾기
                    item = db.execute(
                        """SELECT id FROM items WHERE user_id=? AND bar_type=? AND stage=?
                           AND status IN ('matched','reservable') ORDER BY id DESC LIMIT 1""",
                        (loopay_id, fm['bar_type'], fm['stage'] or 1)
                    ).fetchone()
                    db.execute(
                        """INSERT INTO reservations(user_id,bar_type,stage,match_round,status,reserve_date,confirmed,item_id)
                           VALUES(?,?,?,2,'pending',?,1,?)""",
                        (loopay_id, fm['bar_type'], fm['stage'] or 1, today,
                         item['id'] if item else None)
                    )
            db.commit()

            # 2차 판매예약 수 확인 - 없으면 failed 매치에서 자동 생성 시도
            sell_count_2 = db.execute(
                """SELECT COUNT(*) as c FROM reservations
                   WHERE match_round=2 AND status='pending' AND reserve_date<=?
                   AND COALESCE(confirmed,0)=1 AND item_id IS NOT NULL""",
                (today,)
            ).fetchone()['c']
            if sell_count_2 == 0:
                # failed 매치에서 모든 seller 아이템 기반으로 2차 판매예약 자동 생성
                # seller_id 없는 경우 reservation_id → items 역추적
                _failed2 = db.execute(
                    """SELECT m.id as match_id, m.seller_id, m.bar_type,
                              COALESCE(m.stage,1) as stage, m.seller_item_id,
                              COALESCE(m.seller_id, u_s2.id) as eff_sid
                       FROM matches m
                       LEFT JOIN users u_s2 ON u_s2.phone = m.seller_phone
                       WHERE m.match_round=1 AND m.status='failed'
                       ORDER BY m.id"""
                ).fetchall()
                _used_item_ids = set()
                for _fm2 in _failed2:
                    _bar2 = _fm2['bar_type']
                    _stg2 = _fm2['stage']
                    _sid2 = _fm2['eff_sid']
                    if not _sid2:
                        continue
                    # seller_item_id 우선 사용
                    _item2_id = _fm2['seller_item_id']
                    _item2_status = None
                    if _item2_id:
                        if _item2_id in _used_item_ids:
                            _item2_id = None  # 이미 사용된 아이템
                        else:
                            _itrow = db.execute("SELECT id, status FROM items WHERE id=?", (_item2_id,)).fetchone()
                            if _itrow:
                                _item2_status = _itrow['status']
                            else:
                                _item2_id = None
                    # seller_item_id 없으면 미사용 아이템 조회
                    if not _item2_id:
                        _excl = ','.join(str(x) for x in _used_item_ids) if _used_item_ids else '0'
                        _itrow = db.execute(
                            f"""SELECT id, status FROM items WHERE user_id=? AND bar_type=?
                               AND status IN ('reservable','matched')
                               AND id NOT IN ({_excl})
                               ORDER BY CASE status WHEN 'reservable' THEN 0 ELSE 1 END, id LIMIT 1""",
                            (_sid2, _bar2)
                        ).fetchone()
                        if _itrow:
                            _item2_id, _item2_status = _itrow['id'], _itrow['status']
                    # 아이템 없으면 신규 생성
                    if not _item2_id:
                        _item2_id = db.execute(
                            "INSERT INTO items(user_id,bar_type,stage,purchase_date,status) VALUES(?,?,?,?,'reservable')",
                            (_sid2, _bar2, _stg2, today)
                        ).lastrowid
                        _item2_status = 'reservable'
                    # 이미 이 아이템으로 판매예약 있으면 스킵
                    _exr = db.execute(
                        "SELECT id FROM reservations WHERE item_id=? AND match_round=2 AND status='pending'",
                        (_item2_id,)
                    ).fetchone()
                    if _exr:
                        _used_item_ids.add(_item2_id)
                        continue
                    if _item2_status == 'matched':
                        db.execute("UPDATE items SET status='reservable' WHERE id=?", (_item2_id,))
                    db.execute(
                        """INSERT OR IGNORE INTO reservations(user_id,item_id,bar_type,match_round,reserve_date,status,stage,confirmed)
                           VALUES(?,?,?,2,?,'pending',?,1)""",
                        (_sid2, _item2_id, _bar2, today, _stg2)
                    )
                    _used_item_ids.add(_item2_id)
                db.commit()
                sell_count_2 = db.execute(
                    """SELECT COUNT(*) as c FROM reservations
                       WHERE match_round=2 AND status='pending' AND reserve_date<=?
                       AND COALESCE(confirmed,0)=1 AND item_id IS NOT NULL""",
                    (today,)
                ).fetchone()['c']
                if sell_count_2 == 0:
                    # 마지막 수단: failed 매치를 직접 2차 판매예약으로 변환 (아이템 없이도)
                    # seller_phone JOIN으로 user_id 확보
                    _failed2_bare = db.execute(
                        """SELECT DISTINCT m.bar_type, COALESCE(m.stage,1) as stage,
                                  COALESCE(m.seller_id, u_s.id) as eff_seller_id,
                                  m.seller_item_id as eff_item_id
                           FROM matches m
                           LEFT JOIN users u_s ON u_s.phone = m.seller_phone
                           WHERE m.match_round=1 AND m.status='failed'"""
                    ).fetchall()
                    for _fb in _failed2_bare:
                        _barb = _fb['bar_type']
                        _stgb = _fb['stage']
                        _eidb = _fb['eff_item_id']
                        _eb = _fb['eff_seller_id']
                        # seller_item_id로 추가 역추적
                        if not _eb and _eidb:
                            _ir = db.execute("SELECT user_id FROM items WHERE id=?", (_eidb,)).fetchone()
                            if _ir: _eb = _ir['user_id']
                        if not _eb: continue
                        _exb = db.execute(
                            "SELECT id FROM reservations WHERE user_id=? AND bar_type=? AND match_round=2 AND status='pending'",
                            (_eb, _barb)
                        ).fetchone()
                        if _exb: continue
                        # 아이템이 없으면 신규 생성
                        if not _eidb:
                            _eidb = db.execute(
                                "INSERT INTO items(user_id,bar_type,stage,purchase_date,status) VALUES(?,?,?,?,'reservable')",
                                (_eb, _barb, _stgb, today)
                            ).lastrowid
                        else:
                            db.execute("UPDATE items SET status='reservable' WHERE id=? AND status IN ('matched','sold')", (_eidb,))
                        db.execute(
                            "INSERT OR IGNORE INTO reservations(user_id,item_id,bar_type,match_round,reserve_date,status,stage,confirmed) VALUES(?,?,?,2,?,'pending',?,1)",
                            (_eb, _eidb, _barb, today, _stgb)
                        )
                    db.commit()
                    sell_count_2 = db.execute(
                        "SELECT COUNT(*) as c FROM reservations WHERE match_round=2 AND status='pending' AND reserve_date<=? AND COALESCE(confirmed,0)=1 AND item_id IS NOT NULL",
                        (today,)
                    ).fetchone()['c']
                    if sell_count_2 == 0:
                        db.close()
                        return jsonify(error='2차 매칭 판매수량이 없습니다. 미입금확정 후 진행하세요.', sell_count=0), 400

        import random

        # 유령 matched 구매예약 정리: status=matched인데 실제 매치 없는 구매예약 → pending으로 복원
        db.execute(
            """UPDATE reservations SET status='pending'
               WHERE status='matched'
               AND (item_id IS NULL OR item_id=0)
               AND reserve_date=?
               AND NOT EXISTS (
                   SELECT 1 FROM matches m
                   WHERE m.buyer_id=reservations.user_id
                   AND m.match_date=reservations.reserve_date
                   AND m.status IN ('pending','paid','confirmed','failed')
               )""",
            (today,)
        )
        db.commit()

        # 매칭 전 모든 loopay 판매예약(pending/unmatched 모두) → 현재 round로 리셋
        db.execute(
            """UPDATE reservations SET status='pending', match_round=?
               WHERE status IN ('pending', 'unmatched')
               AND item_id IS NOT NULL AND item_id > 0
               AND user_id = ?
               AND confirmed=1
               AND reserve_date=?""",
            (round_num, loopay_id, today)
        )
        # 일반 사용자 판매예약도 unmatched면 현재 round로 복원
        db.execute(
            """UPDATE reservations SET status='pending', match_round=?
               WHERE status='unmatched'
               AND item_id IS NOT NULL AND item_id > 0
               AND user_id != ?
               AND confirmed=1
               AND reserve_date=?""",
            (round_num, loopay_id, today)
        )
        db.commit()

        # 2차 매칭인데 판매예약(미입금 아이템)이 없으면 → 구매예약 삭제 후 종료
        if round_num == 2:
            _sell_cnt_final = db.execute(
                """SELECT COUNT(*) as c FROM reservations
                   WHERE match_round=2 AND status='pending' AND reserve_date<=?
                   AND item_id IS NOT NULL AND item_id > 0 AND confirmed=1""",
                (today,)
            ).fetchone()['c']
            if _sell_cnt_final == 0:
                # 2차 매칭 대상 없음 → 2차 구매예약 기록만 남기고 삭제
                db.execute(
                    """DELETE FROM reservations
                       WHERE match_round=2 AND status='pending' AND reserve_date=?
                       AND (item_id IS NULL OR item_id=0)
                       AND user_id!=(SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC)""",
                    (today,)
                )
                db.commit()
                return jsonify(success=True, matched=0,
                               message='2차 매칭 대상(미입금 아이템) 없음 — 구매예약 삭제 완료')

        # 판매예약 조회: confirmed=1 + items.status='reservable' (loopay 구매예약 waiting 제외)
        sell_rows = db.execute(
            """SELECT r.id as res_id, r.user_id as seller_id, r.item_id, r.bar_type,
               u.username as seller_username, u.nickname as seller_nickname,
               u.phone as seller_phone, u.bank as seller_bank,
               u.account_no as seller_account, u.account_name as seller_account_name,
               CASE WHEN COALESCE(r.stage,0) <= 0 THEN 1 ELSE r.stage END as stage,
               COALESCE(r.lucky_pair_id, i.lucky_pair_id) as lucky_pair_id
               FROM reservations r
               LEFT JOIN users u ON r.user_id = u.id
               INNER JOIN items i ON r.item_id = i.id
               WHERE r.status IN ('pending','unmatched') AND r.match_round=?
               AND r.reserve_date=?
               AND COALESCE(r.confirmed,0)=1
               AND i.status IN ('reservable','waiting','matched')
               ORDER BY COALESCE(r.lucky_pair_id, 0), r.id""",
            (round_num, today)
        ).fetchall()


        # loopay_id 조회 (이후 로직에서 사용)
        _loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        loopay_id = _loopay['id'] if _loopay else -1
        # 확정된 예약만 사용 - reservable 아이템 자동등록 fallback 제거

        # 구매예약 조회 (loopay 제외, 랜덤)
        # 일반 사용자 구매예약
        _normal_buy_rows = db.execute(
            """SELECT r.id as res_id, r.user_id as buyer_id, r.bar_type,
               CASE WHEN COALESCE(r.stage,0) <= 0 THEN 1 ELSE r.stage END as stage,
               COALESCE(r.stage, 0) as raw_stage,
               COALESCE(r.join_round2, 0) as join_round2,
               r.reserve_date,
               r.item_id,
               u.username as buyer_username, u.nickname as buyer_nickname,
               u.phone as buyer_phone, u.account_name as buyer_account_name
               FROM reservations r
               LEFT JOIN users u ON r.user_id = u.id
               WHERE r.status IN ('pending','unmatched')
               AND (r.match_round=? OR (COALESCE(r.join_round2,0)=1 AND r.match_round=1 AND ?=2))
               AND r.reserve_date=?
               AND COALESCE(r.confirmed,0)=0
               AND u.username != 'loopay'
               AND r.user_id NOT IN (
                   SELECT p.user_id FROM penalties p WHERE p.is_released=0
               )
               AND r.user_id NOT IN (
                   SELECT m.buyer_id FROM matches m
                   WHERE m.match_round=1 AND m.status='failed'
                   AND m.match_date=?
               )
               AND r.user_id NOT IN (
                   SELECT r2.user_id FROM reservations r2
                   WHERE r2.match_round=2 AND r2.status='pending'
                   AND r2.reserve_date=? AND COALESCE(r2.item_id,0)>0
               )
               ORDER BY r.reserve_date DESC, RANDOM()""",
            (round_num, round_num, today, today, today)
        ).fetchall()
        # loopay 구매예약 (confirmed=1, item.status='waiting') 별도 조회
        _loopay_buy_rows = db.execute(
            """SELECT r.id as res_id, r.user_id as buyer_id, r.bar_type,
               CASE WHEN COALESCE(r.stage,0) <= 0 THEN 1 ELSE r.stage END as stage,
               COALESCE(r.stage, 0) as raw_stage,
               COALESCE(r.join_round2, 0) as join_round2,
               r.reserve_date,
               r.item_id,
               u.username as buyer_username, u.nickname as buyer_nickname,
               u.phone as buyer_phone, u.account_name as buyer_account_name
               FROM reservations r
               LEFT JOIN users u ON r.user_id = u.id
               WHERE r.status IN ('pending') AND r.match_round=?
               AND r.reserve_date<=?
               AND u.username = 'loopay'
               AND (COALESCE(r.item_id,0)=0)""",
            (round_num, today)
        ).fetchall()
        buy_rows = list(_normal_buy_rows) + list(_loopay_buy_rows)
        sell_by_type_stage = {}
        for r in sell_rows:
            bt = r['bar_type']
            st = r['stage'] or 1
            key = (bt, st)
            if key not in sell_by_type_stage:
                sell_by_type_stage[key] = []
            sell_by_type_stage[key].append(dict(r))

        buy_by_type_stage = {}
        buy_any_stage = {}  # stage=0 (랜덤): bar_type별만 분류
        for r in buy_rows:
            bt = r['bar_type']
            # stage=0이면 랜덤(any stage) 버킷에 분리
            raw_stage = r['raw_stage'] if 'raw_stage' in r.keys() else (r['stage'] if r['stage'] else 0)
            if raw_stage == 0:
                if bt not in buy_any_stage:
                    buy_any_stage[bt] = []
                buy_any_stage[bt].append(dict(r))
            else:
                key = (bt, raw_stage)
                if key not in buy_by_type_stage:
                    buy_by_type_stage[key] = []
                buy_by_type_stage[key].append(dict(r))




        # 이전 호환용
        sell_by_type = {'bronze': [], 'silver': [], 'gold': []}
        buy_by_type = {'bronze': [], 'silver': [], 'gold': []}
        for r in sell_rows:
            bt = r['bar_type']
            if bt in sell_by_type: sell_by_type[bt].append(dict(r))
        for r in buy_rows:
            bt = r['bar_type']
            if bt in buy_by_type: buy_by_type[bt].append(dict(r))

        names = {'bronze': '수정', 'silver': '루비', 'gold': '다이아'}
        matched_pairs = []
        total_matched = 0
        _buyer_notif_map = {}  # buyer_id → {items:[], bank, acct, acct_name}
        _cnt_map = {}  # buyer_id(int) → 매칭건수 (포인트 정산용)

        # stage별 매칭 (정확한 매칭)
        # ── 랜덤 셔플: 판매/구매 모두 랜덤 순서로 ──
        import random as _rand
        for key in sell_by_type_stage:
            _rand.shuffle(sell_by_type_stage[key])
        for key in buy_by_type_stage:
            _lst = buy_by_type_stage[key]
            # loopay 구매 우선: loopay buyer를 맨 앞으로
            _loopay_buyers = [b for b in _lst if b.get('buyer_username') == 'loopay']
            _normal_buyers = [b for b in _lst if b.get('buyer_username') != 'loopay']
            _rand.shuffle(_normal_buyers)
            buy_by_type_stage[key] = _loopay_buyers + _normal_buyers
        for bt in buy_any_stage:
            _lst2 = buy_any_stage[bt]
            _loopay_any = [b for b in _lst2 if b.get('buyer_username') == 'loopay']
            _normal_any = [b for b in _lst2 if b.get('buyer_username') != 'loopay']
            _rand.shuffle(_normal_any)
            buy_any_stage[bt] = _loopay_any + _normal_any

        all_keys = sorted(set(list(sell_by_type_stage.keys()) + list(buy_by_type_stage.keys())))

        # 행운구매 전용 구매자: 오늘 날짜 + join_round2=0 + 2개 이상 예약한 사용자 (루프 외부에서 한 번 계산)
        _all_buy_rows = [dict(r) for r in buy_rows]
        # 행운구매 구매자: 당일 예약 2개 이상 + 판매자 아님 (join_round2 무관)
        _lp_buyer_count_global = {}
        for _b in _all_buy_rows:
            if _b.get('reserve_date') == today:
                _lp_buyer_count_global[_b['buyer_id']] = _lp_buyer_count_global.get(_b['buyer_id'], 0) + 1
        _lp_eligible_global = {uid for uid, cnt in _lp_buyer_count_global.items() if cnt >= 2}
        _all_lp_seller_ids_global = set()
        for _sr in sell_rows:
            _srd = dict(_sr)
            if _srd.get('lucky_pair_id'):
                _all_lp_seller_ids_global.add(_srd['seller_id'])
        _lucky_buyers_all = [b for b in _all_buy_rows
            if b.get('reserve_date') == today
            and b['buyer_id'] in _lp_eligible_global
            and b['buyer_id'] not in _all_lp_seller_ids_global]

        # price_map 초기화
        from db import BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES
        price_map = {
            'bronze': {s: (b, sl) for s, b, sl in BRONZE_PRICES},
            'silver': {s: (b, sl) for s, b, sl in SILVER_PRICES},
            'gold':   {s: (b, sl) for s, b, sl in GOLD_PRICES},
        }

        matched_seller_ids = set()
        matched_buyer_ids = set()
        matched_pairs = []

        # ── 1단계: 행운구매 쌍 우선 매칭 ──────────────────────────────────
        # lucky_pair별로 그룹화
        lp_groups = {}
        for _sr in sell_rows:
            _sd = dict(_sr)
            _lp = _sd.get('lucky_pair_id')
            if _lp:
                if _lp not in lp_groups:
                    lp_groups[_lp] = []
                lp_groups[_lp].append(_sd)

        # 각 lucky_pair 처리
        for _lp_id, _lp_sellers in lp_groups.items():
            if len(_lp_sellers) < 2:
                continue  # 쌍이 안 되면 스킵

            bt = _lp_sellers[0]['bar_type']
            _lp_seller_ids = {s['seller_id'] for s in _lp_sellers}

            # 이 쌍의 구매자 후보: 판매자 제외 + 당일 2개 이상 구매예약한 사용자
            _buy_pool = [b for b in _all_buy_rows
                if b.get('reserve_date') == today
                and b['bar_type'] == bt
                and b['buyer_id'] not in _lp_seller_ids
                and b['res_id'] not in matched_buyer_ids]

            # 2개 이상 구매예약한 사용자
            _buyer_cnt = {}
            for _b in _buy_pool:
                _buyer_cnt[_b['buyer_id']] = _buyer_cnt.get(_b['buyer_id'], 0) + 1
            _eligible = {uid for uid, cnt in _buyer_cnt.items() if cnt >= 2}

            if not _eligible:
                continue  # 조건 만족하는 구매자 없음

            # 랜덤으로 구매자 선택 (eligible 중 하나)
            import random
            _chosen_uid = random.choice(list(_eligible))
            _chosen_buys = [b for b in _buy_pool if b['buyer_id'] == _chosen_uid
                           and b['res_id'] not in matched_buyer_ids]

            if len(_chosen_buys) < len(_lp_sellers):
                continue  # 구매예약 수 부족

            # 매칭 실행: 각 판매예약에 구매예약 1개씩 배정
            _lp_matched = True
            _lp_match_list = []
            for _i, _seller in enumerate(_lp_sellers):
                _buyer_res = _chosen_buys[_i]
                # DB 검증: buyer_res 소유자 확인
                _chk = db.execute("SELECT user_id FROM reservations WHERE id=?", (_buyer_res['res_id'],)).fetchone()
                if not _chk or int(_chk['user_id']) != int(_chosen_uid):
                    _lp_matched = False; break
                _lp_match_list.append((_seller, _buyer_res))

            if not _lp_matched:
                continue

            # 매칭 INSERT
            for _seller, _buyer_res in _lp_match_list:
                _st = _seller.get('stage') or 1
                _bp = price_map.get(bt, {}).get(_st, (0, 0))[0]
                _sp = price_map.get(bt, {}).get(_st, (0, 0))[1]
                _seller_iid = _seller.get('item_id')
                s_phone = _seller.get('seller_phone', '')
                s_bank = _seller.get('seller_bank', '')
                s_acct = _seller.get('seller_account', '')
                s_name = _seller.get('seller_account_name', '')
                try:
                    db.execute(
                        """INSERT INTO matches(reservation_id, buyer_id, seller_id, bar_type, stage,
                           buy_price, sell_price, match_round, match_date, status,
                           seller_phone, seller_bank, seller_account, seller_account_name,
                           buyer_phone, seller_item_id, buyer_res_id, lucky_pair_id)
                           VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,?)""",
                        (_buyer_res['res_id'], _chosen_uid, _seller['seller_id'],
                         bt, _st, _bp, _sp, round_num, today,
                         s_phone, s_bank, s_acct, s_name,
                         _buyer_res.get('buyer_phone', ''),
                         _seller_iid, _buyer_res['res_id'], _lp_id)
                    )
                    matched_seller_ids.add(_seller['res_id'])
                    matched_buyer_ids.add(_buyer_res['res_id'])
                    # 판매예약/아이템 → matched, 구매예약 → matched
                    db.execute("UPDATE reservations SET status='matched' WHERE id=?", (_seller['res_id'],))
                    db.execute("UPDATE reservations SET status='matched' WHERE id=?", (_buyer_res['res_id'],))
                    if _seller_iid:
                        db.execute("UPDATE items SET status='matched' WHERE id=?", (_seller_iid,))
                    total_matched += 1
                    _cnt_map[int(_chosen_uid)] = _cnt_map.get(int(_chosen_uid), 0) + 1
                    matched_pairs.append({
                        'seller': _seller.get('seller_username'),
                        'buyer': _buyer_res.get('buyer_username'),
                        'bar_type': bt, 'stage': _st, 'lucky_pair_id': _lp_id
                    })
                except Exception as _e:
                    pass

            db.commit()

            # lucky_buy_results buyer_id 업데이트
            try:
                db.execute(
                    "UPDATE lucky_buy_results SET buyer_id=? WHERE id=?",
                    (_chosen_uid, _lp_id)
                )
                db.commit()
            except Exception:
                pass

        # ── 2단계: 일반 매칭 (행운구매 제외 나머지) ────────────────────────
        # bar_type+stage별로 미매칭 판매/구매 그룹화
        sell_normal = [dict(s) for s in sell_rows
            if s['res_id'] not in matched_seller_ids
            and (round_num == 2 or not dict(s).get('lucky_pair_id'))]
            # 2차 매칭은 lucky_pair_id 무관하게 일반 매칭 허용
        # loopay 판매예약도 포함
        loopay_sell = [dict(s) for s in sell_rows
            if s['res_id'] not in matched_seller_ids
            and dict(s).get('seller_username') == 'loopay']

        all_sell_normal = sell_normal  # loopay도 sell_rows에 포함됨

        # 구매예약: 미매칭된 것 (loopay는 reserve_date 무관하게 포함)
        buy_normal = [b for b in _all_buy_rows
            if b['res_id'] not in matched_buyer_ids
            and (b.get('buyer_username') == 'loopay' or b.get('reserve_date') == today)]

        # bar_type+stage별로 묶어서 랜덤 매칭
        import random
        random.shuffle(all_sell_normal)
        # loopay 구매예약 우선: loopay를 맨 앞으로, 나머지는 랜덤
        _loopay_buy_normal = [b for b in buy_normal if b.get('buyer_username') == 'loopay']
        _other_buy_normal = [b for b in buy_normal if b.get('buyer_username') != 'loopay']
        random.shuffle(_other_buy_normal)
        buy_normal = _loopay_buy_normal + _other_buy_normal

        # bar_type별로 구매예약 인덱스
        buy_by_bt = {}
        for _b in buy_normal:
            _bt = _b['bar_type']
            if _bt not in buy_by_bt: buy_by_bt[_bt] = []
            buy_by_bt[_bt].append(_b)

        for _seller in all_sell_normal:
            if _seller['res_id'] in matched_seller_ids:
                continue
            _bt = _seller['bar_type']
            _st = _seller.get('stage') or 1
            _is_loopay = (_seller.get('seller_username') == 'loopay')

            # 구매자 선택
            _candidates = [b for b in buy_by_bt.get(_bt, [])
                if b['res_id'] not in matched_buyer_ids
                and (_is_loopay or b['buyer_id'] != _seller['seller_id'])]

            if not _candidates:
                continue

            # loopay 구매예약 우선 선택
            _loopay_cands = [b for b in _candidates if b.get('buyer_username') == 'loopay']
            _buyer = _loopay_cands[0] if _loopay_cands else random.choice(_candidates)

            # DB 검증
            _chk = db.execute("SELECT user_id FROM reservations WHERE id=?", (_buyer['res_id'],)).fetchone()
            if not _chk or int(_chk['user_id']) != int(_buyer['buyer_id']):
                # 올바른 예약 찾기
                _correct = db.execute(
                    """SELECT id FROM reservations
                       WHERE user_id=? AND bar_type=? AND reserve_date=?
                       AND (item_id IS NULL OR item_id=0)
                       AND status IN ('pending','matched')
                       AND id NOT IN (SELECT COALESCE(buyer_res_id,0) FROM matches WHERE buyer_res_id IS NOT NULL)
                       ORDER BY id LIMIT 1""",
                    (_buyer['buyer_id'], _bt, today)
                ).fetchone()
                if not _correct:
                    continue
                _buyer = dict(_buyer)
                _buyer['res_id'] = _correct['id']

            _bp = price_map.get(_bt, {}).get(_st, (0, 0))[0]
            _sp = price_map.get(_bt, {}).get(_st, (0, 0))[1]
            _seller_iid = _seller.get('item_id')
            s_phone = _seller.get('seller_phone', '')
            s_bank = _seller.get('seller_bank', '')
            s_acct = _seller.get('seller_account', '')
            s_name = _seller.get('seller_account_name', '')

            # loopay 처리
            if _is_loopay:
                def get_setting(key, fallback):
                    row = db.execute("SELECT value FROM system_settings WHERE key=?", (key,)).fetchone()
                    return row['value'] if row else fallback
                s_phone = get_setting('loopay_phone', s_phone)
                s_bank = get_setting('loopay_bank', s_bank)
                s_acct = get_setting('loopay_account', s_acct)
                s_name = get_setting('loopay_account_name', s_name)

            try:
                db.execute(
                    """INSERT INTO matches(reservation_id, buyer_id, seller_id, bar_type, stage,
                       buy_price, sell_price, match_round, match_date, status,
                       seller_phone, seller_bank, seller_account, seller_account_name,
                       buyer_phone, seller_item_id, buyer_res_id, lucky_pair_id)
                       VALUES(?,?,?,?,?,?,?,?,?,'pending',?,?,?,?,?,?,?,NULL)""",
                    (_buyer['res_id'], _buyer['buyer_id'], _seller['seller_id'],
                     _bt, _st, _bp, _sp, round_num, today,
                     s_phone, s_bank, s_acct, s_name,
                     _buyer.get('buyer_phone', ''),
                     _seller_iid, _buyer['res_id'])
                )
                matched_seller_ids.add(_seller['res_id'])
                matched_buyer_ids.add(_buyer['res_id'])
                # 판매예약/아이템 → matched, 구매예약 → matched
                db.execute("UPDATE reservations SET status='matched' WHERE id=?", (_seller['res_id'],))
                db.execute("UPDATE reservations SET status='matched' WHERE id=?", (_buyer['res_id'],))
                _sell_item_id = _seller.get('item_id')
                if _sell_item_id:
                    db.execute("UPDATE items SET status='matched' WHERE id=?", (_sell_item_id,))
                total_matched += 1
                _cnt_map[int(_buyer['buyer_id'])] = _cnt_map.get(int(_buyer['buyer_id']), 0) + 1
                matched_pairs.append({
                    'seller': _seller.get('seller_username'),
                    'buyer': _buyer.get('buyer_username'),
                    'bar_type': _bt, 'stage': _st
                })
            except Exception as _match_err:
                import traceback
                _match_err_log = traceback.format_exc()
                matched_pairs.append({'error': str(_match_err), 'trace': _match_err_log[:500]})

        # 포인트 정산: 모든 매칭 완료 후 _cnt_map 기준으로 정산
        if _cnt_map:
            _settle_match_points(db, _cnt_map)

        # 미매칭 구매자: maintain_points 전액 exchange_points로 환불
        _all_buyer_ids = set(int(b['buyer_id']) for b in _all_buy_rows
                             if b.get('buyer_username') != 'loopay')
        _matched_buyer_ids_set = set(_cnt_map.keys())
        _unmatched_buyer_ids = _all_buyer_ids - _matched_buyer_ids_set
        for _uid in _unmatched_buyer_ids:
            _u = db.execute("""SELECT maintain_points,
                              COALESCE(maintain_from_exchange,0) as mfe,
                              COALESCE(maintain_from_charge,0) as mfc
                              FROM users WHERE id=?""", (_uid,)).fetchone()
            if not _u: continue
            _mn = int(_u['maintain_points'] or 0)
            if _mn > 0:
                # 미매칭 전액 환불 - 원천별 반환
                _mfe = int(_u['mfe'] or 0)
                _mfc = int(_u['mfc'] or 0)
                db.execute("""UPDATE users SET
                    maintain_points=0, maintain_from_exchange=0, maintain_from_charge=0,
                    exchange_points=exchange_points+?,
                    charge_points=charge_points+?
                    WHERE id=?""", (_mfe, _mfc, _uid))

        # 미매칭 구매예약: pending → unmatched (카드에서 0으로 표시되도록)
        db.execute("""UPDATE reservations SET status='unmatched'
            WHERE status='pending'
            AND (item_id IS NULL OR item_id=0)
            AND reserve_date=?
            AND match_round=?
            AND user_id != (SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC LIMIT 1)""",
            (today, round_num))

        db.commit()

        # 마지막 매칭 시각 기록 (클라이언트 폴링용) + 매칭 실행 완료 기록
        try:
            import time as _time_mod
            _ts_now = str(int(_time_mod.time()))
            db.execute("INSERT OR REPLACE INTO system_settings(key,value) VALUES('last_match_ts',?)", (_ts_now,))
            # r1/r2_ran_{today} 저장 - 매칭 실행 여부 추적
            _ran_key = f'r{round_num}_ran_{today}'
            db.execute("INSERT OR REPLACE INTO system_settings(key,value) VALUES(?,?)", (_ran_key, today))
        except Exception: pass

        # 행운구매 동일 구매자 통일: 같은 lucky_pair_id를 가진 매치는 첫 번째 매치의 구매자로 통일
        _lucky_pairs = db.execute(
            """SELECT lucky_pair_id, MIN(id) as first_id
               FROM matches
               WHERE lucky_pair_id IS NOT NULL AND match_date=? AND match_round=?
               AND status='pending'
               GROUP BY lucky_pair_id
               HAVING COUNT(*) >= 1""",
            (today, round_num)
        ).fetchall()
        for _lp in _lucky_pairs:
            db.execute(
                """UPDATE matches SET buyer_id=(SELECT buyer_id FROM matches WHERE id=?)
                   WHERE lucky_pair_id=? AND match_date=? AND match_round=? AND status='pending'""",
                (_lp['first_id'], _lp['lucky_pair_id'], today, round_num)
            )
            # lucky_buy_results의 buyer_id 업데이트 (첫 번째 매치의 실제 buyer_id 사용)
            _first_match = db.execute(
                "SELECT buyer_id FROM matches WHERE id=?", (_lp['first_id'],)
            ).fetchone()
            _actual_buyer_id = _first_match['buyer_id'] if _first_match else None
            if _actual_buyer_id:
                db.execute(
                    "UPDATE lucky_buy_results SET buyer_id=? WHERE id=?",
                    (_actual_buyer_id, _lp['lucky_pair_id'])
                )
        db.commit()

        return jsonify(
            success=True,
            matched=total_matched,
            message=f'{round_num}차 매칭 완료: {total_matched}건',
            pairs=matched_pairs,
            debug_today=today,
            debug_buy_count=len(list(buy_rows)) if buy_rows else 0,
            debug_sell_count=len(sell_rows) if sell_rows else 0,
            debug_sell_normal=len(sell_normal) if 'sell_normal' in dir() else -1,
            debug_buy_normal=len(buy_normal) if 'buy_normal' in dir() else -1,
            debug_matched_seller=list(matched_seller_ids),
            debug_sell_rows_lp=[dict(s).get('lucky_pair_id') for s in sell_rows],
            debug_sell_normal_check=[{'id':dict(s)['res_id'],'lp':dict(s).get('lucky_pair_id'),'in_matched':dict(s)['res_id'] in matched_seller_ids} for s in sell_rows]
        )
    except Exception as e:
        import traceback
        db.rollback()
        return jsonify(error=str(e), trace=traceback.format_exc()), 500
    finally:
        db.close()

@app.route('/api/admin/settings', methods=['GET'])
@jwt_required()
def get_settings():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        rows = db.execute("SELECT key, value FROM system_settings").fetchall()
        return jsonify(settings={r['key']: r['value'] for r in rows})
    finally:
        db.close()

@app.route('/api/admin/settings', methods=['POST'])
@jwt_required()
def update_settings():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    db = get_db()
    try:
        for key, value in data.items():
            if key == 'mock_time':
                # mock_time: None이면 삭제, 값이면 set_at도 함께 저장
                if value is None or value == 'null' or str(value).strip() == '':
                    db.execute("DELETE FROM system_settings WHERE key='mock_time'")
                    db.execute("DELETE FROM system_settings WHERE key='mock_time_set_at'")
                else:
                    import datetime as _dt
                    real_now = (_dt.datetime.utcnow() + _dt.timedelta(hours=9)).strftime('%Y-%m-%d %H:%M:%S')
                    db.execute("INSERT OR REPLACE INTO system_settings(key,value,updated_at) VALUES('mock_time',?,CURRENT_TIMESTAMP)", (str(value),))
                    db.execute("INSERT OR REPLACE INTO system_settings(key,value,updated_at) VALUES('mock_time_set_at',?,CURRENT_TIMESTAMP)", (real_now,))
            else:
                db.execute(
                    "INSERT OR REPLACE INTO system_settings(key,value,updated_at) VALUES(?,?,CURRENT_TIMESTAMP)",
                    (key, str(value))
                )
        db.commit()
        return jsonify(success=True, message='설정이 저장되었습니다')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

# 시스템 설정 조회 헬퍼
def get_setting(key, default='0'):
    db = get_db()
    try:
        row = db.execute("SELECT value FROM system_settings WHERE key=?", (key,)).fetchone()
        return row['value'] if row else default
    except Exception:
        return default
    finally:
        db.close()

@app.route('/api/admin/stats', methods=['GET'])
@jwt_required()
def admin_stats():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    # 승인된 일반 회원만 (admin 계정, loopay 계정 제외)
    total_users = db.execute(
        "SELECT COUNT(*) as c FROM users WHERE approved=1 AND username NOT IN ('admin','loopay')"
    ).fetchone()['c']
    # 일반 유저 아이템만 (loopay 계정 제외)
    loopay_id_row = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
    loopay_id = loopay_id_row['id'] if loopay_id_row else -1
    # 실제 존재하는 승인된 회원의 아이템만 카운트
    total_items = db.execute(
        """SELECT COUNT(*) as c FROM items
           WHERE status!='sold'
           AND user_id!=?
           AND user_id IN (SELECT id FROM users WHERE approved=1)""",
        (loopay_id,)
    ).fetchone()['c']
    pending_charges = db.execute("SELECT COUNT(*) as c FROM charge_requests WHERE status='pending'").fetchone()['c']
    today = get_today().isoformat()
    today_reserves = db.execute("SELECT COUNT(*) as c FROM reservations WHERE reserve_date=?", (today,)).fetchone()['c']
    db.close()
    return jsonify(total_users=total_users,total_items=total_items,pending_charges=pending_charges,today_reserves=today_reserves)

@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    return jsonify(schedule=[{'time':'05:00~20:00','label':'구매·판매 예약','detail':'1차·2차 예약 모두 이 시간에 가능'},{'time':'05:00~13:00','label':'1차 매칭 입금','detail':'매칭금액 판매자 계좌 입금 후 송금완료 버튼 클릭'},{'time':'13:00~14:00','label':'미입금 확인','detail':'판매자: 입금확인 버튼 또는 미입금 버튼 클릭'},{'time':'14:00~15:00','label':'2차 매칭','detail':'관리자 모드에서 실행. 1차 미입금 물량 포함'},{'time':'15:00~19:00','label':'2차 매칭 입금','detail':'매칭금액 입금 후 송금완료 버튼 클릭. 19시 이후 비활성화'},{'time':'19:00~20:00','label':'미입금 확인','detail':'판매자: 입금확인 또는 미입금 버튼 클릭'},{'time':'20:00~05:00','label':'1차 매칭','detail':'관리자 모드에서 실행'}])

@app.route('/api/admin/matching-status', methods=['GET'])
@jwt_required()
def admin_matching_status():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    # 매칭 기준일: 1차 매칭이 실행된 가장 최근 날짜 우선, 없으면 get_matching_date()
    _calc_today = get_matching_date().isoformat()
    # today 결정: 오늘 예약이 있으면 무조건 오늘 기준
    # 오늘 예약도 없고 오늘 매칭도 없을 때만 어제 fallback (자정 직후 처리용)
    _today_has_res = db.execute(
        "SELECT COUNT(*) as c FROM reservations WHERE reserve_date=?",
        (_calc_today,)
    ).fetchone()['c'] > 0
    if _today_has_res:
        today = _calc_today
    else:
        _today_match = db.execute(
            "SELECT match_date FROM matches WHERE match_round=1 AND match_date=? LIMIT 1",
            (_calc_today,)
        ).fetchone()
        if _today_match:
            today = _calc_today
        else:
            _yesterday = (get_matching_date() - __import__('datetime').timedelta(days=1)).isoformat()
            _yest_match = db.execute(
                "SELECT match_date FROM matches WHERE match_round=1 AND match_date=? LIMIT 1",
                (_yesterday,)
            ).fetchone()
            today = _yesterday if _yest_match else _calc_today

    # loopay 계정 ID 조회
    loopay_row = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
    loopay_id = loopay_row['id'] if loopay_row else -1

    # ── failed 매치 → 2차 sell 예약 백필 (seller_id 컬럼 없을 경우 대비) ──
    _today_str = get_today().isoformat()
    # ── 일반 판매자 기준 2차 sell 예약 백필 ──
    _failed_seller_r2 = db.execute(
        """SELECT m.id, m.seller_item_id, m.bar_type, COALESCE(m.stage,1) as stage,
                  m.match_date
           FROM matches m
           WHERE m.match_round=1 AND m.status='failed'
           AND m.seller_item_id IS NOT NULL AND m.seller_item_id > 0
           AND NOT EXISTS (
               SELECT 1 FROM reservations r2
               WHERE r2.item_id=m.seller_item_id
               AND r2.match_round=2 AND r2.status IN ('pending','matched')
           )""",
        ()
    ).fetchall()
    for _fsr in _failed_seller_r2:
        try:
            _fs_item = db.execute("SELECT * FROM items WHERE id=?", (_fsr['seller_item_id'],)).fetchone()
            if _fs_item:
                db.execute("UPDATE items SET status='reservable' WHERE id=?", (_fsr['seller_item_id'],))
                db.execute(
                    """INSERT INTO reservations(user_id,item_id,bar_type,stage,match_round,
                       reserve_date,status,confirmed)
                       VALUES(?,?,?,?,2,?,'pending',1)""",
                    (_fs_item['user_id'], _fsr['seller_item_id'], _fsr['bar_type'],
                     _fsr['stage'], _fsr['match_date'])
                )
        except Exception:
            pass
    if _failed_seller_r2:
        db.commit()

    _failed_without_r2 = db.execute(
        """SELECT m.id, m.bar_type, COALESCE(m.stage,1) as stage
           FROM matches m
           WHERE m.match_round=1 AND m.status='failed' AND m.match_date=?
           AND NOT EXISTS (
               SELECT 1 FROM reservations r2
               WHERE r2.user_id=? AND r2.bar_type=m.bar_type
               AND r2.match_round=2 AND r2.status='pending'
               AND r2.reserve_date=? AND r2.item_id IS NOT NULL
           )""",
        (_today_str, loopay_id, _today_str)
    ).fetchall()
    for _fm in _failed_without_r2:
        _item = db.execute(
            """SELECT id FROM items WHERE user_id=? AND bar_type=?
               AND status IN ('matched','reservable') ORDER BY id DESC LIMIT 1""",
            (loopay_id, _fm['bar_type'])
        ).fetchone()
        if _item:
            db.execute(
                """INSERT INTO reservations(user_id,bar_type,stage,match_round,status,reserve_date,confirmed,item_id)
                   VALUES(?,?,?,2,'pending',?,1,?)""",
                (loopay_id, _fm['bar_type'], _fm['stage'] or 1, _today_str, _item['id'])
            )
    if _failed_without_r2:
        db.commit()

    def get_round_data(round_num):
        # ── 구매예약: pending, 일반 사용자 ──
        # 오늘 또는 어제 날짜 포함 (1차 매칭이 전날 밤에 실행됐을 경우 대비)
        import datetime as _dt
        _yesterday = (_dt.date.fromisoformat(today) - _dt.timedelta(days=1)).isoformat()
        # 2차는 match_round=2 또는 join_round2=1(오늘 날짜)인 구매예약
        _date_cond = "AND r.reserve_date=?" if round_num == 1 else ""
        _date_args = [today] if round_num == 1 else []
        _round2_join_cond = "OR (COALESCE(r.join_round2,0)=1 AND r.reserve_date=?)" if round_num == 2 else ""
        _round2_join_args = [today] if round_num == 2 else []
        buy_count = db.execute(
            f"""SELECT COUNT(*) as c FROM reservations r
               WHERE r.status IN ('pending','unmatched') AND r.user_id!=?
               AND (r.item_id IS NULL OR r.item_id=0)
               AND (r.match_round=? {_round2_join_cond})
               {_date_cond}
               AND COALESCE(r.confirmed,0)=0
               AND r.user_id NOT IN (
                   SELECT p.user_id FROM penalties p WHERE p.is_released=0
               )
               AND r.user_id NOT IN (
                   SELECT m.buyer_id FROM matches m
                   WHERE m.match_round=1 AND m.status='failed'
                   AND m.match_date=?
               )""",
            [loopay_id, round_num] + _round2_join_args + _date_args + [_failed_ref_date]
        ).fetchone()['c']

        # loopay 구매예약도 포함 (waiting 아이템이 있는 pending 예약)
        _loopay_buy_cnt = db.execute(
            """SELECT COUNT(*) as c FROM reservations r
               LEFT JOIN items i ON r.item_id=i.id
               WHERE r.match_round=? AND r.status='pending' AND r.user_id=?
               AND r.reserve_date>=?
               AND (i.status='waiting' OR COALESCE(r.item_id,0)=0)""",
            [round_num, loopay_id, today]
        ).fetchone()['c']
        buy_count = buy_count + _loopay_buy_cnt

        buy_by_type = db.execute(
            f"""SELECT bar_type, COUNT(*) as cnt FROM reservations r
               WHERE r.status IN ('pending','unmatched') AND r.user_id!=?
               AND (r.item_id IS NULL OR r.item_id=0)
               AND (r.match_round=? {_round2_join_cond})
               {_date_cond} AND COALESCE(r.confirmed,0)=0
               AND r.user_id NOT IN (
                   SELECT p.user_id FROM penalties p WHERE p.is_released=0
               )
               AND r.user_id NOT IN (
                   SELECT m.buyer_id FROM matches m
                   WHERE m.match_round=1 AND m.status='failed'
                   AND m.match_date=?
               )
               GROUP BY bar_type""",
            [loopay_id, round_num] + _round2_join_args + _date_args + [today]
        ).fetchall()

        # loopay 구매예약 bar_type별 집계 후 buy_by_type에 합산
        _loopay_buy_by_type = db.execute(
            """SELECT r.bar_type, COUNT(*) as cnt FROM reservations r
               LEFT JOIN items i ON r.item_id=i.id
               WHERE r.match_round=? AND r.status='pending' AND r.user_id=?
               AND r.reserve_date>=?
               AND (i.status='waiting' OR COALESCE(r.item_id,0)=0)
               GROUP BY r.bar_type""",
            [round_num, loopay_id, today]
        ).fetchall()
        # buy_by_type dict로 변환해서 합산 (null 키 제외)
        _bbt_dict = {r['bar_type']: r['cnt'] for r in buy_by_type if r['bar_type']}
        for _r in _loopay_buy_by_type:
            if _r['bar_type']:  # null bar_type 제외
                _bbt_dict[_r['bar_type']] = _bbt_dict.get(_r['bar_type'], 0) + _r['cnt']
        buy_by_type = [{'bar_type': k, 'cnt': v} for k, v in _bbt_dict.items() if k and v > 0]
        # buy_count를 buy_by_type SUM으로 재산출 (카드=테이블 일치)
        buy_count = sum(r['cnt'] for r in buy_by_type) if buy_by_type else buy_count

        # ── 판매예약: loopay + 일반 사용자 모두 집계 ──
        # 구매예약(buy)은 user_id != loopay_id, 판매예약(sell)은 item_id 있음
        # 일반 사용자 판매예약: item_id IS NOT NULL, confirmed=1
        # loopay 판매예약: user_id=loopay_id, confirmed=1
        # 판매예약: items.status='reservable'인 것만 (loopay 구매예약 waiting 제외)
        # 판매예약: 일반사용자(item_id있고 reservable) + loopay(confirmed=1, reservable) - 구매예약(waiting) 제외
        # 판매예약 집계: confirmed=1 + items.status='reservable' (loopay 구매예약 waiting 제외)
        _confirmed_sell = db.execute(
            """SELECT COUNT(*) as c FROM reservations r
               INNER JOIN items i ON r.item_id=i.id
               WHERE r.match_round=? AND r.status IN ('pending','unmatched')
               AND r.reserve_date<=?
               AND COALESCE(r.confirmed,0)=1
               AND r.item_id IS NOT NULL AND r.item_id != 0
               AND i.status IN ('reservable','waiting')
               AND r.lucky_pair_id IS NULL""",
            (round_num, today)
        ).fetchone()['c']
        # loopay 판매예약은 match_round 무관하게 집계 (매칭 실행 시 round로 리셋되므로)
        _loopay_sell = db.execute(
            """SELECT COUNT(*) as c FROM reservations r
               INNER JOIN items i ON r.item_id=i.id
               INNER JOIN users u ON r.user_id=u.id
               WHERE r.status IN ('pending','unmatched')
               AND r.reserve_date>=?
               AND COALESCE(r.confirmed,0)=1
               AND i.status IN ('reservable','waiting')
               AND u.username='loopay'""",
            (today,)
        ).fetchone()['c']
        sell_count = max(_confirmed_sell, _loopay_sell)

        # by_type: loopay + 일반 사용자 판매예약 아이템별 집계 (항상 실행 - sell_count 재산출용)
        by_type_rows = db.execute(
            """SELECT r.bar_type, COUNT(*) as cnt FROM reservations r
               INNER JOIN items i ON r.item_id=i.id
               WHERE r.match_round=? AND r.status IN ('pending','unmatched')
               AND r.reserve_date>=?
               AND COALESCE(r.confirmed,0)=1
               AND i.status IN ('reservable','waiting','matched')
               GROUP BY r.bar_type""",
            (round_num, today)
        ).fetchall()
        # sell_count를 by_type_rows 합계로 재계산 (카드 수치 = 테이블 수치 일치)
        sell_count = sum(r['cnt'] for r in by_type_rows) if by_type_rows else sell_count

        rate = round(min(buy_count, sell_count) / buy_count * 100, 1) if buy_count > 0 else 0.0

        if True:
            pass  # by_type_rows 이미 위에서 계산됨
            if sell_count > 0:
                dummy_unused = None
            by_stage_rows = db.execute(
                """SELECT r.bar_type, COALESCE(r.stage, COALESCE(i.stage,1)) as stage, COUNT(*) as c
                   FROM reservations r
                   INNER JOIN items i ON r.item_id=i.id
                   WHERE r.match_round=? AND r.status IN ('pending','unmatched')
                   AND r.reserve_date>=?
                   AND COALESCE(r.confirmed,0)=1
                   AND i.status IN ('reservable','waiting')
                   GROUP BY r.bar_type, COALESCE(r.stage, COALESCE(i.stage,1))
                   ORDER BY r.bar_type, stage""",
                (round_num, today)
            ).fetchall()
        else:
            by_type_rows = []
            by_stage_rows = []
        by_type = [{'bar_type': r['bar_type'], 'count': r['cnt']} for r in by_type_rows]
        by_stage = [{'bar_type': r['bar_type'], 'stage': r['stage'], 'count': r['c']} for r in by_stage_rows]
        return {
            'buy_count': buy_count,
            'sell_count': sell_count,
            'match_rate': rate,
            'buy_by_type': [{'bar_type': r['bar_type'], 'count': r['cnt']} for r in buy_by_type],
            'by_type': by_type,
            'by_stage': by_stage
        }

    # 오늘 1차 미입금 확정(failed) 수량
    import datetime as _dt2
    _yesterday = (_dt2.date.fromisoformat(today) - _dt2.timedelta(days=1)).isoformat()
    # 오늘 미입금 집계 (오늘 없으면 어제 포함)
    import datetime as _dt3
    _yesterday2 = (_dt3.date.fromisoformat(today) - _dt3.timedelta(days=1)).isoformat()
    failed_today_count = db.execute(
        "SELECT COUNT(*) as c FROM matches WHERE match_round=1 AND status='failed' AND match_date=?",
        (today,)
    ).fetchone()['c']
    # 오늘 미입금 (1차+2차 모두, 오늘 날짜만)
    # failed 매치: 가장 최근 failed 날짜 기준 (날짜 무관)
    _failed_ref_row = db.execute(
        "SELECT MAX(match_date) as d FROM matches WHERE status='failed'"
    ).fetchone()
    _failed_ref_date = (_failed_ref_row['d'] if _failed_ref_row and _failed_ref_row['d'] else today)
    failed_count = db.execute(
        "SELECT COUNT(*) as c FROM matches WHERE status='failed' AND match_date=?",
        (_failed_ref_date,)
    ).fetchone()['c']
    # failed_list 쿼리용 조건 변수
    _failed_date_cond = (_failed_ref_date,)
    _failed_sql_cond = "match_date=?"

    # 미입금 상세
    failed_list = db.execute(
        f"""SELECT u.username, u.nickname, m.bar_type, m.stage, m.id as match_id
           FROM matches m
           LEFT JOIN users u ON m.buyer_id = u.id
           WHERE m.match_round=1 AND m.status='failed' AND {_failed_sql_cond}
           ORDER BY m.bar_type, m.stage""",
        _failed_date_cond
    ).fetchall()

    # 미입금 판매아이템 집계 (r2_sell_by_type: failed 매치의 모든 seller 아이템)
    _failed_sell_rows = db.execute(
        f"""SELECT m.bar_type, COUNT(*) as cnt
           FROM matches m
           WHERE m.match_round=1 AND m.status='failed' AND {_failed_sql_cond}
           GROUP BY m.bar_type""",
        _failed_date_cond
    ).fetchall()
    # fallback: 2차 pending 판매예약에서 집계
    if not _failed_sell_rows:
        _failed_sell_rows = db.execute(
            """SELECT r.bar_type, COUNT(*) as cnt
               FROM reservations r
               INNER JOIN items i ON r.item_id=i.id
               WHERE r.match_round=2 AND r.status='pending' AND r.reserve_date<=?
               AND COALESCE(r.confirmed,0)=1
               GROUP BY r.bar_type""",
            (today,)
        ).fetchall()
    r2_sell_by_type = [{'bar_type': r['bar_type'], 'cnt': r['cnt']} for r in _failed_sell_rows if r['bar_type']]
    r2_sell_count_from_failed = sum(r['cnt'] for r in r2_sell_by_type)

    failed_details = [{'username': r['username'], 'nickname': r['nickname'],
                        'bar_type': r['bar_type'], 'stage': r['stage'],
                        'match_id': r['match_id']} for r in failed_list]

    # 1차 미매칭 구매예약 수 = r1 buy_count - r1 sell_count (매칭되지 않은 구매)
    try:
        r1_data = get_round_data(1)
    except Exception as _e1:
        import traceback; traceback.print_exc()
        return jsonify(error='r1_error: '+str(_e1)), 500
    try:
        r2_data = get_round_data(2)
    except Exception as _e2:
        import traceback; traceback.print_exc()
        return jsonify(error='r2_error: '+str(_e2)), 500
    # 2차 탭에 표시할 구매예약 수 = 1차 미매칭
    # 1차 buy_count > 0: 매칭 전 → buy - sell
    # 1차 buy_count = 0: 매칭 완료 후 → r2 buy_count 사용
    if r1_data['buy_count'] > 0:
        # 1차 매칭 실행 전 - 예상 미매칭 수
        r1_unmatched_buy = max(0, r1_data['buy_count'] - r1_data['sell_count'])
    else:
        # 1차 매칭 실행 후 - 실제 2차 참가 신청자 수
        r1_unmatched_buy = r2_data['buy_count']

    # 2차 매칭 실행 여부 (pending 2차 매치 수)
    r2_pending_count = db.execute(
        "SELECT COUNT(*) as c FROM matches WHERE match_round=2 AND status='pending' AND match_date=?",
        (today,)
    ).fetchone()['c']

    result = {
        'round1': r1_data,
        'round2': r2_data,
        'date': today,
        'server_today': get_matching_date().isoformat(),
        'failed_count': failed_count,
        'failed_details': failed_details,
        'r1_unmatched_buy': r1_unmatched_buy,
        'r2_sell_by_type': r2_sell_by_type,
        'r2_sell_count': r2_sell_count_from_failed,
        'r2_pending_count': r2_pending_count,
        'pending_match_count': db.execute(
            """SELECT COUNT(*) as c FROM matches
               WHERE status IN ('pending','paid')
               AND match_date=?""",
            (today,)
        ).fetchone()['c'],
        # r1_ran_today: 오늘 1차 구매예약 중 unmatched/matched 상태인 것이 있으면 매칭 실행됨
        # system_settings 키는 mock_time 테스트 등으로 오염되므로 reservations 상태로 직접 판단
        'r1_ran_today': (
            db.execute(
                """SELECT COUNT(*) as c FROM reservations
                   WHERE reserve_date=? AND match_round=1
                   AND status IN ('unmatched','matched','confirmed','paid','unpaid')
                   AND (item_id IS NULL OR item_id=0)
                   AND user_id != COALESCE(
                     (SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC LIMIT 1), 0
                   )""",
                (today,)
            ).fetchone()['c'] > 0
        ),
        'r2_ran_today': (
            bool(db.execute("SELECT value FROM system_settings WHERE key=?", (f'r2_ran_{today}',)).fetchone())
            and db.execute("SELECT COUNT(*) as c FROM matches WHERE match_round=2 AND match_date=?", (today,)).fetchone()['c'] > 0
        )
    }
    db.close()
    return jsonify(result)


with app.app_context():
    init_db()
    # 테이블 컬럼 추가 (없으면)
    try:
        _c = _sq3.connect(_DB_PATH, timeout=10)
        for _col_sql in [
            "ALTER TABLE matches ADD COLUMN seller_item_id INTEGER",
            "ALTER TABLE matches ADD COLUMN points_deducted INTEGER DEFAULT 0",
            "ALTER TABLE matches ADD COLUMN lucky_pair_id INTEGER DEFAULT NULL",
            "ALTER TABLE matches ADD COLUMN buyer_res_id INTEGER DEFAULT NULL",
            "ALTER TABLE users ADD COLUMN maintain_points INTEGER DEFAULT 0",
            "ALTER TABLE users ADD COLUMN level_upgrade_declined_until TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN maintain_from_exchange INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN maintain_from_charge INTEGER DEFAULT 0",
            "ALTER TABLE items ADD COLUMN lucky_pair_id INTEGER DEFAULT NULL",
            "ALTER TABLE reservations ADD COLUMN lucky_pair_id INTEGER DEFAULT NULL",
            "ALTER TABLE lucky_buy_results ADD COLUMN status TEXT DEFAULT 'confirmed'",
            "ALTER TABLE users ADD COLUMN suspended_until DATETIME",
            "ALTER TABLE users ADD COLUMN unpaid_count INTEGER DEFAULT 0",
            "ALTER TABLE users ADD COLUMN level_paid_at DATE DEFAULT NULL",
            "ALTER TABLE penalties ADD COLUMN match_id INTEGER",
            "ALTER TABLE penalties ADD COLUMN release_at DATETIME",
            "ALTER TABLE penalties ADD COLUMN match_round INTEGER DEFAULT 1",
            "ALTER TABLE penalties ADD COLUMN release_paid INTEGER DEFAULT 0",
            "ALTER TABLE matches ADD COLUMN receipt_url TEXT",
            "ALTER TABLE matches ADD COLUMN buyer_res_id INTEGER",
            "ALTER TABLE notifications ADD COLUMN scheduled_at DATETIME",
        ]:
            try:
                _c.execute(_col_sql)
            except Exception:
                pass
        _c.commit()
        _c.close()
    except Exception:
        pass
    # loopay 아이템 중 잘못 sold 처리된 것 복원 (match가 pending인 경우)
    try:
        _c2 = _sq3.connect(_DB_PATH, timeout=10)
        _loopay = _c2.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if _loopay:
            _lid = _loopay[0]
            # match가 pending인데 아이템이 sold인 경우 matched로 복원
            _c2.execute("""UPDATE items SET status='matched'
                WHERE user_id=? AND status='sold'
                AND id IN (
                    SELECT COALESCE(m.seller_item_id, (
                        SELECT i2.id FROM items i2
                        WHERE i2.user_id=? AND i2.bar_type=m.bar_type
                        AND i2.status='sold' ORDER BY i2.id DESC LIMIT 1
                    ))
                    FROM matches m WHERE m.seller_id=? AND m.status='pending'
                )""", (_lid, _lid, _lid))
            _c2.commit()
        _c2.close()
    except Exception:
        pass
    # 가격 테이블 수정값 강제 업데이트 (INSERT OR IGNORE로 초기화된 값 덮어쓰기)
    try:
        import sqlite3 as _sq3
        from db import DB_PATH as _DB_PATH
        _c = _sq3.connect(_DB_PATH, timeout=10)
        _c.execute("UPDATE prices SET sell_price=13000 WHERE bar_type='gold' AND stage=1 AND sell_price=1300")
        _c.commit()
        _c.close()
    except Exception:
        pass
    # matches 테이블에서 loopay seller인데 phone/bank/account가 null인 것 수정
    try:
        import sqlite3 as _sq3b
        from db import DB_PATH as _DB_PATH_b
        _cb = _sq3b.connect(_DB_PATH_b, timeout=10)
        _cb.row_factory = _sq3b.Row
        _loopay_b = _cb.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if _loopay_b:
            _lid_b = _loopay_b['id']
            _ph = _cb.execute("SELECT value FROM system_settings WHERE key='loopay_phone'").fetchone()
            _bk = _cb.execute("SELECT value FROM system_settings WHERE key='loopay_bank'").fetchone()
            _ac = _cb.execute("SELECT value FROM system_settings WHERE key='loopay_account'").fetchone()
            _an = _cb.execute("SELECT value FROM system_settings WHERE key='loopay_account_name'").fetchone()
            if _ph and _bk and _ac:
                _cb.execute(
                    """UPDATE matches SET
                        seller_phone=?, seller_bank=?, seller_account=?, seller_account_name=?
                       WHERE seller_id=?
                       AND (seller_phone IS NULL OR seller_phone=''
                            OR seller_bank IS NULL OR seller_bank=''
                            OR seller_account IS NULL OR seller_account='')""",
                    (_ph['value'], _bk['value'], _ac['value'],
                     _an['value'] if _an else '루페이', _lid_b)
                )
                _cb.commit()
        _cb.close()
    except Exception:
        pass

    # 판매예약 중 stage=0인 것을 아이템의 stage로 보정
    try:
        import sqlite3 as _sq3c
        from db import DB_PATH as _DB_PATH_c
        _cc = _sq3c.connect(_DB_PATH_c, timeout=10)
        _cc.execute(
            """UPDATE reservations SET stage=(
                SELECT i.stage FROM items i WHERE i.id=reservations.item_id
            )
            WHERE confirmed=1 AND item_id>0
            AND (stage IS NULL OR stage=0)
            AND EXISTS(SELECT 1 FROM items i2 WHERE i2.id=reservations.item_id AND i2.stage>0)"""
        )
        _cc.commit()
        _cc.close()
    except Exception:
        pass

    # get_now()가 매번 DB에서 읽으므로 별도 복원 불필요


# == combine sell API ==
# redeploy-3


@app.route('/api/combine/preview', methods=['POST'])
@jwt_required()
def combine_preview():
    user_id = get_jwt_identity()
    data = request.json or {}
    item1_id = data.get('item1_id')
    item2_id = data.get('item2_id')
    if not item1_id or not item2_id:
        return jsonify({'error': 'select 2 items'}), 400
    conn = get_db()
    try:
        items = conn.execute(
            'SELECT * FROM items WHERE id IN (?,?) AND user_id=?',
            (item1_id, item2_id, user_id)
        ).fetchall()
        if len(items) != 2:
            return jsonify({'error': 'invalid items'}), 400
        i1, i2 = dict(items[0]), dict(items[1])
        if i1['bar_type'] != i2['bar_type']:
            return jsonify({'error': 'same type only'}), 400
        # 결합된 아이템(waiting) 재결합 불가
        for _it in [i1, i2]:
            if _it['status'] == 'waiting':
                return jsonify({'error': '이미 결합된 아이템은 다시 결합할 수 없습니다.', 'can_combine': False}), 400
        bar_type = i1['bar_type']
        stage1, stage2 = i1['stage'], i2['stage']
        prices = conn.execute('SELECT * FROM prices WHERE bar_type=? ORDER BY stage', (bar_type,)).fetchall()
        price_map = {p['stage']: dict(p) for p in prices}
        buy1 = price_map.get(stage1, {}).get('buy_price', 0)
        buy2 = price_map.get(stage2, {}).get('buy_price', 0)
        sell1 = price_map.get(stage1, {}).get('sell_price', 0)
        sell2 = price_map.get(stage2, {}).get('sell_price', 0)
        total_buy = buy1 + buy2
        normal_profit = (sell1 - buy1) + (sell2 - buy2)
        MAX_PROFIT = 23000
        combined_stage = None
        combined_sell = 0
        for stage in sorted(price_map.keys()):
            p = price_map[stage]
            profit = p['sell_price'] - p['buy_price']
            if profit > normal_profit:
                combined_stage = stage
                combined_sell = p['sell_price']
                break
        POINT_COST = 30000
        net_profit = combined_sell - total_buy - POINT_COST if combined_stage else 0
        can_combine = combined_stage is not None and normal_profit <= MAX_PROFIT
        return jsonify({
            'item1': {'id': i1['id'], 'bar_type': bar_type, 'stage': stage1, 'buy_price': buy1, 'sell_price': sell1},
            'item2': {'id': i2['id'], 'bar_type': bar_type, 'stage': stage2, 'buy_price': buy2, 'sell_price': sell2},
            'total_buy': total_buy,
            'normal_sell': sell1 + sell2,
            'normal_profit': normal_profit,
            'combined_stage': combined_stage,
            'combined_sell': combined_sell,
            'combined_profit': combined_sell - total_buy if combined_stage else 0,
            'point_cost': POINT_COST,
            'net_profit': net_profit,
            'can_combine': can_combine
        })
    finally:
        conn.close()

@app.route('/api/combine/execute', methods=['POST'])
@jwt_required()
def combine_execute():
    user_id = get_jwt_identity()
    data = request.json or {}
    item1_id = data.get('item1_id')
    item2_id = data.get('item2_id')
    conn = get_db()
    try:
        items = conn.execute(
            'SELECT * FROM items WHERE id IN (?,?) AND user_id=?',
            (item1_id, item2_id, user_id)
        ).fetchall()
        if len(items) != 2:
            return jsonify({'error': 'invalid items'}), 400
        i1, i2 = dict(items[0]), dict(items[1])
        if i1['bar_type'] != i2['bar_type']:
            return jsonify({'error': 'same type only'}), 400
        # 판매가능(reservable) 상태 아이템만 결합 가능 + waiting(결합아이템) 재결합 불가
        for it in [i1, i2]:
            if it['status'] == 'waiting':
                return jsonify({'error': '이미 결합된 아이템은 다시 결합할 수 없습니다.'}), 400
            if it['status'] not in ('active', 'reservable'):
                return jsonify({'error': f'보유 중인 아이템만 결합할 수 있습니다 (현재: {it["status"]})'}), 400
        user = dict(conn.execute('SELECT * FROM users WHERE id=?', (user_id,)).fetchone())
        if user['charge_points'] < 250:
            return jsonify({'error': 'insufficient points (need 250P)'}), 400
        bar_type = i1['bar_type']
        stage1, stage2 = i1['stage'], i2['stage']
        prices = conn.execute('SELECT * FROM prices WHERE bar_type=? ORDER BY stage', (bar_type,)).fetchall()
        price_map = {p['stage']: dict(p) for p in prices}
        buy1 = price_map.get(stage1, {}).get('buy_price', 0)
        buy2 = price_map.get(stage2, {}).get('buy_price', 0)
        normal_profit = (price_map.get(stage1,{}).get('sell_price',0)-buy1)+(price_map.get(stage2,{}).get('sell_price',0)-buy2)
        MAX_PROFIT = 23000
        if normal_profit > MAX_PROFIT:
            return jsonify({'error': f'결합 불가: 현재 수익합계({normal_profit:,}원)가 23,000원 초과'}), 400
        combined_stage = None
        for stage in sorted(price_map.keys()):
            p = price_map[stage]
            if (p['sell_price'] - p['buy_price']) > normal_profit:
                combined_stage = stage
                break
        if not combined_stage:
            return jsonify({'error': 'no combinable stage'}), 400
        conn.execute('UPDATE items SET status="sold" WHERE id IN (?,?)', (item1_id, item2_id))
        # 원본 두 아이템 buy_price 합산 = 결합 구매가
        _orig_buy1 = price_map.get(stage1, {}).get('buy_price', 0)
        _orig_buy2 = price_map.get(stage2, {}).get('buy_price', 0)
        _combine_buy = _orig_buy1 + _orig_buy2
        _today_str = get_today().isoformat()
        conn.execute(
            "INSERT INTO items (user_id, bar_type, stage, status, purchase_date, combine_buy_price) VALUES (?,?,?,'waiting',?,?)",
            (user_id, bar_type, combined_stage, _today_str, _combine_buy)
        )
        conn.execute('UPDATE users SET charge_points=charge_points-250 WHERE id=?', (user_id,))
        conn.commit()
        return jsonify({'success': True, 'new_stage': combined_stage})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

# == admin reservation management ==

@app.route('/api/admin/lucky-buy/setup', methods=['POST'])
@jwt_required()
def admin_lucky_buy_setup():
    """행운구매 설정: 종류별 셋수 입력 → 랜덤 짝짓기 미리보기"""
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    data = request.json or {}
    counts = data.get('counts', {})  # {'bronze': 2, 'silver': 1, 'gold': 0}
    conn = get_db()
    try:
        from db import BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES
        price_map = {
            'bronze': {s: (b, sl) for s, b, sl in BRONZE_PRICES},
            'silver': {s: (b, sl) for s, b, sl in SILVER_PRICES},
            'gold':   {s: (b, sl) for s, b, sl in GOLD_PRICES},
        }
        # 행운 단계 범위 (이 단계에서만 행운구매 가능)
        lucky_stages = {'bronze': list(range(1, 11)), 'silver': list(range(1, 9)), 'gold': list(range(1, 8))}
        
        result = {}
        for bar_type, set_count in counts.items():
            set_count = int(set_count)
            if set_count <= 0:
                result[bar_type] = []
                continue
            
            today_str = get_matching_date().isoformat()

            # 해당 단계의 판매예약 아이템 조회
            rows = conn.execute(
                """SELECT r.id as res_id, r.item_id, i.stage, i.id as item_id2, r.user_id as seller_id,
                          u.username as seller_username
                   FROM reservations r
                   JOIN items i ON r.item_id = i.id
                   LEFT JOIN users u ON r.user_id = u.id
                   WHERE r.bar_type=? AND r.status='pending'
                   AND r.item_id IS NOT NULL AND r.item_id > 0
                   AND i.status IN ('reservable','waiting')
                   AND r.lucky_pair_id IS NULL
                   AND r.reserve_date=?
                   AND i.stage IN ({})
                   ORDER BY RANDOM()""".format(','.join('?' * len(lucky_stages[bar_type]))),
                (bar_type, today_str, *lucky_stages[bar_type])
            ).fetchall()

            # 당일 해당 bar_type 구매예약이 있는 사용자 조회 (행운구매 가능 구매자)
            buy_eligible = conn.execute(
                """SELECT r.user_id, COUNT(*) as cnt
                   FROM reservations r
                   WHERE r.bar_type=? AND r.status='pending'
                   AND (r.item_id IS NULL OR r.item_id=0)
                   AND r.reserve_date=?
                   AND COALESCE(r.confirmed,0)=0
                   GROUP BY r.user_id
                   HAVING COUNT(*) >= 1""",
                (bar_type, today_str)
            ).fetchall()
            eligible_buyer_ids = {row['user_id'] for row in buy_eligible}
            
            pairs = []
            used_items = set()
            row_list = list(rows)

            # 다른 판매자끼리 최대한 많이 페어링
            for i in range(len(row_list)):
                if len(pairs) >= set_count:
                    break
                a = row_list[i]
                if a['item_id'] in used_items:
                    continue
                _sid_a = dict(a).get('seller_id')
                b = None
                for j in range(i+1, len(row_list)):
                    cand = row_list[j]
                    if cand['item_id'] in used_items:
                        continue
                    _sid_b = dict(cand).get('seller_id')
                    if _sid_a and _sid_b and _sid_a == _sid_b:
                        continue
                    b = cand
                    break
                if b is None:
                    continue
                # 이 페어의 판매자 2명을 제외한 구매 가능자가 있어야 함
                _seller_ids_pair = {dict(a).get('seller_id'), dict(b).get('seller_id')}
                _available_buyers = eligible_buyer_ids - _seller_ids_pair
                if not _available_buyers:
                    continue  # 구매 가능한 사용자 없음
                used_items.add(a['item_id'])
                used_items.add(b['item_id'])
                dummy = True  # 아래 pairs.append 진행
                sa, sb = a['stage'], b['stage']
                sell_a = price_map[bar_type].get(sa, (0, 0))[1]
                sell_b = price_map[bar_type].get(sb, (0, 0))[1]
                total = sell_a + sell_b
                
                # total보다 큰 sell_price 중 2단계 높은 것
                pm = sorted(price_map[bar_type].items())  # [(stage, (buy, sell))]
                target_stage = None
                for idx2, (st, (bp, sp)) in enumerate(pm):
                    if sp > total:
                        # 2단계 더 높은 단계
                        target_idx = idx2 + 2
                        if target_idx < len(pm):
                            target_stage = pm[target_idx][0]
                        else:
                            target_stage = pm[-1][0]
                        break
                if target_stage is None:
                    target_stage = pm[-1][0]
                
                target_buy, target_sell = price_map[bar_type].get(target_stage, (0, 0))
                pairs.append({
                    'item_a': {'res_id': a['res_id'], 'item_id': a['item_id'], 'stage': sa, 'sell': sell_a, 'seller_id': dict(a).get('seller_id'), 'seller_username': dict(a).get('seller_username')},
                    'item_b': {'res_id': b['res_id'], 'item_id': b['item_id'], 'stage': sb, 'sell': sell_b, 'seller_id': dict(b).get('seller_id'), 'seller_username': dict(b).get('seller_username')},
                    'total_sell': total,
                    'new_stage': target_stage,
                    'new_sell': target_sell,
                    'new_buy': target_buy,
                })
            # 실제 가능한 최대 페어 수 계산 (다른 판매자 조합 기준)
            _max_possible = 0
            _temp_used = set()
            for _i in range(len(row_list)):
                _a = row_list[_i]
                if _a['item_id'] in _temp_used: continue
                _sid_a = dict(_a).get('seller_id')
                for _j in range(_i+1, len(row_list)):
                    _cand = row_list[_j]
                    if _cand['item_id'] in _temp_used: continue
                    _sid_b = dict(_cand).get('seller_id')
                    if _sid_a and _sid_b and _sid_a == _sid_b: continue
                    # 구매 가능자 확인
                    _pair_sellers = {_sid_a, _sid_b}
                    if not (eligible_buyer_ids - _pair_sellers): continue
                    _temp_used.add(_a['item_id']); _temp_used.add(_cand['item_id'])
                    _max_possible += 1; break
            # 불가 사유 분석
            _bt_name = {'bronze':'수정','silver':'루비','gold':'다이아'}.get(bar_type, bar_type)
            _reason = None
            if len(row_list) < 2:
                _reason = f'판매예약 아이템이 부족합니다 (현재 {len(row_list)}개, 최소 2개 필요)'
            elif _max_possible == 0:
                if not eligible_buyer_ids:
                    _reason = f'당일 {_bt_name} 구매예약을 2개 이상 한 구매자가 없습니다'
                else:
                    _reason = f'{_bt_name} 판매자와 다른 구매자가 충분하지 않습니다'
            result[bar_type] = {'pairs': pairs, 'max_possible': _max_possible, 'reason': _reason,
                                'eligible_buyers': len(eligible_buyer_ids)}
        
        return jsonify(success=True, pairs=result)
    finally:
        conn.close()


@app.route('/api/admin/lucky-buy/confirm', methods=['POST'])
@jwt_required()
def admin_lucky_buy_confirm():
    """행운구매 확정: 기존 아이템 삭제, 예약 완료, 새 아이템 생성"""
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    data = request.json or {}
    pairs_data = data.get('pairs', {})  # {'bronze': [{item_a, item_b, new_stage},...], ...}
    conn = get_db()
    try:
        from db import BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES
        price_map = {
            'bronze': {s: (b, sl) for s, b, sl in BRONZE_PRICES},
            'silver': {s: (b, sl) for s, b, sl in SILVER_PRICES},
            'gold':   {s: (b, sl) for s, b, sl in GOLD_PRICES},
        }
        today = get_today().isoformat()
        results = []
        
        for bar_type, pairs in pairs_data.items():
            for pair in pairs:
                ia = pair['item_a']
                ib = pair['item_b']
                new_stage = int(pair['new_stage'])

                # 1. 판매예약은 그대로 유지 (status 변경 없음)
                #    단, items에 lucky_pair_id 기록을 위해 lucky_buy_results 먼저 삽입
                res_a = conn.execute('SELECT user_id FROM reservations WHERE id=?', (ia['res_id'],)).fetchone()
                res_b = conn.execute('SELECT user_id FROM reservations WHERE id=?', (ib['res_id'],)).fetchone()
                seller_a_id = res_a['user_id'] if res_a else None
                seller_b_id = res_b['user_id'] if res_b else None
                new_buy, new_sell = price_map[bar_type].get(new_stage, (0, 0))

                # 2. lucky_buy_results에 미리 등록 (new_item_id는 입금확인 시 생성)
                lbq = ('INSERT INTO lucky_buy_results(bar_type,item_a_id,item_b_id,seller_a_id,seller_b_id,new_item_id,new_stage,sell_a,sell_b,total_sell,status,match_date)'
                       ' VALUES(?,?,?,?,?,NULL,?,?,?,?,\'confirmed\',?)')
                _lbr_today = get_matching_date().isoformat()
                cur = conn.execute(lbq, (bar_type, ia['item_id'], ib['item_id'], seller_a_id, seller_b_id,
                    new_stage, ia.get('sell',0), ib.get('sell',0), ia.get('sell',0)+ib.get('sell',0), _lbr_today))
                lucky_id = cur.lastrowid

                # 3. 두 아이템에 lucky_pair_id 기록 (매칭 시 동일 구매자로 묶기 위해)
                conn.execute('UPDATE items SET lucky_pair_id=? WHERE id=? OR id=?',
                             (lucky_id, ia['item_id'], ib['item_id']))

                # 4. 두 판매예약에도 lucky_pair_id 기록 (res_id와 item_id 두 방식으로 보장)
                conn.execute('UPDATE reservations SET lucky_pair_id=? WHERE (id=? OR id=?) AND lucky_pair_id IS NULL',
                             (lucky_id, ia['res_id'], ib['res_id']))
                # item_id 기준으로도 업데이트 (res_id 누락 방지)
                conn.execute('UPDATE reservations SET lucky_pair_id=? WHERE item_id IN (?,?) AND status=\'pending\' AND lucky_pair_id IS NULL',
                             (lucky_id, ia['item_id'], ib['item_id']))

                results.append({
                    'bar_type': bar_type,
                    'old_stages': [ia['stage'], ib['stage']],
                    'new_stage': new_stage,
                    'new_sell': new_sell,
                    'lucky_id': lucky_id,
                })
        
        conn.commit()
        return jsonify(success=True, results=results)
    except Exception as e:
        conn.rollback()
        return jsonify(error=str(e)), 500
    finally:
        conn.close()


@app.route('/api/admin/lucky-buy/history', methods=['GET'])
@jwt_required()
def admin_lucky_buy_history():
    """행운구매 이력 조회 - 판매자/구매자 정보 포함"""
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    conn = get_db()
    try:
        from db import BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES
        price_map = {
            'bronze': {s: (b, sl) for s, b, sl in BRONZE_PRICES},
            'silver': {s: (b, sl) for s, b, sl in SILVER_PRICES},
            'gold':   {s: (b, sl) for s, b, sl in GOLD_PRICES},
        }
        rows = conn.execute(
            """SELECT lb.*,
               ua.username as seller_a_name, ua.nickname as seller_a_nick, ua.phone as seller_a_phone, ua.bank as seller_a_bank, ua.account_no as seller_a_acct,
               ub.username as seller_b_name, ub.nickname as seller_b_nick, ub.phone as seller_b_phone, ub.bank as seller_b_bank, ub.account_no as seller_b_acct,
               uc.username as buyer_name, uc.nickname as buyer_nick, uc.phone as buyer_phone,
               ia.stage as stage_a, ib.stage as stage_b, ni.stage as new_item_stage
               FROM lucky_buy_results lb
               INNER JOIN users ua ON lb.seller_a_id = ua.id
               INNER JOIN users ub ON lb.seller_b_id = ub.id
               LEFT JOIN users uc ON lb.buyer_id = uc.id
               LEFT JOIN items ia ON lb.item_a_id = ia.id
               LEFT JOIN items ib ON lb.item_b_id = ib.id
               LEFT JOIN items ni ON lb.new_item_id = ni.id
               ORDER BY lb.created_at DESC LIMIT 100"""
        ).fetchall()
        names = {'bronze': '수정', 'silver': '루비', 'gold': '다이아'}
        result = []
        for r in rows:
            bt = r['bar_type']
            _, new_sell = price_map[bt].get(r['new_stage'], (0, 0))
            result.append({
                'id': r['id'],
                'bar_type': bt,
                'bar_name': names.get(bt, bt),
                'created_at': r['created_at'],
                'match_date': r['match_date'] if r['match_date'] else (r['created_at'] or '')[:10],
                'item_a': {'stage': r['stage_a'], 'sell': r['sell_a']},
                'item_b': {'stage': r['stage_b'], 'sell': r['sell_b']},
                'total_sell': r['total_sell'],
                'new_stage': r['new_stage'],
                'new_sell': new_sell,
                'status': r['status'] if 'status' in r.keys() else 'confirmed',
                'new_item_id': r['new_item_id'] if 'new_item_id' in r.keys() else None,
                'seller_a': {
                    'username': r['seller_a_name'], 'nickname': r['seller_a_nick'],
                    'phone': r['seller_a_phone'], 'bank': r['seller_a_bank'], 'account_no': r['seller_a_acct']
                } if r['seller_a_name'] else None,
                'seller_b': {
                    'username': r['seller_b_name'], 'nickname': r['seller_b_nick'],
                    'phone': r['seller_b_phone'], 'bank': r['seller_b_bank'], 'account_no': r['seller_b_acct']
                } if r['seller_b_name'] else None,
                'buyer': {
                    'username': r['buyer_name'], 'nickname': r['buyer_nick'],
                    'phone': r['buyer_phone']
                } if r['buyer_name'] else None,
            })
        return jsonify(success=True, history=result)
    finally:
        conn.close()


@app.route('/api/admin/lucky-buy/history/<int:history_id>', methods=['DELETE'])
@jwt_required()
def admin_lucky_buy_history_delete(history_id):
    """행운구매 이력 삭제"""
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    conn = get_db()
    try:
        if history_id == 0:
            conn.execute("DELETE FROM lucky_buy_results")
        else:
            conn.execute("DELETE FROM lucky_buy_results WHERE id=?", (history_id,))
        conn.commit()
        return jsonify(success=True)
    finally:
        conn.close()

@app.route('/api/admin/reservation-status', methods=['GET'])
@jwt_required()
def admin_reservation_status():
    conn = get_db()
    today = get_today().isoformat()
    try:
        # loopay 계정 ID
        loopay = conn.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        loopay_id = loopay['id'] if loopay else -1

        # 가격 테이블 로드 (sell_price 기준 분류)
        prices = {}
        for row in conn.execute("SELECT bar_type, stage, sell_price FROM prices").fetchall():
            prices[(row['bar_type'], row['stage'])] = row['sell_price']

        result = {}
        for bar_type in ['bronze', 'silver', 'gold']:
            # 사용자 구매예약 (match_round=1, loopay 제외)
            user_buy = conn.execute(
                "SELECT COUNT(*) as cnt FROM reservations WHERE bar_type=? AND match_round=1 AND (status='pending' OR status IS NULL) AND (confirmed=0 OR confirmed IS NULL) AND user_id!=? AND reserve_date=?",
                (bar_type, loopay_id, today)
            ).fetchone()['cnt']
            # loopay 추가예약 (match_round=1)
            extra_buy_pending = conn.execute(
                """SELECT COUNT(*) as cnt FROM reservations r
                   WHERE r.bar_type=? AND r.match_round=1 AND r.status='pending' AND r.confirmed=0
                   AND r.user_id=? AND r.reserve_date>=?
                   AND (r.item_id IS NULL OR r.item_id=0)""",
                (bar_type, loopay_id, today)
            ).fetchone()['cnt']
            extra_buy_confirmed = conn.execute(
                """SELECT COUNT(*) as cnt FROM reservations r
                   LEFT JOIN items i ON r.item_id=i.id
                   WHERE r.bar_type=? AND r.match_round=1 AND r.confirmed=1
                   AND r.user_id=? AND r.reserve_date>=?
                   AND (r.item_id IS NULL OR i.status='waiting' OR i.status IS NULL)""",
                (bar_type, loopay_id, today)
            ).fetchone()['cnt']
            extra_buy = extra_buy_pending + extra_buy_confirmed
            total_buy = user_buy + extra_buy

            # 판매예약 아이템별 가격 분류 (items 조인)
            # 판매예약 가격대별: 일반사용자 + loopay 확정 sell 모두 포함
            # FIX v2: item_id IS NOT NULL = 판매예약만 (구매예약 제외)
            sell_rows = conn.execute(
                """SELECT r.item_id, i.stage, i.bar_type
                   FROM reservations r
                   INNER JOIN items i ON r.item_id = i.id
                   WHERE r.bar_type=? AND r.status='pending'
                   AND r.match_round=1
                   AND r.item_id IS NOT NULL AND r.item_id != 0
                   AND COALESCE(r.confirmed,0)=1
                   AND r.reserve_date=?
                   AND r.user_id != ?""",
                (bar_type, today, loopay_id)
            ).fetchall()

            sell_under32 = 0  # 32만원 미만
            sell_33up = 0     # 33만원 이상
            sell_split = 0    # 분할 (10~33만원 미만)

            # 단계 범위 기준 분류
            _stage_max = {'bronze': 20, 'silver': 16, 'gold': 14}.get(bar_type, 20)
            for row in sell_rows:
                _st = row['stage'] or 1
                if _st > _stage_max:
                    sell_33up += 1
                else:
                    sell_under32 += 1
            sell_total = sell_under32 + sell_33up + sell_split

            # loopay 추가 판매예약 (미확정 + 확정 모두)
            # 판매예약: item_id IS NOT NULL AND items.status='reservable'
            extra_sell_pending = conn.execute(
                """SELECT r.item_id FROM reservations r
                   INNER JOIN items i ON r.item_id=i.id
                   WHERE r.bar_type=? AND r.status='pending' AND r.confirmed=0
                   AND r.user_id=? AND r.reserve_date>=? AND r.match_round=1
                   AND i.status IN ('waiting','reservable')""",
                (bar_type, loopay_id, today)
            ).fetchall()
            extra_sell_confirmed_rows = conn.execute(
                """SELECT r.item_id FROM reservations r
                   INNER JOIN items i ON r.item_id=i.id
                   WHERE r.bar_type=? AND r.confirmed=1 AND r.status='pending'
                   AND r.user_id=? AND r.reserve_date>=? AND r.match_round=1
                   AND i.status='reservable'""",
                (bar_type, loopay_id, today)
            ).fetchall()
            extra_sell_rows = extra_sell_pending + extra_sell_confirmed_rows
            extra_sell_under32 = 0
            extra_sell_33up = 0
            extra_sell_split = 0
            extra_sell_new = 0
            for _er in extra_sell_rows:
                _item_id = _er['item_id'] if isinstance(_er, dict) else _er[0]
                if _item_id:
                    _item = conn.execute("SELECT stage FROM items WHERE id=?", (_item_id,)).fetchone()
                    _st = (_item['stage'] if _item else None) or 1
                else:
                    _st = 1
                if _st > _stage_max:
                    extra_sell_33up += 1
                else:
                    extra_sell_under32 += 1
            extra_sell_total = extra_sell_under32 + extra_sell_33up + extra_sell_split

            total_sell = sell_total + extra_sell_total
            match_rate = round(total_sell / total_buy * 100, 1) if total_buy > 0 else 0

            # 판매가격대별 (prices 테이블 join)
            # 단계 범위 정의 (bar_type별)
            stage_bands = {
                'bronze': [(1,10), (11,19), (20,20), (21,99)],   # 수정
                'silver': [(1,8),  (9,15),  (16,16), (17,99)],   # 루비
                'gold':   [(1,7),  (8,13),  (14,14), (15,99)],   # 다이아
            }
            bands = stage_bands.get(bar_type, [(1,10),(11,19),(20,20),(21,99)])
            price_bands = {'band1': 0, 'band2': 0, 'band3': 0, 'band4': 0, 'prev_unsold': 0}
            # 가격대별 집계 - loopay 판매추가예약 포함 (행운구매 대상)
            # 판매예약 가격대별: 모든 match_round 포함 (1차+2차), 일반 사용자+loopay 확정 sell
            # price_bands: item_id IS NOT NULL인 모든 판매예약 포함 (일반+loopay, 확정여부 무관)
            # 판매예약 가격대별: items.status='reservable'인 것만 (loopay 구매예약 waiting 제외)
            all_sell = conn.execute(
                """SELECT i.stage FROM reservations r
                   JOIN items i ON r.item_id=i.id
                   WHERE r.bar_type=? AND r.status='pending'
                   AND r.item_id IS NOT NULL AND r.item_id > 0
                   AND i.status IN ('reservable','waiting')""",
                (bar_type,)
            ).fetchall()
            for row in all_sell:
                stage = row['stage'] or 1
                matched = False
                for i, (s_min, s_max) in enumerate(bands):
                    if s_min <= stage <= s_max:
                        price_bands[f'band{i+1}'] += 1
                        matched = True
                        break
                if not matched:
                    price_bands['band4'] += 1
            # 전날 미판매분 (추후 구현, 현재 0)
            # price_bands['prev_unsold'] = 0
            if False: price_bands['under10'] = 0  # 하위호환 dummy
            result[bar_type] = {
                'user_buy': user_buy,
                'extra_buy': extra_buy,
                'buy_count': total_buy,
                'sell_under32': sell_under32,
                'sell_33up': sell_33up,
                'sell_split': sell_split,
                'sell_count': total_sell,
                'extra_sell_under32': extra_sell_under32,
                'extra_sell_33up': extra_sell_33up,
                'extra_sell_split': extra_sell_split,
                'extra_sell_new': extra_sell_new,
                'extra_sell_total': extra_sell_total,
                'total': total_buy + total_sell,
                'match_rate': match_rate,
                'price_bands': price_bands
            }
        return jsonify(result)
    finally:
        conn.close()

@app.route('/api/admin/failed-matches', methods=['GET'])
@jwt_required()
def admin_failed_matches():
    """failed 매치 조회 (match_round 포함)"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='권한 없음'), 403
    db = get_db()
    try:
        rows = db.execute(
            """SELECT m.id, m.match_round, m.status, m.match_date,
                      m.seller_item_id, m.buyer_id, m.bar_type, m.stage,
                      u.username as buyer_username
               FROM matches m
               LEFT JOIN users u ON m.buyer_id=u.id
               WHERE m.status='failed'
               ORDER BY m.id DESC LIMIT 20"""
        ).fetchall()
        return jsonify(matches=[dict(r) for r in rows])
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/reservations-list', methods=['GET'])
@jwt_required()
def admin_reservations_list():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    date_from   = request.args.get('date_from', '')
    date_to     = request.args.get('date_to', '')
    single_date = request.args.get('date', '')
    username    = request.args.get('username', '').strip()
    res_type    = request.args.get('type', '')   # 'buy' | 'sell' | ''
    page        = int(request.args.get('page', 1))
    per_page    = int(request.args.get('per_page', 100))
    offset      = (page - 1) * per_page

    where = ['1=1']
    # 2차 판매 예약(match_round=2 + confirmed=1 + item_id>0)은 내부 처리용 → 목록 제외
    where.append("NOT (r.match_round=2 AND COALESCE(r.confirmed,0)=1 AND COALESCE(r.item_id,0)>0)")
    params = []
    if single_date:
        # reserve_date 또는 match_date 기준 (매칭된 경우 match_date로도 조회)
        where.append('''(r.reserve_date = ?
            OR EXISTS (
                SELECT 1 FROM matches m
                WHERE (m.seller_item_id=r.item_id OR m.reservation_id=r.id
                    OR (r.lucky_pair_id IS NOT NULL AND m.lucky_pair_id=r.lucky_pair_id AND m.seller_id=r.user_id))
                AND m.match_date=?
            ))''')
        params.append(single_date)
        params.append(single_date)
    else:
        if date_from:
            where.append('r.reserve_date >= ?'); params.append(date_from)
        if date_to:
            where.append('r.reserve_date <= ?'); params.append(date_to)
    if username:
        where.append('u.username LIKE ?'); params.append(f'%{username}%')
    # 구매/판매 구분: loopay 계정 ID 기준
    # 판매예약 = loopay user, 구매예약 = 일반 user
    conn = get_db()
    try:
        _loopay_row = conn.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        loopay_uid = _loopay_row['id'] if _loopay_row else -1
        if res_type == 'sell':
            where.append('r.user_id = ?'); params.append(loopay_uid)
        elif res_type == 'buy':
            where.append('r.user_id != ?'); params.append(loopay_uid)

        # loopay 미확정 예약(confirmed=0, 구매/판매 모두) 제외 → 확정된 것만 표시
        where.append(
            f'NOT (r.user_id = {loopay_uid} AND COALESCE(r.confirmed,0) = 0)'
        )
        where_sql = ' AND '.join(where)
        total_row = conn.execute(
            f'''SELECT COUNT(*) as cnt FROM reservations r
                LEFT JOIN users u ON r.user_id = u.id
                WHERE {where_sql}''', params
        ).fetchone()
        total = total_row['cnt'] if total_row else 0
        rows = conn.execute(
            f'''SELECT r.id, r.bar_type, r.match_round, r.status,
                       r.reserve_date, r.created_at, r.item_id, r.confirmed,
                       r.stage, COALESCE(r.join_round2, 0) as join_round2,
                       r.lucky_pair_id,
                       u.username, u.nickname, u.account_name,
                       CASE WHEN r.item_id > 0 AND COALESCE(r.confirmed,0)=1 AND i_type.status IN ('reservable','waiting','matched','sold') THEN 'sell' ELSE 'buy' END as res_type,
                       COALESCE(
                         (SELECT m.match_round FROM matches m WHERE m.seller_item_id=r.item_id AND r.item_id>0 ORDER BY m.id DESC LIMIT 1),
                         (SELECT m.match_round FROM matches m WHERE (r.item_id IS NULL OR r.item_id=0) AND (m.reservation_id=r.id OR m.buyer_res_id=r.id) ORDER BY m.id DESC LIMIT 1)
                       ) as matched_round,
                       COALESCE(
                         (SELECT m.status FROM matches m
                          WHERE m.seller_item_id=r.item_id AND r.item_id>0
                          ORDER BY m.id DESC LIMIT 1),
                         (SELECT m.status FROM matches m
                          WHERE (r.item_id IS NULL OR r.item_id=0)
                          AND (m.reservation_id=r.id OR m.buyer_res_id=r.id)
                          AND m.status IN ('pending','paid','confirmed','failed')
                          ORDER BY m.id DESC LIMIT 1),
                         (SELECT m.status FROM matches m
                          WHERE r.lucky_pair_id IS NOT NULL
                          AND m.lucky_pair_id=r.lucky_pair_id
                          AND m.seller_id=r.user_id
                          ORDER BY m.id DESC LIMIT 1)
                       ) as match_status,
                       COALESCE(
                         (SELECT m.match_date FROM matches m
                          WHERE m.seller_item_id=r.item_id AND r.item_id>0
                          ORDER BY m.id DESC LIMIT 1),
                         (SELECT m.match_date FROM matches m
                          WHERE (r.item_id IS NULL OR r.item_id=0)
                          AND (m.reservation_id=r.id OR m.buyer_res_id=r.id)
                          ORDER BY m.id DESC LIMIT 1),
                         (SELECT m.match_date FROM matches m
                          WHERE r.lucky_pair_id IS NOT NULL
                          AND m.lucky_pair_id=r.lucky_pair_id
                          AND m.seller_id=r.user_id
                          AND m.status IN ('pending','paid','confirmed')
                          ORDER BY m.id DESC LIMIT 1)
                       ) as match_date,
                       CASE WHEN EXISTS(
                         SELECT 1 FROM system_settings WHERE key='r1_ran_'||r.reserve_date
                       ) AND EXISTS(
                         SELECT 1 FROM matches WHERE match_round=1 AND match_date=r.reserve_date
                       ) THEN 1 ELSE 0 END as r1_ran_on_date,
                       CASE WHEN EXISTS(
                         SELECT 1 FROM system_settings WHERE key='r2_ran_'||r.reserve_date
                       ) AND EXISTS(
                         SELECT 1 FROM matches WHERE match_round=2 AND match_date=r.reserve_date
                       ) THEN 1 ELSE 0 END as r2_ran_on_date
                FROM reservations r
                LEFT JOIN users u ON r.user_id = u.id
                LEFT JOIN items i_type ON r.item_id = i_type.id AND r.item_id > 0
                WHERE {where_sql}
                ORDER BY r.reserve_date DESC, r.id DESC
                LIMIT ? OFFSET ?''', params + [per_page, offset]
        ).fetchall()
        return jsonify(reservations=[dict(row) for row in rows], total=total, page=page, per_page=per_page)
    finally:
        conn.close()

@app.route('/api/admin/add-reservation', methods=['POST'])
@jwt_required()
def admin_add_reservation():
    data = request.json or {}
    bar_type = data.get('bar_type','bronze')
    res_type = data.get('type', 'buy')
    count = int(data.get('count', 1))
    stage = int(data.get('stage', 1))
    conn = get_db()
    try:
        # loopay 계정 확인/승인
        loopay_user = conn.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay_user:
            # 기존 loopay를 approved=1로 업데이트
            _any_loopay = conn.execute("SELECT id FROM users WHERE username='loopay' ORDER BY id ASC").fetchone()
            if _any_loopay:
                conn.execute("UPDATE users SET approved=1 WHERE id=?", (_any_loopay['id'],))
                conn.commit()
                loopay_user = _any_loopay
            else:
                from werkzeug.security import generate_password_hash
                conn.execute("INSERT INTO users(username,password_hash,nickname,approved,level,charge_points,exchange_points) VALUES('loopay',?,'루페이',1,1,0,0)",
                             (generate_password_hash('loopay1234'),))
                conn.commit()
                loopay_user = conn.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        loopay_id = loopay_user['id']
        today = get_today().isoformat()
        match_round = int(data.get('match_round', 1))  # 기본 1차 매칭용
        join_round2_val = int(data.get('join_round2', 0))  # 2차 매칭 참가 여부
        today = get_today().isoformat()
        conn.execute("PRAGMA foreign_keys=OFF")
        for _ in range(count):
            if res_type == 'buy':
                # 구매예약: item_id=NULL (단계 미지정, 매칭 시 랜덤 판매아이템과 연결)
                conn.execute(
                    "INSERT INTO reservations (user_id, item_id, bar_type, match_round, reserve_date, status, stage, join_round2, confirmed) VALUES (?, 0, ?, ?, ?, 'pending', 0, ?, 0)",
                    (loopay_id, bar_type, match_round, today, join_round2_val)
                )
            else:
                # 판매예약: stage 범위 검증
                _stage_max_map = {'bronze': 20, 'silver': 16, 'gold': 14}
                _stage_max = _stage_max_map.get(bar_type, 20)
                if stage > _stage_max:
                    conn.rollback()
                    return jsonify(error=f'{bar_type} 판매예약 단계는 최대 {_stage_max}단계입니다.'), 400
                # 판매예약: 아이템 생성 후 item_id 연결, confirmed=0 (확정 버튼으로 확정)
                cur = conn.execute(
                    "INSERT INTO items(user_id, bar_type, stage, status, purchase_date, is_extra) VALUES(?,?,?,'waiting',?,1)",
                    (loopay_id, bar_type, stage, today)
                )
                item_id = cur.lastrowid
                conn.execute(
                    "INSERT INTO reservations (user_id, item_id, bar_type, match_round, reserve_date, status, stage, join_round2, confirmed) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, 0)",
                    (loopay_id, item_id, bar_type, match_round, today, stage, join_round2_val)
                )
        conn.execute("PRAGMA foreign_keys=ON")
        conn.commit()
        return jsonify({'success': True, 'added': count})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()

# == lucky matching ==
@app.route('/api/admin/run-lucky-matching', methods=['POST'])
@jwt_required()
def run_lucky_matching():
    data = request.json or {}
    bar_type = data.get('bar_type', 'bronze')
    round_num = int(data.get('round', 1))
    conn = get_db()
    try:
        matched = 0
        buy_list = conn.execute(
            'SELECT * FROM reservations WHERE bar_type=? AND type="buy" AND status="pending" ORDER BY created_at',
            (bar_type,)
        ).fetchall()
        # sell by stage range
        sell_ga = conn.execute(
            'SELECT r.* FROM reservations r JOIN items i ON r.item_id=i.id '
            'WHERE r.bar_type=? AND r.type="sell" AND r.status="pending" AND i.stage<=7 ORDER BY r.created_at',
            (bar_type,)
        ).fetchall()
        sell_na = conn.execute(
            'SELECT r.* FROM reservations r JOIN items i ON r.item_id=i.id '
            'WHERE r.bar_type=? AND r.type="sell" AND r.status="pending" AND i.stage BETWEEN 8 AND 11 ORDER BY r.created_at',
            (bar_type,)
        ).fetchall()
        sell_ra = conn.execute(
            'SELECT r.* FROM reservations r JOIN items i ON r.item_id=i.id '
            'WHERE r.bar_type=? AND r.type="sell" AND r.status="pending" AND i.stage>=16 ORDER BY r.created_at',
            (bar_type,)
        ).fetchall()
        buy_idx = 0
        for sr in sell_ga:
            if buy_idx + 2 > len(buy_list): break
            for b in buy_list[buy_idx:buy_idx+2]:
                conn.execute('UPDATE reservations SET status="matched" WHERE id=?', (b['id'],))
            conn.execute('UPDATE reservations SET status="matched" WHERE id=?', (sr['id'],))
            matched += 1; buy_idx += 2
        for sr in sell_na:
            if buy_idx >= len(buy_list): break
            conn.execute('UPDATE reservations SET status="matched" WHERE id=?', (buy_list[buy_idx]['id'],))
            conn.execute('UPDATE reservations SET status="matched" WHERE id=?', (sr['id'],))
            matched += 1; buy_idx += 1
        for sr in sell_ra:
            if buy_idx + 4 > len(buy_list): break
            for b in buy_list[buy_idx:buy_idx+4]:
                conn.execute('UPDATE reservations SET status="matched" WHERE id=?', (b['id'],))
            conn.execute('UPDATE reservations SET status="matched" WHERE id=?', (sr['id'],))
            matched += 1; buy_idx += 4
        conn.commit()
        return jsonify({'success': True, 'matched': matched})
    except Exception as e:
        conn.rollback()
        return jsonify({'error': str(e)}), 500
    finally:
        conn.close()


# ── 알림 API ────────────────────────────────────────────────
@app.route('/api/user/notifications', methods=['GET'])
@jwt_required()
def get_notifications():
    uid = int(get_jwt_identity())
    db = get_db()
    # mock 시간 기준으로 scheduled_at 필터링
    _now_str = get_now().strftime('%Y-%m-%d %H:%M:%S')
    try:
        rows = db.execute(
            """SELECT * FROM notifications
               WHERE user_id=?
               AND (scheduled_at IS NULL OR scheduled_at <= ?)
               ORDER BY created_at DESC LIMIT 50""",
            (uid, _now_str)
        ).fetchall()
    except Exception:
        # scheduled_at 컬럼 없으면 기본 쿼리
        rows = db.execute(
            "SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50",
            (uid,)
        ).fetchall()
    try:
        unread = db.execute(
            """SELECT COUNT(*) FROM notifications
               WHERE user_id=? AND is_read=0
               AND (scheduled_at IS NULL OR scheduled_at <= ?)""",
            (uid, _now_str)
        ).fetchone()[0]
    except Exception:
        unread = db.execute(
            "SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0",
            (uid,)
        ).fetchone()[0]
    db.close()
    return jsonify(notifications=[dict(r) for r in rows], unread=unread)

@app.route('/api/user/notifications/read', methods=['POST'])
@jwt_required()
def read_notifications():
    uid = int(get_jwt_identity())
    db = get_db()
    db.execute("UPDATE notifications SET is_read=1 WHERE user_id=?", (uid,))
    db.commit()
    db.close()
    return jsonify(success=True)


@app.route('/api/user/notifications/delete', methods=['POST'])
@jwt_required()
def delete_notifications():
    uid = int(get_jwt_identity())
    data = request.json or {}
    ids = data.get('ids', [])
    if not ids:
        return jsonify(error='삭제할 알림 ID가 없습니다'), 400
    db = get_db()
    try:
        placeholders = ','.join(['?' for _ in ids])
        db.execute(
            f"DELETE FROM notifications WHERE id IN ({placeholders}) AND user_id=?",
            ids + [uid]
        )
        db.commit()
    finally:
        db.close()
    return jsonify(success=True, deleted=len(ids))

@app.route('/api/admin/notify', methods=['POST'])
@jwt_required()
def admin_send_notify():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.get_json() or {}
    user_id = data.get('user_id')
    title = data.get('title', '관리자 알림')
    message = data.get('message', '')
    ntype = data.get('type', 'admin')
    db = get_db()
    if user_id:
        db.execute("INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)", (user_id, ntype, title, message))
    else:
        users = db.execute("SELECT id FROM users WHERE approved=1").fetchall()
        for u in users:
            db.execute("INSERT INTO notifications (user_id, type, title, message) VALUES (?, ?, ?, ?)", (u['id'], ntype, title, message))
    db.commit()
    db.close()
    return jsonify(success=True)


# ── 회원 일괄 삭제 ──────────────────────────────────────
@app.route('/api/admin/users/<int:uid>/update', methods=['POST'])
@jwt_required()
def admin_update_user(uid):
    """회원 레벨 / 누적예약횟수 수정"""
    identity = get_jwt_identity()
    if not identity.startswith('admin:'):
        return jsonify(error='Forbidden'), 403
    data = request.json or {}
    updates = {}
    if 'level' in data:
        v = int(data['level'])
        if v < 1 or v > 10:
            return jsonify(error='레벨은 1~10 사이여야 합니다'), 400
        updates['level'] = v
    if 'cumulative_count' in data:
        v = int(data['cumulative_count'])
        if v < 0:
            return jsonify(error='누적예약횟수는 0 이상이어야 합니다'), 400
        updates['cumulative_count'] = v
    if not updates:
        return jsonify(error='수정할 항목이 없습니다'), 400
    db = get_db()
    try:
        set_clause = ', '.join(f'{k}=?' for k in updates)
        db.execute(f'UPDATE users SET {set_clause} WHERE id=?', list(updates.values()) + [uid])
        db.commit()
        row = db.execute('SELECT id, username, level, cumulative_count FROM users WHERE id=?', (uid,)).fetchone()
        if not row:
            return jsonify(error='회원을 찾을 수 없습니다'), 404
        return jsonify(success=True, user=dict(row))
    finally:
        db.close()

@app.route('/api/admin/delete-users', methods=['POST'])
@jwt_required()
def admin_delete_users():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    uids = data.get('user_ids', [])
    db = get_db()
    try:
        db.execute("PRAGMA foreign_keys=OFF")
        if uids:
            for uid in uids:
                db.execute("DELETE FROM reservations WHERE user_id=?", (uid,))
                db.execute("DELETE FROM items WHERE user_id=?", (uid,))
                db.execute("DELETE FROM charge_requests WHERE user_id=?", (uid,))
                db.execute("DELETE FROM matches WHERE buyer_id=? OR seller_id=?", (uid, uid))
                db.execute("DELETE FROM lucky_buy_results WHERE seller_a_id=? OR seller_b_id=? OR buyer_id=?", (uid, uid, uid))
                db.execute("DELETE FROM users WHERE id=? AND username NOT IN ('admin','loopay')", (uid,))
        else:
            db.execute("DELETE FROM reservations WHERE user_id IN (SELECT id FROM users WHERE username NOT IN ('admin','loopay') AND approved=1)")
            db.execute("DELETE FROM items WHERE user_id IN (SELECT id FROM users WHERE username NOT IN ('admin','loopay') AND approved=1)")
            db.execute("DELETE FROM charge_requests WHERE user_id IN (SELECT id FROM users WHERE username NOT IN ('admin','loopay') AND approved=1)")
            db.execute("DELETE FROM matches")
            db.execute("DELETE FROM lucky_buy_results")
            db.execute("DELETE FROM users WHERE username NOT IN ('admin','loopay') AND approved=1")
        db.execute("PRAGMA foreign_keys=ON")
        db.commit()
        return jsonify(success=True, message=(str(len(uids)) if uids else '전체') + ' 회원 삭제 완료')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

# ── 매치 기록 조회 ──────────────────────────────────────
@app.route('/api/admin/matches', methods=['GET'])
@jwt_required()
def admin_get_matches():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        date_param = request.args.get('date', '')
        date_from  = request.args.get('date_from', '')
        date_to    = request.args.get('date_to', '')
        username   = request.args.get('username', '').strip()
        page       = int(request.args.get('page', 1))
        per_page   = int(request.args.get('per_page', 200))
        offset     = (page - 1) * per_page

        where = ['m.status != \'failed\'']  # failed(미입금) 매치는 매칭기록에서 제외
        params = []
        if date_param:
            where.append('m.match_date = ?'); params.append(date_param)
        else:
            if date_from:
                where.append('m.match_date >= ?'); params.append(date_from)
            if date_to:
                where.append('m.match_date <= ?'); params.append(date_to)
        if username:
            where.append('(b.username LIKE ? OR s.username LIKE ?)')
            params += ['%'+username+'%', '%'+username+'%']

        where_sql = ' AND '.join(where)
        total_row = db.execute(
            'SELECT COUNT(*) as cnt FROM matches m'
            ' LEFT JOIN users b ON m.buyer_id = b.id'
            ' LEFT JOIN users s ON m.seller_id = s.id'
            ' WHERE ' + where_sql, params
        ).fetchone()
        total = total_row['cnt'] if total_row else 0

        rows = db.execute(
            'SELECT m.id, m.match_date, m.bar_type, m.stage, m.match_round,'
            ' m.buy_price, m.sell_price, m.status, m.seller_id, m.seller_item_id, m.lucky_pair_id,'
            ' m.reservation_id as buyer_res_id,'
            ' b.username as buyer_username, b.nickname as buyer_nickname, b.phone as buyer_phone,'
            ' b.account_no as buyer_account, b.account_name as buyer_account_name,'
            ' s.username as seller_username, s.nickname as seller_nickname, s.phone as seller_phone,'
            ' s.bank as seller_bank, s.account_no as seller_account, s.account_name as seller_account_name'
            ' FROM matches m'
            ' LEFT JOIN users b ON m.buyer_id = b.id'
            ' LEFT JOIN users s ON m.seller_id = s.id'
            ' WHERE ' + where_sql +
            ' ORDER BY m.id DESC'
            ' LIMIT ? OFFSET ?', params + [per_page, offset]
        ).fetchall()
        names = {'bronze':'수정','silver':'루비','gold':'다이아'}
        # system_settings에서 loopay 정보 로드
        def get_sys(key):
            row = db.execute("SELECT value FROM system_settings WHERE key=?", (key,)).fetchone()
            return row['value'] if row else None
        loopay_bank  = get_sys('loopay_bank')
        loopay_acct  = get_sys('loopay_account')
        loopay_name  = get_sys('loopay_account_name')
        loopay_phone = get_sys('loopay_phone')

        def _build_buyer(r):
            _is_loopay = (r['buyer_username'] == 'loopay')
            phone = r['buyer_phone']
            account = r['buyer_account']
            account_name = r['buyer_account_name']
            bank = None
            if _is_loopay:
                phone = get_setting('loopay_phone', phone)
                account = get_setting('loopay_account', account)
                account_name = get_setting('loopay_account_name', account_name or '루페이')
                bank = get_setting('loopay_bank', bank)
            return {'username': r['buyer_username'], 'nickname': r['buyer_nickname'],
                    'phone': phone, 'account': account, 'account_name': account_name, 'bank': bank}

        def build_seller(r):
            if r['seller_username'] == 'loopay':
                return {
                    'username': 'loopay',
                    'nickname': r['seller_nickname'] or '루페이',
                    'phone': loopay_phone or r['seller_phone'],
                    'bank': loopay_bank or r['seller_bank'],
                    'account': loopay_acct or r['seller_account'],
                    'account_name': loopay_name or r['seller_account_name'],
                }
            return {
                'username': r['seller_username'], 'nickname': r['seller_nickname'],
                'phone': r['seller_phone'], 'bank': r['seller_bank'],
                'account': r['seller_account'], 'account_name': r['seller_account_name'],
            }

        return jsonify(matches=[{
            'id': r['id'], 'match_date': r['match_date'],
            'bar_type': r['bar_type'], 'bar_name': names.get(r['bar_type'], r['bar_type']),
            'stage': r['stage'], 'match_round': r['match_round'],
            'buy_price': r['buy_price'], 'sell_price': r['sell_price'], 'status': r['status'],
            'seller_id': r['seller_id'] if 'seller_id' in r.keys() else None,
            'seller_item_id': r['seller_item_id'] if 'seller_item_id' in r.keys() else None,
            'lucky_pair_id': r['lucky_pair_id'] if 'lucky_pair_id' in r.keys() else None,
            'buyer_res_id': r['buyer_res_id'] if 'buyer_res_id' in r.keys() else None,
            'buyer': _build_buyer(r),
            'seller': build_seller(r),
        } for r in rows])
    finally:
        db.close()

# ── 매치 기록 삭제 ──────────────────────────────────────
@app.route('/api/admin/delete-matches', methods=['POST'])
@jwt_required()
def admin_delete_matches():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    match_ids = data.get('match_ids', [])
    db = get_db()
    try:
        if match_ids:
            for mid in match_ids:
                db.execute("DELETE FROM matches WHERE id=?", (mid,))
        else:
            db.execute("DELETE FROM matches")
        db.commit()
        return jsonify(success=True, message=(str(len(match_ids)) if match_ids else '전체') + ' 매칭 기록 삭제 완료')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

# ── 판매자: 입금확인 ──────────────────────────────────
@app.route('/api/match/confirm-payment', methods=['POST'])
@jwt_required()
def match_confirm_payment():
    identity = get_jwt_identity()
    is_admin = str(identity).startswith('admin:')
    uid = None if is_admin else int(identity)
    data = request.json or {}
    match_id = int(data.get('match_id', 0))
    db = get_db()
    try:
        # 관리자는 seller_id 체크 없이, 일반 사용자는 seller_id 체크
        # 시간 체크: 1차 05:00~13:00, 2차 15:00~19:00 (관리자 제외)
        if not is_admin:
            _now = get_now()
            _h, _mn = _now.hour, _now.minute
            _total = _h*60+_mn
        if is_admin:
            # 관리자는 pending/paid 모두 입금확인 가능 (직접 확인)
            m = db.execute(
                "SELECT * FROM matches WHERE id=? AND status IN ('pending','paid')",
                (match_id,)
            ).fetchone()
        else:
            m = db.execute(
                "SELECT * FROM matches WHERE id=? AND seller_id=? AND status='paid'",
                (match_id, uid)
            ).fetchone()
        if not m:
            return jsonify(error='처리 불가'), 400
        # 시간 창 체크 (관리자 제외): 1차 05:00~13:00, 2차 15:00~19:00
        # paid 상태(loopay 송금완료)면 시간 무관 허용
        if not is_admin and dict(m).get('status') != 'paid':
            _now = get_now()
            _h, _mn = _now.hour, _now.minute
            _total = _h*60+_mn
            _mround = m['match_round'] or 1
            if _mround == 1 and not (300 <= _total < 840):
                return jsonify(error='입금확인은 05:00~14:00 사이에만 가능합니다'), 400
            if _mround == 2 and not (900 <= _total < 1140):
                return jsonify(error='입금확인은 15:00~19:00 사이에만 가능합니다'), 400

        bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}
        bar_name = bar_names.get(m['bar_type'], m['bar_type'])

        # 1. match → confirmed
        # 이미지 파일 삭제 (확인 후 보안 목적으로 삭제)
        if m['receipt_url']:
            try:
                _img_file = os.path.join(os.path.dirname(__file__), m['receipt_url'].lstrip('/'))
                if os.path.exists(_img_file):
                    os.remove(_img_file)
            except Exception:
                pass
        db.execute("UPDATE matches SET status='confirmed', confirmed_at=datetime('now','localtime'), receipt_url=NULL WHERE id=?", (match_id,))

        # 2. 판매예약 → sold, 구매예약 → confirmed
        _m = dict(m)
        if _m.get('reservation_id'):
            try:
                db.execute("UPDATE reservations SET status='sold' WHERE id=?", (_m['reservation_id'],))
            except Exception:
                try:
                    db.execute("UPDATE reservations SET status='confirmed' WHERE id=?", (_m['reservation_id'],))
                except Exception:
                    pass
        # 구매예약(buyer_res_id) → confirmed 상태로 업데이트
        if _m.get('buyer_res_id'):
            try:
                db.execute("UPDATE reservations SET status='confirmed' WHERE id=?", (_m['buyer_res_id'],))
            except Exception:
                pass

        # 3. item을 buyer에게 이전 (seller 아이템은 sold, buyer에게 새 아이템 추가)
        # 행운구매 매치는 step 3 스킵 (행운구매 완료 처리에서 새 아이템 생성)
        _is_lucky_match = bool(dict(m).get('lucky_pair_id'))
        from datetime import date as _date
        # seller 아이템 찾기: match_id와 연결된 loopay reservation → item
        # loopay 계정 ID 조회
        _loopay_row = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        loopay_id = _loopay_row['id'] if _loopay_row else None
        seller_item = None
        # loopay 판매예약(reservation)에서 이 match와 연결된 아이템 찾기
        # loopay의 reservation은 buyer의 reservation_id와 다름
        # → loopay의 reservations 중 bar_type+stage가 일치하고 이 match와 연결된 것
        # seller_item_id가 match에 저장되어 있으면 정확히 사용
        if dict(m).get('seller_item_id'):
            seller_item = db.execute(
                "SELECT id, bar_type, stage FROM items WHERE id=? AND status='matched'",
                (m['seller_item_id'],)
            ).fetchone()
        if not seller_item:
            # fallback: match.reservation_id → reservation.item_id 경로 (정확한 매핑)
            if m['reservation_id']:
                seller_res = db.execute(
                    "SELECT item_id FROM reservations WHERE id=? AND item_id IS NOT NULL",
                    (m['reservation_id'],)
                ).fetchone()
                if seller_res and seller_res['item_id']:
                    seller_item = db.execute(
                        "SELECT id, bar_type, stage FROM items WHERE id=?",
                        (seller_res['item_id'],)
                    ).fetchone()
        if not seller_item:
            # last fallback: matches 테이블의 seller_item_id로 직접 조회 (status 무관)
            # ORDER BY id ASC LIMIT 1 방식은 다른 매치의 아이템을 잘못 선택할 수 있으므로 제거
            if dict(m).get('seller_item_id'):
                seller_item = db.execute(
                    "SELECT id, bar_type, stage FROM items WHERE id=?",
                    (m['seller_item_id'],)
                ).fetchone()
        # 최종 fallback: loopay 판매자인 경우 bar_type+match_date로 판매예약 아이템 찾기
        if not seller_item and m['seller_id'] == loopay_id:
            _loopay_sell_res = db.execute(
                """SELECT r.item_id FROM reservations r
                   INNER JOIN items i ON r.item_id=i.id
                   WHERE r.user_id=? AND r.bar_type=? AND r.confirmed=1
                   AND r.item_id IS NOT NULL AND r.item_id > 0
                   AND r.status IN ('matched','sold','pending')
                   AND i.status IN ('matched','reservable','waiting')
                   ORDER BY r.id DESC LIMIT 1""",
                (loopay_id, m['bar_type'])
            ).fetchone()
            if _loopay_sell_res and _loopay_sell_res['item_id']:
                seller_item = db.execute(
                    "SELECT id, bar_type, stage FROM items WHERE id=?",
                    (_loopay_sell_res['item_id'],)
                ).fetchone()

        if seller_item:
            # seller 아이템 sold 처리 (행운구매는 행운구매 완료 처리에서 sold 처리하므로 스킵)
            if not _is_lucky_match:
                db.execute("UPDATE items SET status='sold' WHERE id=?", (seller_item['id'],))
            # buyer에게 새 아이템 추가 (행운구매는 완료 시 별도 처리하므로 스킵)
            # buyer 아이템은 'active'(보유중) 상태로 추가
            _stage = int(seller_item['stage'] or m['stage'] or 1) + 1  # 1단계 구매 → 2단계 아이템 획득
            # loopay가 buyer인 경우 아이템 추가 스킵 (시스템 내부 구매예약이므로)
            _buyer_is_loopay = (m['buyer_id'] == loopay_id)
            # 아이템 추가: reservable 상태로 (입금확인일 = 1일차)
            _inserted = _is_lucky_match  # 행운구매는 추가 스킵 (완료 처리에서 생성)
            _insert_err = None
            # loopay가 buyer인 경우: 구매 reservation의 item_id 아이템 stage+1 업데이트
            if _buyer_is_loopay:
                try:
                    _lr = db.execute(
                        "SELECT item_id FROM reservations WHERE id=?", (m['reservation_id'],)
                    ).fetchone()
                    _loopay_item_id = _lr['item_id'] if _lr else None
                    if not _loopay_item_id:
                        # reservation에 item_id 없으면 loopay 소유 waiting 아이템에서 찾기
                        _li = db.execute(
                            """SELECT id FROM items WHERE user_id=? AND bar_type=? AND status='waiting'
                               ORDER BY id ASC LIMIT 1""",
                            (loopay_id, seller_item['bar_type'] if seller_item else m['bar_type'])
                        ).fetchone()
                        _loopay_item_id = _li['id'] if _li else None
                    if _loopay_item_id:
                        db.execute(
                            "UPDATE items SET stage=?, status='reservable', purchase_date=?, is_extra=0 WHERE id=? AND user_id=?",
                            (_stage, get_today().isoformat(), _loopay_item_id, loopay_id)
                        )
                    else:
                        # 아이템 새로 생성
                        db.execute(
                            "INSERT INTO items(user_id,bar_type,stage,status,purchase_date,is_extra) VALUES(?,?,?,'reservable',?,0)",
                            (loopay_id, m['bar_type'], _stage, get_today().isoformat())
                        )
                    _inserted = True
                except Exception as _le:
                    _insert_err = str(_le)
            if not _buyer_is_loopay and not _is_lucky_match:
              for _item_status in ('reservable', 'active', 'waiting', 'matched'):
                try:
                    db.execute(
                        """INSERT INTO items(user_id, bar_type, stage, purchase_date, status)
                           VALUES(?, ?, ?, ?, ?)""",
                        (m['buyer_id'], seller_item['bar_type'], _stage,
                         get_today().isoformat(), _item_status)
                    )
                    _inserted = True
                    break
                except Exception as _e:
                    _insert_err = str(_e)
                    continue
            # INSERT 실패 시 stage/status 없는 최소 형태로 재시도
            if not _inserted:
                try:
                    # status 컬럼 없이 삽입 시도 (DEFAULT 사용)
                    db.execute(
                        "INSERT INTO items(user_id, bar_type, stage, purchase_date) VALUES(?,?,?,?)",
                        (m['buyer_id'], seller_item['bar_type'], _stage, get_today().isoformat())
                    )
                    _inserted = True
                except Exception as _e2:
                    # 최후 수단: stage 없이
                    try:
                        db.execute(
                            "INSERT INTO items(user_id, bar_type, stage, purchase_date, status) VALUES(?,?,?,?,?)",
                            (m['buyer_id'], seller_item['bar_type'], 1, get_today().isoformat(), 'waiting')
                        )
                        _inserted = True
                    except Exception:
                        pass

        # 4. 구매자 알림 - 입금확인 완료 (즉시 발송)
        _buyer_msg = (
            f"✅ {bar_name} {m['stage']}단계 입금이 확인되었습니다.\n"
            f"\n📦 아이템이 지급되었습니다.\n"
            f"• 아이템: {bar_name} {m['stage']}단계\n"
            f"• 구매 완료일: {get_today().strftime('%Y-%m-%d')}\n"
            f"\n아이템 현황에서 보유 아이템을 확인하세요."
        )
        try:
            insert_notification(db, m['buyer_id'], 'confirmed', f'{bar_name} 입금확인 완료', _buyer_msg)
        except Exception:
            pass

        # 5. 판매자 알림 - 다음날 5:00에 발송
        try:
            db.execute("INSERT INTO notifications(user_id,type,title,message,scheduled_at) VALUES(?,?,?,?,?)",
                (m['seller_id'], 'confirmed', '송금 확인 완료',
                 f'{bar_name} {m["stage"]}단계 판매 완료. 구매자 입금 확인되었습니다.',
                 _tomorrow_5am))
        except Exception:
            insert_notification(db, m['seller_id'], 'confirmed', '송금 확인 완료', f'{bar_name} {m["stage"]}단계 판매 완료. 구매자 입금 확인되었습니다.')

        # 5. 판매자 포인트 지급 (판매금액 기준)
        try:
            _sell_p = dict(m).get('sell_price') or 0
            if _sell_p and m['seller_id']:
                # 포인트 지급: sell_price 금액을 exchange_points로 지급
                db.execute(
                    "UPDATE users SET exchange_points=exchange_points+? WHERE id=?",
                    (_sell_p, m['seller_id'])
                )
        except Exception:
            pass

        # 6. 구매자 cumulative_count +1 + 레벨업 체크
        try:
            db.execute("UPDATE users SET cumulative_count=cumulative_count+1 WHERE id=?", (m['buyer_id'],))
            db.commit()
            leveled = check_and_level_up(db, m['buyer_id'])
        except Exception:
            pass
        # 7. loopay buyer: step 3에서 stage+1+reservable 처리 완료

        # 행운구매 처리: lucky_pair_id 있는 매치는 양쪽 모두 confirmed이면 새 아이템 생성
        _m_dict = dict(m)
        _lucky_pair_id = _m_dict.get('lucky_pair_id')
        if _lucky_pair_id:
            _lbr = db.execute(
                "SELECT * FROM lucky_buy_results WHERE id=? AND status='confirmed'",
                (_lucky_pair_id,)
            ).fetchone()
            if _lbr and not _lbr['new_item_id']:
                _pair_matches = db.execute(
                    "SELECT status FROM matches WHERE lucky_pair_id=?",
                    (_lucky_pair_id,)
                ).fetchall()
                _all_confirmed = all(pm['status'] == 'confirmed' for pm in _pair_matches)
                if _all_confirmed:
                    from db import BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES
                    _pm = {
                        'bronze': {s:(b,sl) for s,b,sl in BRONZE_PRICES},
                        'silver': {s:(b,sl) for s,b,sl in SILVER_PRICES},
                        'gold':   {s:(b,sl) for s,b,sl in GOLD_PRICES},
                    }
                    _bt = _lbr['bar_type']
                    _ns = _lbr['new_stage']
                    _nb, _nsl = _pm[_bt].get(_ns, (0,0))
                    # 구매자 ID (매치에서)
                    _new_buyer_id = _m_dict['buyer_id']
                    # 새 아이템 생성
                    _new_iid = db.execute(
                        "INSERT INTO items(user_id,bar_type,stage,status,purchase_date) VALUES(?,?,?,'reservable',?)",
                        (_new_buyer_id, _bt, _ns, get_today().isoformat())
                    ).lastrowid
                    # lucky_buy_results 업데이트
                    db.execute(
                        "UPDATE lucky_buy_results SET new_item_id=?, buyer_id=?, status='completed' WHERE id=?",
                        (_new_iid, _new_buyer_id, _lucky_pair_id)
                    )
                    # 기존 두 판매자 아이템 sold 처리
                    db.execute("UPDATE items SET status='sold' WHERE id=? OR id=?",
                               (_lbr['item_a_id'], _lbr['item_b_id']))
                    # 구매자에게 잘못 생성된 아이템 삭제
                    # id > new_item_id 이고 오늘 생성된 것만 (새 코드로 새 아이템 없으므로 공백)
                    pass
                    # 두 판매예약 matched 처리
                    db.execute(
                        "UPDATE reservations SET status='matched' WHERE lucky_pair_id=? AND status='pending'",
                        (_lucky_pair_id,)
                    )

        db.commit()
        return jsonify(success=True, message='거래 완료')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

# ── 판매자: 미입금 신고 ──────────────────────────────
@app.route('/api/match/report-unpaid', methods=['POST'])
@jwt_required()
def match_report_unpaid():
    identity = get_jwt_identity()
    is_admin = str(identity).startswith('admin:')
    uid = None if is_admin else int(identity)
    data = request.json or {}
    match_id = int(data.get('match_id', 0))
    db = get_db()
    try:
        if is_admin:
            m = db.execute(
                "SELECT * FROM matches WHERE id=? AND status IN ('pending','paid')",
                (match_id,)
            ).fetchone()
        else:
            m = db.execute(
                "SELECT * FROM matches WHERE id=? AND seller_id=? AND status IN ('pending','paid')",
                (match_id, uid)
            ).fetchone()
        if not m:
            return jsonify(error='처리 불가'), 400
        # 시간 체크: 1차 12:30~13:00, 2차 18:30~19:00
        _now = get_now()
        _h, _min = _now.hour, _now.minute
        _total = _h*60+_min
        _mround = m['match_round'] or 1
        if not is_admin:
            if _mround == 1 and not (750 <= _total < 780):
                return jsonify(error='입금요청은 12:30~13:00 사이에만 가능합니다'), 400
            if _mround == 2 and not (1110 <= _total < 1140):
                return jsonify(error='입금요청은 18:30~19:00 사이에만 가능합니다'), 400
        bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}
        bar_name = bar_names.get(m['bar_type'], m['bar_type'])
        # 입금요청: status 변경 없이 알림만 발송
        try:
            insert_notification(db, m['buyer_id'], 'payment_request', '입금 요청', f'{bar_name} {m["stage"]}단계 아이템 입금을 요청합니다.\n'
                 f'입금 후 송금완료 버튼을 눌러주세요.\n'
                 f'미입금 시 매칭이 취소될 수 있습니다.')
        except Exception:
            pass
        # reservations status는 유지 (입금요청 단계)
        try:
            pass  # db.execute("UPDATE reservations SET status='unpaid'...) 생략
        except Exception:
            pass
        # 관리자 알림
        seller = db.execute("SELECT nickname, username FROM users WHERE id=?", (uid,)).fetchone()
        seller_name = seller['nickname'] or seller['username'] if seller else '판매자'
        # 판매자(loopay)에게 미입금 알림
        insert_notification(db, m['seller_id'], 'unpaid', '미입금 알림', f'매치 #{match_id} 구매자 미입금 알림이 발송됐습니다. 13:00까지 미입금 확정 가능합니다.')
        # 구매자에게 미입금 알림
        buyer_row = db.execute("SELECT nickname, username FROM users WHERE id=?", (m['buyer_id'],)).fetchone()
        buyer_name_str = buyer_row['nickname'] or buyer_row['username'] if buyer_row else '구매자'
        bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}
        bar_n = bar_names.get(m['bar_type'], m['bar_type'])
        insert_notification(db, m['buyer_id'], 'unpaid', '미입금 알림', f'{bar_n} {m["stage"]}단계 거래에서 미입금이 확인됐습니다. 확인 바랍니다.')
        db.commit()
        return jsonify(success=True, message='미입금 신고 완료')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

# ── 관리자: 미입금확정 (13:00~14:00) ────────────────────────
@app.route('/api/user/confirm-unpaid', methods=['POST'])
@jwt_required()
def user_confirm_unpaid():
    """판매자(사용자 또는 loopay)가 미입금 버튼 클릭 → admin_confirm_unpaid와 동일한 후처리"""
    identity = get_jwt_identity()
    if str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    uid = int(identity)
    data = request.json or {}
    match_id = int(data.get('match_id', 0))
    db = get_db()
    try:
        # 판매자 본인 또는 loopay 계정 허용
        loopay_row = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        loopay_id = loopay_row['id'] if loopay_row else -1
        m = db.execute(
            "SELECT * FROM matches WHERE id=? AND status IN ('pending','paid')",
            (match_id,)
        ).fetchone()
        if not m:
            return jsonify(error='처리 불가 (매칭 없음 또는 상태 오류)'), 400
        # 시간 체크: 1차 13:00~14:00, 2차 19:00~20:00
        _now = get_now()
        _h, _mn = _now.hour, _now.minute
        _total = _h*60+_mn
        _mround = m['match_round'] or 1
        if _mround == 1 and not (780 <= _total < 840):
            return jsonify(error='미입금 확인은 13:00~14:00 사이에만 가능합니다'), 400
        if _mround == 2 and not (1140 <= _total < 1200):
            return jsonify(error='미입금 확인은 19:00~20:00 사이에만 가능합니다'), 400
        # 판매자 본인이거나 loopay 계정만 허용
        seller_id = m['seller_id'] if 'seller_id' in m.keys() else None
        if uid != loopay_id and uid != seller_id:
            return jsonify(error='권한 없음'), 403

        bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}

        # 1. match status → failed
        db.execute("UPDATE matches SET status='failed' WHERE id=?", (match_id,))

        # 2. 구매예약 → 미입금 상태로 (status=matched 유지, match_status=failed로 표시됨)
        # reservation_id와 buyer_res_id 모두 처리
        _buy_res_ids = set()
        if m['reservation_id']: _buy_res_ids.add(m['reservation_id'])
        _m = dict(m)
        if _m.get('buyer_res_id'): _buy_res_ids.add(_m['buyer_res_id'])
        for _brid in _buy_res_ids:
            db.execute("UPDATE reservations SET status='matched' WHERE id=?", (_brid,))
        # 판매예약 → 2차 매칭 대기 (items도 reservable로 복원)
        if _m.get('seller_item_id'):
            db.execute("UPDATE items SET status='reservable' WHERE id=?", (_m['seller_item_id'],))

        # 3. loopay 판매 아이템 → reservable + 2차 sell 예약 생성
        _seller_uid = loopay_id or seller_id
        seller_item = db.execute(
            """SELECT id FROM items WHERE user_id=? AND bar_type=? AND status='matched'
               ORDER BY id DESC LIMIT 1""",
            (_seller_uid, m['bar_type'])
        ).fetchone() if _seller_uid else None
        if seller_item:
            db.execute("UPDATE items SET status='reservable' WHERE id=?", (seller_item['id'],))
            _today = get_today().isoformat()
            _stage = m['stage'] or 1
            _dup = db.execute(
                """SELECT id FROM reservations WHERE user_id=? AND bar_type=? AND stage=?
                   AND match_round=2 AND status='pending' AND reserve_date=? AND item_id=?""",
                (_seller_uid, m['bar_type'], _stage, _today, seller_item['id'])
            ).fetchone()
            if not _dup:
                db.execute(
                    """INSERT INTO reservations(user_id,bar_type,stage,match_round,status,reserve_date,confirmed,item_id)
                       VALUES(?,?,?,2,'pending',?,1,?)""",
                    (_seller_uid, m['bar_type'], _stage, _today, seller_item['id'])
                )

        # 4. 구매자 패널티 처리
        buyer_id = m['buyer_id']
        if buyer_id:
            buyer_row = db.execute("SELECT unpaid_count FROM users WHERE id=?", (buyer_id,)).fetchone()
            current_count = int(buyer_row['unpaid_count'] or 0) + 1 if buyer_row else 1
            penalty_entry = next((p for p in PENALTY_TABLE if p[0] == current_count), PENALTY_TABLE[-1])
            suspend_days = penalty_entry[1]
            release_pts  = penalty_entry[2]
            _now_str  = get_now().strftime('%Y-%m-%d %H:%M:%S')
            from datetime import timedelta
            _release_dt = get_now() + timedelta(days=suspend_days)
            _release_str = _release_dt.strftime('%Y-%m-%d %H:%M:%S')
            db.execute("UPDATE users SET unpaid_count=?, suspended_until=? WHERE id=?",
                       (current_count, _release_str, buyer_id))
            db.execute(
                """INSERT INTO penalties(user_id,unpaid_count,suspend_days,release_points,is_released,created_at,match_id,match_round)
                   VALUES(?,?,?,?,0,?,?,?)""",
                (buyer_id, current_count, suspend_days, release_pts, _now_str, match_id, m['match_round'] or 1)
            )
            # 미입금 구매자 2차 예약 제외
            db.execute("UPDATE reservations SET status='unmatched' WHERE user_id=? AND match_round=2 AND status='pending'",
                       (buyer_id,))
            try:
                insert_notification(db, buyer_id, 'unpaid_penalty', '미입금 패널티',
                    f'{bar_names.get(m["bar_type"],m["bar_type"])} 거래 미입금이 확정됐습니다. 거래가 정지됩니다.')
            except Exception:
                pass

        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/confirm-unpaid', methods=['POST'])
@jwt_required()
def admin_confirm_unpaid():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'):
        return jsonify(error='Forbidden'), 403
    data = request.json or {}
    match_id = int(data.get('match_id', 0))
    db = get_db()
    try:
        m = db.execute(
            "SELECT * FROM matches WHERE id=? AND status IN ('pending','paid','confirmed','failed')",
            (match_id,)
        ).fetchone()
        if not m:
            return jsonify(error='처리 불가'), 400

        bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}
        bar_name = bar_names.get(m['bar_type'], m['bar_type'])

        # 1. match status → failed (미입금확정)
        db.execute("UPDATE matches SET status='failed' WHERE id=?", (match_id,))

        # 2. 구매예약 → 미입금 상태 유지 (status=matched, ms=failed로 표시)
        # buyer_res_id도 처리
        _buy_res_ids = set()
        if m['reservation_id']: _buy_res_ids.add(m['reservation_id'])
        _m2 = dict(m)
        if _m2.get('buyer_res_id'): _buy_res_ids.add(_m2['buyer_res_id'])
        for _brid in _buy_res_ids:
            db.execute("UPDATE reservations SET status='matched' WHERE id=?", (_brid,))
        # 판매아이템 → reservable 복원
        if _m2.get('seller_item_id'):
            db.execute("UPDATE items SET status='reservable' WHERE id=?", (_m2['seller_item_id'],))

        # 3. 판매 아이템 → reservable + 2차 sell 예약 생성 (모든 seller)
        _seller_uid = m['seller_id'] if 'seller_id' in m.keys() and m['seller_id'] else None
        # seller_id가 없으면 seller_item_id로 user_id 역추적
        if not _seller_uid and 'seller_item_id' in m.keys() and m['seller_item_id']:
            _si_row = db.execute("SELECT user_id FROM items WHERE id=?", (m['seller_item_id'],)).fetchone()
            if _si_row: _seller_uid = _si_row['user_id']
        seller_item = None
        if 'seller_item_id' in m.keys() and m['seller_item_id']:
            seller_item = db.execute("SELECT id FROM items WHERE id=?", (m['seller_item_id'],)).fetchone()
        if not seller_item and _seller_uid:
            seller_item = db.execute(
                """SELECT id FROM items WHERE user_id=? AND bar_type=? AND status='matched'
                   ORDER BY id DESC LIMIT 1""",
                (_seller_uid, m['bar_type'])
            ).fetchone()
        if seller_item:
            db.execute("UPDATE items SET status='reservable' WHERE id=?", (seller_item['id'],))
            # 2차 sell 예약: reserve_date = 매치의 match_date 기준 (서버날짜 아님)
            _today = m['match_date'] if m['match_date'] else get_today().isoformat()
            _stage = m['stage'] or 1
            _dup = db.execute(
                """SELECT id FROM reservations WHERE user_id=? AND bar_type=? AND stage=?
                   AND match_round=2 AND status='pending' AND reserve_date=? AND item_id=?""",
                (_seller_uid, m['bar_type'], _stage, _today, seller_item['id'])
            ).fetchone()
            if not _dup:
                db.execute(
                    """INSERT INTO reservations(user_id,bar_type,stage,match_round,status,reserve_date,confirmed,item_id)
                       VALUES(?,?,?,2,'pending',?,1,?)""",
                    (_seller_uid, m['bar_type'], _stage, _today, seller_item['id'])
                )

        # 4. 구매자 패널티 처리
        buyer_id = m['buyer_id']
        buyer_row = db.execute("SELECT unpaid_count, charge_points, exchange_points FROM users WHERE id=?", (buyer_id,)).fetchone()
        current_count = int(buyer_row['unpaid_count'] or 0) + 1 if buyer_row else 1
        # PENALTY_TABLE: [(count, days, release_points), ...]
        penalty_entry = next((p for p in PENALTY_TABLE if p[0] == current_count), PENALTY_TABLE[-1])
        suspend_days = penalty_entry[1]
        release_pts  = penalty_entry[2]
        # 정지 시작 = 지금, 정지 해제 = +suspend_days일 후
        _now_str  = get_now().strftime('%Y-%m-%d %H:%M:%S')
        from datetime import timedelta
        _release_dt = get_now() + timedelta(days=suspend_days)
        _release_str = _release_dt.strftime('%Y-%m-%d %H:%M:%S')
        # users 정지 처리
        db.execute("UPDATE users SET unpaid_count=?, suspended_until=? WHERE id=?",
                   (current_count, _release_str, buyer_id))
        # penalties 기록
        db.execute(
            """INSERT INTO penalties(user_id,unpaid_count,suspend_days,release_points,is_released,created_at,match_id,match_round)
               VALUES(?,?,?,?,0,?,?,?)""",
            (buyer_id, current_count, suspend_days, release_pts, _now_str, match_id, m['match_round'] or 1)
        )
        # 2차 매칭 구매예약 제거 (미입금 구매자 2차 제외)
        db.execute("UPDATE reservations SET status='unmatched' WHERE user_id=? AND match_round=2 AND status='pending'",
                   (buyer_id,))
        # 구매자 알림 - 패널티 내용 포함
        _notif_msg = (
            f'{bar_name} {m["stage"]}단계 거래 미입금이 확정됐습니다.\n\n'
            f'⚠️ 패널티 안내 (누적 {current_count}회)\n'
            f'• 거래 정지 기간: {suspend_days}일 ({_now_str[:10]} ~ {_release_str[:10]})\n'
            f'• 해제 포인트: {release_pts:,}P\n\n'
            f'해제 포인트 충전 후 [패널티] 탭에서 해제 버튼을 눌러주세요.\n'
            f'정지 기간 종료 후 4일차부터 거래가 재개됩니다.'
        )
        insert_notification(db, buyer_id, 'penalty', '거래 정지 안내', _notif_msg)

        db.commit()
        return jsonify(success=True, message=f'미입금 확정, 패널티 {suspend_days}일 정지 처리 완료',
                       penalty={'days':suspend_days,'release_points':release_pts,'count':current_count})
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


# ── 시스템(loopay) 아이템 현황 조회 ──────────────────
@app.route('/api/user/my-items', methods=['GET'])
@jwt_required()
def user_my_items():
    identity = get_jwt_identity()
    if str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    uid = int(identity)
    db = get_db()
    try:
        # 아이템 목록
        items = db.execute(
            """SELECT i.id, i.bar_type, i.stage, i.status, i.purchase_date,
               (SELECT MAX(r2.reserve_date) FROM reservations r2 WHERE r2.item_id=i.id) as reserve_date
               FROM items i
               WHERE i.user_id=? AND (
                 i.status NOT IN ('sold','active')
                 OR EXISTS (
                   SELECT 1 FROM matches m
                   JOIN users ub ON m.buyer_id=ub.id
                   WHERE m.seller_item_id=i.id
                   AND ub.username='loopay'
                   AND m.status IN ('pending','paid')
                 )
               )
               ORDER BY i.id DESC""",
            (uid,)
        ).fetchall()
        result = []
        for item in items:
            row = dict(item)
            # 매칭 정보
            match_status = None
            match_round = None
            buyer_username = None
            buyer_account_name = None
            buyer_account = None
            # reservation에서 match 찾기
            # reservation에서 item_id 기준 최신 예약 찾기
            res = db.execute(
                """SELECT r.reserve_date, r.match_round
                   FROM reservations r
                   WHERE r.item_id=? ORDER BY r.id DESC LIMIT 1""",
                (row['id'],)
            ).fetchone()
            if res:
                if not row.get('reserve_date') and res['reserve_date']:
                    row['reserve_date'] = res['reserve_date']
            # match 찾기: seller_id=uid, bar_type+stage 일치
            # match 조회: seller_item_id 우선, 없으면 seller_id+bar_type+stage
            # status='matched'/'sold' 아이템만 (reservable은 연결 안 함)
            m = None
            if row['status'] in ('matched', 'sold', 'pending', 'reservable') or item_status in ('lucky_matched','lucky_waiting'):
                try:
                    # 1순위: seller_item_id=item.id (정확한 1:1 연결)
                    m = db.execute(
                        """SELECT m.id, m.status, m.match_round,
                                  u.username as buyer_username,
                                  u.account_name as buyer_account_name,
                                  u.account_no as buyer_account
                           FROM matches m
                           LEFT JOIN users u ON m.buyer_id=u.id
                           WHERE m.seller_item_id=?
                             AND m.status NOT IN ('cancelled')
                           ORDER BY m.id DESC LIMIT 1""",
                        (row['id'],)
                    ).fetchone()
                    # 2순위: seller_id+bar_type+stage (seller_item_id 없는 구 데이터)
                    if not m:
                        m = db.execute(
                            """SELECT m.id, m.status, m.match_round,
                                      u.username as buyer_username,
                                      u.account_name as buyer_account_name,
                                      u.account_no as buyer_account
                               FROM matches m
                               LEFT JOIN users u ON m.buyer_id=u.id
                               WHERE m.seller_id=?
                                 AND m.bar_type=?
                                 AND COALESCE(m.stage,1)=COALESCE(?,1)
                                 AND m.status NOT IN ('cancelled')
                                 AND (m.seller_item_id IS NULL OR m.seller_item_id=?)
                               ORDER BY m.id DESC LIMIT 1""",
                            (uid, row['bar_type'], row['stage'] or 1, row['id'])
                        ).fetchone()
                except Exception:
                    m = None
            if m:
                match_status = m['status']
                match_round = m['match_round']
                buyer_username = m['buyer_username']
                buyer_account_name = m['buyer_account_name']
                buyer_account = m['buyer_account']
                try:
                    r_row = db.execute('SELECT receipt_url FROM matches WHERE id=?', (m['id'],)).fetchone()
                    row['receipt_url'] = r_row['receipt_url'] if r_row else None
                except Exception:
                    row['receipt_url'] = None
            # reservation 상태 반영 (아이템 status가 reservable이어도 예약중이면 표시)
            item_status = row['status']
            if item_status == 'reservable':
                pending_res = db.execute(
                    """SELECT id, lucky_pair_id, status FROM reservations
                       WHERE item_id=? AND status IN ('pending','matched')
                       ORDER BY CASE status WHEN 'matched' THEN 0 ELSE 1 END
                       LIMIT 1""",
                    (row['id'],)
                ).fetchone()
                if pending_res:
                    item_status = 'pending' if pending_res['status']=='pending' else 'matched'
                    _lp_id = pending_res['lucky_pair_id']
                    if _lp_id:
                        _mc_cnt = db.execute(
                            "SELECT COUNT(*) as c FROM matches WHERE lucky_pair_id=? AND status IN ('pending','paid')",
                            (_lp_id,)
                        ).fetchone()['c']
                        item_status = 'lucky_matched' if _mc_cnt > 0 else 'lucky_waiting'

            # loopay 자동구매 매치 확인 (sold 상태인 경우)
            _loopay_match = None
            if row['status'] == 'sold':
                _loopay_match = db.execute(
                    """SELECT m.id, m.status, m.match_round
                       FROM matches m JOIN users u ON m.buyer_id=u.id
                       WHERE m.seller_item_id=? AND u.username='loopay'
                       AND m.status IN ('pending','paid')
                       ORDER BY m.id DESC LIMIT 1""",
                    (row['id'],)
                ).fetchone()
            result.append({
                'id': row['id'],
                'bar_type': row['bar_type'],
                'stage': row['stage'] or 1,
                'status': item_status,
                'status_label': '판매예약중' if item_status in ('pending','lucky_matched','lucky_waiting') else ('매칭완료' if item_status == 'matched' else item_status_label(row['status'], row['purchase_date'])),
                'days': days_since(row['purchase_date']),
                'purchase_date': row['purchase_date'],
                'reserve_date': row.get('reserve_date'),
                'match_id': (_loopay_match['id'] if _loopay_match else (m['id'] if (m and match_status not in [None]) else None)),
                'match_status': (_loopay_match['status'] if _loopay_match else match_status),
                'match_round': (_loopay_match['match_round'] if _loopay_match else match_round),
                'receipt_url': row.get('receipt_url'),
                'buyer_username': ('loopay' if _loopay_match else buyer_username),
                'buyer_account_name': buyer_account_name,
                'buyer_account': buyer_account,
                'is_loopay_match': bool(_loopay_match),
            })

        # 판매완료 아이템은 판매탭 리스트에서 제외
        # sold 아이템 중 loopay pending/paid 매치가 있으면 유지
        _loopay_pending_items = set()
        _lp_rows = db.execute(
            """SELECT DISTINCT m.seller_item_id
               FROM matches m JOIN users u ON m.buyer_id=u.id
               WHERE u.username='loopay' AND m.status IN ('pending','paid')
               AND m.seller_item_id IS NOT NULL"""
        ).fetchall()
        _loopay_pending_items = {r['seller_item_id'] for r in _lp_rows}
        result = [i for i in result if not (
            (i.get('status') == 'sold' and i['id'] not in _loopay_pending_items)
            or (i.get('status_label') == '판매완료' and not i.get('_role') and i['id'] not in _loopay_pending_items)
        )]
        # sold+loopay 아이템에 match 정보 보강
        for _ri in result:
            if _ri.get('status') == 'sold' and _ri['id'] in _loopay_pending_items:
                _ri['is_loopay_match'] = True
                try:
                    _lm = db.execute(
                        """SELECT m.id, m.status, m.match_round
                           FROM matches m JOIN users u ON m.buyer_id=u.id
                           WHERE m.seller_item_id=? AND u.username='loopay'
                           AND m.status IN ('pending','paid')
                           ORDER BY m.id DESC LIMIT 1""",
                        (_ri['id'],)
                    ).fetchone()
                    if _lm:
                        _ri['match_id'] = _lm['id']
                        _ri['match_status'] = _lm['status']
                        _ri['match_round'] = _lm['match_round']
                        _ri['buyer_username'] = 'loopay'
                except Exception:
                    pass
        _now_h = get_now().hour
        _is_matching_time = _now_h >= 20 or _now_h < 5
        return jsonify(items=result, total=len(result), is_matching_time=_is_matching_time)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/update-match-status', methods=['POST'])
@jwt_required()
def testtools_update_match_status():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='forbidden'), 403
    data = request.json or {}
    match_id = data.get('match_id')
    status = data.get('status', 'pending')
    db = get_db()
    try:
        db.execute("UPDATE matches SET status=? WHERE id=?", (status, match_id))
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/debug-sql', methods=['GET'])
@jwt_required()
def debug_sql():
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='forbidden'), 403
    db = get_db()
    try:
        item_id = int(request.args.get('item_id', 2270))
        uid = int(request.args.get('uid', 4083))
        # EXISTS 테스트
        ex = db.execute("""SELECT COUNT(*) as c FROM matches m
               JOIN users ub ON m.buyer_id=ub.id
               WHERE m.seller_item_id=? AND ub.username='loopay'
               AND m.status IN ('pending','paid')""", (item_id,)).fetchone()
        # loopay_pending_items 쿼리 테스트
        lpi_rows = db.execute("""SELECT DISTINCT m.seller_item_id
               FROM matches m JOIN users u ON m.buyer_id=u.id
               WHERE u.username='loopay' AND m.status IN ('pending','paid')
               AND m.seller_item_id IS NOT NULL""").fetchall()
        lpi = [r['seller_item_id'] for r in lpi_rows]
        # item 상태
        item = db.execute("SELECT id,status,user_id FROM items WHERE id=?", (item_id,)).fetchone()
        # loopay users
        loopay_users = db.execute("SELECT id,username,approved FROM users WHERE username='loopay'").fetchall()
        # match buyer
        match_buyers = db.execute("""SELECT m.id, m.buyer_id, m.status, u.username as buyer_name
               FROM matches m LEFT JOIN users u ON m.buyer_id=u.id
               WHERE m.seller_item_id=?""", (item_id,)).fetchall()
        return jsonify(
            exists_count=ex['c'],
            item=dict(item) if item else None,
            loopay_users=[dict(r) for r in loopay_users],
            match_buyers=[dict(r) for r in match_buyers],
            loopay_pending_items=lpi
        )
    finally:
        db.close()


@app.route('/api/admin/loopay-sell-reservation', methods=['POST'])
@jwt_required()
def admin_loopay_sell_reservation():
    """loopay 구매완료 아이템 판매예약 등록"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='권한 없음'), 403
    data = request.json or {}
    item_id = int(data.get('item_id', 0))
    if not item_id: return jsonify(error='item_id 필요'), 400
    db = get_db()
    try:
        # loopay 계정
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(error='loopay 계정 없음'), 400
        lid = loopay['id']
        # 아이템 확인
        item = db.execute("SELECT * FROM items WHERE id=? AND user_id=?", (item_id, lid)).fetchone()
        if not item: return jsonify(error='아이템 없음'), 400
        if item['status'] not in ('reservable', 'matched', 'active'):
            return jsonify(error=f'판매예약 불가 상태: {item["status"]}'), 400
        # 중복 판매예약 확인
        dup = db.execute(
            "SELECT id FROM reservations WHERE item_id=? AND status IN ('pending','matched')",
            (item_id,)
        ).fetchone()
        if dup: return jsonify(error='이미 판매예약됨'), 400
        # 판매예약 생성
        today = get_today().isoformat()
        db.execute(
            """INSERT INTO reservations(user_id, item_id, bar_type, stage, match_round,
               reserve_date, status, confirmed, join_round2)
               VALUES(?,?,?,?,1,?,'pending',1,0)""",
            (lid, item_id, item['bar_type'], item['stage'] or 1, today)
        )
        # 아이템 상태 reservable로 확보
        db.execute("UPDATE items SET status='reservable' WHERE id=?", (item_id,))
        db.commit()
        return jsonify(success=True, message='판매예약 등록 완료')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/loopay-items', methods=['GET'])
@jwt_required()
def admin_loopay_items():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        # approved=1 loopay 우선, 없으면 전체에서 가장 낮은 id
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone() or                  db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(items=[], total=0)
        lid = loopay['id']
        # 아이템 목록 먼저 가져오기
        item_rows = db.execute(
            """SELECT i.id, i.bar_type, i.stage, i.status, i.purchase_date, COALESCE(i.is_extra,0) as is_extra,
               (SELECT MAX(r2.reserve_date) FROM reservations r2 WHERE r2.item_id = i.id) as reserve_date,
               (SELECT r4.match_round FROM reservations r4
                WHERE r4.item_id = i.id AND r4.status='pending' AND r4.user_id=i.user_id
                ORDER BY r4.id DESC LIMIT 1) as sell_reservation_round,
               (SELECT r4.reserve_date FROM reservations r4
                WHERE r4.item_id = i.id AND r4.status='pending' AND r4.user_id=i.user_id
                ORDER BY r4.id DESC LIMIT 1) as sell_reservation_date,
               (SELECT r4.id FROM reservations r4
                WHERE r4.item_id = i.id AND r4.status='pending' AND r4.user_id=i.user_id
                ORDER BY r4.id DESC LIMIT 1) as sell_reservation_id
               FROM items i
               WHERE i.user_id = ? AND i.status NOT IN ('sold')
               AND (
                 -- reservable 아이템: 항상 표시 (판매예약 대기 포함)
                 i.status = 'reservable'
                 -- matched: reservation 연결되거나 loopay buyer match가 있는 것만 표시
                 OR (i.status = 'matched' AND (
                   EXISTS (SELECT 1 FROM reservations r3 WHERE r3.item_id = i.id)
                   OR EXISTS (SELECT 1 FROM matches mb WHERE mb.buyer_id = i.user_id AND mb.seller_item_id IS NOT NULL AND mb.match_round=2 AND mb.status IN ('pending','paid','confirmed'))
                 ))
                 -- 나머지 상태: 그대로 표시
                 OR i.status NOT IN ('reservable','matched')
               )
               ORDER BY i.id DESC""",
            (lid,)
        ).fetchall()

        # 각 아이템과 매칭된 match 찾기
        # loopay가 seller이고, 해당 아이템의 bar_type+stage와 일치하는 가장 최신 active match
        def get_match_for_item(bar_type, stage):
            m = db.execute(
                """SELECT m.id, m.status, u.username as buyer_username,
                          u.account_name as buyer_account_name,
                          u.account_no as buyer_account, u.bank as buyer_bank,
                          u.phone as buyer_phone
                   FROM matches m
                   LEFT JOIN users u ON m.buyer_id = u.id
                   WHERE m.seller_id = ? AND m.bar_type = ? AND m.stage = ?
                     AND m.status IN ('pending', 'paid')
                   ORDER BY m.id DESC LIMIT 1""",
                (lid, bar_type, stage or 1)
            ).fetchone()
            return dict(m) if m else None

        def get_buy_match_for_item(item_id):
            """loopay가 buyer인 매칭 조회 (item_id 기반)"""            # 방법1: buyer_res_id → reservation → item_id
            try:
                m = db.execute(
                    """SELECT m.id, m.status, m.bar_type, m.stage,
                              u.account_name as seller_account_name,
                              u.account_no as seller_account, u.bank as seller_bank,
                              u.phone as seller_phone, u.username as seller_username
                       FROM matches m
                       LEFT JOIN reservations r ON m.buyer_res_id = r.id
                       LEFT JOIN users u ON m.seller_id = u.id
                       WHERE r.item_id = ? AND m.buyer_id = ?
                         AND m.status IN ('pending', 'paid')
                       ORDER BY m.id DESC LIMIT 1""",
                    (item_id, lid)
                ).fetchone()
                # 방법2: reservation_id → reservation → item_id
                if not m:
                    m = db.execute(
                        """SELECT m.id, m.status, m.bar_type, m.stage,
                                  u.account_name as seller_account_name,
                                  u.account_no as seller_account, u.bank as seller_bank,
                                  u.phone as seller_phone, u.username as seller_username
                           FROM matches m
                           LEFT JOIN reservations r ON m.reservation_id = r.id
                           LEFT JOIN users u ON m.seller_id = u.id
                           WHERE r.item_id = ? AND m.buyer_id = ?
                             AND m.status IN ('pending', 'paid', 'confirmed')
                           ORDER BY m.id DESC LIMIT 1""",
                        (item_id, lid)
                    ).fetchone()
            except Exception:
                m = None
            return dict(m) if m else None

        # 이미 매핑된 match_id 추적 (중복 방지)
        used_match_ids = set()
        STATUS_LABEL = {'reservable':'판매가능','matched':'판매매칭완료','active':'보유중','waiting':'대기중'}
        # loopay의 구매예약과 연결된 아이템 ID 목록
        buy_res_items = set(
            _r['item_id'] for _r in db.execute(
                """SELECT r.item_id FROM reservations r
                   INNER JOIN items i ON r.item_id=i.id
                   WHERE r.user_id=? AND r.status IN ('pending','unmatched')
                   AND i.status='waiting'""", (lid,)
            ).fetchall() if _r['item_id']
        )
        rows_with_match = []
        for item in item_rows:
            d = dict(item)
            # 구매예약 연결 아이템 구분
            if d.get('status') == 'waiting' and d['id'] in buy_res_items:
                d['item_type'] = '구매예약중'
                d['is_buy_reservation'] = True
                d['sell_type'] = 'extra'
            else:
                # 판매예약된 아이템은 '판매예약중'으로 표시
                if d.get('sell_reservation_id'):
                    d['item_type'] = '판매예약중'
                else:
                    d['item_type'] = STATUS_LABEL.get(d.get('status',''), d.get('status',''))
                d['is_buy_reservation'] = False
            # 판매 구분: 추가판매(루페이가 구매 후 재판매) vs 일반판매
            d['sell_type'] = 'extra' if d.get('is_extra') == 1 else 'normal'
            bt = d['bar_type']
            st = d['stage'] or 1
            # 이 아이템의 status가 matched/sold인 경우만 match 찾기
            d['is_buy_matched'] = False
            # loopay가 구매자인 매칭 확인: bar_type + stage + buyer_id=loopay 방식
            if d['status'] == 'matched':
                try:
                    _buy_m = db.execute(
                        """SELECT m.id, m.status, m.match_round, m.receipt_url,
                           seller.username as seller_username,
                           seller.account_name as seller_account_name,
                           seller.account_no as seller_account,
                           seller.bank as seller_bank,
                           seller.phone as seller_phone
                           FROM matches m
                           LEFT JOIN users seller ON m.seller_id = seller.id
                           WHERE m.buyer_id = ? AND m.bar_type = ? AND m.stage = ?
                             AND m.status IN ('pending', 'paid', 'confirmed')
                             AND m.id NOT IN ({})
                           ORDER BY m.match_round DESC, m.id DESC LIMIT 1""".format(
                               ','.join(str(x) for x in used_match_ids) if used_match_ids else '0'
                           ),
                        (lid, bt, st)
                    ).fetchone()
                except Exception:
                    _buy_m = None
                if _buy_m:
                    d['is_buy_matched'] = True
                    d['match_id'] = _buy_m['id']
                    d['match_status'] = _buy_m['status']
                    # confirmed된 구매매칭은 완료로 표시 (판매테이블 제외 대상)
                    d['buy_match_confirmed'] = (_buy_m['status'] == 'confirmed')
                    # 자기 자신과의 매칭(loopay seller + loopay buyer)이면 판매테이블에도 표시
                    d['is_self_match'] = (_buy_m['seller_username'] == 'loopay')
                    d['match_round'] = _buy_m['match_round'] if 'match_round' in _buy_m.keys() else None
                    d['receipt_url'] = _buy_m['receipt_url'] if 'receipt_url' in _buy_m.keys() else None
                    d['seller_username'] = _buy_m['seller_username']
                    # seller가 loopay 자신인 경우 system_settings에서 계좌정보 가져오기
                    _s_is_loopay = (_buy_m['seller_username'] == 'loopay')
                    d['seller_account_name'] = get_setting('loopay_account_name', '루페이') if _s_is_loopay else _buy_m['seller_account_name']
                    d['seller_account'] = get_setting('loopay_account', _buy_m['seller_account']) if _s_is_loopay else _buy_m['seller_account']
                    d['seller_bank'] = get_setting('loopay_bank', _buy_m['seller_bank']) if _s_is_loopay else _buy_m['seller_bank']
                    d['seller_phone'] = get_setting('loopay_phone', _buy_m['seller_phone']) if _s_is_loopay else _buy_m['seller_phone']
                    d['buyer_username'] = 'loopay'
                    d['buyer_account_name'] = get_setting('loopay_account_name', '루페이')
                    d['buyer_account'] = get_setting('loopay_account', None)
                    d['buyer_bank'] = get_setting('loopay_bank', None)
                    d['buyer_phone'] = get_setting('loopay_phone', None)
                    used_match_ids.add(_buy_m['id'])
                    rows_with_match.append(d)
                    continue
            if d['status'] in ('matched', 'sold', 'reservable'):
                m = db.execute(
                    """SELECT m.id, m.status, m.match_round, m.receipt_url,
                       u.username as buyer_username,
                       u.account_name as buyer_account_name,
                       u.account_no as buyer_account
                       FROM matches m
                       LEFT JOIN users u ON m.buyer_id = u.id
                       WHERE m.seller_id = ? AND m.bar_type = ? AND m.stage = ?
                         AND m.status IN ('pending', 'paid')
                         AND m.id NOT IN ({})
                       ORDER BY m.id DESC LIMIT 1""".format(
                           ','.join(str(x) for x in used_match_ids) if used_match_ids else '0'
                       ),
                    (lid, bt, st)
                ).fetchone()
                if m:
                    d['match_id'] = m['id']
                    d['match_status'] = m['status']
                    d['match_round'] = m['match_round'] if 'match_round' in m.keys() else None
                    d['receipt_url'] = m['receipt_url'] if 'receipt_url' in m.keys() else None
                    d['buyer_username'] = m['buyer_username']
                    d['buyer_account_name'] = m['buyer_account_name']
                    d['buyer_account'] = m['buyer_account']
                    used_match_ids.add(m['id'])
                else:
                    d['match_id'] = None
                    d['match_status'] = None
                    d['buyer_username'] = None
                    d['buyer_account_name'] = None
                    d['buyer_account'] = None
            else:
                d['match_id'] = None
                d['match_status'] = None
                d['buyer_username'] = None
                d['buyer_account_name'] = None
                d['buyer_account'] = None
            rows_with_match.append(d)

        # confirmed/failed match는 목록에서 제외 (match_id 기준으로 제외, item 기준 아님)
        rows = [d for d in rows_with_match
                if d.get('match_status') not in ('confirmed', 'failed')
                or d.get('is_buy_matched')]  # loopay 구매 완료 아이템은 유지

        # ── loopay 구매 중 매치 (item_id=0 구매예약) → 구매아이템으로 표시 ──
        # 아이템 없이 구매예약한 경우: items 테이블에 아이템이 없어서 위 rows에 안 잡힘
        # matches 테이블에서 loopay가 buyer이고 pending/paid인 것을 별도 조회
        _buy_matches = db.execute(
            """SELECT m.id as match_id, m.bar_type, m.stage, m.status as match_status,
                  m.match_round, m.sell_price, m.buy_price, m.match_date,
                  m.seller_item_id,
                  s.username as seller_username, s.account_name as seller_account_name,
                  s.account_no as seller_account, s.bank as seller_bank, s.phone as seller_phone
               FROM matches m
               LEFT JOIN users s ON m.seller_id = s.id
               WHERE m.buyer_id = ? AND m.status IN ('pending','paid')
               ORDER BY m.id DESC""",
            (lid,)
        ).fetchall()
        # 중복 제거: 이미 rows에 있는 match_id 또는 seller_item_id 제외
        _existing_match_ids = {r.get('match_id') for r in rows if r.get('match_id')}
        _existing_item_ids = {r.get('id') for r in rows if r.get('is_buy_matched')}
        _seen_seller_item_ids = set()
        for _bm in _buy_matches:
            if _bm['match_id'] in _existing_match_ids:
                continue
            # 동일 seller_item_id는 최신 match_id 1개만 표시
            if _bm['seller_item_id'] and _bm['seller_item_id'] in _seen_seller_item_ids:
                continue
            # items 테이블에서 이미 잡힌 아이템(matched 상태)은 제외
            if _bm['seller_item_id'] and _bm['seller_item_id'] in _existing_item_ids:
                continue
            if _bm['seller_item_id']:
                _seen_seller_item_ids.add(_bm['seller_item_id'])
            _bp, _sp = get_price(_bm['bar_type'], _bm['stage'] or 1)
            rows.append({
                'id': _bm['seller_item_id'] or 0,  # 가상 아이템 id
                'bar_type': _bm['bar_type'],
                'stage': _bm['stage'] or 1,
                'status': 'matched',
                'purchase_date': _bm['match_date'],
                'reserve_date': _bm['match_date'],
                'sell_reservation_round': None,
                'sell_reservation_date': None,
                'sell_reservation_id': None,
                'match_id': _bm['match_id'],
                'match_status': _bm['match_status'],
                'match_round': _bm['match_round'],
                'receipt_url': None,
                'buyer_username': 'loopay',
                'buyer_account_name': None,
                'buyer_account': None,
                'buyer_bank': None,
                'buyer_phone': None,
                'seller_username': _bm['seller_username'],
                'seller_account_name': _bm['seller_account_name'],
                'seller_account': _bm['seller_account'],
                'seller_bank': _bm['seller_bank'],
                'seller_phone': _bm['seller_phone'],
                'item_type': '구매매칭완료',
                'is_buy_reservation': False,
                'is_buy_matched': True,
                'is_self_match': (_bm['seller_username'] == 'loopay'),
                'buy_match_confirmed': False,
                'buy_price': _bm['buy_price'] or _bp,
                'sell_price': _bm['sell_price'] or _sp,
            })

        return jsonify(
            items=[{
                'id': r['id'],
                'bar_type': r['bar_type'],
                'stage': r['stage'],
                'status': r['status'],
                'purchase_date': r['purchase_date'],
                'reserve_date': r['reserve_date'],
                'match_id': r['match_id'],
                'match_status': r['match_status'],
                'match_round': r.get('match_round'),
                'receipt_url': r.get('receipt_url'),
                'buyer_username': r.get('buyer_username'),
                'buyer_account_name': r.get('buyer_account_name'),
                'buyer_account': r.get('buyer_account'),
                'buyer_bank': r.get('buyer_bank'),
                'buyer_phone': r.get('buyer_phone'),
                'seller_username': r.get('seller_username'),
                'seller_account_name': r.get('seller_account_name'),
                'seller_account': r.get('seller_account'),
                'seller_bank': r.get('seller_bank'),
                'seller_phone': r.get('seller_phone'),
                'item_type': r.get('item_type', r.get('status','')),
                'is_buy_reservation': r.get('is_buy_reservation', False),
                'is_buy_matched': r.get('is_buy_matched', False),
                'is_self_match': r.get('is_self_match', False),
                'buy_match_confirmed': r.get('buy_match_confirmed', False),
                'buy_price': get_price(r['bar_type'], r['stage'])[0],
                'sell_price': get_price(r['bar_type'], r['stage'])[1],
                'sell_reservation_round': r.get('sell_reservation_round'),
                'sell_reservation_date': r.get('sell_reservation_date'),
                'sell_reservation_id': r.get('sell_reservation_id'),
                'is_extra': r.get('is_extra', 0),
                'sell_type': r.get('sell_type', 'normal'),
            } for r in rows],
            total=len(rows)
        )
    finally:
        db.close()

# ── 시스템(loopay) 아이템 삭제 ──────────────────────
@app.route('/api/admin/loopay-sell-reserve', methods=['POST'])
@jwt_required()
def admin_loopay_sell_reserve():
    """loopay 보유아이템을 판매예약으로 추가 (추가예약과 동일 효과)"""
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    item_id = int(data.get('item_id', 0))
    match_round = int(data.get('match_round', 1))
    db = get_db()
    try:
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(error='loopay 계정 없음'), 404
        lid = loopay['id']
        item = db.execute(
            "SELECT * FROM items WHERE id=? AND user_id=? AND status IN ('reservable','matched','sold')",
            (item_id, lid)
        ).fetchone()
        if not item: return jsonify(error='판매가능 상태 아이템 없음'), 404
        today = get_today().isoformat()
        join_round2 = int(data.get('join_round2', 0))
        # 2차 참가 신청인 경우: 1차 예약으로 등록하고 join_round2=1
        actual_round = 1 if join_round2 else match_round
        # 아이템 상태를 reservable로 변경 + 판매예약 생성
        db.execute("UPDATE items SET status='reservable' WHERE id=?", (item_id,))
        db.execute(
            "INSERT INTO reservations(user_id, item_id, bar_type, match_round, reserve_date, status, stage, confirmed, join_round2) VALUES(?,?,?,?,?,'pending',?,1,?)",
            (lid, item_id, item['bar_type'], actual_round, today, item['stage'] or 1, join_round2)
        )
        db.commit()
        return jsonify(success=True, item_id=item_id, bar_type=item['bar_type'], stage=item['stage'])
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/delete-loopay-items', methods=['POST'])
@jwt_required()
def admin_delete_loopay_items():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    item_ids = data.get('item_ids', []) or data.get('ids', [])
    db = get_db()
    try:
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(error='loopay 계정 없음'), 404
        lid = loopay['id']
        if item_ids == 'all':
            # 연결된 예약 먼저 삭제 (FOREIGN KEY 제약 해제)
            db.execute("PRAGMA foreign_keys=OFF")
            db.execute("DELETE FROM reservations WHERE user_id=? AND item_id IN (SELECT id FROM items WHERE user_id=?)", (lid, lid))
            result = db.execute("DELETE FROM items WHERE user_id=?", (lid,))
            deleted = result.rowcount
            db.execute("PRAGMA foreign_keys=ON")
        else:
            if not isinstance(item_ids, list) or not item_ids:
                return jsonify(error='item_ids 필요'), 400
            placeholders = ','.join('?' * len(item_ids))
            int_ids = [int(i) for i in item_ids]
            db.execute("PRAGMA foreign_keys=OFF")
            # loopay 소유 아이템: 예약 삭제 후 아이템 삭제
            db.execute(
                f"DELETE FROM reservations WHERE user_id=? AND item_id IN ({placeholders})",
                [lid] + int_ids
            )
            # loopay가 구매자인 매칭의 아이템 (buyer_id=loopay, 다른 사용자 소유)
            # matches에서 이 아이템이 포함된 매칭 삭제 (buyer=loopay인 경우)
            db.execute(
                f"""DELETE FROM matches WHERE buyer_id=?
                   AND seller_item_id IN ({placeholders})""",
                [lid] + int_ids
            )
            # 아이템 삭제 (loopay 소유 or 매칭된 구매 아이템)
            loopay_owned = db.execute(
                f"SELECT id FROM items WHERE user_id=? AND id IN ({placeholders})",
                [lid] + int_ids
            ).fetchall()
            loopay_owned_ids = [r['id'] for r in loopay_owned]
            # 나머지: matches에서 buyer_id=loopay인 seller_item_id
            buyer_matched = db.execute(
                f"""SELECT DISTINCT m.seller_item_id FROM matches m
                   WHERE m.buyer_id=? AND m.seller_item_id IN ({placeholders})""",
                [lid] + int_ids
            ).fetchall()
            buyer_matched_ids = [r['seller_item_id'] for r in buyer_matched if r['seller_item_id']]
            all_ids = list(set(loopay_owned_ids + buyer_matched_ids))
            deleted = 0
            if all_ids:
                all_ph = ','.join('?'*len(all_ids))
                # 해당 아이템의 matches 삭제
                db.execute(f"DELETE FROM matches WHERE seller_item_id IN ({all_ph})", all_ids)
                # 해당 아이템의 예약 삭제
                db.execute(f"DELETE FROM reservations WHERE item_id IN ({all_ph})", all_ids)
                result = db.execute(f"DELETE FROM items WHERE id IN ({all_ph})", all_ids)
                deleted = result.rowcount
            db.execute("PRAGMA foreign_keys=ON")
        db.commit()
        return jsonify(success=True, deleted=deleted)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

# ── 루페이 추가예약 내역 조회 ─────────────────────────────
@app.route('/api/admin/loopay-extra-reservations', methods=['GET'])
@jwt_required()
def admin_loopay_extra_reservations():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    conn = get_db()
    try:
        loopay = conn.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(reservations=[])
        lid = loopay['id']
        rows = conn.execute("""
            SELECT r.id, r.bar_type, r.status, r.reserve_date,
                   r.match_round,
                   COALESCE(r.confirmed,0) as confirmed,
                   CASE WHEN r.item_id > 0 THEN 'sell' ELSE 'buy' END as type,
                   COALESCE(r.stage, COALESCE(i.stage, 0)) as stage
            FROM reservations r
            LEFT JOIN items i ON r.item_id = i.id
            WHERE r.user_id = ? AND r.status = 'pending'
            AND r.reserve_date >= ?
            AND (r.item_id = 0 OR r.item_id IS NULL OR COALESCE(i.is_extra, 0) = 1)
            ORDER BY r.id DESC
        """, (lid, get_today().isoformat())).fetchall()
        return jsonify(reservations=[dict(r) for r in rows])
    finally:
        conn.close()

# ── 루페이 추가예약 선택 삭제 ─────────────────────────────
@app.route('/api/admin/delete-extra-reservations', methods=['POST'])
@jwt_required()
def admin_delete_extra_reservations():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    ids = data.get('ids', [])
    if not ids: return jsonify(error='ids 필요'), 400
    conn = get_db()
    try:
        loopay = conn.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(error='loopay 계정 없음'), 404
        lid = loopay['id']
        ph = ','.join('?'*len(ids))
        conn.execute("PRAGMA foreign_keys=OFF")
        # 판매예약의 경우 연결된 아이템도 삭제
        sell_rows = conn.execute(
            f"SELECT item_id FROM reservations WHERE id IN ({ph}) AND user_id=? AND match_round=2 AND item_id>0",
            [int(i) for i in ids] + [lid]
        ).fetchall()
        if sell_rows:
            item_ids = [r['item_id'] for r in sell_rows]
            conn.execute(f"DELETE FROM items WHERE id IN ({','.join('?'*len(item_ids))}) AND user_id=?",
                        item_ids + [lid])
        conn.execute(f"DELETE FROM reservations WHERE id IN ({ph}) AND user_id=? AND confirmed=0",
                    [int(i) for i in ids] + [lid])
        conn.execute("PRAGMA foreign_keys=ON")
        conn.commit()
        return jsonify(success=True, deleted=len(ids))
    except Exception as e:
        conn.rollback()
        conn.execute("PRAGMA foreign_keys=ON")
        return jsonify(error=str(e)), 500
    finally:
        conn.close()

# ── 루페이 추가예약 확정 ─────────────────────────────────
@app.route('/api/admin/confirm-extra-reservations', methods=['POST'])
@jwt_required()
def admin_confirm_extra_reservations():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    ids = data.get('ids', [])
    if not ids: return jsonify(error='ids 필요'), 400
    conn = get_db()
    try:
        loopay = conn.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(error='loopay 계정 없음'), 404
        lid = loopay['id']
        today = get_today().isoformat()
        ph = ','.join('?'*len(ids))
        # 확정할 예약들 조회 (confirmed=0인 것만)
        rows = conn.execute(
            f"SELECT * FROM reservations WHERE id IN ({ph}) AND user_id=? AND confirmed=0",
            [int(i) for i in ids] + [lid]
        ).fetchall()
        if not rows:
            return jsonify(error='확정 가능한 항목 없음 (이미 확정됨)'), 400
        confirmed_ids = []
        conn.execute("PRAGMA foreign_keys=OFF")
        for row in rows:
            r_id = row['id']
            bar_type = row['bar_type']
            stage = row['stage'] or 1
            item_id = row['item_id']
            # 구매예약 여부: item_id=0이면 구매, item_id>0이면 판매
            is_buy = (not item_id) or (item_id == 0)

            if is_buy:
                # 구매예약 확정: 아이템 status를 waiting 유지 (매칭 대기),
                # confirmed=1만 설정 → 매칭 시 구매자로 처리됨
                conn.execute("UPDATE reservations SET confirmed=1 WHERE id=?", (r_id,))

            else:
                # 판매예약 확정: 아이템 상태 reservable로 + confirmed=1
                conn.execute("UPDATE items SET status='reservable' WHERE id=? AND user_id=?", (item_id, lid))
                conn.execute("UPDATE reservations SET confirmed=1, status='pending' WHERE id=?", (r_id,))
            confirmed_ids.append(r_id)
        conn.execute("PRAGMA foreign_keys=ON")
        conn.commit()
        return jsonify(success=True, confirmed=len(confirmed_ids))
    except Exception as e:
        conn.rollback()
        conn.execute("PRAGMA foreign_keys=ON")
        return jsonify(error=str(e)), 500
    finally:
        conn.close()

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)

# volume-persistent-db

@app.route('/api/admin/user/<int:uid>', methods=['GET'])
@jwt_required()
def admin_get_user(uid):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    db.close()
    if not u: return jsonify(error='Not found'), 404
    return jsonify(user=dict(u))

@app.route('/api/admin/user/<int:uid>/charges', methods=['GET'])
@jwt_required()
def admin_user_charges(uid):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    rows = db.execute("SELECT * FROM charge_requests WHERE user_id=? ORDER BY created_at DESC", (uid,)).fetchall()
    db.close()
    return jsonify(charges=[dict(r) for r in rows])

@app.route('/api/admin/user/<int:uid>/exchanges', methods=['GET'])
@jwt_required()
def admin_user_exchanges(uid):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    rows = db.execute("SELECT r.*, r.reserve_date as created_at FROM reservations r WHERE r.user_id=? AND r.status IN ('matched','sold') ORDER BY r.reserve_date DESC LIMIT 100", (uid,)).fetchall()
    db.close()
    return jsonify(exchanges=[dict(r) for r in rows])

@app.route('/api/admin/user/<int:uid>/reservations', methods=['GET'])
@jwt_required()
def admin_user_reservations(uid):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    rows = db.execute("SELECT * FROM reservations WHERE user_id=? ORDER BY reserve_date DESC LIMIT 100", (uid,)).fetchall()
    db.close()
    return jsonify(reservations=[dict(r) for r in rows])

@app.route('/api/admin/user/<int:uid>/items', methods=['GET'])
@jwt_required()
def admin_user_items(uid):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    rows = db.execute("SELECT * FROM items WHERE user_id=? ORDER BY purchase_date DESC LIMIT 100", (uid,)).fetchall()
    db.close()
    return jsonify(items=[dict(r) for r in rows])

@app.route('/api/admin/delete-user/<int:uid>', methods=['POST'])
@jwt_required()
def admin_delete_user(uid):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        # 외래키 제약 일시 해제 후 관련 데이터 모두 삭제
        db.execute("PRAGMA foreign_keys=OFF")
        # 관련 데이터 전부 삭제
        db.execute("DELETE FROM reservations WHERE user_id=?", (uid,))
        db.execute("DELETE FROM items WHERE user_id=?", (uid,))
        db.execute("DELETE FROM charge_requests WHERE user_id=?", (uid,))
        db.execute("DELETE FROM notifications WHERE user_id=?", (uid,))
        try:
            db.execute("DELETE FROM lucky_buy_results WHERE seller_a_id=? OR seller_b_id=? OR buyer_id=?", (uid, uid, uid))
        except Exception:
            pass
        # penalties, matches 등 있으면 삭제
        try:
            db.execute("DELETE FROM penalties WHERE user_id=?", (uid,))
        except Exception:
            pass
        try:
            db.execute("DELETE FROM matches WHERE user_id=?", (uid,))
        except Exception:
            pass
        # 마지막으로 사용자 삭제
        db.execute("DELETE FROM users WHERE id=?", (uid,))
        db.execute("PRAGMA foreign_keys=ON")
        db.commit()
        return jsonify(success=True, message='회원 탈퇴 완료')
    except Exception as e:
        db.rollback()
        db.execute("PRAGMA foreign_keys=ON")
        return jsonify(error=str(e)), 500
    finally:
        db.close()


# ── 판매예약 API ──
@app.route('/api/reservation/sell', methods=['POST'])
@jwt_required()
def create_sell_reservation():
    uid = int(get_jwt_identity())
    data = request.json or {}
    item_id = int(data.get('item_id', 0))
    db = get_db()
    try:
        item = db.execute("SELECT * FROM items WHERE id=? AND user_id=? AND status IN ('reservable','active','waiting')", (item_id, uid)).fetchone()
        if not item:
            return jsonify(error='판매예약 불가능한 아이템입니다'), 400
        # 3레벨 이상: 레벨 포인트 결제 여부 확인
        _u = db.execute("SELECT level, level_paid_at FROM users WHERE id=?", (uid,)).fetchone()
        if not is_level_trade_active(db, uid):
            _lv = _u['level'] if _u else 1
            _cost = LEVEL_COST.get(_lv, 0)
            return jsonify(error=f'{_lv}레벨은 거래유지 포인트 {_cost}P 결제 후 예약 가능합니다.', level_pay_required=True), 403
        # 결합아이템(waiting) 또는 루페이 추가판매(is_extra=1)는 당일 판매예약 가능
        _is_extra_item = bool(dict(item).get('is_extra'))
        if item['status'] != 'waiting' and not _is_extra_item:
            days = days_since(item['purchase_date'])
            if days < 2:
                return jsonify(error=f'구매 후 3일째부터 판매예약 가능합니다 (현재 {days+1}일차)'), 400
        today = get_today().isoformat()
        existing = db.execute(
            "SELECT id FROM reservations WHERE item_id=? AND status='pending'", (item_id,)
        ).fetchone()
        if existing:
            return jsonify(error='이미 예약된 아이템입니다'), 400
        db.execute(
            "INSERT INTO reservations(user_id,item_id,bar_type,stage,match_round,reserve_date,status,confirmed) VALUES(?,?,?,?,1,?,'pending',1)",
            (uid, item_id, item['bar_type'], item['stage'], today)
        )
        # 아이템 상태 유지: reservations.confirmed=1로 판매예약 식별
        # (DB CHECK 제약상 sell_reserved 불가 → reservable 유지)
        db.commit()
        buy_p, sell_p = get_price(item['bar_type'], item['stage'])
        return jsonify(success=True, message='판매예약 완료!', sell_price=sell_p)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

# ── 사용자 매칭 목록 API ──
@app.route('/api/user/matching', methods=['GET'])
@jwt_required()
def user_matching():
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        today = get_today().isoformat()
        names = {'bronze':'수정','silver':'루비','gold':'다이아'}

        # ── 구매: 1) 예약 대기 중 ──
        # 오후 2시 이후에는 미매칭(pending) 예약 숨김
        _now = get_now()
        # 05:00~20:00: 미매칭 예약 숨김 (매칭 시간 종료 후)
        # 오늘 예약은 항상 표시, 전날(어제 이전) 미매칭만 숨김
        _today = get_today().isoformat()
        _hide_pending = False  # 오늘 예약은 숨기지 않음
        # 다음날 05:00 이후에만 매칭결과 공개
        # 05:00~20:00에만 매칭결과 공개 (20:00~05:00는 매칭 실행 시간이므로 숨김)
        _show_match_result = (5 <= _now.hour < 20)

        # 오늘 예약은 항상 표시, 어제 이전 예약은 5:00 이후 숨김
        _show_old = not (5 <= _now.hour < 20)  # 5:00~20:00 사이에는 전날 예약 숨김
        if _show_old:
            _date_cond = ""
            _date_params = [uid]
        else:
            _date_cond = "AND r.reserve_date >= ?"
            _date_params = [uid, _today]

        if _show_old:
            buy_reservations = db.execute(
                """SELECT r.id, r.bar_type, r.status as res_status,
                          COALESCE(r.stage,1) as stage, r.reserve_date,
                          'reservation' as source
                   FROM reservations r
                   WHERE r.user_id=? AND r.match_round=1
                     AND r.status IN ('pending','unmatched') AND r.confirmed=0
                   ORDER BY r.id DESC""",
                (uid,)
            ).fetchall()
        else:
            buy_reservations = db.execute(
                """SELECT r.id, r.bar_type, r.status as res_status,
                          COALESCE(r.stage,1) as stage, r.reserve_date,
                          'reservation' as source
                   FROM reservations r
                   WHERE r.user_id=? AND r.match_round=1
                     AND r.status IN ('pending','unmatched') AND r.confirmed=0
                     AND r.reserve_date >= ?
                   ORDER BY r.id DESC""",
                (uid, _today)
            ).fetchall()
        # _hide_pending 사용 안함 - 위에서 이미 날짜 필터 처리됨
        if False:
            buy_reservations = []
        # ── 구매: 2) 매칭 완료 기록 ──
        buy_matches = db.execute(
            """SELECT m.*, su.nickname as seller_nickname,
                      su.phone as seller_phone,
                      su.bank as seller_bank,
                      su.account_no as seller_account,
                      su.account_name as seller_account_name,
                      'match' as source
               FROM matches m
               LEFT JOIN users su ON m.seller_id = su.id
               WHERE m.buyer_id=? AND m.status NOT IN ('cancelled','confirmed')
                 AND m.match_date >= date(?, '-30 days')
               ORDER BY m.id DESC""",
            (uid, today)
        ).fetchall()
        # 05:00 이전에는 pending/matched (미확인) 매칭결과 숨김
        if not _show_match_result:
            buy_matches = [m for m in buy_matches if dict(m).get('status') not in ('pending','matched')]
        else:
            # 1차 매칭(round=1): 13:00~14:00 이후에는 pending 숨김 (송금 시간 05~13시 종료)
            # → 14:00 이후에는 1차 pending 숨기고 2차 매칭 화면에 집중
            # 2차 매칭(round=2): 19:00 이후에는 pending 숨김
            _h = _now.hour
            def _should_show(m):
                d = dict(m)
                r = d.get('match_round', 1) or 1
                s = d.get('status', '')
                if s not in ('pending', 'matched'):
                    return True  # confirmed/paid 등은 항상 표시
                if r == 1:
                    return _h < 14  # 1차는 14:00 이전까지만 pending 표시
                else:
                    return True  # 2차는 항상 표시
            buy_matches = [m for m in buy_matches if _should_show(m)]

        # ── 판매: 1) 예약 대기 중 ──
        sell_reservations = db.execute(
            """SELECT r.id, r.bar_type, r.status as res_status,
                      COALESCE(r.stage, COALESCE(i.stage,1)) as stage,
                      r.reserve_date,
                      r.match_round,
                      r.lucky_pair_id,
                      'reservation' as source
               FROM reservations r
               LEFT JOIN items i ON r.item_id=i.id
               WHERE r.user_id=? AND r.match_round IN (1,2)
                 AND r.status='pending'
                 AND r.item_id IS NOT NULL
                 AND r.reserve_date=?
               ORDER BY r.id DESC""",
            (uid, today)
        ).fetchall()
        # ── 판매: 2) 매칭 완료 기록 ──
        sell_matches = db.execute(
            """SELECT m.*, bu.nickname as buyer_nickname,
                      bu.username as buyer_username, bu.phone as buyer_phone2,
                      'match' as source
               FROM matches m
               LEFT JOIN users bu ON m.buyer_id = bu.id
               WHERE m.seller_id=? AND m.match_date >= date(?, '-30 days')
               ORDER BY m.id DESC""",
            (uid, today)
        ).fetchall()

        def fmt_reservation(r):
            d = dict(r)
            d['bar_name'] = names.get(d.get('bar_type',''), d.get('bar_type',''))
            # 행운구매 판매예약 - 매치가 있으면 lucky_matched로 표시
            if d.get('lucky_pair_id'):
                _has_match = db.execute(
                    "SELECT COUNT(*) as c FROM matches WHERE lucky_pair_id=? AND status IN ('pending','paid')",
                    (d['lucky_pair_id'],)
                ).fetchone()['c']
                d['status'] = 'lucky_matched' if _has_match > 0 else 'lucky_waiting'
            else:
                # 실제 예약 상태 반영
                res_s = d.get('res_status') or d.get('status')
                if res_s == 'unmatched':
                    d['status'] = 'unmatched'  # 1차 미매칭 → 2차 대기
                else:
                    d['status'] = 'waiting'    # 매칭 대기
            return d

        def fmt_match(m, role):
            d = dict(m)
            d['bar_name'] = names.get(d.get('bar_type',''), d.get('bar_type',''))
            d['role'] = role
            return d

        buy_list = [fmt_reservation(r) for r in buy_reservations] + [fmt_match(m,'buyer') for m in buy_matches]
        sell_list = [fmt_reservation(r) for r in sell_reservations] + [fmt_match(m,'seller') for m in sell_matches]

        # 2차 매칭 실행 여부 - system_settings 키 또는 match_round=2 실행 기록
        _mdate = get_matching_date().isoformat()
        _r2_key = bool(db.execute("SELECT value FROM system_settings WHERE key=?",
                                   (f'r2_ran_{_mdate}',)).fetchone())
        _r2_match = db.execute("SELECT COUNT(*) as c FROM matches WHERE match_round=2 AND match_date=?",
                               (_mdate,)).fetchone()['c'] > 0
        _r2_ran = _r2_key or _r2_match
        return jsonify(buy=buy_list, sell=sell_list, r2_ran_today=_r2_ran)
    finally:
        db.close()


# ── 송금완료 API (구매자) ──
@app.route('/api/reservation/payment-complete', methods=['POST'])
@jwt_required()
def payment_complete():
    identity = get_jwt_identity()
    # 관리자가 호출 시 loopay 계정으로 처리
    if identity.startswith('admin:'):
        _loopay_row = get_db().execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        uid = _loopay_row['id'] if _loopay_row else -1
    else:
        uid = int(identity)
    data = request.json or {}
    match_id = int(data.get('match_id', 0))
    image_b64 = data.get('image', '')
    db = get_db()
    try:
        m = db.execute(
            "SELECT * FROM matches WHERE id=? AND buyer_id=? AND status='pending'",
            (match_id, uid)
        ).fetchone()
        if not m:
            return jsonify(error='송금완료 처리 불가 (매칭 없음 또는 이미 처리됨)'), 400
        img_path = ''
        if image_b64 and image_b64.startswith('data:image'):
            import base64, uuid as _uuid
            upload_dir = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
            os.makedirs(upload_dir, exist_ok=True)
            ext = 'png' if 'png' in image_b64[:30] else 'jpg'
            header, b64data = image_b64.split(',', 1)
            fname = f'pay_{match_id}_{_uuid.uuid4().hex[:8]}.{ext}'
            with open(os.path.join(upload_dir, fname), 'wb') as fp:
                fp.write(base64.b64decode(b64data))
            img_path = f'/static/uploads/{fname}'
        db.execute("UPDATE matches SET status='paid', receipt_url=?, paid_at=datetime('now','localtime') WHERE id=?",
                   (img_path, match_id))
        # 구매예약 상태 업데이트 (status 제약 무시)
        try:
            db.execute("UPDATE reservations SET status='paid' WHERE id=?", (m['reservation_id'],))
        except Exception:
            pass  # 구버전 DB의 CHECK 제약 무시
        # 판매자 알림
        buyer = db.execute("SELECT nickname, username FROM users WHERE id=?", (uid,)).fetchone()
        buyer_name = buyer['nickname'] or buyer['username'] if buyer else '구매자'
        insert_notification(db, m['seller_id'], 'payment', '입금 알림', f'{buyer_name}님이 송금완료했습니다. 입금을 확인해주세요. (매치 #{match_id})')
        db.commit()
        return jsonify(success=True, message='송금완료 처리됐습니다', image_url=img_path)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/item/split', methods=['POST'])
@jwt_required()
def item_split():
    """최고단계 아이템 분할: 21단계→10×1+11×3 / 17단계→8×1+9×3 / 15단계→8×4"""
    uid = int(get_jwt_identity())
    data = request.json or {}
    item_id = int(data.get('item_id', 0))
    db = get_db()
    try:
        item = db.execute(
            "SELECT * FROM items WHERE id=? AND user_id=? AND status IN ('reservable','active')",
            (item_id, uid)
        ).fetchone()
        if not item:
            return jsonify(error='아이템을 찾을 수 없습니다.'), 404
        bar_type = item['bar_type']
        stage = item['stage']
        cfg = SPLIT_CONFIG.get(bar_type)
        if not cfg or stage != cfg['max_stage']:
            return jsonify(error=f'분할 불가 아이템입니다 (분할 가능: {bar_type} {cfg["max_stage"] if cfg else "?"}단계)'), 400
        # 아이템 상태 확인
        lbl = item_status_label(item['status'], item['purchase_date'])
        if lbl != '판매가능':
            return jsonify(error='판매가능 상태 아이템만 분할할 수 있습니다.'), 400
        # 원본 아이템 sold 처리
        db.execute("UPDATE items SET status='sold' WHERE id=?", (item_id,))
        # 분할 아이템 생성
        today = get_today().isoformat()
        pieces_created = []
        for piece in cfg['pieces']:
            for _ in range(piece['count']):
                db.execute(
                    "INSERT INTO items(user_id, bar_type, stage, status, purchase_date) VALUES(?,?,?,'waiting',?)",
                    (uid, bar_type, piece['stage'], today)
                )
                pieces_created.append({'stage': piece['stage']})
        # 분할 알림
        bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}
        bar_name = bar_names.get(bar_type, bar_type)
        pieces_desc = ' + '.join([f"{p['count']}개({p['stage']}단계)" for p in cfg['pieces']])
        try:
            insert_notification(db, uid, 'split',
                f'{bar_name} {stage}단계 분할 완료',
                f"✅ {bar_name} {stage}단계 아이템이 분할되었습니다.\n\n분할 결과: {pieces_desc}")
        except Exception:
            pass
        db.commit()
        return jsonify(success=True, bar_type=bar_type, original_stage=stage, pieces=pieces_created)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/item/convert-points', methods=['POST'])
@jwt_required()
def item_convert_points():
    """최고단계 아이템 포인트 전환: sell_price / 120 → exchange_points"""
    uid = int(get_jwt_identity())
    data = request.json or {}
    item_id = int(data.get('item_id', 0))
    db = get_db()
    try:
        item = db.execute(
            "SELECT * FROM items WHERE id=? AND user_id=? AND status IN ('reservable','active')",
            (item_id, uid)
        ).fetchone()
        if not item:
            return jsonify(error='아이템을 찾을 수 없습니다.'), 404
        bar_type = item['bar_type']
        stage = item['stage']
        cfg = SPLIT_CONFIG.get(bar_type)
        if not cfg or stage != cfg['max_stage']:
            return jsonify(error=f'포인트 전환 불가 아이템입니다 (전환 가능: {bar_type} {cfg["max_stage"] if cfg else "?"}단계)'), 400
        lbl = item_status_label(item['status'], item['purchase_date'])
        if lbl != '판매가능':
            return jsonify(error='판매가능 상태 아이템만 전환할 수 있습니다.'), 400
        # 판매가격 조회
        _, sell_price = get_price(bar_type, stage)
        if sell_price <= 0:
            return jsonify(error='판매가격을 확인할 수 없습니다.'), 400
        convert_points = sell_price // 120
        if convert_points <= 0:
            return jsonify(error='전환 포인트가 0입니다.'), 400
        # 아이템 sold 처리 + 포인트 지급
        db.execute("UPDATE items SET status='sold' WHERE id=?", (item_id,))
        db.execute("UPDATE users SET exchange_points=exchange_points+? WHERE id=?", (convert_points, uid))
        # 전환 알림
        bar_names = {'bronze':'수정','silver':'루비','gold':'다이아'}
        bar_name = bar_names.get(bar_type, bar_type)
        try:
            insert_notification(db, uid, 'convert',
                f'{bar_name} {stage}단계 포인트 전환 완료',
                f"✅ {bar_name} {stage}단계 아이템이 포인트로 전환되었습니다.\n\n"
                f"• 판매가격: {sell_price:,}원\n"
                f"• 전환 포인트: {convert_points:,}P (전환포인트)")
        except Exception:
            pass
        db.commit()
        return jsonify(success=True, bar_type=bar_type, stage=stage, sell_price=sell_price, convert_points=convert_points)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/user/pay-level', methods=['POST'])
@jwt_required()
def pay_level():
    """레벨 거래유지 포인트 결제 (3레벨 이상)"""
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not u: return jsonify(error='사용자 없음'), 404
        lv = u['level'] or 1
        cost = LEVEL_COST.get(lv, 0)
        if cost == 0:
            return jsonify(error='현재 레벨은 포인트 결제가 필요 없습니다.'), 400
        # 포인트 확인 (충전포인트 우선)
        total = (u['charge_points'] or 0) + (u['exchange_points'] or 0)
        if total < cost:
            return jsonify(error=f'포인트 부족: {cost}P 필요 (보유 {total}P)'), 400
        # 차감 (충전포인트 우선)
        ch = u['charge_points'] or 0
        ex = u['exchange_points'] or 0
        if ch >= cost:
            ch_use, ex_use = cost, 0
        else:
            ch_use = ch
            ex_use = cost - ch
        today_str = get_today().isoformat()
        db.execute(
            "UPDATE users SET charge_points=charge_points-?, exchange_points=exchange_points-?, level_paid_at=? WHERE id=?",
            (ch_use, ex_use, today_str, uid)
        )
        # 결제 완료 알림
        expire_str = (get_today() + __import__('datetime').timedelta(days=30)).strftime('%Y-%m-%d')
        insert_notification(db, uid, 'level_pay',
            f'{lv}레벨 거래유지 포인트 결제 완료',
            f"✅ {lv}레벨 거래유지 포인트 {cost}P 결제 완료\n\n"
            f"• 결제일: {today_str}\n"
            f"• 만료일: {expire_str}\n"
            f"• 30일간 구매예약·판매예약이 활성화됩니다.")
        db.commit()
        return jsonify(success=True, paid_at=today_str, expire_at=expire_str, cost=cost)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/user/level-change', methods=['POST'])
@jwt_required()
def user_level_change():
    """사용자가 원하는 레벨로 변경 (4일 연속 달성 시)"""
    uid = int(get_jwt_identity())
    data = request.json or {}
    target_level = int(data.get('target_level', 0))
    db = get_db()
    try:
        u = db.execute(
            """SELECT level, original_level, consecutive_reserve_days,
                      level_change_streak_start
               FROM users WHERE id=?""", (uid,)
        ).fetchone()
        if not u:
            return jsonify(error='사용자 없음'), 404

        level = u['level'] or 1
        original_level = u['original_level'] or level
        consecutive = u['consecutive_reserve_days'] or 0
        streak_start = u['level_change_streak_start']

        # 레벨 변경 가능 조건: 4일 연속 달성
        if consecutive < 4 and not streak_start:
            return jsonify(error=f'4일 연속 구매예약이 필요합니다. (현재 {consecutive}일)'), 400

        # 변경 가능 범위: 1 ~ original_level
        max_level = original_level
        if not (1 <= target_level <= max_level):
            return jsonify(error=f'변경 가능 레벨: 1~{max_level}레벨'), 400

        if target_level == level:
            return jsonify(error='현재 레벨과 동일합니다'), 400

        now_str = get_today().isoformat()
        db.execute(
            """UPDATE users SET level=?, level_changed_at=?,
               consecutive_reserve_days=0, level_change_streak_start=NULL
               WHERE id=?""",
            (target_level, now_str, uid)
        )
        # 레벨 변경 시 original_level은 유지 (원래 레벨 기억)
        db.commit()
        try:
            insert_notification(db, uid, 'level_change', '레벨 변경',
                f'{target_level}레벨로 변경되었습니다. 4일 연속 구매예약으로 다시 변경할 수 있습니다.')
        except Exception: pass
        return jsonify(success=True, new_level=target_level,
                       message=f'{target_level}레벨로 변경되었습니다.')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/user/level-status', methods=['GET'])
@jwt_required()
def user_level_status():
    """레벨 상태 상세 조회 (내정보용)"""
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        u = db.execute(
            """SELECT level, original_level, consecutive_reserve_days,
                      last_reserve_date, level_demoted_at, level_changed_at,
                      level_change_streak_start
               FROM users WHERE id=?""", (uid,)
        ).fetchone()
        if not u:
            return jsonify(error='없음'), 404

        level = u['level'] or 1
        original_level = u['original_level'] or level
        consecutive = u['consecutive_reserve_days'] or 0
        streak_start = u['level_change_streak_start']
        demoted_at = u['level_demoted_at']
        changed_at = u['level_changed_at']

        # 상태 판단
        is_demoted = (demoted_at is not None and level < original_level)
        can_change = (consecutive >= 4 or streak_start is not None) and level >= original_level
        days_to_change = max(0, 4 - consecutive) if not can_change else 0

        # 회복 중인 경우
        recovering = is_demoted
        days_to_recover = max(0, 4 - consecutive) if recovering else 0

        return jsonify(
            success=True,
            level=level,
            original_level=original_level,
            consecutive_reserve_days=consecutive,
            last_reserve_date=u['last_reserve_date'],
            level_demoted_at=demoted_at,
            level_changed_at=changed_at,
            is_demoted=is_demoted,
            can_change_level=can_change,
            days_to_change=days_to_change,
            recovering=recovering,
            days_to_recover=days_to_recover,
            changeable_levels=list(range(1, original_level + 1))
        )
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/user/check-level-demotion', methods=['POST'])
@jwt_required()
def check_level_demotion_api():
    """매일 체크: 어제 예약 없으면 강등 (클라이언트 폴링 호출)"""
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        _check_daily_demotion(db)
        return jsonify(success=True)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/testtools/set-user-level-status', methods=['POST'])
@jwt_required()
def testtools_set_user_level_status():
    """테스트용: 사용자 레벨 상태 강제 설정"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='권한 없음'), 403
    data = request.json or {}
    user_id = int(data.get('user_id', 0))
    db = get_db()
    try:
        fields = []
        vals = []
        for col in ['level','original_level','consecutive_reserve_days',
                    'last_reserve_date','level_demoted_at','level_changed_at',
                    'level_change_streak_start']:
            if col in data:
                fields.append(f'{col}=?')
                vals.append(data[col])
        if not fields:
            return jsonify(error='변경할 필드 없음'), 400
        vals.append(user_id)
        db.execute(f"UPDATE users SET {','.join(fields)} WHERE id=?", vals)
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/user/profile', methods=['GET'])
@jwt_required()
def get_user_profile():
    """내정보 탭용 - 개인정보 포함 전체 프로필 반환"""
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not u: return jsonify(error='Not found'), 404
        # dict로 변환 후 안전하게 접근
        udict = dict(u)
        def safe(k, default=''):
            v = udict.get(k)
            return v if v is not None else default
        lv = udict.get('level') or 1
        cost = LEVEL_COST.get(lv, 0)
        paid_at = safe('level_paid_at') or None
        days_left = None
        if paid_at:
            try:
                paid_date = get_today().__class__.fromisoformat(str(paid_at)[:10])
                days_left = max(0, 30 - (get_today() - paid_date).days)
            except Exception:
                days_left = None
        return jsonify(
            id=udict.get('id'),
            username=safe('username'),
            real_name=safe('real_name') or safe('nickname'),
            nickname=safe('nickname'),
            phone=safe('phone'),
            bank=safe('bank'),
            account_no=safe('account_no'),
            account_name=safe('account_name'),
            level=lv,
            level_cost=cost,
            level_paid_at=paid_at,
            level_days_left=days_left,
            level_trade_active=is_level_trade_active(db, udict.get('id')),
        )
    finally:
        db.close()


@app.route('/api/user/update-profile', methods=['POST'])
@jwt_required()
def update_profile():
    uid = int(get_jwt_identity())
    data = request.json or {}
    db = get_db()
    try:
        u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
        if not u:
            return jsonify(error='사용자 없음'), 404
        # 변경 가능 필드
        nickname = (data.get('nickname') or u['nickname']).strip()
        phone = (data.get('phone') or u['phone'] or '').strip()
        bank = (data.get('bank') or u['bank'] or '').strip()
        account_no = (data.get('account_no') or u['account_no'] or '').strip()
        account_name = (data.get('account_name') or u['account_name'] or '').strip()
        new_pw = data.get('new_password', '').strip()
        
        if new_pw:
            from werkzeug.security import generate_password_hash
            db.execute("UPDATE users SET nickname=?,phone=?,bank=?,account_no=?,account_name=?,password_hash=? WHERE id=?",
                (nickname, phone, bank, account_no, account_name, generate_password_hash(new_pw), uid))
        else:
            db.execute("UPDATE users SET nickname=?,phone=?,bank=?,account_no=?,account_name=? WHERE id=?",
                (nickname, phone, bank, account_no, account_name, uid))
        db.commit()
        return jsonify(success=True, message='회원정보가 변경되었습니다')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/reservation/unpaid-report', methods=['POST'])
@jwt_required()
def unpaid_report():
    uid = int(get_jwt_identity())
    data = request.json or {}
    reservation_id = int(data.get('reservation_id', 0))
    reason = (data.get('reason') or '미입금').strip()
    db = get_db()
    try:
        r = db.execute("SELECT * FROM reservations WHERE id=? AND status IN ('matched','unpaid')", (reservation_id,)).fetchone()
        if not r:
            return jsonify(error='해당 예약을 찾을 수 없습니다'), 404
        try:
            db.execute("UPDATE reservations SET status='unpaid', memo=? WHERE id=?", (reason, reservation_id))
        except Exception:
            db.execute("UPDATE reservations SET status='unpaid' WHERE id=?", (reservation_id,))
        # 상대방에게 알림 (매칭된 예약 찾기)
        # match_id로 상대방 찾기
        other_res = db.execute(
            "SELECT * FROM reservations WHERE match_id=? AND id!=?",
            (r['match_id'] or reservation_id, reservation_id)
        ).fetchone() if r['match_id'] else None
        if other_res:
            msg = f"미입금 신고가 접수되었습니다. 예약번호: {reservation_id}"
            insert_notification(db, other_res['user_id'], 'unpaid', '미입금 신고', msg)
        # 관리자에게도 알림
        insert_notification(db, 1, 'admin_unpaid', '미입금 신고',
            f'사용자 ID:{uid}, 예약:{reservation_id}, 사유:{reason}')
        db.commit()
        return jsonify(success=True, message='미입금 신고가 접수되었습니다')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/reservation/unpaid-list', methods=['GET'])
@jwt_required()
def unpaid_list():
    uid = int(get_jwt_identity())
    db = get_db()
    try:
        rows = db.execute(
            """SELECT r.*, u.nickname, u.username FROM reservations r
               JOIN users u ON r.user_id=u.id
               WHERE r.status='unpaid' AND (r.user_id=? OR r.match_id IN (
                   SELECT match_id FROM reservations WHERE user_id=? AND match_id IS NOT NULL
               ))
               ORDER BY r.created_at DESC LIMIT 20""",
            (uid, uid)
        ).fetchall()
        return jsonify(reports=[dict(r) for r in rows])
    finally:
        db.close()

@app.route('/api/user/trade-history', methods=['GET'])
@jwt_required()
def trade_history():
    uid = int(get_jwt_identity())
    start_date = request.args.get('start', '')
    end_date = request.args.get('end', '')
    db = get_db()
    try:
        query = """SELECT r.id, r.bar_type, r.match_round, r.reserve_date, r.status,
                       r.created_at, i.stage, i.buy_price, i.sell_price
                    FROM reservations r
                    LEFT JOIN items i ON r.item_id=i.id
                    WHERE r.user_id=?"""
        params = [uid]
        if start_date:
            query += " AND r.reserve_date >= ?"
            params.append(start_date)
        if end_date:
            query += " AND r.reserve_date <= ?"
            params.append(end_date)
        query += " ORDER BY r.created_at DESC LIMIT 100"
        rows = db.execute(query, params).fetchall()
        type_map = {'bronze':'수정','silver':'루비','gold':'다이아'}
        round_map = {1:'구매예약',2:'판매예약'}
        status_map = {'pending':'대기','matched':'매칭완료','paid':'송금완료','confirmed':'입금확인','unpaid':'미입금','cancelled':'취소'}
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'bar_type': type_map.get(r['bar_type'], r['bar_type']),
                'type': round_map.get(r['match_round'], '-'),
                'date': r['reserve_date'],
                'status': status_map.get(r['status'], r['status']),
                'stage': r['stage'],
                'buy_price': r['buy_price'],
                'sell_price': r['sell_price'],
                'created_at': r['created_at']
            })
        return jsonify(history=result)
    finally:
        db.close()
# ── 입금확인/미입금 API (판매자) ──
@app.route('/api/reservation/payment-confirm', methods=['POST'])
@jwt_required()
def payment_confirm():
    uid = int(get_jwt_identity())
    data = request.json or {}
    reservation_id = int(data.get('reservation_id', 0))
    confirmed = data.get('confirmed', True)
    db = get_db()
    try:
        r = db.execute(
            "SELECT * FROM reservations WHERE id=? AND user_id=? AND match_round=2 AND status='matched'",
            (reservation_id, uid)
        ).fetchone()
        if not r:
            return jsonify(error='처리 불가'), 400
        new_status = 'confirmed' if confirmed else 'unpaid'
        db.execute("UPDATE reservations SET status=? WHERE id=?", (new_status, reservation_id))
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

# ── 아이템 단계별 현황 API ──
@app.route('/api/admin/add-loopay-items', methods=['POST'])
@jwt_required()
def admin_add_loopay_items():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    bar_type = data.get('bar_type', 'bronze')
    stage = int(data.get('stage', 1))
    count = int(data.get('count', 5))
    db = get_db()
    try:
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(error='loopay 계정 없음'), 404
        lid = loopay['id']
        # purchase_date를 3일 전으로 설정 (즉시 판매예약 가능하도록)
        import datetime
        three_days_ago = (get_today() - datetime.timedelta(days=3)).isoformat()
        for _ in range(count):
            db.execute(
                "INSERT INTO items(user_id, bar_type, stage, status, purchase_date) VALUES(?,?,?,'reservable',?)",
                (lid, bar_type, stage, three_days_ago)
            )
        db.commit()
        return jsonify(success=True, message=f'{bar_type} {stage}단계 {count}개 추가')
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/item-stats', methods=['GET'])
@jwt_required()
def admin_item_stats():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    bar_type = request.args.get('bar_type', 'bronze')
    db = get_db()
    try:
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        loopay_id = loopay['id'] if loopay else -1
        prices = {'bronze': BRONZE_PRICES, 'silver': SILVER_PRICES, 'gold': GOLD_PRICES}
        price_list = prices.get(bar_type, BRONZE_PRICES)
        result = []
        for stage, buy_p, sell_p in price_list:
            user_cnt = db.execute(
                "SELECT COUNT(*) as c FROM items WHERE bar_type=? AND stage=? AND user_id!=?",
                (bar_type, stage, loopay_id)
            ).fetchone()['c']
            platform_cnt = db.execute(
                "SELECT COUNT(*) as c FROM items WHERE bar_type=? AND stage=? AND user_id=?",
                (bar_type, stage, loopay_id)
            ).fetchone()['c']
            result.append({'stage': stage, 'user_count': user_cnt, 'platform_count': platform_cnt,
                           'total': user_cnt + platform_cnt, 'sell_price': sell_p, 'buy_price': buy_p})
        return jsonify(stages=result)
    finally:
        db.close()

# ── 미입금 신고 관리자 API ──
@app.route('/api/admin/unpaid-reports', methods=['GET'])
@jwt_required()
def admin_unpaid_reports():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        rows = db.execute(
            """SELECT r.id, r.bar_type, r.status, r.created_at, r.user_id,
                      u.username, u.nickname
               FROM reservations r JOIN users u ON r.user_id=u.id
               WHERE r.status='unpaid'
               ORDER BY r.created_at DESC LIMIT 50"""
        ).fetchall()
        return jsonify(reports=[dict(r) | {'reservation_id': r['id']} for r in rows])
    finally:
        db.close()

@app.route('/api/admin/resolve-unpaid/<int:res_id>', methods=['POST'])
@jwt_required()
def admin_resolve_unpaid(res_id):
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        db.execute("UPDATE reservations SET status='cancelled' WHERE id=? AND status='unpaid'", (res_id,))
        db.commit()
        return jsonify(success=True)
    finally:
        db.close()



@app.route('/api/admin/auto-confirm-paid', methods=['POST'])
@jwt_required()
def admin_auto_confirm_paid():
    """수동으로 paid→confirmed 자동 입금확인 실행 (테스트/긴급용)"""
    identity = get_jwt_identity()
    # admin 토큰: 'admin:숫자' 형식, 일반 사용자: 숫자
    if not str(identity).startswith('admin:'):
        return jsonify(error='권한 없음'), 403
    db = get_db()
    try:
        import datetime as _dt_ac
        real_today = (_dt_ac.datetime.utcnow() + _dt_ac.timedelta(hours=9)).strftime('%Y-%m-%d')
        paid_rows = db.execute(
            """SELECT id, seller_item_id FROM matches
               WHERE status='paid' AND match_date<=?""",
            (real_today,)
        ).fetchall()
        count = 0
        for m_row in paid_rows:
            db.execute("UPDATE matches SET status='confirmed' WHERE id=?", (m_row['id'],))
            if m_row['seller_item_id']:
                db.execute("UPDATE items SET status='sold' WHERE id=?", (m_row['seller_item_id'],))
            count += 1
        db.commit()
        return jsonify(success=True, confirmed_count=count)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/item-status', methods=['GET'])
def testtools_item_status():
    ids_str = request.args.get('ids','')
    if not ids_str: return jsonify(error='no ids'),400
    ids = [int(x) for x in ids_str.split(',') if x.strip().isdigit()]
    db = get_db()
    rows = db.execute(f"SELECT id,user_id,bar_type,stage,status,lucky_pair_id FROM items WHERE id IN ({','.join('?'*len(ids))})", ids).fetchall()
    db.close()
    return jsonify(items=[dict(r) for r in rows])

@app.route('/api/admin/testtools/reset-lucky-test', methods=['POST'])
def testtools_reset_lucky_test():
    """행운구매 테스트 데이터 리셋"""
    data = request.json or {}
    item_ids = data.get('item_ids', [])
    lucky_id = data.get('lucky_id')
    db = get_db()
    try:
        for iid in item_ids:
            db.execute("UPDATE items SET status='reservable' WHERE id=?", (iid,))
        if lucky_id:
            db.execute("UPDATE lucky_buy_results SET status='confirmed', new_item_id=NULL, buyer_id=NULL WHERE id=?", (lucky_id,))
            # 판매예약도 pending으로 복원
            db.execute("UPDATE reservations SET status='pending' WHERE lucky_pair_id=?", (lucky_id,))
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/cleanup-lucky-history', methods=['POST'])
def testtools_cleanup_lucky_history():
    """회원 없는 행운구매 이력 정리"""
    db = get_db()
    try:
        result = db.execute(
            """DELETE FROM lucky_buy_results
               WHERE seller_a_id NOT IN (SELECT id FROM users)
                  OR seller_b_id NOT IN (SELECT id FROM users)"""
        )
        deleted = result.rowcount
        db.commit()
        return jsonify(success=True, deleted=deleted)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-lucky-buyer', methods=['POST'])
def testtools_fix_lucky_buyer():
    """lucky_buy_results의 buyer_id를 실제 매치의 buyer_id로 수정"""
    db = get_db()
    try:
        # matches 테이블에서 각 lucky_pair_id별 실제 buyer_id 가져와서 업데이트
        rows = db.execute(
            """SELECT m.lucky_pair_id, m.buyer_id
               FROM matches m
               WHERE m.lucky_pair_id IS NOT NULL
               AND m.status IN ('pending','paid','confirmed')
               GROUP BY m.lucky_pair_id"""
        ).fetchall()
        fixed = 0
        for r in rows:
            db.execute(
                "UPDATE lucky_buy_results SET buyer_id=? WHERE id=? AND (buyer_id != ? OR buyer_id IS NULL)",
                (r['buyer_id'], r['lucky_pair_id'], r['buyer_id'])
            )
            if db.execute('SELECT changes()').fetchone()[0]:
                fixed += 1
        db.commit()
        return jsonify(success=True, fixed=fixed, debug=debug_info[:5])
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/delete-items', methods=['POST'])
def testtools_delete_items():
    """특정 아이템 직접 삭제"""
    data = request.json or {}
    ids = data.get('ids', [])
    if not ids: return jsonify(error='no ids'), 400
    db = get_db()
    try:
        for iid in ids:
            db.execute('DELETE FROM items WHERE id=?', (iid,))
        db.commit()
        return jsonify(success=True, deleted=len(ids))
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-lucky-buyer-items', methods=['POST'])
def testtools_fix_lucky_buyer_items():
    """행운구매 완료 건에서 구매자에게 잘못 생성된 아이템 삭제"""
    db = get_db()
    deleted_total = 0
    try:
        # 완료된 lucky_buy_results 전체
        completed = db.execute(
            "SELECT id, bar_type, new_item_id, buyer_id FROM lucky_buy_results WHERE status='completed' AND new_item_id IS NOT NULL"
        ).fetchall()
        for lbr in completed:
            lucky_id = lbr['id']
            new_iid = lbr['new_item_id']
            buyer_id = lbr['buyer_id']
            if not buyer_id or not new_iid:
                continue
            # 이 lucky_pair_id의 각 매치에서 seller_item_id 가져옴
            match_rows = db.execute(
                "SELECT seller_item_id FROM matches WHERE lucky_pair_id=?",
                (lucky_id,)
            ).fetchall()
            for mr in match_rows:
                if not mr['seller_item_id']:
                    continue
                si = db.execute(
                    "SELECT bar_type, stage FROM items WHERE id=?",
                    (mr['seller_item_id'],)
                ).fetchone()
                if not si:
                    continue
                wrong_stage = (si['stage'] or 1) + 1
                # 구매자 소유, 같은 bar_type, stage+1, reservable, lucky_pair_id 없음, new_item 제외
                wrong_items = db.execute(
                    """SELECT id FROM items
                       WHERE user_id=? AND bar_type=? AND stage=?
                       AND status='reservable' AND lucky_pair_id IS NULL
                       AND id != ?
                       ORDER BY id ASC""",
                    (buyer_id, si['bar_type'], wrong_stage, new_iid)
                ).fetchall()
                # 잘못된 아이템 수 = 매치 수만큼
                for wi in wrong_items[:1]:  # 매치당 최대 1개
                    db.execute("DELETE FROM items WHERE id=?", (wi['id'],))
                    deleted_total += 1
        db.commit()
        return jsonify(success=True, deleted=deleted_total)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-extra-items', methods=['POST'])
def testtools_fix_extra_items():
    """추가예약으로 생성된 루페이 아이템 is_extra=1로 업데이트"""
    db = get_db()
    try:
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        if not loopay: return jsonify(success=True, updated=0)
        lid = loopay['id']
        # 루페이 소유 아이템 중 reservation이 있는 것 = 추가예약으로 생성된 것
        # reservation 있는 아이템 → is_extra=1 (추가판매)
        r1 = db.execute(
            """UPDATE items SET is_extra=1
               WHERE user_id=? AND is_extra=0
               AND id IN (
                   SELECT r.item_id FROM reservations r
                   WHERE r.user_id=? AND r.item_id IS NOT NULL AND r.item_id > 0
               )""",
            (lid, lid)
        )
        # reservation 없는 아이템 → is_extra=0 (일반판매: 구매→재판매)
        r2 = db.execute(
            """UPDATE items SET is_extra=0
               WHERE user_id=? AND is_extra=1
               AND id NOT IN (
                   SELECT r.item_id FROM reservations r
                   WHERE r.user_id=? AND r.item_id IS NOT NULL AND r.item_id > 0
               )""",
            (lid, lid)
        )
        updated = r1.rowcount + r2.rowcount
        db.commit()
        return jsonify(success=True, updated=updated)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-lucky-sell-reservations', methods=['POST'])
def testtools_fix_lucky_sell_reservations():
    """행운구매 판매예약 중 매치가 있는 것을 matched 처리"""
    db = get_db()
    try:
        today = get_today().isoformat()
        result = db.execute(
            """UPDATE reservations SET status='matched'
               WHERE lucky_pair_id IS NOT NULL
               AND status='pending'
               AND item_id > 0
               AND reserve_date=?
               AND item_id IN (
                   SELECT seller_item_id FROM matches
                   WHERE lucky_pair_id IS NOT NULL
                   AND match_date=?
                   AND status='pending'
                   AND seller_item_id IS NOT NULL
               )""",
            (today, today)
        )
        db.commit()
        return jsonify(success=True, updated=result.rowcount)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-ghost-matched', methods=['POST'])
def testtools_fix_ghost_matched():
    """유령 matched 구매예약 정리 (status=matched인데 실제 매치 없는 것)"""
    db = get_db()
    try:
        result = db.execute(
            """UPDATE reservations SET status='pending'
               WHERE status='matched'
               AND (item_id IS NULL OR item_id=0)
               AND NOT EXISTS (
                   SELECT 1 FROM matches m
                   WHERE m.buyer_id=reservations.user_id
                   AND m.match_date>=reservations.reserve_date
                   AND m.status IN ('pending','paid','confirmed')
               )"""
        )
        db.commit()
        return jsonify(success=True, updated=result.rowcount)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-missing-items', methods=['POST'])
def testtools_fix_missing_items():
    """confirmed 매치인데 구매자에게 아이템이 없는 경우 아이템 생성"""
    db = get_db()
    try:
        from db import BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES
        _pm = {
            'bronze': {s:(b,sl) for s,b,sl in BRONZE_PRICES},
            'silver': {s:(b,sl) for s,b,sl in SILVER_PRICES},
            'gold':   {s:(b,sl) for s,b,sl in GOLD_PRICES},
        }
        loopay_id = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()['id']
        today = get_today().isoformat()
        created = 0
        # confirmed 매치 중 구매자에게 아이템 없는 것
        matches = db.execute(
            """SELECT m.id, m.buyer_id, m.bar_type, m.stage, m.seller_item_id, m.reservation_id
               FROM matches m
               WHERE m.status='confirmed' AND m.buyer_id != ?
               AND NOT EXISTS (
                   SELECT 1 FROM items i WHERE i.user_id=m.buyer_id AND i.bar_type=m.bar_type
                   AND i.purchase_date >= m.match_date
               )""",
            (loopay_id,)
        ).fetchall()
        for m in matches:
            m = dict(m)
            # seller_item 찾기
            seller_item = None
            if m['seller_item_id']:
                seller_item = db.execute("SELECT id,bar_type,stage FROM items WHERE id=?", (m['seller_item_id'],)).fetchone()
            if not seller_item:
                loopay_res = db.execute(
                    """SELECT r.item_id FROM reservations r
                       INNER JOIN items i ON r.item_id=i.id
                       WHERE r.user_id=? AND r.bar_type=? AND r.confirmed=1
                       AND r.item_id IS NOT NULL AND r.item_id > 0
                       ORDER BY r.id DESC LIMIT 1""",
                    (loopay_id, m['bar_type'])
                ).fetchone()
                if loopay_res:
                    seller_item = db.execute("SELECT id,bar_type,stage FROM items WHERE id=?", (loopay_res['item_id'],)).fetchone()
            if seller_item:
                _stage = int(seller_item['stage'] or m['stage'] or 1) + 1
                db.execute(
                    "INSERT INTO items(user_id,bar_type,stage,purchase_date,status) VALUES(?,?,?,?,'reservable')",
                    (m['buyer_id'], m['bar_type'], _stage, today)
                )
                db.execute("UPDATE items SET status='sold' WHERE id=?", (seller_item['id'],))
                created += 1
        db.commit()
        return jsonify(success=True, created=created)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-match-buyer-res-id', methods=['POST'])
def testtools_fix_match_buyer_res_id():
    """매치의 buyer_res_id가 실제 buyer_id 소유 예약이 아닌 경우 수정"""
    db = get_db()
    try:
        # buyer_id와 buyer_res_id의 user_id가 다른 매치 찾기
        # user_id 불일치 OR reserve_date 불일치
        mismatches = db.execute(
            """SELECT m.id, m.buyer_id, m.buyer_res_id, m.bar_type, m.match_date
               FROM matches m
               JOIN reservations r ON r.id=m.buyer_res_id
               WHERE (r.user_id != m.buyer_id OR r.reserve_date != m.match_date)
               AND m.buyer_res_id IS NOT NULL
               AND m.status IN ('pending','paid')""",
        ).fetchall()
        fixed = 0
        for mm in mismatches:
            mm = dict(mm)
            correct_res = db.execute(
                """SELECT id FROM reservations
                   WHERE user_id=? AND bar_type=?
                   AND status IN ('matched','pending')
                   AND (item_id IS NULL OR item_id=0)
                   AND reserve_date=?
                   AND id NOT IN (SELECT COALESCE(buyer_res_id,0) FROM matches WHERE id!=?)
                   ORDER BY id LIMIT 1""",
                (mm['buyer_id'], mm['bar_type'], mm['match_date'], mm['id'])
            ).fetchone()
            if correct_res:
                db.execute(
                    "UPDATE matches SET buyer_res_id=? WHERE id=?",
                    (correct_res['id'], mm['id'])
                )
                fixed += 1
        db.commit()
        return jsonify(success=True, fixed=fixed, mismatches_found=len(mismatches))
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-match-buyer-res-date', methods=['POST'])
def testtools_fix_match_buyer_res_date():
    """매치의 buyer_res_id가 오늘 날짜가 아닌 경우 오늘 예약으로 교체"""
    db = get_db()
    try:
        today = get_today().isoformat()
        mismatches = db.execute(
            """SELECT m.id, m.buyer_id, m.buyer_res_id, m.bar_type, m.match_date
               FROM matches m
               JOIN reservations r ON r.id=m.buyer_res_id
               WHERE r.reserve_date != m.match_date
               AND m.buyer_res_id IS NOT NULL
               AND m.status IN ('pending','paid')""",
        ).fetchall()
        fixed = 0
        for mm in mismatches:
            mm = dict(mm)
            correct_res = db.execute(
                """SELECT id FROM reservations
                   WHERE user_id=? AND bar_type=?
                   AND status IN ('pending','matched')
                   AND (item_id IS NULL OR item_id=0)
                   AND reserve_date=?
                   AND id NOT IN (SELECT buyer_res_id FROM matches WHERE buyer_res_id IS NOT NULL AND id!=?)
                   ORDER BY id LIMIT 1""",
                (mm['buyer_id'], mm['bar_type'], mm['match_date'], mm['id'])
            ).fetchone()
            if correct_res:
                db.execute("UPDATE matches SET buyer_res_id=? WHERE id=?", (correct_res['id'], mm['id']))
                db.execute("UPDATE reservations SET status='matched' WHERE id=?", (correct_res['id'],))
                fixed += 1
        db.commit()
        return jsonify(success=True, fixed=fixed, found=len(mismatches))
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-all-match-res-mismatch', methods=['POST'])
def testtools_fix_all_match_res_mismatch():
    """buyer_res_id가 buyer_id 소유가 아니거나 날짜 불일치인 매치 전부 수정"""
    db = get_db()
    try:
        # Python으로 직접 비교 (타입 불일치 방지)
        all_matches = db.execute(
            "SELECT id, buyer_id, buyer_res_id, bar_type, match_date FROM matches WHERE buyer_res_id IS NOT NULL AND status IN ('pending','paid')"
        ).fetchall()
        rows = []
        for m in all_matches:
            m = dict(m)
            res = db.execute("SELECT user_id, reserve_date FROM reservations WHERE id=?", (m['buyer_res_id'],)).fetchone()
            if res is None or int(res['user_id']) != int(m['buyer_id']) or res['reserve_date'] != m['match_date']:
                rows.append(m)
        fixed = 0
        for row in rows:
            used = {r['buyer_res_id'] for r in db.execute(
                "SELECT buyer_res_id FROM matches WHERE buyer_res_id IS NOT NULL AND id!=?", (row['id'],)
            ).fetchall()}
            correct = db.execute(
                """SELECT id FROM reservations
                   WHERE user_id=? AND bar_type=?
                   AND (item_id IS NULL OR item_id=0)
                   AND reserve_date=?
                   ORDER BY CASE WHEN status='matched' THEN 0 ELSE 1 END, id""",
                (row['buyer_id'], row['bar_type'], row['match_date'])
            ).fetchall()
            for c in correct:
                if c['id'] not in used:
                    db.execute("UPDATE matches SET buyer_res_id=? WHERE id=?", (c['id'], row['id']))
                    db.execute("UPDATE reservations SET status='matched' WHERE id=?", (c['id'],))
                    fixed += 1
                    break
        db.commit()
        return jsonify(success=True, fixed=fixed, found=len(rows))
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-match-buyer-direct', methods=['POST'])
def testtools_fix_match_buyer_direct():
    """매치 buyer_res_id를 match_date의 buyer 소유 예약으로 직접 수정"""
    db = get_db()
    try:
        fixed = 0
        debug_info = []
        matches = db.execute(
            "SELECT id, buyer_id, buyer_res_id, bar_type, match_date FROM matches WHERE status IN ('pending','paid')"
        ).fetchall()
        for m in matches:
            mid, bid, brid, bt, mdate = m['id'], m['buyer_id'], m['buyer_res_id'], m['bar_type'], m['match_date']
            if not brid: continue
            res = db.execute("SELECT user_id, reserve_date FROM reservations WHERE id=?", (brid,)).fetchone()
            if not res: continue
            uid, rdate = int(res['user_id']), res['reserve_date']
            if uid == int(bid) and rdate == mdate: continue  # 정상
            # 수정 필요 - buyer_id 소유의 match_date 예약 찾기
            used = set()
            for r2 in db.execute("SELECT buyer_res_id FROM matches WHERE buyer_res_id IS NOT NULL AND id!=?", (mid,)).fetchall():
                if r2['buyer_res_id']: used.add(r2['buyer_res_id'])
            cands = db.execute(
                "SELECT id FROM reservations WHERE user_id=? AND bar_type=? AND (item_id IS NULL OR item_id=0) AND reserve_date=? ORDER BY id",
                (bid, bt, mdate)
            ).fetchall()
            debug_info.append({'match_id':mid,'buyer_id':bid,'bar_type':bt,'mdate':mdate,'uid':uid,'rdate':rdate,'cands':[c['id'] for c in cands],'used':list(used)})
            for cand in cands:
                if cand['id'] not in used:
                    db.execute("UPDATE matches SET buyer_res_id=? WHERE id=?", (cand['id'], mid))
                    db.execute("UPDATE reservations SET status='matched' WHERE id=?", (cand['id'],))
                    fixed += 1
                    break
        db.commit()
        return jsonify(success=True, fixed=fixed)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/update-match-buyer-res', methods=['POST'])
def testtools_update_match_buyer_res():
    """특정 매치의 buyer_res_id를 직접 수정"""
    data = request.get_json()
    match_id = data.get('match_id')
    buyer_res_id = data.get('buyer_res_id')
    db = get_db()
    try:
        db.execute("UPDATE matches SET buyer_res_id=? WHERE id=?", (buyer_res_id, match_id))
        db.execute("UPDATE reservations SET status='matched' WHERE id=?", (buyer_res_id,))
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/cleanup-loopay-old-reservations', methods=['POST'])
def testtools_cleanup_loopay_old_reservations():
    """loopay의 오늘 날짜가 아닌 예약 삭제 (매칭 미완료인 것만)"""
    db = get_db()
    try:
        today = get_today().isoformat()
        loopay_id = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()['id']
        result = db.execute(
            """DELETE FROM reservations
               WHERE user_id=? AND reserve_date != ?
               AND status IN ('pending','unmatched')
               AND confirmed=1""",
            (loopay_id, today)
        )
        db.commit()
        return jsonify(success=True, deleted=result.rowcount)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/delete-match', methods=['POST'])
def testtools_delete_match():
    """잘못 생성된 매치 삭제 및 예약 상태 복원"""
    data = request.get_json()
    match_id = data.get('match_id')
    db = get_db()
    try:
        m = db.execute("SELECT buyer_res_id, seller_item_id FROM matches WHERE id=?", (match_id,)).fetchone()
        if not m:
            return jsonify(error='매치 없음'), 404
        # 매치 삭제
        db.execute("DELETE FROM matches WHERE id=?", (match_id,))
        # buyer_res_id 예약 pending으로 복원
        if m['buyer_res_id']:
            db.execute("UPDATE reservations SET status='pending' WHERE id=?", (m['buyer_res_id'],))
        db.commit()
        return jsonify(success=True)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-lucky-match-date', methods=['POST'])
def testtools_fix_lucky_match_date():
    """lucky_buy_results의 match_date를 매치의 match_date로 업데이트"""
    db = get_db()
    try:
        # lucky_pair_id를 통해 매치의 match_date 조회
        rows = db.execute(
            """SELECT lb.id, m.match_date
               FROM lucky_buy_results lb
               LEFT JOIN matches m ON m.lucky_pair_id = lb.id
               WHERE (lb.match_date IS NULL OR lb.match_date='')
               AND m.match_date IS NOT NULL
               GROUP BY lb.id""",
        ).fetchall()
        fixed = 0
        for row in rows:
            db.execute("UPDATE lucky_buy_results SET match_date=? WHERE id=?", (row['match_date'], row['id']))
            fixed += 1
        db.commit()
        return jsonify(success=True, fixed=fixed)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/restore-old-reservations', methods=['POST'])
def testtools_restore_old_reservations():
    """이전 날짜 예약을 올바른 상태로 복구 (매칭 실행으로 인해 변경된 것)"""
    db = get_db()
    try:
        today = get_matching_date().isoformat()
        fixed = 0
        # 이전 날짜 미매칭 판매예약 → unmatched 유지 (원래 미매칭이었음)
        # 이전 날짜 pending(j2=1) 구매예약 중 confirmed 매치 있는 것 → matched로 복원
        rows = db.execute(
            """SELECT r.id FROM reservations r
               WHERE r.status='pending' AND r.reserve_date < ?
               AND (r.item_id IS NULL OR r.item_id=0)
               AND EXISTS (
                   SELECT 1 FROM matches m
                   WHERE m.buyer_id=r.user_id
                   AND m.match_date=r.reserve_date
                   AND m.status IN ('pending','paid','confirmed','failed')
               )""",
            (today,)
        ).fetchall()
        for row in rows:
            db.execute("UPDATE reservations SET status='matched' WHERE id=?", (row['id'],))
            fixed += 1
        # 이전 날짜 unmatched 판매예약 → 원래 confirmed 매치 있으면 matched로
        sell_rows = db.execute(
            """SELECT r.id FROM reservations r
               WHERE r.status='unmatched' AND r.reserve_date < ?
               AND r.item_id IS NOT NULL AND r.item_id > 0
               AND EXISTS (
                   SELECT 1 FROM matches m
                   WHERE m.seller_item_id=r.item_id
                   AND m.status IN ('pending','paid','confirmed')
               )""",
            (today,)
        ).fetchall()
        for row in sell_rows:
            db.execute("UPDATE reservations SET status='matched' WHERE id=?", (row['id'],))
            fixed += 1
        db.commit()
        return jsonify(success=True, fixed=fixed)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/debug-lucky-results', methods=['GET'])
def testtools_debug_lucky_results():
    db = get_db()
    try:
        rows = db.execute("""
            SELECT lb.id, lb.seller_a_id, lb.seller_b_id, lb.buyer_id,
                   lb.bar_type, lb.status, lb.match_date,
                   ua.username as sa, ub.username as sb, uc.username as buyer
            FROM lucky_buy_results lb
            LEFT JOIN users ua ON lb.seller_a_id=ua.id
            LEFT JOIN users ub ON lb.seller_b_id=ub.id
            LEFT JOIN users uc ON lb.buyer_id=uc.id
            ORDER BY lb.id DESC LIMIT 10
        """).fetchall()
        return jsonify(results=[dict(r) for r in rows])
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-matched-items-status', methods=['POST'])
def testtools_fix_matched_items_status():
    """매치된 판매예약의 아이템 status를 matched로 업데이트"""
    db = get_db()
    try:
        fixed = db.execute(
            """UPDATE items SET status='matched'
               WHERE id IN (
                   SELECT m.seller_item_id FROM matches m
                   WHERE m.seller_item_id IS NOT NULL
                   AND m.status IN ('pending','paid')
               )
               AND status IN ('reservable','active','waiting')""",
        ).rowcount
        db.commit()
        return jsonify(success=True, fixed=fixed)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/debug-matches', methods=['GET'])
def testtools_debug_matches():
    db = get_db()
    try:
        rows = db.execute("""
            SELECT m.id, m.status, m.match_date, m.match_round,
                   b.username as buyer, s.username as seller
            FROM matches m
            LEFT JOIN users b ON m.buyer_id=b.id
            LEFT JOIN users s ON m.seller_id=s.id
            WHERE m.match_date='2026-07-12'
            ORDER BY m.id DESC
        """).fetchall()
        return __import__('flask').jsonify(matches=[dict(r) for r in rows])
    finally:
        db.close()

@app.route('/api/admin/testtools/debug-buy-count', methods=['GET'])
def testtools_debug_buy_count():
    import flask
    db = get_db()
    try:
        today = '2026-07-12'
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()['id']
        rows = db.execute("""
            SELECT r.id, u.username as username, r.user_id, r.status, r.match_round, r.join_round2
            FROM reservations r
            JOIN users u ON r.user_id=u.id
            WHERE r.status='pending' AND r.user_id!=?
            AND (r.match_round=2 OR (COALESCE(r.join_round2,0)=1 AND r.reserve_date<=?))
            AND COALESCE(r.confirmed,0)=0 AND r.res_type='buy'
        """, (loopay, today)).fetchall()
        failed_buyers = db.execute("""
            SELECT DISTINCT m.buyer_id FROM matches m
            WHERE m.match_round=1 AND m.status='failed' AND m.match_date=?
        """, (today,)).fetchall()
        fb_ids = {r['buyer_id'] for r in failed_buyers}
        all_rows = [dict(r) for r in rows]
        eligible = [r for r in all_rows if r['user_id'] not in fb_ids]
        return flask.jsonify(all_rows=all_rows, failed_buyer_ids=list(fb_ids), eligible=eligible, total_all=len(all_rows), total_eligible=len(eligible))
    finally:
        db.close()


@app.route('/api/admin/testtools/debug-r2-buy', methods=['GET'])
def testtools_debug_r2_buy():
    import flask
    db = get_db()
    try:
        today = '2026-07-12'
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()['id']
        # failed buyers
        fb = db.execute("""SELECT DISTINCT m.buyer_id, u.username
            FROM matches m JOIN users u ON m.buyer_id=u.id
            WHERE m.match_round=1 AND m.status='failed' AND m.match_date=?""", (today,)).fetchall()
        # r2 buy 후보
        rows = db.execute("""SELECT r.id, u.username, r.item_id, r.match_round, r.join_round2, r.confirmed
            FROM reservations r JOIN users u ON r.user_id=u.id
            WHERE r.status='pending' AND r.user_id!=?
            AND (r.item_id IS NULL OR r.item_id=0)
            AND (r.match_round=2 OR (COALESCE(r.join_round2,0)=1 AND r.reserve_date<=?))
            AND COALESCE(r.confirmed,0)=0""", (loopay, today)).fetchall()
        fb_ids = {r['buyer_id'] for r in fb}
        included = [dict(r) for r in rows]
        excluded_by_fail = [r for r in included if db.execute("SELECT id FROM users WHERE id=?",
            (r.get('user_id', 0),)).fetchone() and r['username'] in [f['username'] for f in fb]]
        return flask.jsonify(failed_buyers=[dict(r) for r in fb], all_candidates=included,
                           fail_buyer_ids=list(fb_ids), count=len(included))
    finally:
        db.close()

@app.route('/api/admin/testtools/fix-r2-sell-date', methods=['POST'])
def testtools_fix_r2_sell_date():
    import flask
    db = get_db()
    try:
        # match_round=2 sell 예약의 reserve_date를 match_date와 맞춤
        rows = db.execute("""
            SELECT r.id, r.reserve_date, r.user_id, r.item_id,
                   m.match_date
            FROM reservations r
            JOIN items i ON r.item_id=i.id
            JOIN matches m ON m.seller_item_id=r.item_id AND m.match_round=1 AND m.status='failed'
            WHERE r.match_round=2 AND r.status='pending'
            AND r.reserve_date != m.match_date
        """).fetchall()
        fixed = 0
        for row in rows:
            db.execute("UPDATE reservations SET reserve_date=? WHERE id=?",
                      (row['match_date'], row['id']))
            fixed += 1
        db.commit()
        return flask.jsonify(success=True, fixed=fixed, rows=[dict(r) for r in rows])
    finally:
        db.close()

@app.route('/api/admin/testtools/debug-items', methods=['GET'])
def testtools_debug_items():
    import flask
    db = get_db()
    try:
        ids = flask.request.args.get('ids','').split(',')
        rows = db.execute(
            'SELECT id,status,bar_type,user_id FROM items WHERE id IN ({})'.format(','.join(['?']*len(ids))),
            ids
        ).fetchall()
        # 2차 sell 예약 아이템도
        sell_r2 = db.execute(
            """SELECT r.id, r.item_id, r.status, r.confirmed, r.reserve_date, r.match_round, i.status as item_status
               FROM reservations r JOIN items i ON r.item_id=i.id WHERE r.match_round=2""").fetchall()
        return flask.jsonify(items=[dict(r) for r in rows], sell_r2=[dict(r) for r in sell_r2])
    finally:
        db.close()

@app.route('/api/admin/testtools/debug-r2-matching', methods=['GET'])
def testtools_debug_r2_matching():
    import flask
    db = get_db()
    try:
        today = '2026-07-12'
        loopay = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()['id']
        round_num = 2
        
        buy_rows = db.execute(
            """SELECT r.id, u.username, r.bar_type, r.match_round, r.join_round2, r.status, r.reserve_date
               FROM reservations r LEFT JOIN users u ON r.user_id=u.id
               WHERE r.status IN ('pending','unmatched')
               AND (r.match_round=? OR (COALESCE(r.join_round2,0)=1 AND r.match_round=1 AND ?=2))
               AND r.reserve_date=?
               AND COALESCE(r.confirmed,0)=0
               AND u.username != 'loopay'
               AND r.user_id NOT IN (SELECT m.buyer_id FROM matches m WHERE m.match_round=1 AND m.status='failed' AND m.match_date=?)
               AND r.user_id NOT IN (
                   SELECT r2.user_id FROM reservations r2
                   WHERE r2.match_round=2 AND r2.status='pending'
                   AND r2.reserve_date=? AND COALESCE(r2.item_id,0)>0
               )
            """, (round_num, round_num, today, today, today)
        ).fetchall()
        
        sell_rows = db.execute(
            """SELECT r.id, u.username, r.bar_type, r.match_round, r.status, r.reserve_date, i.status as item_status
               FROM reservations r LEFT JOIN users u ON r.user_id=u.id INNER JOIN items i ON r.item_id=i.id
               WHERE r.status IN ('pending','unmatched') AND r.match_round=?
               AND r.reserve_date=? AND COALESCE(r.confirmed,0)=1
               AND i.status IN ('reservable','waiting','matched')
            """, (round_num, today)
        ).fetchall()
        
        return flask.jsonify(
            buy_count=len(buy_rows),
            sell_count=len(sell_rows),
            buy=[dict(r) for r in buy_rows],
            sell=[dict(r) for r in sell_rows]
        )
    finally:
        db.close()

@app.route('/api/admin/testtools/debug-r2-run', methods=['POST'])
def testtools_debug_r2_run():
    import flask, random
    db = get_db()
    try:
        today = '2026-07-12'
        round_num = 2
        
        buy_rows = db.execute("""
            SELECT r.id as res_id, r.user_id as buyer_id, r.bar_type,
               CASE WHEN COALESCE(r.stage,0)<=0 THEN 1 ELSE r.stage END as stage,
               COALESCE(r.stage,0) as raw_stage, u.username as buyer_username
               FROM reservations r LEFT JOIN users u ON r.user_id=u.id
               WHERE r.status='pending'
               AND (r.match_round=? OR (COALESCE(r.join_round2,0)=1 AND r.match_round=1 AND ?=2))
               AND r.reserve_date=? AND COALESCE(r.confirmed,0)=0
               AND u.username != 'loopay'
               AND r.user_id NOT IN (SELECT p.user_id FROM penalties p WHERE p.is_released=0)
               AND r.user_id NOT IN (SELECT m.buyer_id FROM matches m WHERE m.match_round=1 AND m.status='failed' AND m.match_date=?)
               AND r.user_id NOT IN (SELECT r2.user_id FROM reservations r2 WHERE r2.match_round=2 AND r2.status='pending' AND r2.reserve_date=? AND COALESCE(r2.item_id,0)>0)
        """, (round_num, round_num, today, today, today)).fetchall()
        
        sell_rows = db.execute("""
            SELECT r.id as res_id, r.user_id as seller_id, r.item_id, r.bar_type,
               CASE WHEN COALESCE(r.stage,0)<=0 THEN 1 ELSE r.stage END as stage,
               u.username as seller_username, i.status as item_status
               FROM reservations r LEFT JOIN users u ON r.user_id=u.id INNER JOIN items i ON r.item_id=i.id
               WHERE r.status IN ('pending','unmatched') AND r.match_round=?
               AND r.reserve_date=? AND COALESCE(r.confirmed,0)=1
               AND i.status IN ('reservable','waiting','matched')
        """, (round_num, today)).fetchall()
        
        buy_by_bt = {}
        for b in buy_rows:
            bt = b['bar_type']
            if bt not in buy_by_bt: buy_by_bt[bt]=[]
            buy_by_bt[bt].append(dict(b))
        
        results = []
        for s in sell_rows:
            sd = dict(s)
            bt = sd['bar_type']
            cands = [b for b in buy_by_bt.get(bt,[]) if b['buyer_id']!=sd['seller_id']]
            results.append({'seller':sd['seller_username'],'bt':bt,'st':sd['stage'],'candidates':[c['buyer_username'] for c in cands]})
        
        return flask.jsonify(buy=[dict(r) for r in buy_rows], sell=[dict(r) for r in sell_rows], match_sim=results)
    finally:
        db.close()

@app.route('/api/admin/testtools/run-r2-match-test', methods=['POST'])
def testtools_run_r2_match_test():
    import flask, random
    db = get_db()
    try:
        today = '2026-07-12'
        round_num = 2
        log = []
        
        buy_rows = db.execute(f"""SELECT r.id as res_id, r.user_id as buyer_id, r.bar_type,
               CASE WHEN COALESCE(r.stage,0)<=0 THEN 1 ELSE r.stage END as stage,
               COALESCE(r.stage,0) as raw_stage, u.username as buyer_username
               FROM reservations r LEFT JOIN users u ON r.user_id=u.id
               WHERE r.status='pending'
               AND (r.match_round=? OR (COALESCE(r.join_round2,0)=1 AND r.match_round=1 AND ?=2))
               AND r.reserve_date=? AND COALESCE(r.confirmed,0)=0
               AND u.username != 'loopay'
               AND r.user_id NOT IN (SELECT m.buyer_id FROM matches m WHERE m.match_round=1 AND m.status='failed' AND m.match_date=?)
               AND r.user_id NOT IN (SELECT r2.user_id FROM reservations r2 WHERE r2.match_round=2 AND r2.status='pending' AND r2.reserve_date=? AND COALESCE(r2.item_id,0)>0)
            """, (round_num, round_num, today, today, today)).fetchall()
        
        sell_rows = db.execute("""SELECT r.id as res_id, r.user_id as seller_id, r.bar_type,
               CASE WHEN COALESCE(r.stage,0)<=0 THEN 1 ELSE r.stage END as stage,
               u.username as seller_username, r.item_id
               FROM reservations r LEFT JOIN users u ON r.user_id=u.id INNER JOIN items i ON r.item_id=i.id
               WHERE r.status IN ('pending','unmatched') AND r.match_round=?
               AND r.reserve_date=? AND COALESCE(r.confirmed,0)=1
               AND i.status IN ('reservable','waiting','matched')
            """, (round_num, today)).fetchall()
        
        log.append(f'buy_count={len(buy_rows)}, sell_count={len(sell_rows)}')
        
        buy_by_bt = {}
        for b in buy_rows:
            bt = b['bar_type']; 
            if bt not in buy_by_bt: buy_by_bt[bt]=[]
            buy_by_bt[bt].append(dict(b))
        
        matched = 0
        for s in sell_rows:
            sd = dict(s)
            bt = sd['bar_type']
            cands = [b for b in buy_by_bt.get(bt,[]) if b['buyer_id']!=sd['seller_id']]
            log.append(f'seller={sd["seller_username"]} bt={bt} cands={[c["buyer_username"] for c in cands]}')
            if not cands: continue
            b = cands[0]
            # DB 검증
            chk = db.execute('SELECT user_id FROM reservations WHERE id=?', (b['res_id'],)).fetchone()
            log.append(f'chk={dict(chk) if chk else None}, buyer_id={b["buyer_id"]}')
            if chk and int(chk['user_id'])==int(b['buyer_id']):
                matched += 1
                log.append(f'MATCH: {b["buyer_username"]} -> {sd["seller_username"]}')
            else:
                log.append(f'SKIP: chk mismatch res_id={b["res_id"]}')
        
        return flask.jsonify(matched=matched, log=log)
    finally:
        db.close()

@app.route('/api/admin/testtools/debug-sell-normal', methods=['GET'])
def testtools_debug_sell_normal():
    import flask
    db = get_db()
    try:
        today = '2026-07-12'
        sell_rows = db.execute("""SELECT r.id as res_id, r.user_id as seller_id, r.item_id, r.bar_type,
               COALESCE(r.lucky_pair_id, i.lucky_pair_id) as lucky_pair_id,
               u.username as seller_username, r.status, r.match_round, r.reserve_date
               FROM reservations r LEFT JOIN users u ON r.user_id=u.id INNER JOIN items i ON r.item_id=i.id
               WHERE r.status IN ('pending','unmatched') AND r.match_round=2
               AND r.reserve_date=? AND COALESCE(r.confirmed,0)=1
               AND i.status IN ('reservable','waiting','matched')
        """, (today,)).fetchall()
        
        # item lucky_pair_id 직접
        items = db.execute("SELECT id, lucky_pair_id FROM items WHERE id IN (1674, 1677)").fetchall()
        
        sell_normal = [dict(s) for s in sell_rows if not dict(s).get('lucky_pair_id')]
        return flask.jsonify(
            sell_rows=[dict(r) for r in sell_rows],
            items=[dict(i) for i in items],
            sell_normal_count=len(sell_normal)
        )
    finally:
        db.close()

@app.route('/api/admin/testtools/set-user-points', methods=['POST'])
def testtools_set_user_points():
    import flask
    db = get_db()
    data = flask.request.json or {}
    uid = data.get('user_id')
    try:
        db.execute("UPDATE users SET charge_points=?, exchange_points=? WHERE id=?",
                  (data.get('charge',0), data.get('exchange',0), uid))
        try:
            maintain = data.get('maintain', 0)
            mfe = data.get('maintain_from_exchange', maintain)  # 기본: 전액 exchange에서
            mfc = data.get('maintain_from_charge', 0)
            db.execute("UPDATE users SET maintain_points=?, maintain_from_exchange=?, maintain_from_charge=? WHERE id=?",
                      (maintain, mfe, mfc, uid))
        except Exception:
            try:
                db.execute("UPDATE users SET maintain_points=? WHERE id=?", (data.get('maintain',0), uid))
            except Exception: pass
        db.commit()
        u = db.execute("SELECT charge_points, exchange_points FROM users WHERE id=?", (uid,)).fetchone()
        return flask.jsonify(success=True, **dict(u))
    except Exception as e:
        return flask.jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/test-settle-points', methods=['POST'])
def testtools_test_settle_points():
    import flask
    db = get_db()
    data = flask.request.json or {}
    uid = data.get('user_id')
    matched_count = data.get('matched_count', 1)
    try:
        before = db.execute("SELECT maintain_points, exchange_points, charge_points FROM users WHERE id=?", (uid,)).fetchone()
        _settle_match_points(db, {uid: matched_count})
        db.commit()
        after = db.execute("SELECT maintain_points, exchange_points, charge_points FROM users WHERE id=?", (uid,)).fetchone()
        return flask.jsonify(
            success=True,
            before=dict(before),
            after=dict(after),
            matched_count=matched_count,
            consumed=matched_count*40,
            refund=max(0,(before['maintain_points'] or 0)-matched_count*40)
        )
    finally:
        db.close()

@app.route('/api/admin/testtools/delete-settings-keys', methods=['POST'])
def testtools_delete_settings_keys():
    import flask
    db = get_db()
    data = flask.request.json or {}
    keys = data.get('keys', [])
    try:
        deleted = 0
        for key in keys:
            r = db.execute("DELETE FROM system_settings WHERE key=?", (key,))
            deleted += r.rowcount
        db.commit()
        return flask.jsonify(success=True, deleted=deleted)
    finally:
        db.close()

@app.route('/api/admin/testtools/system-settings', methods=['GET'])
def testtools_system_settings():
    import flask
    db = get_db()
    try:
        rows = db.execute("SELECT key, value FROM system_settings WHERE key LIKE '%ran%' OR key LIKE '%match%' ORDER BY key").fetchall()
        return flask.jsonify(settings=[dict(r) for r in rows])
    finally:
        db.close()

@app.route('/api/admin/testtools/run-db-migration', methods=['POST'])
def testtools_run_db_migration():
    """DB 마이그레이션 강제 실행 (개발용)"""
    import sqlite3 as _sq3_m
    db_path = _DB_PATH
    results = []
    cols = [
        "ALTER TABLE items ADD COLUMN lucky_pair_id INTEGER DEFAULT NULL",
        "ALTER TABLE reservations ADD COLUMN lucky_pair_id INTEGER DEFAULT NULL",
        "ALTER TABLE lucky_buy_results ADD COLUMN status TEXT DEFAULT 'confirmed'",
        "ALTER TABLE matches ADD COLUMN lucky_pair_id INTEGER DEFAULT NULL",
        "ALTER TABLE items ADD COLUMN is_extra INTEGER DEFAULT 0",
        "ALTER TABLE matches ADD COLUMN buyer_res_id INTEGER DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN maintain_points INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN level_upgrade_declined_until TEXT DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN suspended_until DATETIME",
        "ALTER TABLE users ADD COLUMN unpaid_count INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN level_paid_at DATE DEFAULT NULL",
        "ALTER TABLE users ADD COLUMN maintain_from_exchange INTEGER DEFAULT 0",
        "ALTER TABLE users ADD COLUMN maintain_from_charge INTEGER DEFAULT 0",
    ]
    try:
        _c = _sq3_m.connect(db_path, timeout=10)
        for sql in cols:
            try:
                _c.execute(sql)
                results.append({'sql': sql, 'ok': True})
            except Exception as e:
                results.append({'sql': sql, 'ok': False, 'err': str(e)})
        _c.commit()
        _c.close()
    except Exception as e:
        return jsonify(error=str(e)), 500
    return jsonify(success=True, results=results)

@app.route('/api/admin/testtools/run-round2-auto', methods=['POST'])
@jwt_required()
def testtools_run_round2_auto():
    """테스트용: 20:00 2차 자동처리 수동 실행"""
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    try:
        today = get_today().isoformat()
        _loopay2 = db.execute("SELECT id FROM users WHERE username='loopay' AND approved=1 ORDER BY id ASC").fetchone()
        _loopay_id2 = _loopay2['id'] if _loopay2 else None
        pending2 = db.execute(
            """SELECT m.id, m.buyer_id, m.seller_item_id, m.bar_type,
                  COALESCE(m.stage,1) as stage, m.sell_price,
                  u_s.account_name as seller_account_name,
                  u_s.account_no as seller_account,
                  u_s.bank as seller_bank,
                  u_s.phone as seller_phone,
                  COALESCE(m.seller_id, u_s2.id) as eff_seller_id
               FROM matches m
               LEFT JOIN users u_s ON u_s.id = m.seller_id
               LEFT JOIN users u_s2 ON u_s2.phone = m.seller_phone
               WHERE m.match_round=2 AND m.status='pending'"""
        ).fetchall()
        processed = 0
        for m_row in pending2:
            m_id2 = m_row['id']
            item_id2 = m_row['seller_item_id']
            bar2 = m_row['bar_type']
            stage2 = m_row['stage']
            db.execute("UPDATE matches SET status='failed' WHERE id=?", (m_id2,))
            if item_id2 and _loopay_id2:
                db.execute("UPDATE items SET status='matched', user_id=? WHERE id=?", (_loopay_id2, item_id2))
                _bp2, _sp2 = get_price(bar2, stage2)
                _sid2 = m_row['eff_seller_id']
                # reservation_id FK 처리
                _res_row2 = db.execute(
                    "SELECT id FROM reservations WHERE item_id=? AND match_round=2 ORDER BY id DESC LIMIT 1",
                    (item_id2,)).fetchone()
                _res_id3 = _res_row2['id'] if _res_row2 else None
                if not _res_id3:
                    _res_id3 = db.execute(
                        "INSERT INTO reservations(user_id,item_id,bar_type,match_round,reserve_date,status,stage,confirmed) VALUES(?,?,?,2,?,'matched',?,1)",
                        (_loopay_id2, item_id2, bar2, today, stage2)).lastrowid
                # 중복 방지: 동일 seller_item_id로 loopay pending 매치가 이미 있으면 스킵
                _dup2 = db.execute(
                    "SELECT id FROM matches WHERE seller_item_id=? AND buyer_id=? AND status='pending' AND match_round=2",
                    (item_id2, _loopay_id2)
                ).fetchone()
                if not _dup2:
                    db.execute(
                        """INSERT INTO matches(reservation_id, buyer_id, seller_id, bar_type, stage,
                              buy_price, sell_price, match_round, match_date, status,
                              seller_phone, seller_bank, seller_account, seller_account_name, seller_item_id)
                           VALUES(?, ?, ?, ?, ?, ?, ?, 2, ?, 'pending', ?, ?, ?, ?, ?)""",
                    (_res_id3, _loopay_id2, _sid2 or 0, bar2, stage2, _bp2, _sp2, today,
                     m_row['seller_phone'], m_row['seller_bank'],
                     m_row['seller_account'], m_row['seller_account_name'], item_id2)
                )
                processed += 1
        db.commit()
        return jsonify(success=True, processed=processed)
    except Exception as e:
        try: db.rollback()
        except: pass
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/create-item', methods=['POST'])
def testtools_create_item():
    """테스트용 아이템 생성"""
    tok = request.headers.get('Authorization','').replace('Bearer ','')
    try:
        from flask_jwt_extended import decode_token
        data_tok = decode_token(tok)
        ident = data_tok.get('sub','')
        if not str(ident).startswith('admin:'):
            return jsonify(error='권한 없음'), 403
    except Exception:
        return jsonify(error='인증 오류'), 401
    data = request.json or {}
    user_id = data.get('user_id')
    bar_type = data.get('bar_type','bronze')
    stage = data.get('stage', 2)
    purchase_date = data.get('purchase_date', get_today().isoformat())
    status = data.get('status','reservable')
    if not user_id:
        return jsonify(error='user_id 필요'), 400
    db = get_db()
    try:
        cur = db.execute(
            "INSERT INTO items(user_id,bar_type,stage,status,purchase_date) VALUES(?,?,?,?,?)",
            (user_id, bar_type, stage, status, purchase_date)
        )
        db.commit()
        return jsonify(success=True, item_id=cur.lastrowid)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/admin/testtools/delete-item', methods=['POST'])
def testtools_delete_item():
    tok = request.headers.get('Authorization','').replace('Bearer ','')
    try:
        from flask_jwt_extended import decode_token
        ident = decode_token(tok).get('sub','')
        if not str(ident).startswith('admin:'): return jsonify(error='권한 없음'), 403
    except: return jsonify(error='인증 오류'), 401
    data = request.json or {}
    item_id = data.get('item_id')
    if not item_id: return jsonify(error='item_id 필요'), 400
    db = get_db()
    try:
        db.execute("PRAGMA foreign_keys=OFF")
        db.execute("DELETE FROM reservations WHERE item_id=?", (item_id,))
        result = db.execute("DELETE FROM items WHERE id=?", (item_id,))
        db.execute("PRAGMA foreign_keys=ON")
        db.commit()
        return jsonify(success=True, deleted=result.rowcount)
    except Exception as e:
        db.rollback(); return jsonify(error=str(e)), 500
    finally: db.close()

@app.route('/api/admin/testtools/create-buy-reservation', methods=['POST'])
def testtools_create_buy_reservation():
    tok = request.headers.get('Authorization','').replace('Bearer ','')
    try:
        from flask_jwt_extended import decode_token
        ident = decode_token(tok).get('sub','')
        if not str(ident).startswith('admin:'): return jsonify(error='권한 없음'), 403
    except: return jsonify(error='인증 오류'), 401
    data = request.json or {}
    user_id = data.get('user_id')
    bar_type = data.get('bar_type','bronze')
    match_date = data.get('match_date', get_today().isoformat())
    if not user_id: return jsonify(error='user_id 필요'), 400
    db = get_db()
    try:
        db.execute("PRAGMA foreign_keys=OFF")
        cur = db.execute(
            """INSERT INTO reservations(user_id,item_id,bar_type,match_round,reserve_date,status,confirmed)
               VALUES(?,0,?,1,?,'pending',0)""",
            (user_id, bar_type, match_date)
        )
        db.execute("PRAGMA foreign_keys=ON")
        db.commit()
        return jsonify(success=True, reservation_id=cur.lastrowid)
    except Exception as e:
        db.rollback(); return jsonify(error=str(e)), 500
    finally: db.close()

@app.route('/api/admin/testtools/set-purchase-date', methods=['POST'])
@jwt_required()
def testtools_set_purchase_date():
    """테스트용: 아이템 purchase_date 강제 변경"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    item_ids = data.get('item_ids', [])
    purchase_date = data.get('purchase_date', '2026-06-01')
    if not item_ids: return jsonify(error='item_ids 필요'), 400
    db = get_db()
    try:
        ph = ','.join('?'*len(item_ids))
        db.execute(f"UPDATE items SET purchase_date=? WHERE id IN ({ph})",
                   [purchase_date] + list(item_ids))
        db.commit()
        return jsonify(success=True, updated=len(item_ids))
    except Exception as e:
        db.rollback(); return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/grant-points', methods=['POST'])
@jwt_required()
def admin_grant_points():
    """관리자가 특정 사용자에게 포인트 직접 부여"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    username = data.get('username', '').strip()
    points = int(data.get('points', 0))
    reason = data.get('reason', '관리자 지급').strip()
    if not username: return jsonify(error='아이디 필요'), 400
    if points <= 0: return jsonify(error='포인트는 1 이상이어야 합니다'), 400
    db = get_db()
    try:
        user = db.execute("SELECT id, username, charge_points FROM users WHERE username=?", (username,)).fetchone()
        if not user: return jsonify(error=f'사용자 {username} 없음'), 404
        uid = user['id']
        before = int(user['charge_points'] or 0)
        after = before + points
        db.execute("UPDATE users SET charge_points=charge_points+? WHERE id=?", (points, uid))
        # charge_requests에 기록 (포인트=points, amount=0, 관리자 지급으로 표시)
        db.execute(
            """INSERT INTO charge_requests(user_id, amount, points, status, created_at, confirmed_at)
               VALUES(?, 0, ?, 'confirmed', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
            (uid, points)
        )
        try:
            insert_notification(db, uid, 'charge', '포인트 지급',
                f'관리자가 {points:,}P를 지급했습니다. 사유: {reason}')
        except Exception:
            pass
        db.commit()
        return jsonify(success=True, username=username, points=points, before=before, after=after)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()


@app.route('/api/admin/reservations/delete', methods=['POST'])
@jwt_required()
def admin_delete_reservations():
    """관리자 구매/판매 예약기록 선택 삭제"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='Forbidden'), 403
    data = request.json or {}
    ids = [int(x) for x in data.get('ids', [])]
    if not ids: return jsonify(error='ids 필요'), 400
    db = get_db()
    try:
        ph = ','.join('?' * len(ids))
        db.execute(f"DELETE FROM reservations WHERE id IN ({ph})", ids)
        db.commit()
        return jsonify(success=True, deleted=len(ids))
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
    finally:
        db.close()
