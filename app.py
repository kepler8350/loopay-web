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
import datetime, sqlite3, os

# ── 테스트용 시간 조작 ──────────────────────────────────

def _get_mock_time_from_db():
    """DB의 system_settings에서 mock_time 읽기"""
    try:
        db = get_db()
        row = db.execute("SELECT value FROM system_settings WHERE key='mock_time'").fetchone()
        db.close()
        if row and row['value']:
            return datetime.datetime.strptime(row['value'], '%Y-%m-%d %H:%M:%S')
    except Exception:
        pass
    return None

def _set_mock_time_to_db(dt):
    """DB의 system_settings에 mock_time 저장 (None이면 삭제)"""
    try:
        db = get_db()
        if dt:
            val = dt.strftime('%Y-%m-%d %H:%M:%S')
            db.execute("INSERT OR REPLACE INTO system_settings(key,value) VALUES('mock_time',?)", (val,))
        else:
            db.execute("DELETE FROM system_settings WHERE key='mock_time'")
        db.commit()
        db.close()
    except Exception:
        pass

def get_now():
    """현재 시간 반환 - 매번 DB에서 읽어 멀티워커 동기화"""
    mt = _get_mock_time_from_db()
    return mt if mt else datetime.datetime.now()

def get_today():
    """오늘 날짜 반환"""
    return get_now().date()
from db import get_db, init_db, LEVEL_CONFIG, BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES, PENALTY_TABLE, get_sv_count, get_gd_count

STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
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
        return (datetime.datetime.combine(get_today(), datetime.time()) - dt).days
    except Exception:
        return 0

def item_status_label(status, purchase_date):
    status_map = {
        'active': '보유중',
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

@app.route('/')
def index():
    return send_from_directory(STATIC_DIR, 'index.html')

@app.route('/admin')
def admin():
    return send_from_directory(STATIC_DIR, 'admin.html')

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
    db = get_db()
    try:
        existing = db.execute("SELECT id FROM users WHERE username=?", (username,)).fetchone()
        if existing:
            return jsonify(error='이미 사용 중인 아이디입니다.'), 409
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
        yesterday = (get_today() - __import__('datetime').timedelta(days=3)).isoformat()
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
    lv = u['level']
    cfg = LEVEL_CONFIG.get(lv, {})
    next_cum = cfg.get('cum')
    pct = round(u['cumulative_count'] / next_cum * 100, 1) if next_cum else None
    items = db.execute("SELECT * FROM items WHERE user_id=? AND status!='sold' ORDER BY bar_type, stage", (uid,)).fetchall()
    def fmt_item(it):
        buy, sell = get_price(it['bar_type'], it['stage'])
        d = days_since(it['purchase_date'])
        return {'id':it['id'],'bar_type':it['bar_type'],'stage':it['stage'],'purchase_date':it['purchase_date'],'days':d,'status_label':item_status_label(it['status'],it['purchase_date']),'buy_price':buy,'sell_price':sell,'profit':sell-buy}
    bronze = [fmt_item(i) for i in items if i['bar_type']=='bronze']
    silver = [fmt_item(i) for i in items if i['bar_type']=='silver']
    gold   = [fmt_item(i) for i in items if i['bar_type']=='gold']
    reservable_bz = sum(1 for i in bronze if i['status_label']=='매칭예약가능')
    reservable_sv = sum(1 for i in silver if i['status_label']=='매칭예약가능')
    reservable_gd = sum(1 for i in gold   if i['status_label']=='매칭예약가능')
    # db stays open for today_res query below
    today = get_today().isoformat()
    try:
        res_rows = db.execute(
            "SELECT bar_type, COUNT(*) as cnt FROM reservations WHERE user_id=? AND reserve_date=?",
            (uid, today)
        ).fetchall()
        today_res = {r['bar_type']: r['cnt'] for r in res_rows}
    except Exception:
        today_res = {}
    auto_reserve = u['auto_reserve'] if u['auto_reserve'] is not None else 0
    db.close()
    return jsonify(id=u['id'],username=u['username'],nickname=u['nickname'],level=lv,charge_points=u['charge_points'],exchange_points=u['exchange_points'],total_points=u['charge_points']+u['exchange_points'],cumulative_count=u['cumulative_count'],next_level_cum=next_cum,progress_pct=pct,level_config=dict(cfg),items={'bronze':bronze,'silver':silver,'gold':gold},reservable={'bronze':reservable_bz,'silver':reservable_sv,'gold':reservable_gd},today_reservations={'bronze':today_res.get('bronze',0),'silver':today_res.get('silver',0),'gold':today_res.get('gold',0)},auto_reserve=auto_reserve)

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
    if bz < cfg['bz_min'] or bz > cfg['bz_max']:
        db.close()
        return jsonify(error=f'브론즈 예약수는 {cfg["bz_min"]}~{cfg["bz_max"]}개 범위여야 합니다'), 400
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
    data = request.json or {}
    bz = int(data.get('bronze_count', 0))
    # 클라이언트에서 독립적으로 선택한 sv/gd 값 사용 (없으면 자동 계산)
    sv_from_client = data.get('silver_count')
    gd_from_client = data.get('gold_count')
    db = get_db()
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
                db.execute("INSERT INTO reservations(user_id,item_id,bar_type,match_round,reserve_date) VALUES(?,?,?,?,?)", (uid,item['id'],bar_type,1,today))
        else:
            # 아이템 없어도 예약 수만큼 레코드 생성 (외래키 일시 해제)
            db.execute("PRAGMA foreign_keys=OFF")
            for _ in range(cnt):
                db.execute("INSERT INTO reservations(user_id,item_id,bar_type,match_round,reserve_date) VALUES(?,?,?,?,?)", (uid,0,bar_type,1,today))
            db.execute("PRAGMA foreign_keys=ON")
    ex_use = min(u['exchange_points'], cost)
    ch_use = cost - ex_use
    db.execute("UPDATE users SET exchange_points=exchange_points-?, charge_points=charge_points-?, cumulative_count=cumulative_count+? WHERE id=?", (ex_use,ch_use,total,uid))
    db.commit()
    db.close()
    return jsonify(success=True,message=f'매칭예약 완료! 총 {total}회, {cost}P 차감',bronze=bz,silver=sv,gold=gd)

@app.route('/api/items', methods=['GET'])
@jwt_required()
def get_items():
    uid = int(get_jwt_identity())
    bar_type = request.args.get('bar_type')
    db = get_db()
    try:
        if bar_type:
            rows = db.execute("SELECT * FROM items WHERE user_id=? AND bar_type=? AND status!='sold' ORDER BY bar_type, stage", (uid, bar_type)).fetchall()
        else:
            rows = db.execute("SELECT * FROM items WHERE user_id=? AND status!='sold' ORDER BY bar_type, stage", (uid,)).fetchall()
        result = []
        for it in rows:
            buy, sell = get_price(it['bar_type'], it['stage'])
            result.append({
                'id': it['id'],
                'bar_type': it['bar_type'],
                'stage': it['stage'],
                'purchase_date': it['purchase_date'],
                'days': days_since(it['purchase_date']),
                'status_label': item_status_label(it['status'], it['purchase_date']),
                'buy_price': buy,
                'sell_price': sell,
                'profit': sell - buy
            })
        return jsonify(result)
    except Exception as e:
        return jsonify(error=str(e)), 500
    finally:
        db.close()

@app.route('/api/prices', methods=['GET'])
def get_prices():
    bar_type = request.args.get('bar_type', 'bronze')
    tbl = price_table(bar_type)
    return jsonify(prices=[{'stage':s,'buy':b,'sell':sl,'profit':sl-b} for s,b,sl in tbl])

@app.route('/api/charge/request', methods=['POST'])
@jwt_required()
def charge_request():
    uid = int(get_jwt_identity())
    data = request.json or {}
    points = int(data.get('amount', 0))  # 프론트에서 포인트로 전송
    if points < 1:
        return jsonify(error='1 포인트 이상 충전 가능'), 400
    amount = points * 120  # 원화 계산 (1P = 120원)
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
        db.commit()
    finally:
        db.close()
    return jsonify(success=True,amount=amount,points=points,message=f'{amount:,}원 → {points}P 충전 요청 완료')

@app.route('/api/levels', methods=['GET'])
def get_levels():
    return jsonify(levels=LEVEL_CONFIG,cum_thresholds={'1→2':150,'2→3':450,'3→4':960,'4→5':1740,'5→6':2850,'6→7':4350,'7→8':6450,'8→9':9450,'9→10':12450})

@app.route('/api/penalties', methods=['GET'])
def get_penalty_table():
    return jsonify(penalties=[{'count':c,'days':d,'release_points':p} for c,d,p in PENALTY_TABLE])

@app.route('/api/admin/pending-users', methods=['GET'])
def admin_pending_users():
    """승인 대기 중인 회원 목록"""
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    db = get_db()
    try:
        rows = db.execute("""
            SELECT id, username, nickname, phone, bank, account_no, account_name, approved, created_at
            FROM users WHERE username IS NOT NULL
            ORDER BY approved ASC, created_at DESC
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

@app.route('/api/admin/approve-user', methods=['POST'])
def admin_approve_user():
    """회원 승인/거절"""
    if not check_admin_auth():
        return jsonify(error='unauthorized'), 401
    data = request.json or {}
    user_id = data.get('user_id')
    action = data.get('action')  # 'approve' or 'reject'
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
    """현재 서버 시간 반환 (mock 시간 포함)"""
    now = get_now()
    return jsonify(
        time=now.strftime('%Y-%m-%d %H:%M:%S'),
        hour=now.hour,
        minute=now.minute,
        is_mock=_MOCK_TIME is not None
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
    db = get_db()
    try:
        test_users = [
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
        created = []
        skipped = []
        for username,name,phone,bank,account,acname in test_users:
            exists = db.execute('SELECT id FROM users WHERE username=?',(username,)).fetchone()
            if exists:
                skipped.append(username)
                continue
            pw = generate_password_hash('test1234')
            db.execute(
                'INSERT INTO users (username,password_hash,nickname,phone,bank,account_no,account_name,approved) VALUES (?,?,?,?,?,?,?,0)',
                (username,pw,name,phone,bank,account,acname)
            )
            created.append(username)
        db.commit()
        return jsonify(success=True, created=created, skipped=skipped, password='test1234')
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
    rows = db.execute("SELECT id,username,nickname,email,level,charge_points,exchange_points,cumulative_count,phone,bank,account_no,account_name,created_at FROM users WHERE approved=1 ORDER BY created_at DESC").fetchall()
    db.close()
    users = []
    for u in rows:
        d = dict(u)
        # nickname이 username과 같으면 account_name을 성명으로 사용
        if d['nickname'] == d['username'] or not d['nickname']:
            d['real_name'] = d.get('account_name') or d['username']
        else:
            d['real_name'] = d['nickname']
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
    if not cr: return jsonify(error='Not found'), 404
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
    db = get_db()
    today = get_today().isoformat()
    pending = db.execute("SELECT * FROM reservations WHERE reserve_date=? AND status='pending'", (today,)).fetchall()
    matched = 0
    for r in pending:
        db.execute("UPDATE reservations SET status='matched' WHERE id=?", (r['id'],))
        matched += 1
    db.commit()
    db.close()
    return jsonify(success=True,matched=matched,message=f'매칭 실행 완료: {matched}건')


# ── 시스템 설정 API ──
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
    loopay_id_row = db.execute("SELECT id FROM users WHERE username='loopay'").fetchone()
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
    today = get_today().isoformat()

    def get_round_data(round_num):
        buy_count = db.execute(
            "SELECT COUNT(*) as c FROM reservations WHERE match_round=? AND reserve_date=? AND status='pending'",
            (round_num, today)
        ).fetchone()['c']
        sell_count = db.execute(
            "SELECT COUNT(*) as c FROM reservations WHERE match_round=2 AND reserve_date=? AND status='pending'",
            (today,)
        ).fetchone()['c']
        if buy_count > 0:
            rate = round(min(buy_count, sell_count) / buy_count * 100, 1)
        else:
            rate = 0.0
        by_type = db.execute(
            "SELECT bar_type, COUNT(*) as cnt FROM reservations WHERE match_round=2 AND reserve_date=? AND status='pending' GROUP BY bar_type",
            (today,)
        ).fetchall()
        by_stage = db.execute(
            """SELECT r.bar_type, COALESCE(i.stage,1) as stage, COUNT(*) as cnt
               FROM reservations r LEFT JOIN items i ON r.item_id=i.id
               WHERE r.match_round=2 AND r.reserve_date=? AND r.status='pending'
               GROUP BY r.bar_type, COALESCE(i.stage,1) ORDER BY r.bar_type, stage""",
            (today,)
        ).fetchall()
        return {
            'buy_count': buy_count,
            'sell_count': sell_count,
            'match_rate': rate,
            'by_type': [{'bar_type': r['bar_type'], 'count': r['cnt']} for r in by_type],
            'by_stage': [{'bar_type': r['bar_type'], 'stage': r['stage'], 'count': r['cnt']} for r in by_stage]
        }

    result = {
        'round1': get_round_data(1),
        'round2': get_round_data(2),
        'date': today
    }
    db.close()
    return jsonify(result)


with app.app_context():
    init_db()
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
        combined_stage = None
        for stage in sorted(price_map.keys()):
            p = price_map[stage]
            if (p['sell_price'] - p['buy_price']) > normal_profit:
                combined_stage = stage
                break
        if not combined_stage:
            return jsonify({'error': 'no combinable stage'}), 400
        conn.execute('UPDATE items SET status="sold" WHERE id IN (?,?)', (item1_id, item2_id))
        conn.execute(
            "INSERT INTO items (user_id, bar_type, stage, status, purchase_date) VALUES (?,?,?,'waiting',date('now'))",
            (user_id, bar_type, combined_stage)
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
@app.route('/api/admin/reservation-status', methods=['GET'])
@jwt_required()
def admin_reservation_status():
    conn = get_db()
    today = get_today().isoformat()
    try:
        # loopay 계정 ID
        loopay = conn.execute("SELECT id FROM users WHERE username='loopay'").fetchone()
        loopay_id = loopay['id'] if loopay else -1

        # 가격 테이블 로드 (sell_price 기준 분류)
        prices = {}
        for row in conn.execute("SELECT bar_type, stage, sell_price FROM prices").fetchall():
            prices[(row['bar_type'], row['stage'])] = row['sell_price']

        result = {}
        for bar_type in ['bronze', 'silver', 'gold']:
            # 사용자 구매예약 (match_round=1, loopay 제외)
            user_buy = conn.execute(
                "SELECT COUNT(*) as cnt FROM reservations WHERE bar_type=? AND match_round=1 AND status='pending' AND user_id!=?",
                (bar_type, loopay_id)
            ).fetchone()['cnt']
            # loopay 추가예약 (match_round=1)
            extra_buy = conn.execute(
                "SELECT COUNT(*) as cnt FROM reservations WHERE bar_type=? AND match_round=1 AND status='pending' AND user_id=?",
                (bar_type, loopay_id)
            ).fetchone()['cnt']
            total_buy = user_buy + extra_buy

            # 판매예약 아이템별 가격 분류 (items 조인)
            sell_rows = conn.execute(
                """SELECT r.item_id, i.stage, i.bar_type
                   FROM reservations r
                   LEFT JOIN items i ON r.item_id = i.id
                   WHERE r.bar_type=? AND r.match_round=2 AND r.status='pending'""",
                (bar_type,)
            ).fetchall()

            sell_under32 = 0  # 32만원 미만
            sell_33up = 0     # 33만원 이상
            sell_split = 0    # 분할 (10~33만원 미만)

            for row in sell_rows:
                sp = prices.get((bar_type, row['stage'] or 1), 0) if row['stage'] else 0
                if sp >= 330000:
                    sell_33up += 1
                elif sp >= 100000:
                    sell_split += 1
                else:
                    sell_under32 += 1
            sell_total = sell_under32 + sell_33up + sell_split

            # loopay 추가 판매예약
            extra_sell_rows = conn.execute(
                "SELECT r.item_id FROM reservations r WHERE r.bar_type=? AND r.match_round=2 AND r.status='pending' AND r.user_id=?",
                (bar_type, loopay_id)
            ).fetchall()
            extra_sell_under32 = len(extra_sell_rows)  # 추가예약은 기본 32만원 미만으로 처리
            extra_sell_33up = 0
            extra_sell_split = 0
            extra_sell_new = 0
            extra_sell_total = extra_sell_under32

            total_sell = sell_total + extra_sell_total
            match_rate = round(total_sell / total_buy * 100, 1) if total_buy > 0 else 0

            # 판매가격대별 (prices 테이블 join)
            price_bands = {'under10': 0, 'band10_29': 0, 'band29_33': 0, 'over33': 0}
            all_sell = conn.execute(
                """SELECT i.stage FROM reservations r
                   LEFT JOIN items i ON r.item_id=i.id
                   WHERE r.bar_type=? AND r.match_round=2 AND r.status='pending'""",
                (bar_type,)
            ).fetchall()
            for row in all_sell:
                sp = prices.get((bar_type, row['stage'] or 1), 0) if row['stage'] else 0
                if sp < 100000: price_bands['under10'] += 1
                elif sp < 290000: price_bands['band10_29'] += 1
                elif sp < 330000: price_bands['band29_33'] += 1
                else: price_bands['over33'] += 1

            result[bar_type] = {
                'user_buy': user_buy,
                'extra_buy': extra_buy,
                'buy_count': total_buy,
                'sell_under32': sell_under32,
                'sell_33up': sell_33up,
                'sell_split': sell_split,
                'sell_count': sell_total,
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

@app.route('/api/admin/reservations-list', methods=['GET'])
@jwt_required()
def admin_reservations_list():
    conn = get_db()
    try:
        rows = conn.execute(
            '''SELECT r.id, r.bar_type, r.match_round, r.status, r.reserve_date,
                      u.username, u.nickname
               FROM reservations r
               LEFT JOIN users u ON r.user_id = u.id
               ORDER BY r.reserve_date DESC, r.created_at DESC LIMIT 200'''
        ).fetchall()
        return jsonify(reservations=[dict(row) for row in rows])
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
        # loopay 계정 확인/생성
        loopay_user = conn.execute("SELECT id FROM users WHERE username='loopay'").fetchone()
        if not loopay_user:
            from werkzeug.security import generate_password_hash
            conn.execute("INSERT INTO users(username,password_hash,nickname,approved,level,charge_points,exchange_points) VALUES('loopay',?,'루페이',1,1,0,0)",
                (generate_password_hash('loopay1234'),))
            conn.commit()
            loopay_user = conn.execute("SELECT id FROM users WHERE username='loopay'").fetchone()
        loopay_id = loopay_user['id']
        today = get_today().isoformat()
        match_round = 1 if res_type == 'buy' else 2
        conn.execute("PRAGMA foreign_keys=OFF")
        for _ in range(count):
            conn.execute(
                "INSERT INTO reservations (user_id, item_id, bar_type, match_round, reserve_date, status) VALUES (?, 0, ?, ?, ?, 'pending')",
                (loopay_id, bar_type, match_round, today)
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
    rows = db.execute("SELECT * FROM notifications WHERE user_id=? ORDER BY created_at DESC LIMIT 50", (uid,)).fetchall()
    unread = db.execute("SELECT COUNT(*) FROM notifications WHERE user_id=? AND is_read=0", (uid,)).fetchone()[0]
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
        item = db.execute("SELECT * FROM items WHERE id=? AND user_id=? AND status='reservable'", (item_id, uid)).fetchone()
        if not item:
            return jsonify(error='판매예약 불가능한 아이템입니다'), 400
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
            "INSERT INTO reservations(user_id,item_id,bar_type,match_round,reserve_date,status) VALUES(?,?,?,2,?,'pending')",
            (uid, item_id, item['bar_type'], today)
        )
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
        rows = db.execute(
            """SELECT r.*, i.stage, i.purchase_date,
                      p.buy_price, p.sell_price
               FROM reservations r
               LEFT JOIN items i ON r.item_id = i.id
               LEFT JOIN prices p ON p.bar_type=r.bar_type AND p.stage=i.stage
               WHERE r.user_id=? AND r.reserve_date=?
               ORDER BY r.id DESC""",
            (uid, today)
        ).fetchall()
        result = []
        for r in rows:
            result.append({
                'id': r['id'],
                'bar_type': r['bar_type'],
                'stage': r['stage'],
                'match_round': r['match_round'],
                'status': r['status'],
                'reserve_date': r['reserve_date'],
                'buy_price': r['buy_price'] or 0,
                'sell_price': r['sell_price'] or 0,
                'item_id': r['item_id']
            })
        return jsonify(result)
    finally:
        db.close()

# ── 송금완료 API (구매자) ──
@app.route('/api/reservation/payment-complete', methods=['POST'])
@jwt_required()
def payment_complete():
    uid = int(get_jwt_identity())
    data = request.json or {}
    reservation_id = int(data.get('reservation_id', 0))
    image_b64 = data.get('image', '')  # base64 이미지
    db = get_db()
    try:
        r = db.execute(
            "SELECT * FROM reservations WHERE id=? AND user_id=? AND match_round=1 AND status='matched'",
            (reservation_id, uid)
        ).fetchone()
        if not r:
            return jsonify(error='송금완료 처리 불가'), 400
        # 이미지 저장 (static/uploads 폴더)
        img_path = ''
        if image_b64 and image_b64.startswith('data:image'):
            import base64, uuid as _uuid
            upload_dir = os.path.join(os.path.dirname(__file__), 'static', 'uploads')
            os.makedirs(upload_dir, exist_ok=True)
            ext = 'jpg'
            if 'png' in image_b64[:30]: ext = 'png'
            header, b64data = image_b64.split(',', 1)
            fname = f'pay_{reservation_id}_{_uuid.uuid4().hex[:8]}.{ext}'
            with open(os.path.join(upload_dir, fname), 'wb') as fp:
                fp.write(base64.b64decode(b64data))
            img_path = f'/uploads/{fname}'
        db.execute("UPDATE reservations SET status='paid' WHERE id=?", (reservation_id,))
        # 판매자에게 입금 알림
        matched_res = db.execute(
            "SELECT * FROM reservations WHERE match_id=? AND id!=? AND match_round=2",
            (r['match_id'] or reservation_id, reservation_id)
        ).fetchone() if r.get('match_id') else None
        if matched_res:
            db.execute("INSERT INTO notifications(user_id,type,title,message) VALUES(?,?,?,?)",
                (matched_res['user_id'], 'payment', '입금 알림', f'구매자가 송금완료를 처리했습니다. 입금 내역을 확인해주세요. (예약번호: {reservation_id})'))
        db.commit()
        return jsonify(success=True, message='송금완료 처리됐습니다', image_url=img_path)
    except Exception as e:
        db.rollback()
        return jsonify(error=str(e)), 500
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
            db.execute("INSERT INTO notifications(user_id,type,title,message) VALUES(?,?,?,?)",
                (other_res['user_id'], 'unpaid', '미입금 신고', msg))
        # 관리자에게도 알림
        db.execute("INSERT INTO notifications(user_id,type,title,message) VALUES(1,'admin_unpaid','미입금 신고',?)",
            (f'사용자 ID:{uid}, 예약:{reservation_id}, 사유:{reason}',))
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
@app.route('/api/admin/item-stats', methods=['GET'])
@jwt_required()
def admin_item_stats():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    bar_type = request.args.get('bar_type', 'bronze')
    db = get_db()
    try:
        loopay = db.execute("SELECT id FROM users WHERE username='loopay'").fetchone()
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
