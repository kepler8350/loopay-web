import sqlite3
import os

# DB 경로: 환경변수 DB_PATH > /data/loopay.db (Railway Volume) > 로컬
_volume_path = '/data/loopay.db'
_local_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'loopay.db')
DB_PATH = os.environ.get('DB_PATH', _volume_path if os.path.isdir('/data') else _local_path)

def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=60)
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")
        conn.execute("PRAGMA busy_timeout=60000")  # 60초 busy wait
        conn.execute("PRAGMA foreign_keys=ON")
        conn.execute("PRAGMA wal_autocheckpoint=100")
    except sqlite3.OperationalError:
        pass
    return conn

def init_db():
    import time
    for attempt in range(3):
        try:
            conn = get_db()
            break
        except sqlite3.OperationalError as e:
            if attempt < 2:
                time.sleep(2)
            else:
                raise
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kakao_id TEXT UNIQUE,
        username TEXT UNIQUE,
        password_hash TEXT,
        nickname TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        bank TEXT,
        account_no TEXT,
        account_name TEXT,
        approved INTEGER DEFAULT 0,
        level INTEGER DEFAULT 1,
        charge_points INTEGER DEFAULT 0,
        exchange_points INTEGER DEFAULT 0,
        cumulative_count INTEGER DEFAULT 0,
        auto_reserve INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')
    c.execute('''CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        bar_type TEXT NOT NULL CHECK(bar_type IN ('bronze','silver','gold')),
        stage INTEGER NOT NULL,
        purchase_date DATE NOT NULL,
        status TEXT DEFAULT 'waiting' CHECK(status IN ('waiting','reservable','matched','sold')),
        is_extra INTEGER DEFAULT 0,
        lucky_pair_id INTEGER DEFAULT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_id INTEGER,
        bar_type TEXT NOT NULL,
        match_round INTEGER DEFAULT 1,
        reserve_date DATE NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','matched','unmatched','sold','paid','confirmed','unpaid','cancelled')),
        memo TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS matches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        reservation_id INTEGER NOT NULL,
        buyer_id INTEGER NOT NULL,
        seller_id INTEGER NOT NULL,
        bar_type TEXT NOT NULL,
        stage INTEGER NOT NULL,
        buy_price INTEGER NOT NULL,
        sell_price INTEGER NOT NULL,
        match_round INTEGER DEFAULT 1,
        match_date DATE NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid','confirmed','failed','unpaid')),
        receipt_url TEXT,
        paid_at DATETIME,
        confirmed_at DATETIME,
        seller_bank TEXT,
        seller_account TEXT,
        seller_account_name TEXT,
        seller_phone TEXT,
        buyer_phone TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(reservation_id) REFERENCES reservations(id)
    )''')
    # 기존 테이블에 컬럼 추가 (이미 있으면 무시)
    for col_def in [
        "ALTER TABLE matches ADD COLUMN receipt_url TEXT",
        "ALTER TABLE matches ADD COLUMN paid_at DATETIME",
        "ALTER TABLE matches ADD COLUMN confirmed_at DATETIME",
        "ALTER TABLE matches ADD COLUMN seller_bank TEXT",
        "ALTER TABLE matches ADD COLUMN seller_account TEXT",
        "ALTER TABLE matches ADD COLUMN seller_account_name TEXT",
        "ALTER TABLE matches ADD COLUMN seller_phone TEXT",
        "ALTER TABLE matches ADD COLUMN buyer_phone TEXT",
        "ALTER TABLE reservations ADD COLUMN stage INTEGER DEFAULT 0",
        "ALTER TABLE reservations ADD COLUMN confirmed INTEGER DEFAULT 0",
    ]:
        try: c.execute(col_def)
        except: pass

    c.execute('''CREATE TABLE IF NOT EXISTS charge_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        points INTEGER NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
        receipt_phone TEXT DEFAULT '',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confirmed_at DATETIME,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')
    # 기존 DB에 receipt_phone 컬럼 없으면 추가
    try:
        c.execute("ALTER TABLE charge_requests ADD COLUMN receipt_phone TEXT DEFAULT ''")
        conn.commit()
    except Exception:
        pass

    c.execute('''CREATE TABLE IF NOT EXISTS penalties (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        unpaid_count INTEGER NOT NULL,
        suspend_days INTEGER NOT NULL,
        release_points INTEGER NOT NULL,
        is_released INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )''')

    # prices 테이블
    c.execute('''CREATE TABLE IF NOT EXISTS prices (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bar_type TEXT NOT NULL,
        stage INTEGER NOT NULL,
        buy_price INTEGER NOT NULL,
        sell_price INTEGER NOT NULL,
        UNIQUE(bar_type, stage)
    )''')
    # 기존 데이터 없으면 삽입
    if conn.execute("SELECT COUNT(*) FROM prices").fetchone()[0] == 0:
        for stage, buy, sell in BRONZE_PRICES:
            c.execute("INSERT OR IGNORE INTO prices(bar_type,stage,buy_price,sell_price) VALUES('bronze',?,?,?)", (stage,buy,sell))
        for stage, buy, sell in SILVER_PRICES:
            c.execute("INSERT OR IGNORE INTO prices(bar_type,stage,buy_price,sell_price) VALUES('silver',?,?,?)", (stage,buy,sell))
        for stage, buy, sell in GOLD_PRICES:
            c.execute("INSERT OR IGNORE INTO prices(bar_type,stage,buy_price,sell_price) VALUES('gold',?,?,?)", (stage,buy,sell))

    c.execute('''CREATE TABLE IF NOT EXISTS notifications (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        type TEXT NOT NULL DEFAULT 'info',
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        is_read INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT (datetime('now','localtime'))
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS lucky_buy_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        bar_type TEXT NOT NULL,
        item_a_id INTEGER,
        item_b_id INTEGER,
        seller_a_id INTEGER,
        seller_b_id INTEGER,
        new_item_id INTEGER,
        new_stage INTEGER NOT NULL,
        sell_a INTEGER DEFAULT 0,
        sell_b INTEGER DEFAULT 0,
        total_sell INTEGER DEFAULT 0,
        buyer_id INTEGER DEFAULT NULL,
        status TEXT DEFAULT 'confirmed',
        created_at DATETIME DEFAULT (datetime('now','localtime'))
    )''')

    conn.commit()
    _seed(conn)

    # 마이그레이션: 기존 DB에 신규 컬럼 추가
    # lucky_buy_results에 match_date 컬럼 추가
    try:
        c.execute("ALTER TABLE lucky_buy_results ADD COLUMN match_date TEXT")
        conn.commit()
    except Exception:
        pass

    for col_def in [
        ('username', 'TEXT'),
        ('password_hash', 'TEXT'),
        ('phone', 'TEXT'),
        ('bank', 'TEXT'),
        ('account_no', 'TEXT'),
        ('account_name', 'TEXT'),
        ('approved', 'INTEGER DEFAULT 0'),
    ]:
        try:
            c.execute(f'ALTER TABLE users ADD COLUMN {col_def[0]} {col_def[1]}')
            conn.commit()
        except Exception:
            pass

    # system_settings 테이블
    try:
        c.execute('''CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL DEFAULT '0',
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )''')
        c.execute("INSERT OR IGNORE INTO system_settings(key,value) VALUES('auto_approve','0')")
        conn.commit()
    except Exception:
        pass
    # 추가 컬럼 마이그레이션
    try:
        for _sql in [
            "ALTER TABLE users ADD COLUMN maintain_points INTEGER DEFAULT 0",
            "ALTER TABLE matches ADD COLUMN seller_item_id INTEGER",
            "ALTER TABLE matches ADD COLUMN points_deducted INTEGER DEFAULT 0",
            "ALTER TABLE notifications ADD COLUMN scheduled_at DATETIME",
        ]:
            try:
                conn.execute(_sql)
            except Exception:
                pass
        conn.commit()
    except Exception:
        pass
    conn.close()

def _seed(conn):
    c = conn.cursor()
    c.execute("SELECT id FROM users WHERE kakao_id='demo_kakao_001'")
    if not c.fetchone():
        c.execute("""INSERT OR IGNORE INTO users (kakao_id, nickname, email, level, charge_points, exchange_points, cumulative_count)
                     VALUES ('demo_kakao_001','홍길동','hong@test.com',3,2400,1200,524)""")
        uid = c.lastrowid
        if not uid:
            c.execute("SELECT id FROM users WHERE kakao_id='demo_kakao_001'")
            row = c.fetchone()
            uid = row[0] if row else None
        if not uid: return
        import datetime
        today = datetime.date.today()
        d_3 = (today - datetime.timedelta(days=2)).isoformat()
        d_4 = (today - datetime.timedelta(days=3)).isoformat()
        d_2 = (today - datetime.timedelta(days=1)).isoformat()
        items = [
            (uid,'bronze',3,d_3,'reservable'),(uid,'bronze',5,d_4,'reservable'),
            (uid,'bronze',2,d_3,'reservable'),(uid,'bronze',4,d_4,'reservable'),
            (uid,'bronze',1,d_2,'waiting'),(uid,'silver',2,d_4,'reservable'),
            (uid,'silver',3,d_2,'waiting'),(uid,'gold',1,d_2,'waiting'),
        ]
        c.executemany("INSERT INTO items(user_id,bar_type,stage,purchase_date,status) VALUES(?,?,?,?,?)", items)
    from werkzeug.security import generate_password_hash
    c.execute("SELECT id FROM admins WHERE username='admin'")
    if not c.fetchone():
        c.execute("INSERT OR IGNORE INTO admins(username,password_hash) VALUES('admin',?)",
                  (generate_password_hash('admin1234'),))
    conn.commit()

LEVEL_CONFIG = {
    1:{'bz_min':1,'bz_max':3,'sv_min':0,'sv_max':1,'gd_min':0,'gd_max':1,'cum':150},
    2:{'bz_min':4,'bz_max':6,'sv_min':0,'sv_max':3,'gd_min':0,'gd_max':2,'cum':450},
    3:{'bz_min':7,'bz_max':10,'sv_min':0,'sv_max':5,'gd_min':0,'gd_max':3,'cum':960},
    4:{'bz_min':11,'bz_max':14,'sv_min':0,'sv_max':7,'gd_min':0,'gd_max':5,'cum':1740},
    5:{'bz_min':15,'bz_max':20,'sv_min':0,'sv_max':9,'gd_min':0,'gd_max':7,'cum':2850},
    6:{'bz_min':21,'bz_max':27,'sv_min':0,'sv_max':13,'gd_min':0,'gd_max':9,'cum':4350},
    7:{'bz_min':28,'bz_max':34,'sv_min':0,'sv_max':17,'gd_min':0,'gd_max':12,'cum':6450}
}

# 레벨별 거래유지 포인트 비용 (월 30일, 3레벨부터 유료)
LEVEL_COST = {
    1: 0, 2: 0, 3: 100, 4: 200, 5: 350, 6: 500, 7: 700
}
LEVEL_UP_FEE = 100  # 레벨업 고정 비용 (어느 레벨이든 동일)

# 최고단계 아이템 분할 규칙
SPLIT_CONFIG = {
    'bronze': {'max_stage': 21, 'pieces': [{'stage': 9,  'count': 1}, {'stage': 10, 'count': 3}]},
    'silver':  {'max_stage': 17, 'pieces': [{'stage': 7,  'count': 1}, {'stage': 8,  'count': 3}]},
    'gold':    {'max_stage': 15, 'pieces': [{'stage': 7,  'count': 4}]},
}

# bz 수량 → sv 가능 수량 (레벨별 단계)
# 레벨1: bz=3→sv=1
# 레벨2: bz=4→2, bz=5→2, bz=6→3
# 레벨3: bz=7→4, bz=8,9→4, bz=10→5
# 레벨4: bz=11,12→6, bz=13,14→7
# 레벨5: bz=15~17→8, bz=18,19→8, bz=20→9
# 레벨6: bz=21~24→10, bz=25,26→11, bz=27→13
# 레벨7: bz=28~31→14, bz=32,33→15, bz=34→17
_BZ_TO_SV = {
    1:1, 2:1, 3:1,
    4:2, 5:2, 6:3,
    7:4, 8:4, 9:4, 10:5,
    11:6, 12:6, 13:7, 14:7,
    15:8, 16:8, 17:8, 18:8, 19:8, 20:9,
    21:10, 22:10, 23:10, 24:10, 25:11, 26:11, 27:13,
    28:14, 29:14, 30:14, 31:14, 32:15, 33:15, 34:17
}
# sv 수량 → gd 가능 수량
# 레벨1: sv=1→gd=1
# 레벨2: sv=2→1, sv=3→2
# 레벨3: sv=4→2, sv=5→3
# 레벨4: sv=6→4, sv=7→5
# 레벨5: sv=8→6, sv=9→7
# 레벨6: sv=10,11→8, sv=13→9
# 레벨7: sv=14,15→10,11, sv=17→12
_SV_TO_GD = {
    1:1, 2:1, 3:2,
    4:2, 5:3,
    6:4, 7:5,
    8:6, 9:7,
    10:8, 11:8, 12:8, 13:9,
    14:10, 15:11, 16:11, 17:12
}
def get_sv_count(bz):
    return _BZ_TO_SV.get(int(bz), 1 if bz<=3 else (17 if bz>=34 else 14))
def get_gd_count(sv):
    return _SV_TO_GD.get(int(sv), 1 if sv<=1 else (12 if sv>=17 else 10))
BRONZE_PRICES=[(1,5000,10500),(2,10500,16550),(3,16550,23200),(4,23200,30550),(5,30550,38600),(6,38600,47450),(7,47450,57200),(8,57200,67900),(9,67900,79700),(10,79700,92700),(11,92700,106950),(12,106950,122650),(13,122650,139900),(14,139900,158900),(15,158900,179750),(16,179750,202750),(17,202750,228000),(18,228000,255800),(19,255800,286400),(20,286400,320000),(21,320000,357000)]
SILVER_PRICES=[(1,5000,11720),(2,11720,19250),(3,19250,27700),(4,27700,37150),(5,37150,47700),(6,47700,59550),(7,59550,72800),(8,72800,87650),(9,87650,104300),(10,104300,122950),(11,122950,143800),(12,143800,167200),(13,167200,193400),(14,193400,222700),(15,222700,255550),(16,255550,292300),(17,292300,333500)]
GOLD_PRICES=[(1,5000,13000),(2,1300,22100),(3,22100,32450),(4,32450,44300),(5,44300,57750),(6,57750,73150),(7,73150,90650),(8,90650,110600),(9,110600,133400),(10,133400,159350),(11,159350,188900),(12,188900,222660),(13,222660,261100),(14,261100,304900),(15,304900,354900)]
PENALTY_TABLE=[(1,3,1000),(2,7,3000),(3,20,6000),(4,50,15000),(5,120,30000)]
