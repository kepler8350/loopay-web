from flask import Flask, request, jsonify, g, send_from_directory
from flask_cors import CORS
from flask_jwt_extended import JWTManager, create_access_token, jwt_required, get_jwt_identity
from werkzeug.security import check_password_hash
import datetime, sqlite3, os
from db import get_db, init_db, LEVEL_CONFIG, BRONZE_PRICES, SILVER_PRICES, GOLD_PRICES, PENALTY_TABLE, get_sv_count, get_gd_count

STATIC_DIR = os.path.join(os.path.dirname(__file__), 'static')
app = Flask(__name__, static_folder=STATIC_DIR, static_url_path='')
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

def price_table(bar_type):
    if bar_type == 'bronze': return BRONZE_PRICES
    if bar_type == 'silver': return SILVER_PRICES
    return GOLD_PRICES

def get_price(bar_type, stage):
    for s, buy, sell in price_table(bar_type):
        if s == stage: return buy, sell
    return 0, 0

def days_since(purchase_date_str):
    d = datetime.date.fromisoformat(purchase_date_str)
    return (datetime.date.today() - d).days + 1

def item_status_label(status, purchase_date):
    d = days_since(purchase_date)
    if status == 'sold': return 'Ã­ÂÂÃ«Â§Â¤Ã¬ÂÂÃ«Â£Â'
    if status == 'matched': return 'Ã«Â§Â¤Ã¬Â¹Â­Ã¬Â¤Â'
    if d < 3: return 'Ã«ÂÂÃªÂ¸Â°Ã¬Â¤Â'
    return 'Ã«Â§Â¤Ã¬Â¹Â­Ã¬ÂÂÃ¬ÂÂ½ÃªÂ°ÂÃ«ÂÂ¥'

@app.route('/api/auth/kakao-login', methods=['POST'])
def kakao_login():
    data = request.json or {}
    kakao_id = data.get('kakao_id')
    nickname = data.get('nickname', 'Ã¬ÂÂ¬Ã¬ÂÂ©Ã¬ÂÂ')
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
    reservable_bz = sum(1 for i in bronze if i['status_label']=='Ã«Â§Â¤Ã¬Â¹Â­Ã¬ÂÂÃ¬ÂÂ½ÃªÂ°ÂÃ«ÂÂ¥')
    reservable_sv = sum(1 for i in silver if i['status_label']=='Ã«Â§Â¤Ã¬Â¹Â­Ã¬ÂÂÃ¬ÂÂ½ÃªÂ°ÂÃ«ÂÂ¥')
    reservable_gd = sum(1 for i in gold   if i['status_label']=='Ã«Â§Â¤Ã¬Â¹Â­Ã¬ÂÂÃ¬ÂÂ½ÃªÂ°ÂÃ«ÂÂ¥')
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
        return jsonify(error=f'Ã«Â¸ÂÃ«Â¡Â Ã¬Â¦Â Ã¬ÂÂÃ¬ÂÂ½Ã¬ÂÂÃ«ÂÂ {cfg["bz_min"]}~{cfg["bz_max"]}ÃªÂ°Â Ã«Â²ÂÃ¬ÂÂÃ¬ÂÂ¬Ã¬ÂÂ¼ Ã­ÂÂ©Ã«ÂÂÃ«ÂÂ¤'), 400
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
        return jsonify(error='Ã¬ÂÂÃ¬ÂÂ½ Ã¬ÂÂÃ«ÂÂ Ã«Â²ÂÃ¬ÂÂ Ã¬Â´ÂÃªÂ³Â¼'), 400
    sv = get_sv_count(bz) if lv == 3 else cfg['sv_min']
    gd = get_gd_count(sv) if lv == 3 else cfg['gd_min']
    total = bz + sv + gd
    cost = total * 40
    total_pts = u['charge_points'] + u['exchange_points']
    if total_pts < cost:
        db.close()
        return jsonify(error=f'Ã­ÂÂ¬Ã¬ÂÂ¸Ã­ÂÂ¸ Ã«Â¶ÂÃ¬Â¡Â±. Ã­ÂÂÃ¬ÂÂ: {cost}P, Ã«Â³Â´Ã¬ÂÂ : {total_pts}P'), 400
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
    return jsonify(success=True,message=f'Ã«Â§Â¤Ã¬Â¹Â­Ã¬ÂÂÃ¬ÂÂ½ Ã¬ÂÂÃ«Â£Â! Ã¬Â´Â {total}Ã­ÂÂ, {cost}P Ã¬Â°Â¨ÃªÂ°Â',bronze=bz,silver=sv,gold=gd)

@app.route('/api/items', methods=['GET'])
@jwt_required()
def get_items():
    uid = int(get_jwt_identity())
    bar_type = request.args.get('bar_type')
    db = get_db()
    if bar_type:
        rows = db.execute("SELECT * FROM items WHERE user_id=? AND bar_type=? AND status!='sold'", (uid,bar_type)).fetchall()
    else:
        rows = db.execute("SELECT * FROM items WHERE user_id=? AND status!='sold'", (uid,)).fetchall()
    result = []
    for it in rows:
        buy, sell = get_price(it['bar_type'], it['stage'])
        result.append({'id':it['id'],'bar_type':it['bar_type'],'stage':it['stage'],'purchase_date':it['purchase_date'],'days':days_since(it['purchase_date']),'status_label':item_status_label(it['status'],it['purchase_date']),'buy_price':buy,'sell_price':sell,'profit':sell-buy})
    db.close()
    return jsonify(items=result)

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
        return jsonify(error='Ã¬ÂµÂÃ¬ÂÂ 1,000Ã¬ÂÂ Ã¬ÂÂ´Ã¬ÂÂ Ã¬Â¶Â©Ã¬Â Â ÃªÂ°ÂÃ«ÂÂ¥'), 400
    points = amount // 120
    db = get_db()
    db.execute("INSERT INTO charge_requests(user_id,amount,points) VALUES(?,?,?)", (uid,amount,points))
    db.commit()
    db.close()
    return jsonify(success=True,amount=amount,points=points,message=f'{amount:,}Ã¬ÂÂ Ã¢ÂÂ {points}P Ã¬Â¶Â©Ã¬Â Â Ã¬ÂÂÃ¬Â²Â­ Ã¬ÂÂÃ«Â£Â')

@app.route('/api/levels', methods=['GET'])
def get_levels():
    return jsonify(levels=LEVEL_CONFIG,cum_thresholds={'1Ã¢ÂÂ2':150,'2Ã¢ÂÂ3':450,'3Ã¢ÂÂ4':960,'4Ã¢ÂÂ5':1740,'5Ã¢ÂÂ6':2850,'6Ã¢ÂÂ7':4350,'7Ã¢ÂÂ8':6450,'8Ã¢ÂÂ9':9450,'9Ã¢ÂÂ10':12450})

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
    return jsonify(success=True,message=f'{cr["points"]}P Ã¬Â¶Â©Ã¬Â Â Ã¬ÂÂÃ«Â£Â')

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
    return jsonify(success=True,matched=matched,message=f'Ã«Â§Â¤Ã¬Â¹Â­ Ã¬ÂÂ¤Ã­ÂÂ Ã¬ÂÂÃ«Â£Â: {matched}ÃªÂ±Â´')

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
    return jsonify(schedule=[{'time':'05:00~13:00','label':'ÃªÂµÂ¬Ã«Â§Â¤ÃÂ·Ã­ÂÂÃ«Â§Â¤ Ã¬ÂÂÃ¬ÂÂ½','detail':'1Ã¬Â°Â¨ÃÂ·2Ã¬Â°Â¨ Ã¬ÂÂÃ¬ÂÂ½ Ã«ÂªÂ¨Ã«ÂÂ Ã¬ÂÂ´ Ã¬ÂÂÃªÂ°ÂÃ¬ÂÂ ÃªÂ°ÂÃ«ÂÂ¥'},{'time':'13:00~14:00','label':'1Ã¬Â°Â¨ Ã«Â§Â¤Ã¬Â¹Â­ Ã¬ÂÂÃªÂ¸Â','detail':'Ã«Â§Â¤Ã¬Â¹Â­ÃªÂ¸ÂÃ¬ÂÂ¡ Ã¬ÂÂÃªÂ¸Â Ã­ÂÂ Ã¬ÂÂ¡ÃªÂ¸ÂÃ¬ÂÂÃ«Â£Â Ã«Â²ÂÃ­ÂÂ¼ Ã­ÂÂ´Ã«Â¦Â­'},{'time':'14:00~15:00','label':'2Ã¬Â°Â¨ Ã«Â§Â¤Ã¬Â¹Â­','detail':'ÃªÂ´ÂÃ«Â¦Â¬Ã¬ÂÂ Ã«ÂªÂ¨Ã«ÂÂÃ¬ÂÂÃ¬ÂÂ Ã¬ÂÂ¤Ã­ÂÂ'},{'time':'15:00~19:00','label':'2Ã¬Â°Â¨ Ã«Â§Â¤Ã¬Â¹Â­ Ã¬ÂÂÃªÂ¸Â','detail':'19Ã¬ÂÂ Ã¬ÂÂ´Ã­ÂÂ Ã«Â²ÂÃ­ÂÂ¼ Ã«Â¹ÂÃ­ÂÂÃ¬ÂÂ±Ã­ÂÂ'},{'time':'19:00~20:00','label':'2Ã¬Â°Â¨ Ã«Â¯Â¸Ã¬ÂÂÃªÂ¸Â Ã­ÂÂÃ¬ÂÂ¸','detail':'Ã­ÂÂÃ«Â§Â¤Ã¬ÂÂ Ã¬ÂÂÃªÂ¸ÂÃ­ÂÂÃ¬ÂÂ¸ Ã«ÂÂÃ«ÂÂ Ã«Â¯Â¸Ã¬ÂÂÃªÂ¸Â Ã«Â²ÂÃ­ÂÂ¼'},{'time':'20:00~13:00','label':'Ã«Â§Â¤Ã¬Â¹Â­ Ã¬ÂÂ¤Ã­ÂÂ','detail':'ÃªÂ´ÂÃ«Â¦Â¬Ã¬ÂÂ Ã«ÂªÂ¨Ã«ÂÂÃ¬ÂÂÃ¬ÂÂ Ã¬ÂÂ¤Ã­ÂÂ'}])

@app.route('/api/admin/matching-status', methods=['GET'])
@jwt_required()
def admin_matching_status():
    identity = get_jwt_identity()
    if not identity.startswith('admin:'): return jsonify(error='Forbidden'), 403
    db = get_db()
    today = datetime.date.today().isoformat()

    def get_round_data(round_num):
        # 구매 예약 수 (reservations where match_round=round_num, status=pending)
        buy_count = db.execute(
            "SELECT COUNT(*) as c FROM reservations WHERE match_round=? AND reserve_date=? AND status='pending'",
            (round_num, today)
        ).fetchone()['c']

        # 판매 예약 수 (items where status='reservable')
        sell_count = db.execute(
            "SELECT COUNT(*) as c FROM items WHERE status='reservable'"
        ).fetchone()['c']

        # 매칭율
        if sell_count > 0:
            rate = round(min(buy_count, sell_count) / max(buy_count, sell_count) * 100, 1)
        else:
            rate = 0.0

        # 아이템별 판매예약 수
        by_type = db.execute(
            "SELECT bar_type, COUNT(*) as cnt FROM items WHERE status='reservable' GROUP BY bar_type"
        ).fetchall()

        # 아이템 단계별 판매예약 수
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

if __name__ == '__main__':
    port = int(os.environ.get('PORT', 8080))
    app.run(host='0.0.0.0', port=port, debug=False)
