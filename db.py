import sqlite3
import os

DB_PATH = os.environ.get('DB_PATH', os.path.join(os.path.dirname(os.path.abspath(__file__)), 'loopay.db'))

def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA foreign_keys=ON")
    return conn

def init_db():
    conn = get_db()
    c = conn.cursor()

    c.execute('''CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        kakao_id TEXT UNIQUE,
        nickname TEXT NOT NULL,
        email TEXT,
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
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS reservations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        bar_type TEXT NOT NULL,
        match_round INTEGER DEFAULT 1,
        reserve_date DATE NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','matched','unmatched','sold')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id),
        FOREIGN KEY(item_id) REFERENCES items(id)
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
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','paid','confirmed','failed')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(reservation_id) REFERENCES reservations(id)
    )''')

    c.execute('''CREATE TABLE IF NOT EXISTS charge_requests (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        amount INTEGER NOT NULL,
        points INTEGER NOT NULL,
        status TEXT DEFAULT 'pending' CHECK(status IN ('pending','confirmed','rejected')),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        confirmed_at DATETIME,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )''')

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

    conn.commit()
    _seed(conn)
    conn.close()

def _seed(conn):
    c = conn.cursor()
    c.execute("SELECT id FROM users WHERE kakao_id='demo_kakao_001'")
    if not c.fetchone():
        c.execute("""INSERT OR IGNORE INTO users (kakao_id, nickname, email, level, charge_points, exchange_points, cumulative_count)
                     VALUES ('demo_kakao_001','Ã­ÂÂÃªÂ¸Â¸Ã«ÂÂ','hong@test.com',3,2400,1200,524)""")
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
    1:{'bz_min':1,'bz_max':3,'sv_min':1,'sv_max':2,'gd_min':1,'gd_max':1,'cum':150},
    2:{'bz_min':4,'bz_max':5,'sv_min':2,'sv_max':3,'gd_min':1,'gd_max':2,'cum':450},
    3:{'bz_min':7,'bz_max':10,'sv_min':4,'sv_max':5,'gd_min':2,'gd_max':3,'cum':960},
    4:{'bz_min':9,'bz_max':10,'sv_min':5,'sv_max':6,'gd_min':3,'gd_max':4,'cum':1740},
    5:{'bz_min':11,'bz_max':12,'sv_min':6,'sv_max':7,'gd_min':4,'gd_max':5,'cum':2850},
    6:{'bz_min':14,'bz_max':15,'sv_min':8,'sv_max':8,'gd_min':6,'gd_max':6,'cum':4350},
    7:{'bz_min':18,'bz_max':20,'sv_min':9,'sv_max':10,'gd_min':7,'gd_max':8,'cum':6450},
    8:{'bz_min':21,'bz_max':25,'sv_min':11,'sv_max':13,'gd_min':8,'gd_max':9,'cum':9450},
    9:{'bz_min':27,'bz_max':28,'sv_min':14,'sv_max':15,'gd_min':10,'gd_max':11,'cum':12450},
    10:{'bz_min':32,'bz_max':34,'sv_min':17,'sv_max':18,'gd_min':12,'gd_max':13,'cum':None},
}
def get_sv_count(bz): return 5 if bz>=10 else 4
def get_gd_count(sv): return 3 if sv>=5 else 2
BRONZE_PRICES=[(1,5000,10500),(2,10500,16550),(3,16550,23200),(4,23200,30550),(5,30550,38600),(6,38600,47450),(7,47450,57200),(8,57200,67900),(9,67900,79700),(10,79700,92700),(11,92700,106950),(12,106950,122650),(13,122650,139900),(14,139900,158900),(15,158900,179750),(16,179750,202750),(17,202750,228000),(18,228000,255800),(19,255800,286400),(20,286400,320000),(21,320000,357000)]
SILVER_PRICES=[(1,5000,11720),(2,11720,19250),(3,19250,27700),(4,27700,37150),(5,37150,47700),(6,47700,59550),(7,59550,72800),(8,72800,87650),(9,87650,104300),(10,104300,122950),(11,122950,143800),(12,143800,167200),(13,167200,193400),(14,193400,222700),(15,222700,255550),(16,255550,292300),(17,292300,333500)]
GOLD_PRICES=[(1,5000,1300),(2,1300,22100),(3,22100,32450),(4,32450,44300),(5,44300,57750),(6,57750,73150),(7,73150,90650),(8,90650,110600),(9,110600,133400),(10,133400,159350),(11,159350,188900),(12,188900,222660),(13,222660,261100),(14,261100,304900),(15,304900,354900)]
PENALTY_TABLE=[(1,3,1000),(2,7,3000),(3,20,6000),(4,50,15000),(5,120,30000)]
