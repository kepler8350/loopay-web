from flask import Flask, request, jsonify, make_response, g, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import check_password_hash
import datetime, sqlite3, os
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
        dt = datetime.datetime.strptime(str(purchase_date)[:19], '%Y-%m-%d %H:%M:%S')
        return (datetime.datetime.now() - dt).days
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
        today = __import__('datetime').date.today().isoformat()
        yesterday = (__import__('datetime').date.today() - __import__('datetime').timedelta(days=1)).isoformat()
        # 기존 아이템 삭제 후 재추가
        conn.execute("DELETE FROM items WHERE user_id=?", (uid,))
        items_to_add = [
            ('bronze', 3, yesterday), ('bronze', 5, yesterday),
            ('bronze', 2, today),     ('bronze', 4, yesterday),
            ('bronze', 1, today),
            ('silver', 2, yesterday), ('silver', 3, today),
            ('gold', 1, today),
        ]
        for bar_type, stage, date in items_to_add:
            conn.execute(
                "INSERT INTO items (user_id, bar_type, stage, purchase_date, status) VALUES (?,?,?,?,'waiting')",
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
    db.close()
    return jsonify(id=u['id'],nickname=u['nickname'],level=lv,charge_points=u['charge_points'],exchange_points=u['exchange_points'],total_points=u['charge_points']+u['exchange_points'],cumulative_count=u['cumulative_count'],next_level_cum=next_cum,progress_pct=pct,level_config=dict(cfg),items={'bronze':bronze,'silver':silver,'gold':gold},reservable={'bronze':reservable_bz,'silver':reservable_sv,'gold':reservable_gd})

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
    sv = get_sv_count(bz) if lv == 3 else cfg['sv_min']
    gd = get_gd_count(sv) if lv == 3 else cfg['gd_min']
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
    db = get_db()
    u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    lv = u['level']
    cfg = LEVEL_CONFIG[lv]
    if bz < cfg['bz_min'] or bz > cfg['bz_max']:
        db.close()
        return jsonify(error='예약 수량 범위 초과'), 400
    sv = get_sv_count(bz) if lv == 3 else cfg['sv_min']
    gd = get_gd_count(sv) if lv == 3 else cfg['gd_min']
    total = bz + sv + gd
    cost = total * 40
    total_pts = u['charge_points'] + u['exchange_points']
    if total_pts < cost:
        db.close()
        return jsonify(error=f'포인트 부족. 필요: {cost}P, 보유: {total_pts}P'), 400
    today = datetime.date.today().isoformat()
    counts = {'bronze': bz, 'silver': sv, 'gold': gd}
    for bar_type, cnt in counts.items():
        reservable = db.execute("SELECT id FROM items WHERE user_id=? AND bar_type=? AND status='reservable' AND julianday('now') - julianday(purchase_date) >= 2 LIMIT ?", (uid, bar_type, cnt)).fetchall()
        for item in reservable:
            db.execute("INSERT INTO reservations(user_id,item_id,bar_type,reserve_date) VALUES(?,?,?,?)", (uid,item['id'],bar_type,today))
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
    amount = int(data.get('amount', 0))
    if amount < 1000:
        return jsonify(error='최소 1,000원 이상 충전 가능'), 400
    points = amount // 120
    db = get_db()
    db.execute("INSERT INTO charge_requests(user_id,amount,points) VALUES(?,?,?)", (uid,amount,points))
    db.commit()
    db.close()
    return jsonify(success=True,amount=amount,points=points,message=f'{amount:,}원 → {points}P 충전 요청 완료')

@app.route('/api/levels', methods=['GET'])
def get_levels():
    return jsonify(levels=LEVEL_CONFIG,cum_thresholds={'1→2':150,'2→3':450,'3→4':960,'4→5':1740,'5→6':2850,'6→7':4350,'7→8':6450,'8→9':9450,'9→10':12450})

@app.route('/api/penalties', methods=['GET'])
def get_penalty_table():
    return jsonify(penalties=[{'count':c,'days':d,'release_points':p} for c,d,p in PENALTY_TABLE])

@app.route('/api/admin/users', methods=['GET'])
@jwt_required()
def admin_users():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    users = db.execute("SELECT id,nickname,email,level,charge_points,exchange_points,cumulative_count,created_at FROM users").fetchall()
    db.close()
    return jsonify(users=[dict(u) for u in users])

@app.route('/api/admin/charges', methods=['GET'])
@jwt_required()
def admin_charges():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    rows = db.execute("SELECT cr.*, u.nickname FROM charge_requests cr JOIN users u ON u.id=cr.user_id WHERE cr.status='pending' ORDER BY cr.created_at DESC").fetchall()
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
    db.execute("UPDATE users SET charge_points=charge_points+? WHERE id=?", (cr['points'],cr['user_id']))
    db.commit()
    db.close()
    return jsonify(success=True,message=f'{cr["points"]}P 충전 완료')

@app.route('/api/admin/run-matching', methods=['POST'])
@jwt_required()
def admin_run_matching():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    today = datetime.date.today().isoformat()
    pending = db.execute("SELECT * FROM reservations WHERE reserve_date=? AND status='pending'", (today,)).fetchall()
    matched = 0
    for r in pending:
        db.execute("UPDATE reservations SET status='matched' WHERE id=?", (r['id'],))
        matched += 1
    db.commit()
    db.close()
    return jsonify(success=True,matched=matched,message=f'매칭 실행 완료: {matched}건')

@app.route('/api/admin/stats', methods=['GET'])
@jwt_required()
def admin_stats():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    total_users = db.execute("SELECT COUNT(*) as c FROM users").fetchone()['c']
    total_items = db.execute("SELECT COUNT(*) as c FROM items WHERE status!='sold'").fetchone()['c']
    pending_charges = db.execute("SELECT COUNT(*) as c FROM charge_requests WHERE status='pending'").fetchone()['c']
    today = datetime.date.today().isoformat()
    today_reserves = db.execute("SELECT COUNT(*) as c FROM reservations WHERE reserve_date=?", (today,)).fetchone()['c']
    db.close()
    return jsonify(total_users=total_users,total_items=total_items,pending_charges=pending_charges,today_reserves=today_reserves)

@app.route('/api/schedule', methods=['GET'])
def get_schedule():
    return jsonify(schedule=[{'time':'05:00~13:00','label':'구매·판매 예약','detail':'1차·2차 예약 모두 이 시간에 가능'},{'time':'13:00~14:00','label':'1차 매칭 입금','detail':'매칭금액 입금 후 송금완료 버튼 클릭'},{'time':'14:00~15:00','label':'2차 매칭','detail':'관리자 모드에서 실행'},{'time':'15:00~19:00','label':'2차 매칭 입금','detail':'19시 이후 버튼 비활성화'},{'time':'19:00~20:00','label':'2차 미입금 확인','detail':'판매자 입금확인 또는 미입금 버튼'},{'time':'20:00~13:00','label':'매칭 실행','detail':'관리자 모드에서 실행'}])

@app.route('/api/admin/matching-status', methods=['GET'])
@jwt_required()
def admin_matching_status():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    today = datetime.date.today().isoformat()

    def get_round_data(round_num):
        # l� }  (reservations where match_round=round_num, status=pending)
        buy_count = db.execute(
            "SELECT COUNT(*) as c FROM reservations WHERE match_round=? AND reserve_date=? AND status='pending'",
            (round_num, today)
        ).fetchone()['c']

        # � }  (items where status='reservable')
        sell_count = db.execute(
            "SELECT COUNT(*) as c FROM items WHERE status='reservable'"
        ).fetchone()['c']

        # �m(
        if sell_count > 0:
            rate = round(min(buy_count, sell_count) / max(buy_count, sell_count) * 100, 1)
        else:
            rate = 0.0

        # Dt\� �} 
        by_type = db.execute(
            "SELECT bar_type, COUNT(*) as cnt FROM items WHERE status='reservable' GROUP BY bar_type"
        ).fetchall()

        # Dt\ ��� �} 
        by_stage = db.execute(
            "SELECT bar_type, stage, COUNT(*) as cnt FROM items WHERE status='reservable' GROUP BY bar_type, stage ORDER BY bar_type, stage"
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


# == combine sell API ==


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
        conn.execute('UPDATE items SET status="combined" WHERE id IN (?,?)', (item1_id, item2_id))
        conn.execute(
            'INSERT INTO items (user_id, bar_type, stage, status, created_at) VALUES (?,?,?,"active",datetime("now","localtime"))',
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
    try:
        result = {}
        for bar_type in ['bronze', 'silver', 'gold']:
            # reservations 테이블에는 type 컬럼 없음 - match_round로 구매/판매 구분
            # match_round=1: 구매예약, match_round=2: 판매예약 (또는 전체 pending)
            total = conn.execute(
                "SELECT COUNT(*) as cnt FROM reservations WHERE bar_type=? AND status='pending'",
                (bar_type,)
            ).fetchone()['cnt']
            buy_count = conn.execute(
                "SELECT COUNT(*) as cnt FROM reservations WHERE bar_type=? AND status='pending' AND match_round=1",
                (bar_type,)
            ).fetchone()['cnt']
            sell_count = total - buy_count
            match_rate = round(sell_count / buy_count * 100, 1) if buy_count > 0 else 0
            result[bar_type] = {
                'buy_count': buy_count,
                'sell_count': sell_count,
                'match_rate': match_rate,
                'total': total
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
                      u.kakao_id as username
               FROM reservations r
               LEFT JOIN users u ON r.user_id = u.id
               ORDER BY r.created_at DESC LIMIT 100'''
        ).fetchall()
        return jsonify(reservations=[dict(row) for row in rows])
    finally:
        conn.close()

@app.route('/api/admin/add-reservation', methods=['POST'])
@jwt_required()
def admin_add_reservation():
    data = request.json or {}
    bar_type = data.get('bar_type')
    res_type = data.get('type', 'buy')
    count = int(data.get('count', 1))
    stage = int(data.get('stage', 1))
    conn = get_db()
    try:
        # reservations 테이블: item_id, bar_type, match_round, reserve_date, status
        today = __import__('datetime').date.today().isoformat()
        for _ in range(count):
            conn.execute(
                "INSERT INTO reservations (user_id, item_id, bar_type, match_round, reserve_date, status) VALUES (1, 0, ?, ?, ?, 'pending')",
                (bar_type, 1 if res_type == 'buy' else 2, today)
            )
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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
