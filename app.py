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
        except Exception: pass

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


@app.route('/api/admin/delete-users', methods=['POST'])
@jwt_required()
def admin_delete_users():
    """회원 삭제 (admin, loopay 제외)"""
    identity = get_jwt_identity()
    if not str(identity).startswith('admin:'): return jsonify(error='권한 없음'), 403
    data = request.json or {}
    user_ids = data.get('user_ids', [])  # 빈 리스트면 전체 삭제
    db = get_db()
    try:
        # admin, loopay 계정 ID 보호
        protected = {r['id'] for r in db.execute(
            "SELECT id FROM users WHERE username IN ('admin','loopay')"
        ).fetchall()}
        if user_ids:
            target_ids = [int(i) for i in user_ids if int(i) not in protected]
        else:
            # 전체 삭제 (protected 제외)
            all_ids = [r['id'] for r in db.execute("SELECT id FROM users").fetchall()]
            target_ids = [i for i in all_ids if i not in protected]
        if not target_ids:
            return jsonify(success=True, deleted=0, message='삭제 대상 없음')
        placeholders = ','.join('?' * len(target_ids))
        target_tuple = tuple(target_ids)
        # 관련 데이터 삭제 (순서 주의)
        for tbl, col in [('notifications','user_id'),('reservations','user_id'),('items','user_id'),('charge_requests','user_id')]:
            try:
                db.execute(f"DELETE FROM {tbl} WHERE {col} IN ({placeholders})", target_tuple)
            except Exception:
                pass
        try:
            db.execute(f"DELETE FROM matches WHERE buyer_id IN ({placeholders})", target_tuple)
            db.execute(f"DELETE FROM matches WHERE seller_id IN ({placeholders})", target_tuple)
        except Exception:
            pass
        db.execute(f"DELETE FROM users WHERE id IN ({placeholders})", target_tuple)
        db.commit()
        return jsonify(success=True, deleted=len(target_ids))
    except Exception as e:
        db.rollback()
        import traceback
        return jsonify(error=str(e), detail=traceback.format_exc()[-500:]), 500   return jsonify(error=str(e)), 500
    finally:
        db.close()



