// ── 공통 커스텀 confirm 팝업 ──

// ── 판매예약 버튼 상태 통합 관리 ──
window._hasSellableItem = false;  // 초기값: 아이템 로드 전까지 false(비활성)
window._isReserveTimeCached = false;
function _updateSellBtn(isReserveTime){
  var _canSell = !!isReserveTime && !!window._hasSellableItem;
  var _title = !isReserveTime ? '구매·판매 예약은 05:00~20:00에만 가능합니다'
    : (!window._hasSellableItem ? '판매예약 가능한 아이템이 없습니다' : '');
  // 판매예약하기 버튼
  var btn = document.getElementById('sell-reserve-btn');
  if(btn){
    btn.disabled = !_canSell;
    btn.style.background = _canSell ? '#7b1fa2' : '#9e9e9e';
    btn.style.opacity = _canSell ? '1' : '0.7';
    btn.style.cursor = _canSell ? 'pointer' : 'not-allowed';
    btn.title = _title;
  }
  // 전체판매예약 버튼 (bar_type별)
  ['bulk-sell-btn-bronze','bulk-sell-btn-silver','bulk-sell-btn-gold'].forEach(function(id){
    var el = document.getElementById(id);
    if(!el) return;
    // 해당 bar_type의 판매가능 아이템이 있는지 (없으면 비활성)
    var _bt = id.replace('bulk-sell-btn-','');
    var _btSellable = _canSell && el._sellableIds && el._sellableIds.length > 0;
    el.disabled = !_btSellable;
    el.style.background = !_btSellable ? '#9e9e9e' : (el._allSelected ? '#546e7a' : '#7b1fa2');
    el.style.opacity = _btSellable ? '1' : '0.7';
    el.style.cursor = _btSellable ? '' : 'not-allowed';
    el.title = !isReserveTime ? '구매·판매 예약은 05:00~20:00에만 가능합니다'
      : (!window._hasSellableItem ? '판매예약 가능한 아이템이 없습니다' : '');
  });
}

// 아이템 목록으로 _hasSellableItem 설정 후 버튼 즉시 업데이트
// items: 배열({status_label,...}[]) 또는 딕셔너리({bronze:[],silver:[],gold:[]})
function _updateSellBtnFromItems(items){
  var _flatItems = [];
  if(Array.isArray(items)){
    _flatItems = items;
  } else if(items && typeof items === 'object'){
    Object.values(items).forEach(function(arr){ if(Array.isArray(arr)) _flatItems = _flatItems.concat(arr); });
  }
  window._hasSellableItem = _flatItems.some(function(it){ return it.status_label==='판매가능'; });
  // 서버 시간 직접 조회 (오프셋 미설정 문제 방지)
  fetch('/api/current-time').then(function(r){return r.json();}).then(function(ct){
    var _nowH = ct.hour != null ? ct.hour : parseInt((ct.time||'00:00').slice(11,13));
    window._isReserveTimeCached = (_nowH >= 5 && _nowH < 20);
    _updateSellBtn(window._isReserveTimeCached);
  }).catch(function(){
    var _nowH = getEffectiveDate().getHours();
    window._isReserveTimeCached = (_nowH >= 5 && _nowH < 20);
    _updateSellBtn(window._isReserveTimeCached);
  });
}


function showConfirm(opts){
  var ov = document.getElementById('common-confirm-overlay');
  if(!ov){ if(opts.onOk && confirm((opts.title||'확인')+'\n'+(opts.message||''))) opts.onOk(); else if(opts.onCancel) opts.onCancel(); return; }
  document.getElementById('common-confirm-title').innerHTML = opts.title||'확인';
  document.getElementById('common-confirm-body').innerHTML = opts.message||'';
  var okBtn = document.getElementById('common-confirm-ok-btn');
  var cancelBtn = document.getElementById('common-confirm-cancel-btn');
  okBtn.textContent = opts.okText||'확인';
  okBtn.style.background = opts.okColor||'';
  var newOk = okBtn.cloneNode(true); var newCancel = cancelBtn.cloneNode(true);
  okBtn.parentNode.replaceChild(newOk, okBtn); cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);
  newOk.onclick = function(){ _closeCommonConfirm(); if(opts.onOk) opts.onOk(); };
  newCancel.onclick = function(){ _closeCommonConfirm(); if(opts.onCancel) opts.onCancel(); };
  if(ov.parentElement!==document.body) document.body.appendChild(ov);
  ov.classList.add('show');
}
function _closeCommonConfirm(){
  var ov = document.getElementById('common-confirm-overlay');
  if(ov) ov.classList.remove('show');
}

// 판매탭 전역 변수 - 최상단 선언
var _sellUnpaidClickedAt = typeof _sellUnpaidClickedAt !== 'undefined' ? _sellUnpaidClickedAt : {};
var _sellServerHour = typeof _sellServerHour !== 'undefined' ? _sellServerHour : 0;
var _sellServerMin = typeof _sellServerMin !== 'undefined' ? _sellServerMin : 0;

var _sellSelected={}; // 판매예약 선택 상태
var _sellTabSelected={}; // 판매탭 선택 상태
// 계좌번호 복사 함수
function _copyAcct(acct, btn){
  if(!acct) return;
  navigator.clipboard.writeText(acct).then(function(){
    if(btn){ var orig=btn.textContent; btn.textContent='✅'; setTimeout(function(){ btn.textContent=orig; }, 1500); }
  }).catch(function(){
    // clipboard API 실패 시 fallback
    var el=document.createElement('textarea');
    el.value=acct; el.style.position='fixed'; el.style.opacity='0';
    document.body.appendChild(el); el.select();
    try{ document.execCommand('copy'); if(btn){ var orig=btn.textContent; btn.textContent='✅'; setTimeout(function(){btn.textContent=orig;},1500); } }catch(e){}
    document.body.removeChild(el);
  });
}

var _reservedToday=false; // 오늘 구매예약 완료 여부
var svCnt=0; var gdCnt=0; // 루비/다이아 선택 수량
var LEVEL_CFG_JS={
  1:{bz_min:0,bz_max:3,sv_min:0,sv_max:1,gd_min:0,gd_max:1,cum:150},
  2:{bz_min:0,bz_max:6,sv_min:0,sv_max:3,gd_min:0,gd_max:2,cum:450},
  3:{bz_min:0,bz_max:10,sv_min:0,sv_max:5,gd_min:0,gd_max:3,cum:960},
  4:{bz_min:0,bz_max:14,sv_min:0,sv_max:7,gd_min:0,gd_max:5,cum:1740},
  5:{bz_min:0,bz_max:20,sv_min:0,sv_max:9,gd_min:0,gd_max:7,cum:2850},
  6:{bz_min:0,bz_max:27,sv_min:0,sv_max:13,gd_min:0,gd_max:9,cum:4350},
  7:{bz_min:0,bz_max:34,sv_min:0,sv_max:17,gd_min:0,gd_max:12,cum:6450},
  8:{bz_min:0,bz_max:42,sv_min:0,sv_max:22,gd_min:0,gd_max:15,cum:9450},
  9:{bz_min:0,bz_max:51,sv_min:0,sv_max:27,gd_min:0,gd_max:20,cum:12450},
  10:{bz_min:0,bz_max:60,sv_min:0,sv_max:34,gd_min:0,gd_max:26,cum:null}
};
var combinePairs=[];var pendingItem=null;

const API = '/api';
var token = '';
var userData = null;
var bzCnt = 7;

// --- utils ----------------------------------------------------------------
// --- price ----------------------------------------------------------------
const PRICES={
  bronze:[[1,5000,10500],[2,10500,16550],[3,16550,23200],[4,23200,30550],[5,30550,38600],[6,38600,47450],[7,47450,57200],[8,57200,67900],[9,67900,79700],[10,79700,92700],[11,92700,106950],[12,106950,122650],[13,122650,139900],[14,139900,158900],[15,158900,179750],[16,179750,202750],[17,202750,228000],[18,228000,255800],[19,255800,286400],[20,286400,320000],[21,320000,357000]],
  silver:[[1,5000,11720],[2,11720,19250],[3,19250,27700],[4,27700,37150],[5,37150,47700],[6,47700,59550],[7,59550,72800],[8,72800,87650],[9,87650,104300],[10,104300,122950],[11,122950,143800],[12,143800,167200],[13,167200,193400],[14,193400,222700],[15,222700,255550],[16,255550,292300],[17,292300,333500]],
  gold:[[1,5000,13000],[2,13000,22100],[3,22100,32450],[4,32450,44300],[5,44300,57750],[6,57750,73150],[7,73150,90650],[8,90650,110600],[9,110600,133400],[10,133400,159350],[11,159350,188900],[12,188900,222660],[13,222660,261100],[14,261100,304900],[15,304900,354900]]
};

let combineSelected = [];
function toast(msg, dur=2500){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),dur);
}

async function api(path, opts={}){
  token = localStorage.getItem('lp_token')||''; const headers={'Content-Type':'application/json'};
  if(token) headers['Authorization']='Bearer '+token;
  const r = await fetch(API+path,{...opts,headers:{...headers,...(opts.headers||{})}});
  const data = await r.json();
  if(!r.ok) throw new Error(data.error||'오류 발생');
  return data;
}

// --- auth -----------------------------------------------------------------



async function showMainApp(){
  document.getElementById('login-screen').style.display='none';
  const m=document.getElementById('main-app');
  m.style.display='flex'; m.style.flexDirection='column'; m.style.height='100vh';

  updateTimeBanner();
}

// --- user data ------------------------------------------------------------
async function loadUserData(){
  // 서버 시간 동기화 (mock_time 반영) - 구매예약 시간 조건에 필요
  if(!window._syncInterval) await syncServerTime();
  try{
    const d=await api('/user/me');
    // 다른 유저로 전환 시 판매예약 선택 초기화
    if(userData && userData.id !== d.id){
      if(typeof _sellSelected !== 'undefined') { for(var k in _sellSelected) delete _sellSelected[k]; }
      if(typeof _itemCache !== 'undefined') { for(var k in _itemCache) delete _itemCache[k]; }
    }
    userData=d;
    renderHeader(d);
    renderBars(d);
    renderLevelTab();
    updateReserveByLevel();
    // 예약 여부를 먼저 설정 후 enableReserveSection 호출 (포인트 미리보기 오작동 방지)
    var _todayRes = d.today_reservations || {};
    _reservedToday = !!((_todayRes.bronze||0) + (_todayRes.silver||0) + (_todayRes.gold||0) > 0);
    if(!_reservedToday) enableReserveSection();
    updateReserveDefaults(d.level);  // UI 업데이트 (내부적으로 updateResUI 호출, _reservedToday 참조)
    if(_reservedToday){
      disableReserveSection();  // 버튼 텍스트/스타일 최종 적용
    }
    // 다음날 05:00 재활성화 타이머
    scheduleReserveReset();
    // 판매예약 버튼 업데이트 (my-items로 직접 확인)
    try {
      var _sellData2 = await api('/user/my-items');
      _updateSellBtnFromItems(_sellData2.items||[]);
    } catch(e2) { _updateSellBtnFromItems([]); }
  }catch(e){
    // API 실패 또는 새 회원 - 빈 초기값
    userData={
      level:1,charge_points:0,exchange_points:0,total_points:0,
      cumulative_count:0,next_level_cum:150,progress_pct:0,
      level_config:{bz_min:0,bz_max:3,sv_min:1,sv_max:2,gd_min:1,gd_max:1},
      items:{bronze:[],silver:[],gold:[]},
      reservable:{bronze:0,silver:0,gold:0},
      today_reservations:{bronze:0,silver:0,gold:0},
      reserve_counts:{bronze:0,silver:0,gold:0}
    };
    renderHeader(userData);
    renderBars(userData);
    renderLevelTab();
    updateReserveDefaults(1);
  }
  // 거래 정지 체크 - 모든 버튼 설정 후 마지막에 실행 (최우선 적용)
  checkSuspended(userData);
  loadPrices(); loadNotifBadge();
}

function renderHeader(d){
  document.getElementById('h-level').textContent=d.level+'레벨';
  // 레벨배지 색상 업데이트
  var lv=d.level||1;
  var badge=document.getElementById('h-userid-badge');
  var dot=document.getElementById('h-lv-dot');
  if(badge){badge.className='user-id-badge lv-'+lv;}
  if(dot){dot.className='lv-dot lv-'+lv;}
  document.getElementById('h-total').textContent=((d.total_points)||0).toLocaleString()+' P';
  var uidEl=document.getElementById('h-userid');
  if(uidEl) uidEl.textContent=d.username||d.nickname||'';;
  document.getElementById('h-sub').textContent='충전 '+(d.charge_points||0).toLocaleString()+'P + 전환 '+(d.exchange_points||0).toLocaleString()+'P';
  document.getElementById('h-charge').textContent=(d.charge_points||0).toLocaleString()+' P';
  document.getElementById('h-exchange').textContent=(d.exchange_points||0).toLocaleString()+' P';
  document.getElementById('h-cum').textContent=(d.cumulative_count||0).toLocaleString()+'회';
  const pct=d.progress_pct||0;
  document.getElementById('h-pct').textContent=pct.toFixed(1)+'% → '+(d.level+1)+'레벨 ('+(d.next_level_cum||'?')+'회)';
  document.getElementById('h-progfill').style.width=Math.min(100,pct)+'%';
  // highlight current level row in table
  document.querySelectorAll('.lv-table tr.cur').forEach(r=>r.classList.remove('cur'));
  const row=document.getElementById('lv-row-'+d.level);
  if(row) row.classList.add('cur');
  // highlight cum chip
  document.querySelectorAll('.cum-chip').forEach(c=>c.classList.remove('cur'));
  // 매칭유지포인트 = DB의 maintain_points 실제값
  var mEl=document.getElementById('h-maintain');
  if(mEl){
    var maintainPts = (d.maintain_points != null) ? d.maintain_points : 0;
    mEl.textContent = maintainPts.toLocaleString()+' P';
  }
}

function renderBars(d){
  const items=d.items||{}; const res=d.reservable||{}; const cfg=d.level_config||{};
  const types=['bronze','silver','gold'];
  const ids=['bz','sv','gd'];
  types.forEach((t,i)=>{
    const hold=(items&&items[t])?items[t].length:0;
    const rv=res[t]||0;
    document.getElementById(ids[i]+'-hold').textContent=hold+'개';
  });
  if(cfg){
    document.getElementById('bz-range').textContent=`구매예약: 최소 ${cfg.bz_min} ~ 최대 ${cfg.bz_max}`;
    document.getElementById('sv-range').textContent=`구매예약: 최소 ${cfg.sv_min} ~ 최대 ${cfg.sv_max}`;
    document.getElementById('gd-range').textContent=`구매예약: 최소 ${cfg.gd_min} ~ 최대 ${cfg.gd_max}`;
  }
  // Render item details
  types.forEach(t=>{
    const el=document.getElementById('detail-'+t+'-items');
    const list=items[t];
    if(!list||!list.length){el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">보유 아이템 없음<\/div>';return;}
    el.innerHTML=list.map(function(it){
      var barLabel=t==='bronze'?'수정':t==='silver'?'루비':'다이아';
      var badgeCls=it.status_label==='대기중'?'badge-wait':'badge-match';
      return '<div class="item-row">'
        +'<div class="item-hd">'
        +'<span class="item-stage">'+it.stage+'단계 '+barLabel+'<\/span>'
        +'<span class="badge '+badgeCls+'">'+it.status_label+'<\/span>'
        +'<\/div>'
        +'<div class="item-date">취득일: '+it.purchase_date+' ('+(it.days+1)+'일째)<\/div>'
        +'<div class="item-price">구매 '+it.buy_price.toLocaleString()+'원 → 판매 '+it.sell_price.toLocaleString()+'원 (차액 +'+(it.profit||0).toLocaleString()+')<\/div>'
        +'<\/div>';
    }).join('');
  });
}
function calcCharge(){
  var pts=parseInt(document.getElementById('charge-amount').value)||0;
  var won=pts*120;
  var el=document.getElementById('charge-result');
  if(el) el.textContent=pts>0?pts.toLocaleString()+'P → '+won.toLocaleString()+'원 입금':'';
}
async function requestCharge(){
  var pts=parseInt(document.getElementById('charge-amount').value)||0;
  var won=pts*120;
  if(pts<1){toast('충전 포인트를 입력해주세요.');return;}

  // ── 확인 팝업 ──
  showConfirm({
    title: '💳 충전 신청 확인',
    message: '충전 포인트: <b>'+pts.toLocaleString()+'P</b><br>입금 금액: <b>'+won.toLocaleString()+'원</b><br><br><span style="font-size:12px">📌 입금 계좌번호는 신청 후 알림에서 확인하세요.</span>',
    okText: '신청하기',
    onOk: async function(){
      try{
        var d=await api('/charge/request',{method:'POST',body:JSON.stringify({amount:won})});
        if(d.message){
          toast(d.message);
          document.getElementById('charge-amount').value='';
          document.getElementById('charge-result').textContent='';
        } else {
          toast('충전 신청 완료! '+pts.toLocaleString()+'P ('+won.toLocaleString()+'원)');
        }
      }catch(e){
        toast('신청 실패: '+e.message);
      }
    }
  });
}


function loadPrices(){
  ['bronze','silver','gold'].forEach(t=>{
    const rows=PRICES[t].map(([s,b,sl])=>`<tr><td>${s}<\/td><td>${b.toLocaleString()}<\/td><td>${sl.toLocaleString()}<\/td><td class="${sl-b>=0?'tag-pos':'tag-neg'}">${sl-b>=0?'+':''}${(sl-b).toLocaleString()}<\/td><\/tr>`).join('');
    document.getElementById('price-'+t).innerHTML=`<table class="price-table"><tr><th>단계<\/th><th>구매(원)<\/th><th>판매(원)<\/th><th>차액<\/th><\/tr>${rows}<\/table>`;
  });
}

function showBarPrice(type,btn){
  ['bronze','silver','gold'].forEach(t=>document.getElementById('price-'+t).style.display=t===type?'block':'none');
  btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

// --- tabs -----------------------------------------------------------------
var LEVEL_CONFIG_JS={
  1:{bz_min:0,bz_max:3,sv_min:0,sv_max:1,gd_min:0,gd_max:1,cum:150},
  2:{bz_min:0,bz_max:6,sv_min:2,sv_max:3,gd_min:1,gd_max:2,cum:450},
  3:{bz_min:0,bz_max:10,sv_min:4,sv_max:5,gd_min:2,gd_max:3,cum:960},
  4:{bz_min:0,bz_max:14,sv_min:6,sv_max:7,gd_min:4,gd_max:5,cum:1740},
  5:{bz_min:0,bz_max:20,sv_min:8,sv_max:9,gd_min:6,gd_max:7,cum:2850},
  6:{bz_min:0,bz_max:27,sv_min:10,sv_max:13,gd_min:8,gd_max:9,cum:4350},
  7:{bz_min:0,bz_max:34,sv_min:14,sv_max:17,gd_min:10,gd_max:12,cum:6450},
  8:{bz_min:0,bz_max:42,sv_min:18,sv_max:22,gd_min:13,gd_max:15,cum:9450},
  9:{bz_min:0,bz_max:51,sv_min:23,sv_max:27,gd_min:16,gd_max:20,cum:12450},
  10:{bz_min:0,bz_max:60,sv_min:28,sv_max:34,gd_min:21,gd_max:26,cum:99999},
};


// --- detail toggle ---------------------------------------------------------

// --- admin ----------------------------------------------------------------
let adminToken='';
function showAdminModal(){document.getElementById('admin-modal').style.display='flex';}
function closeAdminModal(){document.getElementById('admin-modal').style.display='none';}

async function adminLogin(){
  const u=document.getElementById('adm-user').value;
  const p=document.getElementById('adm-pass').value;
  try{
    const d=await api('/auth/admin-login',{method:'POST',body:JSON.stringify({username:u,password:p})});
    adminToken=d.token; closeAdminModal(); showAdminPanel();
  }catch(e){toast('관리자 로그인 실패: '+e.message);}
}

async function showAdminPanel(){
  document.getElementById('admin-panel').style.display='block';
  const savedToken=token; token=adminToken;
  try{
    const stats=await api('/admin/stats');
    document.getElementById('admin-stats').innerHTML=[
      ['총 회원',stats.total_users],['보유 아이템',stats.total_items],
      ['충전 대기',stats.pending_charges],['오늘 예약',stats.today_reserves]
    ].map(([l,v])=>`<div style="flex:1;background:var(--bg2);border-radius:8px;padding:10px;text-align:center"><div style="font-size:11px;color:var(--text2)">${l}<\/div><div style="font-size:18px;font-weight:700">${v}<\/div><\/div>`).join('');

    const charges=await api('/admin/charges');
    document.getElementById('admin-charges').innerHTML=charges.charges.length?
      charges.charges.map(c=>`<div style="background:var(--bg2);border-radius:8px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:13px;font-weight:600">${c.nickname}<\/div><div style="font-size:12px;color:var(--text2)">${c.amount.toLocaleString()}
        <button onclick="confirmCharge(${c.id})" style="padding:7px 14px;background:var(--blue);color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600">확인<\/button>
      <\/div>`).join(''):
      '<div style="color:var(--text2);font-size:13px;padding:8px">대기 중인 충전 신청 없음<\/div>';
  }catch(e){document.getElementById('admin-charges').textContent='데이터 로드 실패';}
  token=savedToken;
}

async function confirmCharge(id){
  const saved=token; token=adminToken;
  try{
    const d=await api(`/admin/charge/confirm/${id}`,{method:'POST'});
    toast(d.message); showAdminPanel();
  }catch(e){toast('오류: '+e.message);}
  token=saved;
}

async function runMatching(){
  const saved=token; token=adminToken;
  try{
    const d=await api('/admin/run-matching',{method:'POST'});
    toast(d.message);
  }catch(e){toast('매칭 실행 오류: '+e.message);}
  token=saved;
}

function closeAdminPanel(){document.getElementById('admin-panel').style.display='none';}

// --- init -----------------------------------------------------------------

if(token){showMainApp();loadUserData();}
loadPrices();

// ── 매칭 완료 자동 새로고침 (30초마다 체크) ──
var _lastMatchState = null;
async function checkMatchRefresh(){
  if(!localStorage.getItem('lp_token')) return;
  try{
    var d = await api('/user/me');
    var curState = JSON.stringify({
      bronze: d.items?.bronze?.length,
      silver: d.items?.silver?.length,
      gold: d.items?.gold?.length,
      maintain: d.maintain_points,
      total: d.total_points
    });
    if(_lastMatchState && _lastMatchState !== curState){
      // 상태 변경 감지 → 이미 받은 최신 d로 즉시 갱신 (포인트 정산 포함)
      userData = d;
      renderHeader(d);
      renderBars && renderBars(d);
      renderLevelTab && renderLevelTab();
      // loadUserData로 나머지 UI도 갱신 (비동기, 포인트표시 재확정 포함)
      loadUserData().then(function(){
        if(window.userData) renderHeader(window.userData);
      });
    }
    _lastMatchState = curState;
  }catch(e){}
}
setInterval(checkMatchRefresh, 30000);
setInterval(loadNotifBadge, 20000);  // 20초마다 알림 체크 → 새 알림 시 포인트 갱신

// 결합판매
function getStatusBadge(s){
  if(s==='active'||s==='reservable'||!s)
    return '<span style="background:#e8f5e9;color:#2e7d32;font-size:10px;padding:1px 5px;border-radius:6px;margin-left:4px">보유<\/span>';
  if(s==='pending'||s==='matched')
    return '<span style="background:#fff3e0;color:#e65100;font-size:10px;padding:1px 5px;border-radius:6px;margin-left:4px">매칭중<\/span>';
  return '';
}
// ── combine 판매 ──────────────────────────────────────────
// combineSelected: [{id, barType, stage}, ...]  (짝수 개 유지)
// 홀수 번째(0-indexed)가 첫번째, 짝수 번째가 두번째 → 2개씩 쌍

async function loadCombineItems(){
  var list=document.getElementById('combine-items-list');
  if(!list) return;
  var _tok=localStorage.getItem('lp_token')||'';
  if(!_tok){list.innerHTML='<div class="empty-msg">로그인이 필요합니다.<\/div>';return;}
  try{
    var _r=await fetch('/api/items',{headers:{'Authorization':'Bearer '+_tok}});
    if(!_r.ok){list.innerHTML='<div class="empty-msg">로드 실패<\/div>';return;}
    var d=await _r.json();
    var _allItems=(Array.isArray(d)?d:(d.items_flat||[]));
    // 판매가능 아이템만 결합 대상으로 필터
    // 보유중(reservable/active) 아이템만 결합 가능 (판매가능일 무관), waiting(결합아이템) 재결합 불가
    // 결합판매: 판매가능일 관계없이 보유중(reservable/active) 아이템 결합 가능
    window._combineAllItems=_allItems.filter(function(it){ return (it.status==='reservable'||it.status==='active') && it.status!=='waiting'; });
    combineSelected=[];
    renderCombineList();
    renderCombinePairs();
  }catch(e){list.innerHTML='<div class="empty-msg">'+e.message+'<\/div>';}
}

function renderCombineList(){
  // 보유 아이템 없으면 빈 메시지
  var totalItems=(userData&&userData.items)?(userData.items.bronze||[]).length+(userData.items.silver||[]).length+(userData.items.gold||[]).length:0;
  if(totalItems===0){
    var el=document.getElementById('combine-items-list');
    if(el) el.innerHTML='<div class=\"empty-msg\">📦 보유 아이템이 없습니다</div>';
    return;
  }
  var list=document.getElementById('combine-items-list');
  if(!list) return;
  var items=window._combineAllItems||[];
  var barNames={bronze:'수정',silver:'루비',gold:'다이아'};
  var barOrder=['bronze','silver','gold'];
  var grouped={bronze:[],silver:[],gold:[]};
  items.forEach(function(i){ if(grouped[i.bar_type]) grouped[i.bar_type].push(i); });
  var validTypes=barOrder.filter(function(bt){ return grouped[bt]&&grouped[bt].length>=2; });

  if(items.length===0){
    list.innerHTML='<div class="empty-msg" style="padding:20px;text-align:center;color:#888"><div style="font-size:32px;margin-bottom:8px">📦</div>아이템이 없습니다.<br><span style="font-size:12px">우선 아이템을 구매하세요.</span></div>';
    return;
  }
  if(!validTypes.length){
    var hasList=barOrder.filter(function(bt){ return grouped[bt]&&grouped[bt].length>=1; });
    var msg='결합판매는 각 종류별 2개 이상 필요합니다.';
    if(hasList.length){
      msg+='<br><span style="font-size:12px;color:#aaa">현재 보유: ';
      msg+=hasList.map(function(bt){ return barNames[bt]+' '+grouped[bt].length+'개'; }).join(', ');
      msg+='</span>';
    }
    list.innerHTML='<div class="empty-msg" style="padding:20px;text-align:center;color:#888"><div style="font-size:32px;margin-bottom:8px">🔗</div>'+msg+'</div>';
    return;
  }

  list.innerHTML=validTypes.map(function(bt){
    var cards=grouped[bt].map(function(i){
      var isSel=combinePairs.some(function(pair){ return pair.item1.id===i.id||pair.item2.id===i.id; })||(pendingItem&&pendingItem.id===i.id);
      var styleVal=isSel?'display:none':'';
      var btnLabel=isSel?'✓':'+';
      return '<div class="combine-item-card'+(isSel?' selected':'')+'" id="ci-'+i.id+'" data-id="'+i.id+'" data-bt="'+i.bar_type+'" data-st="'+i.stage+'" style="'+styleVal+'">'
        +'<div class="item-stage">'+i.stage+'단계</div>'
        +'<div class="item-price">'+(i.buy_price?i.buy_price.toLocaleString():'')+'원</div>'
        +'<button onclick="ciToggle(this)">'+btnLabel+'</button>'
        +'</div>';
    }).join('');
    return '<div class="combine-group"><div class="combine-group-title">'+barNames[bt]+'</div>'
      +'<div class="combine-group-grid">'+cards+'</div></div>';
  }).join('');
}

function ciToggle(btn){
  var card=btn.closest('[data-id]');
  if(!card) return;
  var id=parseInt(card.dataset.id);
  var bt=card.dataset.bt;
  var st=parseInt(card.dataset.st);

  // 이미 쌍에 포함된 카드는 클릭 무시 (display:none 상태)
  if(card.style.display==='none') return;

  if(!pendingItem){
    // 첫 번째 선택
    pendingItem={id:id,barType:bt,stage:st};
    card.style.display='none';
    renderCombinePairs();
  } else {
    // 두 번째 선택 → 쌍 완성
    var pair={item1:pendingItem, item2:{id:id,barType:bt,stage:st}};
    pendingItem=null;
    card.style.display='none';
    combinePairs.push(pair);
    renderCombinePairs();
    // 새 쌍 preview 로드
    var pairIdx=combinePairs.length-1;
    loadPairPreview(pairIdx, pair.item1, pair.item2);
  }
}

function removeFromCombine(pairIdx){
  var pair=combinePairs[pairIdx];
  if(!pair) return;
  // 두 카드 모두 복원
  [pair.item1, pair.item2].forEach(function(it){
    var c=document.getElementById('ci-'+it.id);
    if(c){c.style.display=''; var b=c.querySelector('button'); if(b) b.innerHTML='+';}
  });
  combinePairs.splice(pairIdx,1);
  renderCombinePairs();
}

function renderCombinePairs(){
  var sel=document.getElementById('combine-selected');
  var container=document.getElementById('combine-sel-info');
  var pr=document.getElementById('combine-preview-result');
  var execBtn=document.getElementById('combine-exec-btn');
  if(!sel) return;

  var totalItems=combinePairs.length*2+(pendingItem?1:0);
  if(totalItems===0&&!pendingItem){
    sel.style.display='none';
    if(pr) pr.innerHTML='';
    if(execBtn) execBtn.style.display='none';
    return;
  }
  sel.style.display='block';

  var barName=function(t){return t==='bronze'?'수정':t==='silver'?'루비':'다이아';};
  var pairColors=[['#4fc3f7','#000'],['#66bb6a','#fff'],['#ffb74d','#000'],['#ba68c8','#fff'],['#f06292','#fff'],['#4db6ac','#fff']];

  // ── container: 쌍별 독립 블록 ──
  if(container){
    var html='';
    // 완성된 쌍들
    combinePairs.forEach(function(pair,pi){
      var c1=pairColors[pi*2%pairColors.length];
      var c2=pairColors[(pi*2+1)%pairColors.length];
      html+='<div style="margin-bottom:14px;padding:10px 12px;background:rgba(255,255,255,0.04);border:1px solid #333;border-radius:10px">';
      // 뱃지 줄
      html+='<div style="display:flex;align-items:center;gap:6px;margin-bottom:8px;flex-wrap:wrap">';
      html+='<span style="background:'+c1[0]+';color:'+c1[1]+';padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700">'+barName(pair.item1.barType)+' '+pair.item1.stage+'단계</span>';
      html+='<span style="color:#aaa">+</span>';
      html+='<span style="background:'+c2[0]+';color:'+c2[1]+';padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700">'+barName(pair.item2.barType)+' '+pair.item2.stage+'단계</span>';
      html+='<button onclick="removeFromCombine('+pi+')" style="margin-left:auto;background:#c62828;border:none;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px">전체 삭제</button>';
      html+='</div>';
      // 결과 영역 (id로 나중에 채움)
      html+='<div id="pair-preview-'+pi+'" style="font-size:12px;color:#aaa">계산 중...</div>';
      html+='</div>';
    });
    // 대기 중인 첫 번째 선택
    if(pendingItem){
      var c=pairColors[(combinePairs.length*2)%pairColors.length];
      html+='<div style="margin-bottom:14px;padding:10px 12px;background:rgba(255,255,255,0.04);border:1px dashed #555;border-radius:10px">';
      html+='<div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">';
      html+='<span style="background:'+c[0]+';color:'+c[1]+';padding:4px 10px;border-radius:12px;font-size:12px;font-weight:700">'+barName(pendingItem.barType)+' '+pendingItem.stage+'단계</span>';
      html+='<span style="color:#aaa;font-size:12px">하나 더 선택하세요</span>';
      html+='<button onclick="cancelPending()" style="margin-left:auto;background:#555;border:none;color:#fff;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:11px">취소</button>';
      html+='</div>';
      html+='</div>';
    }
    container.innerHTML=html;

    // preview 영역 채우기 (이미 로드된 쌍)
    combinePairs.forEach(function(pair,pi){
      if(pair._preview) renderPairResult(pi, pair._preview);
    });
  }

  // 실행 버튼
  if(execBtn){
    if(combinePairs.length>0){
      execBtn.style.display='block';
      // 결합 불가 쌍이 있으면 버튼 비활성화
      var hasBlocked = combinePairs.some(function(pair){ return pair._preview && !pair._preview.can_combine; });
      execBtn.disabled = hasBlocked;
      execBtn.style.opacity = hasBlocked ? '0.4' : '1';
      execBtn.style.cursor = hasBlocked ? 'not-allowed' : 'pointer';
      execBtn.title = hasBlocked ? '결합 불가 쌍이 있습니다 (수익 23,000원 초과)' : '';
      execBtn.innerHTML='결합판매 실행 ('+combinePairs.length+'쌍 × 250P)'+(hasBlocked?' ⛔':'');
    } else {
      execBtn.style.display='none';
    }
  }
  if(pr) pr.innerHTML='';
}

function cancelPending(){
  if(!pendingItem) return;
  var card=document.getElementById('ci-'+pendingItem.id);
  if(card){card.style.display=''; var b=card.querySelector('button'); if(b) b.innerHTML='+';}
  pendingItem=null;
  renderCombinePairs();
}

function loadPairPreview(pairIdx, item1, item2){
  var tok=localStorage.getItem('lp_token')||'';
  fetch('/api/combine/preview',{method:'POST',
    headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
    body:JSON.stringify({item1_id:item1.id,item2_id:item2.id})})
  .then(function(r){return r.json();})
  .then(function(resp){
    if(combinePairs[pairIdx]) combinePairs[pairIdx]._preview=resp;
    renderPairResult(pairIdx, resp);
  })
  .catch(function(e){
    var el=document.getElementById('pair-preview-'+pairIdx);
    if(el) el.innerHTML='<span style="color:#c62828">'+e.message+'</span>';
  });
}

function renderPairResult(pairIdx, resp){
  var el=document.getElementById('pair-preview-'+pairIdx);
  if(!el) return;
  if(resp.can_combine){
    el.innerHTML='<div class="row"><span class="label">결합 구매가</span><span class="val">'+resp.total_buy.toLocaleString()+'원</span></div>'
      +'<div class="row"><span class="label">결합 판매 단계</span><span class="val yellow">'+resp.combined_stage+'단계</span></div>'
      +'<div class="row"><span class="label">결합 판매가</span><span class="val green">'+resp.combined_sell.toLocaleString()+'원</span></div>'
      +'<div class="row"><span class="label">포인트 비용</span><span class="val red">250P (30,000원)</span></div>'
      +'<div class="row" style="border-top:1px solid #333;margin-top:5px;padding-top:5px">'
      +'<span class="label" style="font-weight:700">최종 차액</span>'
      +'<span class="val green" style="font-size:14px;font-weight:700">'+resp.net_profit.toLocaleString()+'원</span></div>';
  } else {
    el.innerHTML='<span style="color:#c62828;font-size:13px">'+(resp.error||'결합 불가')+'</span>';
  }
}

function executeCombine(){
  if(combinePairs.length===0){alert('선택된 쌍이 없습니다.');return;}
  // 결합 불가 쌍 사전 체크 (수익 23,000원 초과 등)
  var blocked = combinePairs.filter(function(pair){ return pair._preview && !pair._preview.can_combine; });
  if(blocked.length > 0){
    alert('결합 불가 쌍이 있습니다.\n차익합계가 23,000원을 초과하면 결합할 수 없습니다.');
    return;
  }
  var tok=localStorage.getItem('lp_token')||'';
  var btn=document.getElementById('combine-exec-btn');
  if(btn) btn.disabled=true;
  var promises=combinePairs.map(function(pair){
    return fetch('/api/combine/execute',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body:JSON.stringify({item1_id:pair.item1.id,item2_id:pair.item2.id})})
    .then(function(r){return r.json();});
  });
  Promise.all(promises)
  .then(function(results){
    var ok=results.filter(function(r){return r.success;}).length;
    combinePairs=[];pendingItem=null;
    renderCombinePairs();
    loadCombineItems();
    loadUserData();
    alert(ok+'쌍 결합판매 완료! ('+ok*250+'P 차감)');
  })
  .catch(function(e){
    alert('오류: '+e.message);
    if(btn) btn.disabled=false;
  });
}

function refreshApp(){
  // 페이지 리로드 없이 데이터만 갱신 (로그인 상태 유지)
  if(typeof loadUserData === 'function') loadUserData();
  if(typeof updateTimeBanner === 'function') updateTimeBanner();
}

function toggleHeader(){
  var el = document.getElementById('header-collapsible');
  var icon = document.getElementById('header-toggle-icon');
  if(!el) return;
  if(el.style.display === 'none'){
    el.style.display = '';
    icon.textContent = '▲ 접기';
  } else {
    el.style.display = 'none';
    icon.textContent = '▼ 펼치기';
  }
}

function doLogout() {
  localStorage.removeItem('lp_token');
  localStorage.removeItem('lp_kakao_id');
  // 전역 userData/token 초기화
  userData = null;
  token = '';
  window._isSuspended = false;
  // 판매예약 선택 상태 및 캐시 초기화
  if(typeof _sellSelected !== 'undefined') { for(var k in _sellSelected) delete _sellSelected[k]; }
  if(typeof _itemCache !== 'undefined') { for(var k in _itemCache) delete _itemCache[k]; }
  // ★ 거래정지로 인해 비활성화된 버튼 스타일 초기화
  ['r-bz-m','r-bz-p','r-sv-m','r-sv-p','r-gd-m','r-gd-p'].forEach(function(id){
    var el=document.getElementById(id);
    if(el){ el.disabled=false; el.style.cursor=''; el.style.opacity=''; }
  });
  var reserveBtn = document.getElementById('reserve-btn');
  if(reserveBtn){ reserveBtn.disabled=false; reserveBtn.style.opacity=''; reserveBtn.style.cursor=''; reserveBtn.title=''; }
  _updateSellBtn(window._isReserveTimeCached);
  var banner = document.getElementById('suspend-banner');
  if(banner) banner.style.display='none';
  var badge = document.getElementById('suspend-badge');
  if(badge) badge.style.display='none';
  // 모든 동적 탭 콘텐츠 초기화
  _clearAllTabContents();
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
}

function _clearAllTabContents() {
  // 매칭 탭
  var buyEl = document.getElementById('match-buy-list');
  var sellEl = document.getElementById('match-sell-list');
  if(buyEl) buyEl.innerHTML = '';
  if(sellEl) sellEl.innerHTML = '';
  // 알림 탭
  var notifEl = document.getElementById('notif-list');
  if(notifEl) notifEl.innerHTML = '';
  // 탭 active 클래스 초기화 (홈 탭만 active)
  document.querySelectorAll('.tab').forEach(function(t){ t.classList.remove('active'); });
  var homeTab = document.getElementById('tab-home');
  if(homeTab) homeTab.classList.add('active');
  document.querySelectorAll('.nav-btn').forEach(function(b){ b.classList.remove('active'); });
  var homeBtn = document.querySelector(".nav-btn[onclick*=\"'home'\"]");
  if(homeBtn) homeBtn.classList.add('active');
}

function onlyDigits(el){
  var v=el.value.replace(/[^0-9]/g,'');
  if(el.value!==v) el.value=v;
}
function onUsername(el){
  // 영소문자·숫자만 허용, 대문자는 소문자로
  var v=el.value.toLowerCase().replace(/[^a-z0-9]/g,'');
  if(el.value!==v) el.value=v;
  var err=document.getElementById('reg-username-error');
  if(!err) return;
  if(v.length===0){ err.textContent=''; return; }
  if(v.length<6){ err.textContent='⚠️ 6자 이상 입력해주세요.'; }
  else if(v.length>16){ el.value=v.slice(0,16); err.textContent='⚠️ 16자 이하로 입력해주세요.'; }
  else { err.textContent=''; }
}
function showLogin(){
  document.getElementById('login-form').style.display='';
  document.getElementById('register-form').style.display='none';
  document.getElementById('register-done').style.display='none';
  document.getElementById('login-error').textContent='';
}
function showRegister(){
  document.getElementById('login-form').style.display='none';
  document.getElementById('register-form').style.display='';
  document.getElementById('register-done').style.display='none';
  document.getElementById('register-error').textContent='';
}
async function doLogin(){
  var username=document.getElementById('login-username').value.trim();
  var password=document.getElementById('login-password').value;
  var errEl=document.getElementById('login-error');
  errEl.textContent='';
  if(!username||!password){errEl.textContent='아이디와 비밀번호를 입력해주세요.';return;}
  try{
    var r=await fetch('/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password})});
    var d=await r.json();
    if(!r.ok){errEl.textContent=d.error||'로그인 실패';return;}
    localStorage.setItem('lp_token',d.access_token);
    await loadUserData();
    // 로그인 전 이전 사용자 데이터 완전 초기화
    _clearAllTabContents();
    document.getElementById('login-screen').style.display='none';
    document.getElementById('main-app').style.display='flex';
    startTimeBar();
    // 로그인 후 홈 탭 기본 표시
    var homeBtn=document.querySelector(".nav-btn[onclick*=\"'home'\"]");
    if(homeBtn) showTab('home',homeBtn);
  }catch(e){errEl.textContent='서버 오류: '+e.message;}
}
async function doRegister(){
  var username=document.getElementById('reg-username').value.trim();
  var password=document.getElementById('reg-password').value;
  var phone=document.getElementById('reg-phone').value.trim();
  var bank=document.getElementById('reg-bank').value.trim();
  var accountNo=document.getElementById('reg-account-no').value.trim();
  var accountName=document.getElementById('reg-account-name').value.trim();
  var errEl=document.getElementById('register-error');
  errEl.textContent='';
  if(!username||!password){errEl.textContent='아이디와 비밀번호는 필수입니다.';return;}if(!/^[a-z0-9]{6,16}$/.test(username)){errEl.textContent='아이디는 영문 소문자/숫자 6~16자여야 합니다.';return;}
  try{
    var realName=(document.getElementById('reg-real-name')?.value||'').trim();
    if(!realName){errEl.textContent='본인 이름을 입력해주세요';return;}
    // 이름/예금주 일치 검증 (예금주 입력시 반드시 일치해야 함)
    if(!accountName){errEl.textContent='예금주명을 입력해주세요.';return;}
    if(realName !== accountName){
      errEl.textContent='본인 이름과 예금주명이 일치해야 합니다.';return;
    }
    var r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username,password,phone,bank,account_no:accountNo,account_name:accountName,real_name:realName})});
    var d=await r.json();
    if(!r.ok){errEl.textContent=d.error||'회원가입 실패';return;}
    // 가입 완료 화면 표시
    document.getElementById('register-form').style.display='none';
    var doneEl = document.getElementById('register-done');
    if(doneEl){
      doneEl.style.display='';
      var msgEl = document.getElementById('register-done-msg');
      if(msgEl) msgEl.textContent = d.auto_approved ? '가입이 완료되었습니다! 바로 로그인하세요.' : '관리자 승인 후 로그인 가능합니다.';
    }
  }catch(e){errEl.textContent='서버 오류: '+e.message;}
}
function demoLogin(btn){
  if(btn){btn.disabled=true;btn.textContent="Loading...";}
  fetch("/api/auth/demo-login",{method:"POST",headers:{"Content-Type":"application/json"},body:"{}"})
  .then(function(r){return r.json();})
  .then(function(d){
    if(!d.access_token){
      alert(d.error||"Error");
      if(btn){btn.disabled=false;btn.textContent="\uB370\uBAA8 \uACC4\uC815\uC73C\uB85C \uCCB4\uD5D8\uD558\uAE30";}
      return;
    }
    localStorage.setItem("lp_token",d.access_token);
    return fetch("/api/auth/init-demo-items",{method:"POST",headers:{"Authorization":"Bearer "+d.access_token,"Content-Type":"application/json"},body:"{}"})
    .then(function(){
      if(typeof loadUserData==="function") return loadUserData();
    })
    .then(function(){
      document.getElementById("login-screen").style.display="none";
      document.getElementById("main-app").style.display="flex";
      startTimeBar();
      var n=document.querySelector(".nav-btn");if(n)n.click();
    });
  })
  .catch(function(e){alert(e.message);})
  .finally(function(){if(btn){btn.disabled=false;btn.textContent="\uB370\uBAA8 \uACC4\uC815\uC73C\uB85C \uCCB4\uD5D8\uD558\uAE30";}});
}



// ── 레벨 탭: 현재 레벨 강조 + 연동규칙 표시 ──
var LEVEL_CFG_JS = {
  1:{bz_min:0,bz_max:3,sv_min:0,sv_max:1,gd_min:0,gd_max:1},
  2:{bz_min:0,bz_max:6,sv_min:2,sv_max:3,gd_min:1,gd_max:2},
  3:{bz_min:0,bz_max:10,sv_min:4,sv_max:5,gd_min:2,gd_max:3},
  4:{bz_min:0,bz_max:14,sv_min:6,sv_max:7,gd_min:4,gd_max:5},
  5:{bz_min:0,bz_max:20,sv_min:8,sv_max:9,gd_min:6,gd_max:7},
  6:{bz_min:0,bz_max:27,sv_min:10,sv_max:13,gd_min:8,gd_max:9},
  7:{bz_min:0,bz_max:34,sv_min:14,sv_max:17,gd_min:10,gd_max:12},
  8:{bz_min:0,bz_max:42,sv_min:18,sv_max:22,gd_min:13,gd_max:15},
  9:{bz_min:0,bz_max:51,sv_min:23,sv_max:27,gd_min:16,gd_max:20},
  10:{bz_min:0,bz_max:60,sv_min:28,sv_max:34,gd_min:21,gd_max:26}
};
function changeRes(t, delta){
  if(!userData) return;  // userData 로드 전엔 UI 업데이트 안 함
  var cfg=userData.level_config||LEVEL_CFG_JS[userData.level||1]||LEVEL_CFG_JS[1];
  var BZ_MIN=(cfg.bz_min!=null?cfg.bz_min:0), BZ_MAX=cfg.bz_max||3;
  var SV_MAX=cfg.sv_max||0, GD_MAX=cfg.gd_max||0;
  if(t==='bz'){
    bzCnt = Math.min(Math.max(bzCnt+delta, BZ_MIN), BZ_MAX);
    if(bzCnt < BZ_MAX){ svCnt=0; gdCnt=0; }
  } else if(t==='sv'){
    if(bzCnt >= BZ_MAX && SV_MAX > 0){
      svCnt = Math.min(Math.max(svCnt+delta, 0), SV_MAX);
      if(svCnt < SV_MAX) gdCnt=0;
    }
  } else if(t==='gd'){
    if(bzCnt >= BZ_MAX && svCnt >= SV_MAX && GD_MAX > 0){
      gdCnt = Math.min(Math.max(gdCnt+delta, 0), GD_MAX);
    }
  }
  var SV_MIN_R=(cfg.sv_min!=null?cfg.sv_min:0), SV_MAX_R=cfg.sv_max||0;
  var GD_MIN_R=(cfg.gd_min!=null?cfg.gd_min:0), GD_MAX_R=cfg.gd_max||0;
  updateResUI(BZ_MIN, BZ_MAX, SV_MIN_R, SV_MAX_R, GD_MIN_R, GD_MAX_R);
}
function getSv(bz){
  var cfg=(userData&&userData.level_config)||LEVEL_CFG_JS[1];
  return cfg.sv_max||0;
}
function getGd(sv){
  var cfg=(userData&&userData.level_config)||LEVEL_CFG_JS[1];
  return cfg.gd_max||0;
}

// ── 시간표 배너: 현재시간 기준 표시 ──
var SCHEDULE=[
  {s:5,e:20,text:'05:00~20:00 구매·판매 예약 시간'},
  {s:20,e:24,text:'20:00~05:00 매칭 대기 시간'},
  {s:0,e:5,text:'00:00~05:00 매칭 대기 시간'}
];
function updateTimeBanner(){
  var h=new Date().getHours();
  var banner=document.getElementById('time-banner');
  var bannerText=document.getElementById('time-banner-text');
  if(!banner||!bannerText)return;
  var SCHED=[
    {s:5,e:20,text:'📅 05:00~20:00 구매·판매 예약 시간'},
    {s:20,e:24,text:'🌙 20:00~05:00 매칭 대기 시간'},
    {s:0,e:5,text:'🌙 00:00~05:00 매칭 대기 시간'}
  ];
  var found=null;
  for(var i=0;i<SCHED.length;i++){
    var s=SCHED[i];
    if(s.s>=0&&s.e<=24&&h>=s.s&&h<s.e){found=s;break;}
  }
  if(!found) found={text:'🌙 현재 매칭 대기 시간'};
  banner.style.display='flex';
  bannerText.textContent=found.text;
}
updateTimeBanner();
setInterval(updateTimeBanner, 60000);
// ── 시간 bar 실시간 업데이트 ──
var SCHEDULE_TEXTS=[
  {s:5,e:20,text:'📅 05:00~20:00 구매·판매 예약 시간',color:'#1565c0'},
  {s:20,e:24,text:'🌙 20:00~05:00 매칭 대기',color:'#37474f'},
  {s:0,e:5,text:'🌙 00:00~05:00 매칭 대기',color:'#37474f'}
];
function updateTimeBar(){
  var SCHED=[
    {s:5,e:20,text:'📅 05:00~20:00 구매·판매 예약 시간',color:'#0d47a1'},
    {s:20,e:24,text:'🌙 20:00~05:00 매칭 대기',color:'#37474f'},
    {s:0,e:5,text:'🌙 00:00~05:00 매칭 대기',color:'#37474f'}
  ];
  var now=getEffectiveDate();
  var h=now.getHours(), m=now.getMinutes(), s=now.getSeconds();
  var days=['일','월','화','수','목','금','토'];
  var dateStr=(now.getMonth()+1)+'/'+now.getDate()+'('+days[now.getDay()]+')';
  var timeStr=String(h).padStart(2,'0')+':'+String(m).padStart(2,'0')+':'+String(s).padStart(2,'0');
  var dateEl=document.getElementById('tbar-date');
  var timeEl=document.getElementById('tbar-time');
  var schedEl=document.getElementById('tbar-schedule');
  var barEl=document.getElementById('time-bar');
  if(dateEl) dateEl.textContent=dateStr;
  if(timeEl) timeEl.textContent=timeStr;
  if(schedEl&&barEl){
    var found=null;
    for(var i=0;i<SCHED.length;i++){
      if(h>=SCHED[i].s && h<SCHED[i].e){found=SCHED[i];break;}
    }
    if(!found) found=SCHED[1];
    // 아래줄: 시간표 2번째 이하 항목 중 현재 시간에 해당하는 것 표시
    var SCHED2=[
      {s:5,e:13,text:'💸 1차 매칭 입금 (05:00~13:00)'},
      {s:13,e:14,text:'✅ 미입금 확인 (13:00~14:00)'},
      {s:14,e:15,text:'⚡ 2차 매칭 (14:00~15:00)'},
      {s:15,e:19,text:'💸 2차 매칭 입금 (15:00~19:00)'},
      {s:19,e:20,text:'✅ 미입금 확인 (19:00~20:00)'},
      {s:20,e:24,text:'🔗 1차 매칭 (20:00~05:00)'},
      {s:0,e:5,text:'🔗 1차 매칭 (20:00~05:00)'}
    ];
    var found2=null;
    for(var j=0;j<SCHED2.length;j++){
      if(h>=SCHED2[j].s && h<SCHED2[j].e){found2=SCHED2[j];break;}
    }
    if(found2){
      schedEl.style.display='';
      schedEl.textContent=found2.text;
    } else {
      schedEl.style.display='none';
    }
    barEl.style.background='linear-gradient(90deg,'+found.color+' 0%,'+found.color+'cc 100%)';
  }
  // ── 위쪽 줄: 예약시간/매칭대기 동적 표시 ──
  var reserveLabel = document.getElementById('tbar-reserve');
  if(reserveLabel){
    if(h >= 5 && h < 20){
      reserveLabel.style.display = '';
      reserveLabel.textContent = '🟢 구매·판매예약: 05:00~20:00';
    } else {
      reserveLabel.style.display = 'none';
    }
  }
  // ── 구매·판매 예약 버튼 시간 제어 (05:00~20:00만 활성화) ──
  var isReserveTime = (h >= 5 && h < 20);
  window._isReserveTimeCached = isReserveTime;

  // 구매 예약하기 버튼 - 시간 조건만 체크
  // 포인트/수량 조건은 updateResUI에서 별도 처리
  var reserveBtn = document.getElementById('reserve-btn');
  if(reserveBtn && !reserveBtn.dataset.disabledByUser){
    var _avail = ((userData&&userData.charge_points)||0) + ((userData&&userData.exchange_points)||0);
    // 현재 선택된 예약수에 따른 비용 계산 (bzCnt 기반)
    // bzCnt/svCnt/gdCnt는 전역 변수
    var _curTotal = (typeof bzCnt!=='undefined'?bzCnt:0) + (typeof svCnt!=='undefined'?svCnt:0) + (typeof gdCnt!=='undefined'?gdCnt:0);
    var _curCost = _curTotal * 40;
    // 예약수가 있으면 비용 비교, 없으면 포인트 0 체크
    // 수량 0이면 무조건 비활성, 수량 있으면 포인트 체크
    var _noPoints = (_curTotal === 0) ? true : (_avail < _curCost);
    var _btnOk = isReserveTime && !_noPoints;
    reserveBtn.disabled = !_btnOk;
    reserveBtn.style.opacity = _btnOk ? '' : '0.4';
    reserveBtn.style.background = '';  // CSS 클래스가 처리
    reserveBtn.style.cursor = _btnOk ? '' : 'not-allowed';
    if(!isReserveTime) reserveBtn.title = '구매·판매 예약은 05:00~20:00에만 가능합니다';
    else if(_noPoints) reserveBtn.title = '포인트가 부족합니다';
    else reserveBtn.title = '';
  }
  // 판매 예약하기 버튼
    _updateSellBtn(isReserveTime);
  // ── 날짜 변경 감지: 날짜 바뀌면 loadUserData 재호출 ──
  var _todayDate = (now.getMonth()+1)+'-'+now.getDate();
  if(typeof window._lastKnownDate === 'undefined') window._lastKnownDate = _todayDate;
  if(window._lastKnownDate !== _todayDate){
    window._lastKnownDate = _todayDate;
    if(userData){
      _reservedToday = false;
      loadUserData();
    }
  }
  // 구매예약 수량 +/- 버튼 (예약시간 외 OR 오늘 이미 예약 완료 시 비활성화)
  // userData에서 직접 재확인 (비동기 덮어쓰기 방지)
  var _todayTotal = userData && userData.today_reservations ?
    ((userData.today_reservations.bronze||0) + (userData.today_reservations.silver||0) + (userData.today_reservations.gold||0)) : 0;
  if(_todayTotal > 0){
    if(!_reservedToday) disableReserveSection();  // 버튼 텍스트도 업데이트
    _reservedToday = true;
  }
  var _shouldDisableButtons = !isReserveTime || _reservedToday;
  ['r-bz-m','r-bz-p','r-sv-m','r-sv-p','r-gd-m','r-gd-p'].forEach(function(id){
    var el = document.getElementById(id);
    if(el){ el.disabled = _shouldDisableButtons; el.style.opacity = _shouldDisableButtons ? '0.4' : ''; }
  });
  // 전체판매예약 버튼은 _updateSellBtn에서 통합 처리
  // 보유내역 개별 판매예약 배지 클릭 제어
  document.querySelectorAll('[id^="badge-"]').forEach(function(badge){
    if(isReserveTime){
      // 예약시간: 원래 onclick 복원 (data-onclick에 저장해둔 것)
      if(badge.dataset.onclick){ badge.setAttribute('onclick', badge.dataset.onclick); delete badge.dataset.onclick; }
      badge.style.cursor = badge.dataset.canSell === '1' ? 'pointer' : 'default';
      badge.style.opacity = '1';
    } else {
      // 비예약시간: onclick 제거, 클릭 막기
      if(badge.getAttribute('onclick') && !badge.dataset.onclick){
        badge.dataset.onclick = badge.getAttribute('onclick');
      }
      badge.removeAttribute('onclick');
      badge.style.cursor = 'not-allowed';
      badge.style.opacity = '0.5';
    }
  });
}
// updateTimeBar interval은 로그인 후 startTimeBar()로 등록

// 서버/로컬 시간 동기화 (mock time 지원 - localStorage 기반)
var _serverTimeOffset = 0;
var _isMockTime = false;
var _mockBaseMs = 0;
var _mockFetchAt = 0;

function _loadMockFromStorage(){
  try{
    var s = localStorage.getItem('lp_mock_time');
    if(s){
      var obj = JSON.parse(s);
      _isMockTime = true;
      _mockBaseMs = obj.base;
      _mockFetchAt = obj.at;
      return true;
    }
  }catch(e){}
  return false;
}
function _saveMockToStorage(baseMs, fetchAt){
  try{ localStorage.setItem('lp_mock_time', JSON.stringify({base:baseMs, at:fetchAt})); }catch(e){}
}
function _clearMockStorage(){
  try{ localStorage.removeItem('lp_mock_time'); }catch(e){}
}

async function syncServerTime(){
  try{
    var fetchStart = Date.now();
    var res = await fetch('/api/current-time');
    var d = await res.json();
    var fetchEnd = Date.now();
    var latency = (fetchEnd - fetchStart) / 2;
    // 서버는 항상 KST(UTC+9) 반환 → '+09:00' 명시로 정확히 파싱
    function parseKST(s){ return new Date(s.replace(' ','T')+'+09:00').getTime(); }
    if(d.is_mock){
      var newBase = parseKST(d.time);
      // mock 시간이 바뀐 경우(관리자가 다른 시간으로 변경)에만 재설정
      // 이미 같은 시간으로 설정된 경우에는 _mockFetchAt을 갱신하지 않음
      // → 시계가 멈추지 않고 흐르도록 유지
      if(!_isMockTime || Math.abs(newBase - _mockBaseMs) > 2000){
        // 처음 설정하거나 시간 값이 2초 이상 다를 때만 기준점 재설정
        _isMockTime = true;
        _mockBaseMs = newBase;
        _mockFetchAt = fetchEnd - latency;
      }
      // 이미 같은 mock 시간이면 _mockBaseMs/_mockFetchAt 유지 → 시계 흐름 보존
    } else {
      _isMockTime = false;
      _mockBaseMs = 0; _mockFetchAt = 0;
      var serverMs = parseKST(d.time);
      _serverTimeOffset = serverMs - (fetchEnd - latency);
    }
  }catch(e){}
}
function getEffectiveDate(){
  if(_isMockTime && _mockFetchAt > 0){
    var elapsed = Date.now() - _mockFetchAt;
    return new Date(_mockBaseMs + elapsed);
  }
  return new Date(Date.now() + _serverTimeOffset);
}
// mock 시간 직접 설정 (테스트도구용 - 서버 없이도 동작)
function setMockTimeLocal(datetimeStr){
  _isMockTime = true;
  // KST 명시 파싱 (+09:00)
  _mockBaseMs = new Date(datetimeStr.replace(' ','T')+'+09:00').getTime();
  _mockFetchAt = Date.now();
  _saveMockToStorage(_mockBaseMs, _mockFetchAt);
}
function resetMockTimeLocal(){
  _isMockTime = false;
  _mockBaseMs = 0;
  _mockFetchAt = 0;
  _clearMockStorage();
  _serverTimeOffset = 0;
}
function startTimeBar(){
  syncServerTime();  // 서버 시간 동기화 (mock 포함)
  updateTimeBar();
  if(window._tbInterval) clearInterval(window._tbInterval);
  window._tbInterval = setInterval(updateTimeBar, 1000);
  if(window._syncInterval) clearInterval(window._syncInterval);
  window._syncInterval = setInterval(syncServerTime, 1500);
}

// ── 아이템 상세보기 (판매예약 포함) ──
async function toggleDetail(type){
  var panel=document.getElementById('detail-'+type);
  var card=document.getElementById('card-'+type);
  var masterPanel=document.getElementById('bar-detail-panel');
  var isOpen=panel&&panel.style.display!=='none';
  window._currentBarType = type;
  ['bronze','silver','gold'].forEach(function(t){
    var p2=document.getElementById('detail-'+t);
    var c2=document.getElementById('card-'+t);
    if(p2) p2.style.display='none';
    if(c2) c2.classList.remove('selected');
  });
  if(isOpen){
    if(masterPanel) masterPanel.style.display='none';
    window._currentBarType = null;
    return;
  }
  if(masterPanel) masterPanel.style.display='block';
  if(panel) panel.style.display='block';
  if(card) card.classList.add('selected');
  // 전체판매예약 버튼: 해당 타입만 표시
  ['bronze','silver','gold'].forEach(function(t){
    var bb=document.getElementById('bulk-sell-btn-'+t);
    if(bb) bb.style.display=(t===type)?'':'none';
  });
  await loadItemDetail(type);
}

// 아이템별 판매예약 선택 상태 관리
var _sellSelected = {};

async function loadItemDetail(barType){
  var container=document.getElementById('detail-'+barType+'-items');
  container.innerHTML='<div class="loading">로딩 중...</div>';
  try{
    var items=await api('/items?bar_type='+barType);
    if(!items.length){
      container.innerHTML='<div style="text-align:center;color:#aaa;padding:20px">보유 아이템 없음</div>';
      return;
    }
    var names={bronze:'수정',silver:'루비',gold:'다이아'};
    updateBulkSellBtn(barType, items);
    // 아이템 캐시 업데이트 (판매보드에서 사용)
    items.forEach(function(it){ _itemCache[it.id]={bar_type:barType,stage:it.stage,sell_price:it.sell_price,profit:it.profit,buy_price:it.buy_price,purchase_date:it.purchase_date,days:it.days}; });
    // 구매일자 내림차순 정렬 (최신 구매 아이템 위에)
    items.sort(function(a,b){ return (b.purchase_date||'') > (a.purchase_date||'') ? 1 : (b.purchase_date||'') < (a.purchase_date||'') ? -1 : b.id - a.id; });
    var html=items.map(function(it){
      var dayNum = it.days + 1;
      // 결합아이템(waiting)은 당일부터, 일반아이템은 3일째(days>=2)부터 판매가능
      var _minDays = (it.status==='waiting') ? 0 : 2;  // 결합아이템은 당일부터 판매가능
      var canSell = it.days>=_minDays && it.status_label!=='판매중' && it.status_label!=='매칭중' && it.status_label!=='매칭완료' && it.status_label!=='판매예약' && it.status_label!=='판매예약중';
      var isSelected = !!_sellSelected[it.id];
      var rawLabel = it.status_label||'보유중';
      var displayLabel = rawLabel==='reservable'||rawLabel==='매칭예약가능' ? '판매예약가능' : rawLabel;
      // 배지: 클릭 가능 여부에 따라 cursor/색상 변경 (버튼 없음)
      var badgeColor = isSelected?'#388e3c':canSell?'#7b1fa2':'#546e7a';
      var badgeText = isSelected?'✓ 판매예약':displayLabel;
      var cardBg = isSelected?'rgba(56,142,60,0.12)':'';
      var cursor = (canSell && _isRT)?'cursor:pointer;':(canSell?'cursor:not-allowed;':'');
      var badgeTitle = canSell?(isSelected?'클릭하여 취소':'클릭하여 판매예약'):'';
      // 배지 클릭 → toggleSellSelect (canSell일 때만)
      var _isRT = (getEffectiveDate().getHours()>=5 && getEffectiveDate().getHours()<20);
      var badgeOnclick = (canSell && _isRT)?'onclick="toggleSellSelect('+it.id+',\''+barType+'\')" data-onclick="toggleSellSelect('+it.id+',\''+barType+'\')\" ':' ';
      if(canSell) badgeOnclick += ' data-can-sell="1"';
      var statusBadge = '<span id="badge-'+it.id+'" '+badgeOnclick
        +'title="'+badgeTitle+'" '
        +'style="display:inline-block;background:'+badgeColor+';color:#fff;border-radius:12px;'
        +'padding:3px 10px;font-size:11px;font-weight:700;margin-left:6px;'+cursor+'">'
        +badgeText+'</span>';
      // 일차 안내 (canSell 아닐 때만 표시)
      var dayNote = '';  // 판매 가능 안내 제거 (형식1)
      var _isMaxStage = !!(it.is_max_stage);
      var _cardCanSell = (it.status_label === '판매가능') && !_isMaxStage;
      var _cardSelected = !!_sellSelected[String(it.id)];
      var _cardStyle = 'background:'+(_cardSelected?'rgba(123,31,162,0.15)':cardBg)+';border:'+(_cardSelected?'1.5px solid #7b1fa2':'1px solid transparent')+';transition:background 0.2s';
      var _cardOnclick = _cardCanSell ? ' onclick="toggleSellSelect('+it.id+',\''+(it.bar_type||barType)+'\')"' : '';
      var _sellBadge;
      if(_isMaxStage && it.status_label === '판매가능'){
        // 최고단계: 분할 / 포인트전환 버튼
        _cardOnclick = '';
        _sellBadge = '<span class="badge" style="background:#e65100;color:#fff;font-size:10px">최고단계</span>';
      } else {
        _sellBadge = _cardSelected
          ? '<span id="badge-'+it.id+'" class="badge" style="background:#388e3c;color:#fff">✓ 판매예약</span>'
          : (it.status_label==='판매예약중'
            ? '<span id="badge-'+it.id+'" class="badge badge-pending">판매예약중</span>'
            : (_cardCanSell
              ? '<span id="badge-'+it.id+'" class="badge" style="background:var(--bg2);border:1.5px solid #7b1fa2;color:#7b1fa2">☐ 판매선택</span>'
              : statusBadge));
      }
      var _maxStageBtns = (_isMaxStage && it.status_label === '판매가능')
        ? '<div style="display:flex;gap:6px;margin-top:8px">'
          +'<button onclick="doItemSplit('+it.id+',\''+it.bar_type+'\')" style="flex:1;padding:7px 0;background:#1565c0;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">✂️ 분할</button>'
          +'<button onclick="doItemConvert('+it.id+','+it.sell_price+',\''+it.bar_type+'\','+it.stage+')" style="flex:1;padding:7px 0;background:#2e7d32;color:#fff;border:none;border-radius:7px;font-size:12px;font-weight:700;cursor:pointer">💎 포인트전환</button>'
          +'</div>'
        : '';
      return '<div class="item-row" id="icard-'+it.id+'"'+_cardOnclick+' style="cursor:'+(_cardCanSell?'pointer':'default')+(_cardSelected?';background:rgba(123,31,162,0.15);border:1.5px solid #7b1fa2;':';')+'">'        +'<div class="item-hd">'        +'<span class="item-stage">'+it.stage+'단계 '+names[it.bar_type||barType]+'</span>'        +_sellBadge        +'</div>'        +'<div class="item-date">'+(it.status==='waiting'?'결합일: ':'구매일: ')+it.purchase_date+' ('+(it.status==='waiting'?'결합 ':'')+dayNum+'일째)</div>'        +'<div class="item-price">'+((it.status==='waiting'&&it.combine_buy_price)?'결합가 ':'구매 ')+'<span style="color:#aaa">'+it.buy_price.toLocaleString()+'원</span> → 판매 <span style="color:#f9a825">'+it.sell_price.toLocaleString()+'원</span> <span style="color:#66bb6a;font-size:12px">(+'+(it.profit.toLocaleString())+'원)</span></div>'        +(!_cardCanSell && it.status_label!=='판매예약중' && it.status_label!=='매칭완료' && it.status_label!=='매칭중' ? '<div style="font-size:10px;color:#f9a825;margin-top:2px">⏳ 구매 3일째부터 판매예약 가능 (현재 '+dayNum+'일째)</div>' : '')        +_maxStageBtns        +'</div>';
    }).join('');
    container.innerHTML=html;
    // 결합아이템 포함 여부에 따라 헤더 안내 텍스트 업데이트
    var _hasWaiting = items.some(function(it){return it.status==='waiting';});
    var _allWaiting = items.length>0 && items.every(function(it){return it.status==='waiting';});
    var _headerNoteEl = container.closest('.detail-panel')?.querySelector('.detail-panel-title span[style*="color:#aaa"]')
                      || container.parentElement?.querySelector('.detail-panel-title span[style*="color:#aaa"]');
    if(_headerNoteEl){
      _headerNoteEl.textContent = _allWaiting ? '결합 당일부터 판매가능' : (_hasWaiting ? '결합:당일/구매:3일째부터 판매가능' : '구매 3일째부터 판매가능');
    }
  }catch(e){
    container.innerHTML='<div style="color:#ef5350;padding:12px">오류: '+e.message+'</div>';
  }
}

function updateBulkSellBtn(barType, items){
  var btn = document.getElementById('bulk-sell-btn-'+barType);
  if(!btn) return;
  var sellableIds = (items||[]).filter(function(it){
    return it.status_label === '판매가능';
  }).map(function(it){return it.id;});
  var allSelected = sellableIds.length>0 && sellableIds.every(function(id){return _sellSelected[id];});
  // sellableIds 저장 (타입별로 - _updateSellBtn에서 참조)
  var _hasSellable = sellableIds.length > 0;
  btn.textContent = allSelected?'전체취소':'전체판매예약';
  btn._sellableIds = sellableIds;
  btn._allSelected = allSelected;
}

async function toggleBulkSell(barType){
  var btn = document.getElementById('bulk-sell-btn-'+barType);
  if(!btn) return;
  var ids = btn._sellableIds || [];
  var allSelected = btn._allSelected;
  if(!allSelected){
    // 선택 시: 이미 선택된 아이템 중 가장 많은 구매일 그룹으로 통일
    var selectedIds = ids.filter(function(id){return _sellSelected[id];});
    var baseDate = null;
    if(selectedIds.length > 0){
      baseDate = _itemCache[selectedIds[0]] && _itemCache[selectedIds[0]].purchase_date;
    } else {
      // 첫 번째 아이템의 구매일 기준
      baseDate = _itemCache[ids[0]] && _itemCache[ids[0]].purchase_date;
    }
    ids.forEach(function(id){
      var info = _itemCache[id];
      var d = info && info.purchase_date;
      if(!baseDate || d === baseDate){ _sellSelected[id] = true; }
      else { _sellSelected[id] = false; }
    });
  } else {
    ids.forEach(function(id){ _sellSelected[id] = false; });
  }
  await loadItemDetail(barType);
  updateSellBoard();
}

;

function toggleSellSelect(itemId, barType){
  // 같은날 구매한 아이템만 선택 가능
  var _id = String(itemId);
  var clickedInfo = _itemCache[_id] || _itemCache[itemId];
  var selectedIds = Object.keys(_sellSelected).filter(function(id){return _sellSelected[id];});

  // 선택하려는 경우(현재 미선택 → 선택으로 전환)
  var cd2 = clickedInfo ? clickedInfo.purchase_date : null;
  if(!_sellSelected[_id] && selectedIds.length > 0 && cd2){
    var _diffDate2=false;
    for(var i=0;i<selectedIds.length;i++){
      var k2=selectedIds[i];
      var info2=_itemCache[k2]||_itemCache[Number(k2)];
      if(info2 && info2.purchase_date && info2.purchase_date!==cd2){_diffDate2=true;break;}
    }
    if(_diffDate2){toast('같은 구매일의 아이템만 함께 선택할 수 있습니다.','error');return;}
  }

  _sellSelected[_id] = !_sellSelected[_id];
  var card = document.getElementById('icard-'+_id);
  var badge = document.getElementById('badge-'+_id);
  var selected = !!_sellSelected[_id];
  if(card) card.style.background = selected?'rgba(56,142,60,0.12)':'';
  if(badge){
    if(selected){
      badge.style.background = '#388e3c';
      badge.style.border = 'none';
      badge.style.color = '#fff';
      badge.textContent = '✓ 판매예약';
    } else {
      badge.style.background = 'var(--bg2)';
      badge.style.border = '1.5px solid #7b1fa2';
      badge.style.color = '#7b1fa2';
      badge.textContent = '☐ 판매선택';
    }
    badge.title = selected?'클릭하여 취소':'클릭하여 판매예약';
  }
  var bulkBtn = document.getElementById('bulk-sell-btn-'+barType);
  if(bulkBtn && bulkBtn._sellableIds){
    var allSel = bulkBtn._sellableIds.every(function(id){return _sellSelected[String(id)];});
    bulkBtn.textContent = allSel?'전체취소':'전체판매예약';
    bulkBtn.style.background = allSel?'#546e7a':'#7b1fa2';
    bulkBtn._allSelected = allSel;
  }
  updateSellBoard();
}

async function doSellReservation(itemId, barType){
  showConfirm({
    title: '🏷️ 판매예약 확인',
    message: '이 아이템을 판매예약하시겠습니까?',
    okText: '예약하기',
    onOk: async function(){
      try{
        var d=await api('/reservation/sell',{method:'POST',body:JSON.stringify({item_id:itemId})});
        toast('판매예약 완료! 판매가: '+d.sell_price.toLocaleString()+'원');
        await loadItemDetail(barType);
        if(typeof loadSellTab==='function') await loadSellTab();
      }catch(e){ toast('판매예약 실패: '+e.message); }
    }
  });
}

// ── 매칭 탭 로드 ──
var TYPE_NAME={bronze:'수정',silver:'루비',gold:'다이아'};
var TYPE_COLOR={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};

async function loadMatchingTab(){
  var buyEl = document.getElementById('match-buy-list');
  var sellEl = document.getElementById('match-sell-list');
  // 이전 내용 초기화
  if(buyEl) buyEl.innerHTML = '';
  if(sellEl) sellEl.innerHTML = '';
  try{
    // 서버 시간 확인: 20:00~05:00 사이에는 매칭결과 숨김 안내
    var _ct = await api('/current-time');
    var _ch = _ct.hour||0;
    var _isMatchingTime = (_ch >= 20 || _ch < 5);
    if(_isMatchingTime){
      // paid/confirmed 상태 매치는 시간 무관하게 표시 (송금 완료 후 입금확인 필요)
      var _d = null;
      try { _d = await api('/user/matching'); } catch(e2) {}
      var _hasPaid = _d && ((_d.buy||[]).some(function(m){ return m.status==='paid'||m.status==='confirmed'; }) ||
                            (_d.sell||[]).some(function(m){ return m.status==='paid'||m.status==='confirmed'; }));
      if(!_hasPaid){
        if(buyEl) buyEl.innerHTML = '<div style="text-align:center;color:#f9a825;padding:20px;font-size:13px">⏳ 매칭 진행 중 (20:00~05:00)<br><span style="font-size:11px;color:#aaa">매칭 결과는 오전 5시 이후 확인 가능합니다</span></div>';
        if(sellEl) sellEl.innerHTML = '';
        return;
      }
      // paid 매치가 있으면 계속 진행
    }
    var d = await api('/user/matching');
    var buys = [], sells = [];
    if(Array.isArray(d)){
      buys = d.filter(function(r){ return r.match_round===1; });
      sells = d.filter(function(r){ return r.match_round===2; });
    } else {
      buys = d.buy || [];
      sells = d.sell || [];
    }
    renderMatchBuyList(buys);
    renderMatchSellList(sells);
  }catch(e){
    if(buyEl) buyEl.innerHTML='<div style="color:#ef5350;padding:12px">오류: '+e.message+'</div>';
  }
}


function renderMatchBuyList(items){
  var TYPE_NAME={bronze:'수정',silver:'루비',gold:'다이아'};
  var TYPE_COLOR={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
  var el=document.getElementById('match-buy-list');
  if(!items.length){
    el.innerHTML='<div style="text-align:center;color:#aaa;padding:20px;font-size:13px">구매예약 없음</div>';
    return;
  }
  var _effDate = getEffectiveDate ? getEffectiveDate() : new Date();
  var h = (_effDate.getUTCHours() + 9) % 24;  // KST = UTC+9
  el.innerHTML = items.map(function(m){
    var statusLabel = {waiting:'예약대기',lucky_waiting:'🍀 행운예약중',lucky_matched:'🍀 행운매칭완료',pending:'매칭완료',matched:'매칭완료',paid:'송금완료',confirmed:'입금',unpaid:'미입금',failed:'미입금'}[m.status]||m.status;
    var statusColor = {waiting:'#90caf9',lucky_waiting:'#7b1fa2',lucky_matched:'#7b1fa2',pending:'#f9a825',matched:'#f9a825',paid:'#1976d2',confirmed:'#66bb6a',unpaid:'#ef5350'}[m.status]||'#aaa';
    var hasMatchInfo = !!(m.seller_phone || m.seller_bank || m.seller_account);
    var dateTxt = m.source==='reservation'?m.reserve_date:(m.match_date||'');
    var isLucky = !!(m.lucky_pair_id);
    var luckyBadge = isLucky ? '<span style="display:inline-block;background:#7b1fa2;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle">🍀 행운</span>' : '';

    if(m.status==='waiting'){
      return '<div style="padding:10px 12px;margin-bottom:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">'        +'<div style="display:flex;justify-content:space-between;align-items:center">'        +'<strong style="color:'+TYPE_COLOR[m.bar_type]+'">'+TYPE_NAME[m.bar_type]+(m.stage?' '+m.stage+'단계':'')+'</strong>'+luckyBadge        +'<span style="font-size:11px;color:'+statusColor+'">'+statusLabel+'</span>'        +'</div>'        +'<div style="font-size:11px;color:var(--text2);margin-top:4px">⏳ 매칭 대기 중'+(dateTxt?' · '+dateTxt:'')+'</div>'        +'</div>';
    }

    var infoHtml = '';
    if(hasMatchInfo){
      var _sellerAcct = m.seller_account||'';
      infoHtml = '<div style="font-size:12px;color:var(--text2);margin:6px 0;line-height:1.9">'
        +'<div>🏦 은행: <span style="color:var(--text)">'+(m.seller_bank||'-')+'</span></div>'
        +'<div>💳 계좌: <span style="color:var(--text);font-weight:600">'+(_sellerAcct||'-')+'</span>'
        +(_sellerAcct ? ' <button onclick="_copyAcct(\'' + _sellerAcct + '\',this)" style="background:none;border:none;cursor:pointer;font-size:14px;padding:0 2px 0 4px;color:#90caf9;vertical-align:middle" title="계좌번호 복사">📋</button>' : '')
        +'</div>'
        +'<div>👤 예금주: <span style="color:var(--text)">'+(m.seller_account_name||'-')+'</span></div>'
        +'<div>💰 입금액: <span style="color:#f9a825;font-weight:600">'+(m.sell_price?m.sell_price.toLocaleString()+'원':'-')+'</span></div>'
        +'</div>';
    } else if(m.status==='pending'||m.status==='matched'){
      infoHtml = '<div style="font-size:11px;color:#f9a825;margin:6px 0">매칭완료 — 판매자 정보 확인 중</div>';
    }

    var btnHtml = '';
    var _r = m.match_round || 1;
    var canSend = (_r===2) ? (h>=15 && h<19) : (h>=5 && h<13);
    // dateTxt에 1차/2차 배지 추가
    if(m.source==='match'){
      dateTxt += ' <span style="font-size:10px;background:' + (_r===2?'#1565c0':'#4a148c') + ';color:#fff;padding:1px 5px;border-radius:4px;">' + _r + '차</span>';
    }
    if((m.status==='pending'||m.status==='matched') && hasMatchInfo){
      if(canSend){
        btnHtml = '<button onclick="openPaymentModal('+m.id+')" style="margin-top:8px;padding:8px 16px;background:#1976d2;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer;font-weight:600;width:100%">💸 송금 완료</button>';
      } else {
        var _now_h = (typeof getEffectiveDate==='function') ? getEffectiveDate().getHours() : new Date().getHours();
        var _expired = (_r===1 && _now_h>=14) || (_r===2 && _now_h>=19);
        if(_expired) {
          btnHtml = '<div style="font-size:11px;color:#ef5350;margin-top:6px">' + (_r===1?'1차':'2차') + ' 송금 시간 종료 (' + (_r===1?'05:00~13:00':'15:00~19:00') + ')</div>';
        } else {
          btnHtml = '<div style="font-size:11px;color:#888;margin-top:6px">송금: ' + (_r===2 ? '15:00~19:00' : '05:00~13:00') + ' 사이에 가능</div>';
        }
      }
    } else if(m.status==='paid'){
      btnHtml = '<div style="font-size:12px;color:#1976d2;margin-top:6px;font-weight:600">✅ 송금완료 — 판매자 확인 대기</div>';
    } else if(m.status==='confirmed'){
      btnHtml = '<div style="font-size:12px;color:#66bb6a;margin-top:6px;font-weight:600">✅ 거래 완료</div>';
    }

    return '<div data-match-id="'+m.id+'" style="padding:10px 12px;margin-bottom:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">'      +'<div style="display:flex;justify-content:space-between;align-items:center">'      +'<strong style="color:'+TYPE_COLOR[m.bar_type]+'">'+TYPE_NAME[m.bar_type]+(m.stage?' '+m.stage+'단계':'')+'</strong>'+luckyBadge      +'<span style="font-size:11px;color:'+statusColor+';font-weight:600">'+statusLabel+'</span>'      +'</div>'      +(dateTxt?'<div style="font-size:10px;color:var(--text2);margin-top:2px">'+dateTxt+'</div>':'')      +infoHtml+btnHtml      +'</div>';
  }).join('');
}

function renderMatchSellList(items){
  var TYPE_NAME={bronze:'수정',silver:'루비',gold:'다이아'};
  var TYPE_COLOR={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
  var el=document.getElementById('match-sell-list');
  if(!el) return; // 구매탭에서 판매예약 섹션 제거됨
  if(!items.length){
    el.innerHTML='<div style="text-align:center;color:#aaa;padding:20px;font-size:13px">판매예약 없음</div>';
    return;
  }
  var h = getEffectiveDate ? getEffectiveDate().getHours() : new Date().getHours();
  el.innerHTML = items.map(function(m){
    var statusLabel = {waiting:'예약대기',lucky_waiting:'예약대기',lucky_matched:'입금대기',pending:'입금대기',paid:'입금확인중',confirmed:'거래완료',unpaid:'미입금'}[m.status]||m.status;
    var statusColor = {waiting:'#90caf9',lucky_waiting:'#90caf9',lucky_matched:'#f9a825',pending:'#f9a825',paid:'#1976d2',confirmed:'#66bb6a',unpaid:'#ef5350'}[m.status]||'#aaa';
    var _luckyBadgeSell = '';  // 판매 카드에는 행운 표시 제거
    var buyerInfo = (m.status==='waiting'||m.status==='lucky_waiting')
      ? '<div style="font-size:12px;color:#90caf9;margin:6px 0">⏳ 매칭 대기 중...</div>'
      : '<div style="font-size:12px;color:#aaa;margin:6px 0">'
      +'<div>👤 구매자: '+(m.buyer_nickname||m.buyer_username||'-')+'</div>'
      +'<div>📞 연락처: '+(m.buyer_phone||'-')+'</div>'
      +'<div>💰 수령액: '+(m.sell_price?m.sell_price.toLocaleString()+'원':'-')+'</div>'
      +'</div>';
    var _sr = m.match_round || 1;
    var _totalMinSell = h * 60 + (getEffectiveDate ? getEffectiveDate().getMinutes() : new Date().getMinutes());
    // 입금확인 가능: 1차 05~13, 2차 15~19
    var canConfirm = (_sr===2) ? (h>=15 && h<19) : (h>=5 && h<13);
    // 미입금 버튼: 1차 13~14, 2차 19~20
    var canUnpaid = (_sr===2) ? (h>=19 && h<20) : (h>=13 && h<14);
    // 입금요청: 1차 12:30~13:00, 2차 18:30~19:00
    var canRequest = (_sr===2) ? (_totalMinSell >= 1110 && _totalMinSell < 1140) : (_totalMinSell >= 750 && _totalMinSell < 780);
    // 입금확인: 1차 05:00~13:00, 2차 15:00~19:00 (분 단위 정밀 체크)
    var canConfirmMin = (_sr===2) ? (_totalMinSell>=900&&_totalMinSell<1140) : (_totalMinSell>=300&&_totalMinSell<780);
    // 미입금: 1차 13:00~14:00, 2차 19:00~20:00 (분 단위)
    var canUnpaidMin = (_sr===2) ? (_totalMinSell>=1140&&_totalMinSell<1200) : (_totalMinSell>=780&&_totalMinSell<840);
    var btnHtml = '';
    if(m.status==='paid'){
      btnHtml = '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">';
      if(canConfirmMin){
        btnHtml += '<button onclick="doConfirmPayment('+m.id+')" style="padding:7px 14px;background:#388e3c;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">✅ 입금확인</button>';
      }
      if(canUnpaidMin){
        btnHtml += '<button onclick="doReportUnpaid('+m.id+')" style="padding:7px 14px;background:#c62828;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">❌ 미입금</button>';
      }
      if(!canConfirmMin && !canUnpaidMin){
        var _waitTxt = (_sr===2) ? '입금확인: 15:00~19:00 / 미입금: 19:00~20:00' : '입금확인: 05:00~13:00 / 미입금: 13:00~14:00';
        btnHtml += '<div style="font-size:11px;color:#f9a825;padding:4px 0">' + _waitTxt + '</div>';
      }
      btnHtml += '</div>';
      if(m.receipt_url){
        btnHtml += '<a href="'+m.receipt_url+'" target="_blank" style="font-size:11px;color:#90caf9;display:block;margin-top:4px">영수증 보기</a>';
      }
    } else if(m.status==='pending'){
      btnHtml = '<div style="display:flex;gap:8px;margin-top:8px">'
        +'<button onclick="doReportUnpaid('+m.id+')" style="padding:7px 14px;background:#c62828;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">❌ 미입금</button>'
        +'</div>';
    }
    var sellSub=(m.status==='waiting'||m.status==='lucky_waiting')?'⏳ 대기':'👤 '+(m.buyer_nickname||m.buyer_username||'-')+(m.sell_price?' · '+m.sell_price.toLocaleString()+'원':'');
    var sellDate=m.source==='reservation'?m.reserve_date:(m.match_date||'');
    return '<div style="display:flex;align-items:center;gap:6px;padding:8px 10px;margin-bottom:5px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">'
      +'<strong style="color:'+TYPE_COLOR[m.bar_type]+';font-size:12px;white-space:nowrap">'+TYPE_NAME[m.bar_type]+(m.stage?' '+m.stage+'단계':'')+'</strong>'+(_luckyBadgeSell||'')
      +'<span style="font-size:11px;color:var(--text2);flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+sellSub+'</span>'
      +(sellDate?'<span style="font-size:10px;color:var(--text2);white-space:nowrap">'+sellDate+'</span>':'')
      +'<span style="font-size:11px;color:'+statusColor+';font-weight:600;white-space:nowrap">'+statusLabel+'</span>'
      +'</div>';
  }).join('');
}

// ── 송금완료 모달 ──────────────────────────────────
var _payMatchId = null;

function openPaymentModal(matchId){
  _payMatchId = matchId;
  var modal = document.getElementById('payment-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'payment-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.5);z-index:9999;display:flex;align-items:center;justify-content:center;box-sizing:border-box';
    modal.innerHTML = '<div style="background:#ffffff;border-radius:14px;padding:24px;width:90%;max-width:380px;border:1px solid #ddd;color:#333">'
      +'<div style="font-size:16px;font-weight:700;margin-bottom:16px;color:#333">💸 송금완료 확인</div>'
      +'<div style="font-size:13px;color:#555;margin-bottom:12px">판매자 계좌로 송금 후 영수증을 첨부해주세요.</div>'
      +'<div style="margin-bottom:12px">'
      +'<label style="display:block;font-size:12px;color:#555;margin-bottom:6px">📎 영수증 이미지 <span style="color:#ef5350">(필수)</span></label>'
      +'<input type="file" id="receipt-file" accept="image/*" style="width:100%;font-size:13px">'
      +'</div>'
      +'<div id="receipt-preview" style="margin-bottom:12px"></div>'
      +'<div style="display:flex;gap:10px">'
      +'<button onclick="closePaymentModal()" style="flex:1;padding:10px;background:#eee;color:#333;border:none;border-radius:8px;font-size:13px;cursor:pointer">취소</button>'
      +'<button id="submit-payment-btn" onclick="submitPayment()" disabled style="flex:1;padding:10px;background:#555;color:#aaa;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:not-allowed">송금완료</button>'
      +'</div>'
      +'</div>';
    document.body.appendChild(modal);
    document.getElementById('receipt-file').onchange = function(e){
      var file = e.target.files[0];
      var sbtn = document.getElementById('submit-payment-btn');
      if(sbtn){sbtn.disabled=!file;sbtn.style.background=file?'#1976d2':'#555';sbtn.style.color=file?'#fff':'#aaa';sbtn.style.cursor=file?'pointer':'not-allowed';}
      if(!file){window._receiptBase64=null;document.getElementById('receipt-preview').innerHTML='';return;}
      var reader = new FileReader();
      reader.onload = function(ev){
        window._receiptBase64 = ev.target.result.split(',')[1];
        document.getElementById('receipt-preview').innerHTML = '<img src="'+ev.target.result+'" style="width:100%;border-radius:8px;max-height:200px;object-fit:contain">';
      };
      reader.readAsDataURL(file);
    };
  } else {
    modal.style.display = 'flex';
    document.getElementById('receipt-preview').innerHTML = '';
    if(document.getElementById('receipt-file')) document.getElementById('receipt-file').value='';
    window._receiptBase64 = null;
    var sbtn=document.getElementById('submit-payment-btn');
    if(sbtn){sbtn.disabled=true;sbtn.style.background='#555';sbtn.style.color='#aaa';sbtn.style.cursor='not-allowed';}
  }
}

function closePaymentModal(){
  var m = document.getElementById('payment-modal');
  if(m) m.style.display='none';
  // 버튼/상태 초기화 (처리중이어도 닫으면 복원)
  var sbtn = document.getElementById('submit-payment-btn');
  if(sbtn){ sbtn.textContent='송금완료'; sbtn.disabled=true; sbtn.style.background='#555'; sbtn.style.color='#aaa'; sbtn.style.cursor='not-allowed'; }
  var rf = document.getElementById('receipt-file'); if(rf) rf.value='';
  var prev = document.getElementById('receipt-preview'); if(prev) prev.innerHTML='';
  window._receiptBase64 = null;
  window._payMatchId = null;
}

async function submitPayment(){
  if(!window._payMatchId){ closePaymentModal(); return; }
  var btn = document.getElementById('submit-payment-btn');
  if(btn && btn.disabled) return;
  if(btn){ btn.textContent='처리 중...'; btn.disabled=true; }
  try{
    var payload = {match_id: window._payMatchId};
    if(window._receiptBase64) payload.image = 'data:image/jpeg;base64,'+window._receiptBase64;
    var d = await api('/reservation/payment-complete', {method:'POST', body:JSON.stringify(payload)});
    var modal = document.getElementById('payment-modal');
    if(modal) modal.style.display='none';
    window._receiptBase64 = null;
    var paidMatchId = window._payMatchId;
    window._payMatchId = null;
    if(btn){ btn.textContent='송금완료'; btn.disabled=false; }
    if(d && d.success){
      toast('송금 처리가 완료됐습니다.', 'success');
      // 해당 match 카드만 상태 업데이트 (전체 리로드 대신)
      var matchCard = document.querySelector('[data-match-id="'+paidMatchId+'"]');
      if(matchCard){
        // 카드 내 상태 뱃지 업데이트
        var badge = matchCard.querySelector('.match-status');
        if(badge){ badge.textContent='송금완료'; badge.style.color='#1976d2'; }
        // 송금 버튼 숨기고 완료 메시지로 교체
        var sendBtn = matchCard.querySelector('button[onclick*="openPaymentModal"]');
        if(sendBtn){ sendBtn.outerHTML='<div style="font-size:12px;color:#1976d2;margin-top:6px;font-weight:600">✅ 송금완료 — 판매자 확인 대기</div>'; }
      } else {
        // 카드를 찾지 못한 경우에만 전체 리로드
        loadMatchingTab();
      }
    } else {
      toast((d&&d.error)||'처리 실패', 'error');
    }
  }catch(e){
    if(btn){ btn.textContent='송금완료'; btn.disabled=false; }
    toast('오류: '+e.message, 'error');
  }
}

function doConfirmPayment(matchId){
  showConfirm({
    title: '✅ 입금 확인',
    message: '구매자의 입금을 확인하시겠습니까?',
    okText: '입금확인',
    onOk: async function(){
      try{
        await api('/match/confirm-payment', {method:'POST', body:JSON.stringify({match_id:matchId})});
        if(typeof toast==='function') toast('입금 확인 완료!','success');
        loadMatchingTab();
      }catch(e){ if(typeof toast==='function') toast('오류: '+e.message,'error'); }
    }
  });
}

function doReportUnpaid(matchId){
  showConfirm({
    title: '📨 미입금 신고',
    message: '구매자의 미입금을 신고하시겠습니까?<br><span style="color:#e65100;font-size:12px">구매자에게 패널티가 부여됩니다.</span>',
    okText: '신고하기',
    okColor: '#e65100',
    onOk: async function(){
      try{
        await api('/match/report-unpaid', {method:'POST', body:JSON.stringify({match_id:matchId})});
        if(typeof toast==='function') toast('미입금 신고 완료','info');
        loadMatchingTab();
      }catch(e){ if(typeof toast==='function') toast('오류: '+e.message,'error'); }
    }
  });
}

function doPaymentComplete(resId){ openPaymentModal(resId); }



async function disableReserveSection(){
  _reservedToday=true;
  // 구매 예약하기 버튼 비활성화 (회색 처리)
  var btn=document.getElementById('reserve-btn');
  if(btn){
    btn.disabled=true;
    btn.style.opacity='';
    btn.style.background='';
    btn.style.cursor='';
    btn.textContent='오늘 예약 완료';
    btn.dataset.disabledByUser='1';
  }
  // +/- 버튼 모두 비활성화 (수정/루비/다이아)
  ['r-bz-m','r-bz-p','r-sv-m','r-sv-p','r-gd-m','r-gd-p'].forEach(function(id){
    var el=document.getElementById(id);
    if(el){el.disabled=true;el.style.opacity='0.3';el.style.cursor='not-allowed';}
  });
  // 수량 입력란도 비활성화 (readonly)
  ['bz-cnt','sv-cnt','gd-cnt'].forEach(function(id){
    var el=document.getElementById(id);
    if(el){el.disabled=true;el.style.opacity='0.4';el.style.cursor='not-allowed';}
  });
  // 예약 섹션 전체에 완료 메시지 표시
  var info=document.getElementById('r-info');
  if(info){
    info.innerHTML='✅ 오늘 구매예약 완료! 매칭 실행 시 포인트가 차감됩니다.';
    info.style.color='#4caf50';info.style.fontWeight='600';
  }
  bzCnt=0; svCnt=0; gdCnt=0;
  // 비동기 loadUserData 이후에도 비활성화 유지되도록 재확인
  setTimeout(function(){
    if(!_reservedToday) return;
    var btn2=document.getElementById('reserve-btn');
    if(btn2 && btn2.textContent.indexOf('오늘 예약 완료')>=0){
      btn2.disabled=true;
      btn2.style.background='';  // CSS :disabled 처리
      btn2.style.cursor='not-allowed';
    }
    // +/- 버튼 비활성화
    ['r-bz-m','r-bz-p','r-sv-m','r-sv-p','r-gd-m','r-gd-p'].forEach(function(id){
      var el=document.getElementById(id);
      if(el){el.disabled=true;el.style.opacity='0.3';}
    });
    // 수량 숫자 표시를 모두 0으로 (이미 예약 완료이므로 새 선택 불가)
    ['r-bz-v','r-sv-v','r-gd-v'].forEach(function(id){
      var el=document.getElementById(id);
      if(el) el.textContent='0';
    });
    // wrap 전체 비활성화
    ['r-bz-wrap','r-sv-wrap','r-gd-wrap'].forEach(function(id){
      var el=document.getElementById(id);
      if(el){el.style.opacity='0.5';el.style.pointerEvents='none';}
    });
    bzCnt=0; svCnt=0; gdCnt=0;
  }, 500);
}

function updateReserveByLevel(){
  // 레벨 3+이고 level_trade_active=false이면 구매/판매 예약 버튼 비활성화
  if(!userData) return;
  var lv = userData.level || 1;
  var active = userData.level_trade_active !== false; // undefined = 활성(구버전 호환)
  var cost = userData.level_cost || 0;
  var btn = document.getElementById('reserve-btn');
  var sellBtn = document.getElementById('sell-reserve-btn');
  if(lv >= 3 && cost > 0 && !active){
    // 비활성화
    if(btn && !btn.disabled){
      btn.disabled = true;
      btn.style.opacity = '0.4';
      btn.style.cursor = 'not-allowed';
      btn.title = lv+'레벨 거래유지 포인트 미결제 — 내정보 탭에서 결제하세요';
      btn.textContent = '포인트 결제 필요 (내정보 탭)';
    }
    // 판매 예약 버튼도
    document.querySelectorAll('.sell-reserve-btn,[id*="sell-btn"],[onclick*="sellReserve"],[onclick*="판매예약"]').forEach(function(el){
      el.disabled = true;
      el.style.opacity = '0.4';
      el.style.cursor = 'not-allowed';
      el.title = lv+'레벨 거래유지 포인트 미결제';
    });
    // 안내 토스트 (처음 한 번만)
    if(!window._levelPayWarned){
      window._levelPayWarned = true;
      toast('⚠️ '+lv+'레벨: 거래유지 포인트 '+cost+'P 결제 필요. 내정보 탭에서 결제하세요.', 'error');
    }
  } else {
    window._levelPayWarned = false;
  }
}

function scheduleReserveReset(){
  // 매분마다 서버 시간 확인 → 날짜 바뀌면 loadUserData 재호출
  if(window._reserveResetTimer) clearInterval(window._reserveResetTimer);
  window._reserveResetTimer = setInterval(async function(){
    try{
      var r = await fetch('/api/current-time');
      var d = await r.json();
      var h = d.hour;
      var dateStr = d.time ? d.time.slice(0,10) : '';
      window._serverTodayStr = dateStr;  // 패널티 남은일수 계산용
      // 예약 가능 시간(05:00~20:00)이고, userData의 예약 날짜와 다르면 재로드
      var isReserveTime = (h >= 5 && h < 20);
      if(isReserveTime && _reservedToday){
        // userData.today_reservations는 오늘 예약 기준 → 서버에서 재확인
        await loadUserData();
      }
    }catch(e){}
  }, 60000);
}

function enableReserveSection(){
  _reservedToday=false;
  var btn = document.getElementById('reserve-btn');
  // 사용자가 직접 비활성화한 경우 복원하지 않음
  if(btn && btn.dataset.disabledByUser) { delete btn.dataset.disabledByUser; }
  if(btn){
    // 포인트 + 시간 체크 후 활성화
    var _avail2 = ((userData&&userData.charge_points)||0) + ((userData&&userData.exchange_points)||0);
    var _h3 = getEffectiveDate().getHours();
    // 수량 및 포인트, 시간 모두 체크 (수량은 bzCnt 기준)
    var _curTotal2 = (typeof bzCnt!=='undefined'?bzCnt:0)+(typeof svCnt!=='undefined'?svCnt:0)+(typeof gdCnt!=='undefined'?gdCnt:0);
    // 레벨 3+ 미결제 시 거래 불가
    var _lvActive = (userData && userData.level_trade_active !== false) || !(userData && userData.level_cost > 0);
    var _canEnable = _lvActive && (_avail2 > 0) && (_h3 >= 5 && _h3 < 20) && (_curTotal2 === 0 || _avail2 >= _curTotal2 * 40);
    btn.disabled = !_canEnable;
    btn.style.opacity = _canEnable ? '' : '0.4';
    btn.style.background = '';  // CSS :disabled가 자동 회색 처리
    btn.style.cursor = _canEnable ? '' : 'not-allowed';
    btn.title = !_lvActive ? (userData.level||'')+'레벨 거래유지 포인트 미결제 — 내정보 탭에서 결제하세요' : (_avail2 <= 0 ? '포인트가 부족합니다' : (!(_h3>=5&&_h3<20) ? '05:00~20:00에만 가능합니다' : ''));
    btn.textContent = !_lvActive ? '포인트 결제 필요 (내정보 탭에서 결제)' : '구매 예약하기 (40P × 매칭예약수)';
    btn.onclick = function(){ if(btn.disabled) return; showReserveConfirm(); };
  }
  // 원본 포인트 복원은 updateResUI에서 cost=0일 때 처리됨 (bzCnt=0이면 자동 복원)
  var _h2=getEffectiveDate().getHours();
  var _isRT2=(_h2>=5 && _h2<20);
  ['r-bz-m','r-bz-p'].forEach(function(id){
    var el = document.getElementById(id);
    if(el) el.disabled = !_isRT2;
  });
  var info = document.getElementById('r-info');
  if(info){ info.style.color = ''; info.style.fontWeight = ''; }
  if(userData) updateReserveDefaults(userData.level || 1);
}

function updateResUI(BZ_MIN,BZ_MAX,SV_MIN,SV_MAX,GD_MIN,GD_MAX){
  if(window._isSuspended){ checkSuspended(window.userData); return; }
  // 파라미터가 없으면 userData에서 읽기 (하위호환)
  if(SV_MAX==null){ var cfg=(userData&&userData.level_config)||LEVEL_CFG_JS[(userData&&userData.level)||1]||LEVEL_CFG_JS[1]; SV_MIN=(cfg.sv_min!=null?cfg.sv_min:0); SV_MAX=cfg.sv_max||0; GD_MIN=(cfg.gd_min!=null?cfg.gd_min:0); GD_MAX=cfg.gd_max||0; }
  // sv/gd는 전역 변수로 관리 (독립 선택)
  var sv=svCnt, gd=gdCnt;
  // ── 예약시간 외에는 모든 수량버튼 비활성화 ──
  var _h=getEffectiveDate().getHours();
  var _isRT=(_h>=5 && _h<20);

  // 수정 표시
  var _bzV=document.getElementById('r-bz-v'); if(_bzV) _bzV.textContent=bzCnt;
  var _bzRange=document.getElementById('r-bz-range'); if(_bzRange) _bzRange.textContent='최소 '+BZ_MIN+' / 최대 '+BZ_MAX;
  var bzNote=document.getElementById('r-bz-note');
  if(bzNote) bzNote.textContent='수정 '+BZ_MAX+'개 예약시 루비 '+SV_MAX+'개 활성화 / 루비 '+SV_MAX+'개 예약시 다이아 '+GD_MAX+'개 활성화';
  var _byUser = _reservedToday;
  var _bzM=document.getElementById('r-bz-m'); if(_bzM) _bzM.disabled=(_byUser || !_isRT || bzCnt<=BZ_MIN);
  var _bzP=document.getElementById('r-bz-p'); if(_bzP) _bzP.disabled=(_byUser || !_isRT || bzCnt>=BZ_MAX);
  // 예약 완료 시 수정 wrap 전체 비활성화
  var bzWrap = document.getElementById('r-bz-wrap');
  if(bzWrap){ bzWrap.style.opacity = _byUser ? '0.5' : ''; bzWrap.style.pointerEvents = _byUser ? 'none' : ''; }

  // 루비: 수정이 BZ_MAX 도달해야 선택 가능
  var svUnlocked = (bzCnt >= BZ_MAX) && SV_MAX > 0;
  // 수정이 BZ_MAX 미달이면 svCnt 강제 0
  if(!svUnlocked) svCnt = 0;
  sv = svCnt;
  var _svV=document.getElementById('r-sv-v'); if(_svV) _svV.textContent = sv;
  var _svRange=document.getElementById('r-sv-range'); if(_svRange) _svRange.textContent = svUnlocked
    ? '최소 '+SV_MIN+' / 최대 '+SV_MAX
    : '(수정 '+BZ_MAX+'개 달성 시 선택 가능)';
  var _svNote=document.getElementById('r-sv-note'); if(_svNote) _svNote.textContent = '수정 '+BZ_MAX+'개 예약 시 루비 선택 가능';
  document.getElementById('r-sv-wrap').className = 'r-wrap'+(svUnlocked?'':' locked');
  var svWrap2 = document.getElementById('r-sv-wrap');
  if(svWrap2){ svWrap2.style.opacity = _byUser ? '0.5' : ''; svWrap2.style.pointerEvents = _byUser ? 'none' : ''; }
  var svMBtn = document.getElementById('r-sv-m');
  var svPBtn = document.getElementById('r-sv-p');
  if(svMBtn) svMBtn.disabled = (_byUser || !_isRT || !svUnlocked || sv <= SV_MIN);
  if(svPBtn) svPBtn.disabled = (_byUser || !_isRT || !svUnlocked || sv >= SV_MAX);

  // 다이아: 루비가 SV_MAX 도달해야 선택 가능
  var gdUnlocked = svUnlocked && (sv >= SV_MAX) && GD_MAX > 0;
  // 루비가 SV_MAX 미달이면 gdCnt 강제 0
  if(!gdUnlocked) gdCnt = 0;
  gd = gdCnt;
  var _gdV=document.getElementById('r-gd-v'); if(_gdV) _gdV.textContent = gd;
  var _gdRange=document.getElementById('r-gd-range'); if(_gdRange) _gdRange.textContent = gdUnlocked
    ? '최소 '+GD_MIN+' / 최대 '+GD_MAX
    : '(루비 '+SV_MAX+'개 달성 시 선택 가능)';
  var _gdNote=document.getElementById('r-gd-note'); if(_gdNote) _gdNote.textContent = '루비 '+SV_MAX+'개 예약 시 다이아 선택 가능';
  document.getElementById('r-gd-wrap').className = 'r-wrap'+(gdUnlocked?'':' locked');
  var gdWrap2 = document.getElementById('r-gd-wrap');
  if(gdWrap2){ gdWrap2.style.opacity = _byUser ? '0.5' : ''; gdWrap2.style.pointerEvents = _byUser ? 'none' : ''; }
  var gdMBtn = document.getElementById('r-gd-m');
  var gdPBtn = document.getElementById('r-gd-p');
  if(gdMBtn) gdMBtn.disabled = (_byUser || !_isRT || !gdUnlocked || gd <= GD_MIN);
  if(gdPBtn) gdPBtn.disabled = (_byUser || !_isRT || !gdUnlocked || gd >= GD_MAX);

  // 총계
  var totalSv = sv;
  var totalGd = gd;
  var total = bzCnt + totalSv + totalGd;
  var cost = total * 40;
  document.getElementById('r-info').textContent='구매예약 '+total+'회 / 차감 '+cost+'P (수정 '+bzCnt+(sv>0?' + 루비 '+sv:'')+(gd>0?' + 다이아 '+gd:'')+')';  // ── 포인트 미리보기: 수량 선택 시 실시간 표시 (오늘 예약 완료 시 스킵) ──
  var _todayReserved = !!(userData && userData.today_reservations && (userData.today_reservations.bronze||0) > 0);
  if(!_reservedToday && !_todayReserved && userData){
    var chargePts = userData.charge_points || 0;
    var exchangePts = userData.exchange_points || 0;
    var fromExchange = Math.min(exchangePts, cost);
    var fromCharge = Math.max(0, cost - fromExchange);
    var remainCharge = chargePts - fromCharge;
    var remainExchange = exchangePts - fromExchange;
    var hTotal = document.getElementById('h-total');
    var hMaintain = document.getElementById('h-maintain');
    var hSub = document.getElementById('h-sub');
    // 수량 선택 시 실시간 미리보기 (수량>0인 경우만)
    if(total > 0){
      if(hTotal) hTotal.textContent = Math.max(0, remainCharge + remainExchange).toLocaleString() + ' P';
      if(hMaintain) hMaintain.textContent = cost.toLocaleString() + ' P';
    } else {
      // 수량=0: DB 실제값 복원
      if(hTotal) hTotal.textContent = ((userData.charge_points||0)+(userData.exchange_points||0)).toLocaleString() + ' P';
      if(hMaintain) hMaintain.textContent = (userData.maintain_points||0).toLocaleString() + ' P';
    }
    if(hSub) hSub.textContent = '충전 '+remainCharge.toLocaleString()+'P + 전환 '+remainExchange.toLocaleString()+'P';
  }
  // 버튼 활성/비활성
  var btn = document.getElementById('reserve-btn');
  var _chP = (userData && userData.charge_points) || 0;
  var _exP = (userData && userData.exchange_points) || 0;
  var notEnough = (_chP + _exP < cost);
  var isEmpty = (total === 0);
  // 시간 조건: 서버 시간(mock_time 포함) 기준
  var _h2 = getEffectiveDate().getHours();
  var _isTimeOk = (_h2 >= 5 && _h2 < 20);
  if(btn && !_reservedToday){
    var _btnDisabled = (notEnough || isEmpty || !_isTimeOk);
    btn.disabled = _btnDisabled;
    btn.style.opacity = _btnDisabled ? '0.4' : '1';
    btn.style.cursor = _btnDisabled ? 'not-allowed' : 'pointer';
    if(notEnough) btn.title = '포인트가 부족합니다';
    else if(!_isTimeOk) btn.title = '구매·판매 예약은 05:00~20:00에만 가능합니다';
    else btn.title = '';
  }
}
function updateReserveDefaults(lv){
  var d=userData||{};
  var tr=d.today_reservations||{};
  var cfg=d.level_config||LEVEL_CFG_JS[lv]||LEVEL_CFG_JS[1];
  var BZ_MIN=(cfg.bz_min!=null?cfg.bz_min:0), BZ_MAX=cfg.bz_max||3;
  var todayBz=tr.bronze||0;
  // 예약 완료 시 수정 수량도 0으로 표시 (비활성화 상태로 통일)
  bzCnt = (_reservedToday || todayBz > 0) ? 0 : BZ_MIN;
  // 루비/다이아는 항상 0으로 초기화 (매번 새로 선택)
  svCnt = 0;
  gdCnt = 0;
  var SV_MIN_A=(cfg.sv_min!=null?cfg.sv_min:0), SV_MAX_A=cfg.sv_max||0;
  var GD_MIN_A=(cfg.gd_min!=null?cfg.gd_min:0), GD_MAX_A=cfg.gd_max||0;
  updateResUI(BZ_MIN, BZ_MAX, SV_MIN_A, SV_MAX_A, GD_MIN_A, GD_MAX_A);
}
function renderLevelTab(){
  var lv=(userData&&userData.level)||1;
  var cfg=LEVEL_CFG_JS[lv]||LEVEL_CFG_JS[1];

  // ── 모든 행 초기화 ──
  for(var i=1;i<=10;i++){
    var row=document.getElementById('level-row-'+i);
    if(!row) continue;
    var star=row.querySelector('.lv-star');
    if(star) star.style.display='none';
    row.style.background='';
    row.style.fontWeight='';
    row.style.outline='';
  }

  // ── 현재 레벨 행 강조 + 별표 ──
  var cur=document.getElementById('level-row-'+lv);
  if(cur){
    cur.style.background='rgba(25,118,210,0.18)';
    cur.style.fontWeight='700';
    cur.style.outline='2px solid #1976d2';
    var star=cur.querySelector('.lv-star');
    if(star){ star.style.display='inline'; star.textContent='★'; }
  }

  // ── 연동규칙 헤더 ──
  var hdr=document.querySelector('#level-rules-box>div:first-child');
  if(hdr) hdr.textContent='🔗 연동규칙 (현재 '+lv+'레벨)';

  // ── 수정 규칙 ──
  var bzEl=document.getElementById('rule-bz');
  if(bzEl) bzEl.textContent='• 수정: 최소 '+(cfg.bz_min||1)+' ~ 최대 '+(cfg.bz_max||1)+'개 예약 가능';

  // ── 루비 규칙 ──
  var svEl=document.getElementById('rule-sv');
  if(svEl){
    if(cfg.sv_max>0)
      svEl.textContent='• 루비: 최소 '+(cfg.sv_min||1)+' ~ 최대 '+(cfg.sv_max||1)+'개 예약 (수정 '+cfg.bz_min+'개 이상 시 활성화)';
    else
      svEl.textContent='• 룢: 현재 레벨에서 예약 불가';
  }

  // ── 다이아 규칙 ──
  var gdEl=document.getElementById('rule-gd');
  if(gdEl){
    if(cfg.gd_max>0)
      gdEl.textContent='• 다이아: 최소 '+(cfg.gd_min||1)+' ~ 최대 '+(cfg.gd_max||1)+'개 예약 (룢 '+cfg.sv_min+'개 이상 시 활성화)';
    else
      gdEl.textContent='• 다이아: 현재 레벨에서 예약 불가';
  }
}



var _notifSelectMode = false;

function _renderNotifList(notifications){
  var list = document.getElementById('notif-list');
  if(!list) return;
  if(!notifications || notifications.length === 0){
    list.innerHTML = '<div style="text-align:center;color:#aaa;padding:40px 0">알림이 없습니다</div>';
    return;
  }
  list.innerHTML = notifications.map(function(n){
    var date = (n.created_at||'').slice(0,16);
    var isRead = n.is_read;
    var typeIcon = n.type==='charge'?'\uD83D\uDCB0':n.type==='admin'?'\uD83D\uDCE2':'\uD83D\uDD14';
    var chk = _notifSelectMode
      ? '<input type="checkbox" class="notif-chk" data-id="'+n.id+'" style="margin-right:8px;width:17px;height:17px;cursor:pointer;flex-shrink:0;margin-top:3px">'
      : '';
    return '<div style="padding:12px 16px;border-bottom:1px solid #eee;background:'+(isRead?'#fff':'#f0f7ff')+';display:flex;align-items:flex-start">'      +chk      +'<div style="flex:1;min-width:0">'      +'<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">'      +'<span style="font-size:16px">'+typeIcon+'</span>'      +'<span style="font-weight:600;font-size:14px;color:#333;flex:1">'+n.title+'</span>'      +(isRead?'':'<span style="background:#2196f3;color:#fff;font-size:10px;padding:1px 6px;border-radius:10px">NEW</span>')      +'</div>'      +'<div style="font-size:12px;color:#555;white-space:pre-line;word-break:break-word">'+n.message+'</div>'      +'<div style="font-size:11px;color:#aaa;margin-top:4px">'+date+'</div>'      +'</div></div>';
  }).join('');
}

function toggleNotifSelectMode(){
  _notifSelectMode = !_notifSelectMode;
  var btn = document.getElementById('notif-select-btn');
  var delBtn = document.getElementById('notif-delete-btn');
  if(btn){ btn.textContent = _notifSelectMode ? '\ucde8\uc18c' : '\uc120\ud0dd'; btn.style.borderColor = _notifSelectMode ? '#e53935' : '#1976d2'; btn.style.color = _notifSelectMode ? '#e53935' : '#1976d2'; }
  if(delBtn) delBtn.style.display = _notifSelectMode ? 'inline-block' : 'none';
  _renderNotifList(window._notifData||[]);
}

async function deleteSelectedNotifs(){
  var chks = document.querySelectorAll('.notif-chk:checked');
  if(!chks.length){ toast('\uc0ad\uc81c\ud560 \uc54c\ub9bc\uc744 \uc120\ud0dd\ud574\uc8fc\uc138\uc694.'); return; }
  var ids = Array.from(chks).map(function(c){ return parseInt(c.dataset.id); });
  try{
    await api('/user/notifications/delete',{method:'POST',body:JSON.stringify({ids:ids})});
    window._notifData = (window._notifData||[]).filter(function(n){ return ids.indexOf(n.id)<0; });
    toast(ids.length+'\uac1c \uc54c\ub9bc\uc774 \uc0ad\uc81c\ub418\uc5c8\uc2b5\ub2c8\ub2e4.');
    _notifSelectMode = false;
    var btn = document.getElementById('notif-select-btn');
    var delBtn = document.getElementById('notif-delete-btn');
    if(btn){ btn.textContent='\uc120\ud0dd'; btn.style.borderColor='#1976d2'; btn.style.color='#1976d2'; }
    if(delBtn) delBtn.style.display='none';
    _renderNotifList(window._notifData);
    var badge = document.getElementById('notif-badge');
    if(badge && !(window._notifData||[]).some(function(n){return !n.is_read;})) badge.style.display='none';
  }catch(e){ toast('\uc0ad\uc81c \uc2e4\ud328: '+e.message); }
}

var _lastUnreadCount = 0;
async function loadNotifBadge(){
  try{
    const d=await api('/user/notifications');
    const badge=document.getElementById('notif-badge');
    const unread = d.unread||0;
    if(badge){
      if(unread>0){badge.style.display='inline-block';badge.textContent=unread>99?'99+':unread;}
      else{badge.style.display='none';}
    }
    // 정지 상태 주기적 확인 (30초 간격)
    if(window._lastSuspendCheck === undefined || Date.now() - window._lastSuspendCheck > 30000){
      window._lastSuspendCheck = Date.now();
      try{
        var _me = await api('/user/me');
        if(_me && typeof _me.suspended_until !== 'undefined'){
          if(window.userData) window.userData.suspended_until = _me.suspended_until;
          checkSuspended(_me);
        }
      }catch(_e){}
    }
    // 새 알림(매칭완료 등) 감지 시 포인트 즉시 갱신
    if(unread > _lastUnreadCount && _lastUnreadCount >= 0){
      await loadUserData();
      if(window.userData) renderHeader(window.userData);
    }
    _lastUnreadCount = unread;
  }catch(e){}
}

async function loadNotifications(){
  try{
    const d=await api('/user/notifications');
    // 뱃지 업데이트
    const badge=document.getElementById('notif-badge');
    var notifBtn=document.getElementById('nav-notif-btn');
    if(badge){
      if(d.unread>0){
        badge.textContent=d.unread>99?'99+':d.unread;
        badge.style.display='inline-block';
        if(notifBtn && !notifBtn.classList.contains('notif-blink')) notifBtn.classList.add('notif-blink');
      } else {
        badge.style.display='none';
        if(notifBtn) notifBtn.classList.remove('notif-blink');
      }
    }
    // 알림 목록 렌더링
    const list=document.getElementById('notif-list');
    if(!list) return;
    if(!d.notifications||d.notifications.length===0){
      list.innerHTML='<div style="text-align:center;color:#aaa;padding:40px 0">알림이 없습니다</div>';
      return;
    }
    window._notifData = d.notifications;
    _renderNotifList(d.notifications);
    // 읽음 처리
    if(d.unread>0){
      await api('/user/notifications/read',{method:'POST'});
      if(badge) badge.style.display='none';
    }
  }catch(e){
    const list=document.getElementById('notif-list');
    if(list) list.innerHTML='<div style="text-align:center;color:#e53935;padding:40px 0">알림을 불러오지 못했습니다</div>';
  }
}

// ── 거래 정지 체크 ──────────────────────────────────────
function checkSuspended(d){
  var now = getEffectiveDate ? getEffectiveDate() : new Date();
  var suspendedUntil = d && d.suspended_until ? new Date(d.suspended_until.replace(' ','T')) : null;
  var isSuspended = suspendedUntil && now < suspendedUntil;

  // ★ 거래 정지 시 모든 조건보다 우선하여 버튼 비활성화
  if(isSuspended){
    // 구매예약 +/- 버튼
    ['r-bz-m','r-bz-p','r-sv-m','r-sv-p','r-gd-m','r-gd-p'].forEach(function(id){
      var el=document.getElementById(id);
      if(el){ el.disabled=true; el.style.cursor='not-allowed'; }
    });
    // 구매예약 확정 버튼
    var reserveBtn = document.getElementById('reserve-btn');
    if(reserveBtn){
      reserveBtn.disabled=true;
      reserveBtn.style.opacity='0.4';
      reserveBtn.style.cursor='not-allowed';
      reserveBtn.title='거래 정지 중';
    }
    // 판매예약 버튼 (판매예약하기)
    document.querySelectorAll('.sell-reserve-btn,[onclick*="doSellReservation"],[onclick*="판매 예약하기"]').forEach(function(b){
      b.disabled=true; b.style.opacity='0.4'; b.style.cursor='not-allowed';
    });
    // 판매예약 버튼 id로도
    var sellBtn = document.getElementById('sell-reserve-btn') || document.querySelector('[onclick*="doSellReservationBulk"]');
    if(sellBtn){ sellBtn.disabled=true; sellBtn.style.opacity='0.4'; sellBtn.style.cursor='not-allowed'; }
    // 배너
    var banner = document.getElementById('suspend-banner');
    if(banner){
      var untilDate = (d.suspended_until||'').slice(0,10);
      var resumeTime = untilDate ? untilDate + ' 01:00' : '';
      banner.style.display='block';
      banner.innerHTML = '🚫 거래 정지 중 — 거래 재개: ' + resumeTime + ' | 패널티 탭에서 해제하세요';
    }
    // 로고 옆 거래정지 배지
    var badge = document.getElementById('suspend-badge');
    if(badge) badge.style.display='inline';
  } else {
    // ★ 정지 해제 시: 버튼 스타일 완전 복원
    ['r-bz-m','r-bz-p','r-sv-m','r-sv-p','r-gd-m','r-gd-p'].forEach(function(id){
      var el=document.getElementById(id);
      if(el){ el.disabled=false; el.style.cursor=''; el.style.opacity=''; }
    });
    var reserveBtn = document.getElementById('reserve-btn');
    if(reserveBtn){
      reserveBtn.disabled=false;
      reserveBtn.style.opacity='';
      reserveBtn.style.cursor='';
      reserveBtn.title='';
    }
    document.querySelectorAll('.sell-reserve-btn,[onclick*="doSellReservation"],[onclick*="판매 예약하기"]').forEach(function(b){
      b.disabled=false; b.style.opacity=''; b.style.cursor='';
    });
    var sellBtn = document.getElementById('sell-reserve-btn') || document.querySelector('[onclick*="doSellReservationBulk"]');
    if(sellBtn){ sellBtn.disabled=false; sellBtn.style.opacity=''; sellBtn.style.cursor=''; }
    var banner = document.getElementById('suspend-banner');
    if(banner) banner.style.display='none';
    var badge = document.getElementById('suspend-badge');
    if(badge) badge.style.display='none';
  }
  window._isSuspended = isSuspended;
}

// ── 패널티 탭 로드 ──────────────────────────────────────
async function loadPenaltyTab(){
  try {
    var d = await api('/user/penalties');
    var pending = d.pending_penalty;
    var btn = document.getElementById('penalty-release-btn');
    var statusText = document.getElementById('penalty-status-text');
    var infoBox = document.getElementById('my-penalty-info');
    var detailText = document.getElementById('penalty-detail-text');

    if(pending && !pending.is_released){
      var isWaitingApproval = pending.release_paid === 1 || pending.release_paid === true;
      var resumeAt = pending.release_at || null;
      var suspendDays = pending.suspend_days || 0;
      if(isWaitingApproval){
        // 납부 완료 → 자동 해제 대기중
        if(btn){
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
          btn.textContent = '⏳ 정지 ' + suspendDays + '일 후 자동 해제 예정';
          btn.style.background = '#546e7a';
        }
        // 남은 정지일수 계산
        var remainText = '';
        if(resumeAt) {
          // 오늘 날짜(서버 기준)와 release_at 날짜만 비교하여 남은 일수 계산
          var resumeDate = resumeAt.slice(0,10);
          // 서버 시간 기반 today 사용 (UTC 오프셋 문제 방지)
          var _effD = typeof getEffectiveDate==='function' ? getEffectiveDate() : new Date();
          var todayStr = window._serverTodayStr ||
            (_effD.getFullYear()+'-'+String(_effD.getMonth()+1).padStart(2,'0')+'-'+String(_effD.getDate()).padStart(2,'0'));
          var todayMs = new Date(todayStr + 'T00:00:00').getTime();
          var resumeMs = new Date(resumeDate + 'T00:00:00').getTime();
          var diffDays = Math.round((resumeMs - todayMs) / (1000*60*60*24));
          if(diffDays > 0) {
            remainText = resumeDate + ' 01:00 자동 해제 (남은 ' + diffDays + '일)';
          } else if(diffDays === 0) {
            remainText = '오늘 01:00 자동 해제됩니다';
          } else {
            remainText = '곧 자동 해제됩니다';
          }
        }
        if(statusText){
          statusText.textContent = remainText || ('정지 ' + suspendDays + '일 경과 후 자동 해제');
          statusText.style.color = '#f9a825';
        }
      } else {
        // 미납부 → 해제 버튼 활성화
        if(btn){
          btn.disabled = false;
          btn.style.opacity = '1';
          btn.style.cursor = 'pointer';
          btn.textContent = '🔓 패널티 해제하기';
          btn.style.background = '#c62828';
        }
        if(statusText){
          statusText.textContent = '미해제 패널티 있음 — 해제 포인트: ' + (pending.release_points||0).toLocaleString() + 'P';
          statusText.style.color = '#ef5350';
        }
      }
      if(infoBox) infoBox.style.display = 'block';
      if(detailText && d.suspended_until){
        detailText.innerHTML =
          '• 누적 미입금: ' + (d.unpaid_count||0) + '회<br>' +
          '• 정지 해제일: ' + (d.suspended_until||'').slice(0,10) + '<br>' +
          '• 해제 포인트: ' + (pending.release_points||0).toLocaleString() + 'P<br>' +
          (isWaitingApproval
            ? '• ⏳ ' + (resumeAt ? resumeAt.slice(0,10)+' 01:00' : '정지 '+suspendDays+'일 후') + ' 자동 해제됩니다.'
            : '• 해제 포인트 충전 후 해제 버튼을 눌러주세요.');
      }
    } else {
      // 패널티 없거나 모두 해제됨 - 버튼 숨김, 누적횟수 표시
      if(btn){
        btn.style.display = 'none';
      }
      if(statusText){ statusText.textContent = ''; }
      if(infoBox) infoBox.style.display = 'none';
      // 누적 패널티 횟수 표시
      var totalReleased = d.penalties ? d.penalties.filter(function(p){ return p.is_released; }).length : 0;
      var totalAll = d.penalties ? d.penalties.length : 0;
      if(totalAll > 0) {
        var historyEl = document.getElementById('penalty-history-text');
        if(!historyEl) {
          historyEl = document.createElement('div');
          historyEl.id = 'penalty-history-text';
          historyEl.style.cssText = 'font-size:12px;color:#888;text-align:center;padding:8px;margin-bottom:8px';
          var section = document.getElementById('penalty-release-section');
          if(section) section.appendChild(historyEl);
        }
        historyEl.textContent = '누적 미입금: 총 ' + totalAll + '회 (해제 완료)';
      }
    }
  } catch(e) { console.error('loadPenaltyTab:', e); }
}

async function showPenaltyReleasePopup(){
  try {
    var d = await api('/user/penalties');
    var pending = d.pending_penalty;
    if(!pending) return;
    var relPts = pending.release_points || 0;
    var me = await api('/user/me');
    var totalPts = (me.charge_points||0) + (me.exchange_points||0);
    var content = document.getElementById('penalty-popup-content');
    var confirmBtn = document.getElementById('penalty-confirm-btn');
    var overlay = document.getElementById('penalty-release-overlay');
    if(content){
      if(totalPts >= relPts){
        content.innerHTML =
          '<div style="color:#f9a825;margin-bottom:10px">패널티 포인트 납부 후 정지일수 다음날 01:00에 자동으로 해제됩니다.</div>' +
          '• 해제 포인트: <strong>' + relPts.toLocaleString() + 'P</strong><br>' +
          '• 현재 포인트: ' + totalPts.toLocaleString() + 'P<br>' +
          '• 차감 후 잔액: ' + (totalPts - relPts).toLocaleString() + 'P';
        if(confirmBtn){ confirmBtn.style.display='block'; }
      } else {
        content.innerHTML =
          '<div style="color:#ef5350;margin-bottom:10px">포인트가 부족합니다.</div>' +
          '• 해제 포인트: <strong>' + relPts.toLocaleString() + 'P</strong><br>' +
          '• 현재 포인트: ' + totalPts.toLocaleString() + 'P<br>' +
          '• 부족 포인트: ' + (relPts - totalPts).toLocaleString() + 'P<br><br>' +
          '<span style="color:#888;font-size:11px">포인트를 충전 후 해제하세요.</span>';
        if(confirmBtn){ confirmBtn.style.display='none'; }
      }
    }
    if(overlay){
      // position:fixed가 제대로 동작하도록 body 직접 자식으로 이동
      if(overlay.parentElement !== document.body) document.body.appendChild(overlay);
      overlay.style.display='flex';
    }
  } catch(e){ toast('오류 발생','error'); }
}

function closePenaltyPopup(){
  var overlay = document.getElementById('penalty-release-overlay');
  if(overlay) overlay.style.display = 'none';
}

async function doReleasePenalty(){
  try {
    var d = await api('/penalty/release', {method:'POST', body:JSON.stringify({})});
    closePenaltyPopup();
    toast(d.message || '납부 완료. 관리자 확인 후 해제됩니다.', 'success');
    // 즉시 버튼 상태 변경 (API 재로드 전)
    var btn = document.getElementById('penalty-release-btn');
    var statusText = document.getElementById('penalty-status-text');
    var suspDays = d.suspend_days || 0;
    var resumeAt = d.resume_at ? d.resume_at.slice(0,10) : '';
    if(btn){
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      btn.textContent = '⏳ 정지 ' + suspDays + '일 후 자동 해제 예정';
      btn.style.background = '#546e7a';
    }
    if(statusText){
      statusText.textContent = resumeAt ? resumeAt + ' 01:00 자동 해제' : '정지 기간 후 자동 해제';
      statusText.style.color = '#f9a825';
    }
    await loadUserData();
    await loadPenaltyTab();
  } catch(e){
    closePenaltyPopup();
    toast(e.message || '패널티 해제 실패', 'error');
  }
}


// ── 판매 탭 ──────────────────────────────────────
var _myItems = [];
var _sellServerHour = 0;
var _sellServerMin  = 0;
var _isMatchingTimeServer = true;  // 기본값: 매칭 시간(안전한 방향)
var _sellUnpaidClickedAt = {};
var _confirmedUnpaidMatchIds = {}; // 미입금확인 완료된 match_id 세트 // matchId → 마지막 클릭 시각(분)

async function loadSellTab(){
  try {
    // 서버 시간 가져오기 (버튼 활성화 조건용)
    try {
      var ct = await fetch('/api/current-time').then(function(r){return r.json();});
      _sellServerHour = ct.hour||0;
      _sellServerMin  = ct.minute||0;
    } catch(e2){}
    var d = await api('/user/my-items');
    _myItems = d.items || [];
    // 서버에서 매칭 시간 여부를 직접 받아서 전역 변수에 저장
    if(typeof d.is_matching_time !== 'undefined'){
      _isMatchingTimeServer = !!d.is_matching_time;
    } else {
      _isMatchingTimeServer = (_sellServerHour>=20||_sellServerHour<5);
    }
    _renderSellSummary();
    renderSellTab();
    // 판매예약하기 버튼: /user/my-items로 직접 확인 (await으로 순서 보장)
    try {
      var _sellData = await api('/user/my-items');
      _updateSellBtnFromItems(_sellData.items||[]);
    } catch(e2) { _updateSellBtnFromItems([]); }
  } catch(e) {
    var el = document.getElementById('sell-tab-list');
    if(el) el.innerHTML = '<div style="text-align:center;color:var(--text2);padding:20px">불러오기 실패: '+e.message+'</div>';
  }
}

function _renderSellSummary(){
  var types = ['bronze','silver','gold'];
  var ids   = ['bz','sv','gd'];
  types.forEach(function(t,i){
    var all = _myItems.filter(function(x){ return x.bar_type===t; });
    var ok  = all.filter(function(x){ return x.status==='reservable'||x.status==='active'; }).length;
    var pend= all.filter(function(x){ return x.status==='pending'; }).length;
    var mat = all.filter(function(x){ return x.status==='matched'; }).length;
    var sold= all.filter(function(x){ return x.status==='sold'; }).length;
    var pf  = ids[i];
    var el  = document.getElementById('sell-sum-'+pf+'-total');
    if(el) el.textContent = all.length;
    var elOk = document.getElementById('sell-sum-'+pf+'-ok');
    if(elOk) elOk.textContent = ok + (pend>0?' (예약중 '+pend+')':'');
    var elMat = document.getElementById('sell-sum-'+pf+'-match');
    if(elMat) elMat.textContent = mat;
    var elSold = document.getElementById('sell-sum-'+pf+'-sold');
    if(elSold) elSold.textContent = sold;
  });
}

function renderSellTab(){
  var listEl = document.getElementById('sell-tab-list');
  var totalEl = document.getElementById('sell-tab-total');
  if(!listEl) return;

  var filtered = _myItems.slice();

  if(totalEl) totalEl.textContent = '총 '+filtered.length+'개';

  if(!filtered.length){
    listEl.innerHTML = '<div style="text-align:center;color:var(--text2);padding:20px;font-size:13px">아이템 없음</div>';
    return;
  }

  var tC={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
  var tN={bronze:'수정',silver:'루비',gold:'다이아'};
  var msKr={pending:'대기',matched:'매칭완료',paid:'송금',confirmed:'거래완료',cancelled:'취소',failed:'미입금',unpaid:'미입금'};
  var msColor={pending:'#888',matched:'#f9a825',paid:'#42a5f5',confirmed:'#66bb6a',cancelled:'#ef5350',failed:'#ef5350',unpaid:'#ef5350'};

  // 매칭 시간 여부: 서버에서 받은 값 사용 (더 정확)
  var _isMatchingTime = _isMatchingTimeServer;

  // 단계별 그룹 정의 (순서: 보유중 → 판매가능 → 판매예약중 → 진행중)
  var stages = [
    {key:'보유중',   label:'보유중',     color:'#64b5f6', filter:function(x){
      if(x.match_status && x.match_status!=='cancelled') return false;
      return x.status_label==='보유중';
    }},
    {key:'판매가능', label:'판매가능',   color:'#66bb6a', filter:function(x){
      if(x.match_status && x.match_status!=='cancelled') return false;
      return x.status_label==='판매가능';
    }},
    {key:'판매예약중',label:'판매예약중', color:'#ab47bc', filter:function(x){
      if(x.status_label!=='판매예약중') return false;
      var ms = x.match_status;
      // paid 이상은 진행중으로
      if(ms==='paid'||ms==='confirmed'||ms==='unpaid'||ms==='failed') return false;
      // 매칭 시간(20~05시)에는 pending도 판매예약중으로 표시
      // 그 외 시간에는 pending을 진행중으로 넘김 (매칭 완료 후 공개 시간)
      if(ms==='pending'||ms==='matched') return _isMatchingTime;
      return true;
    }},

    {key:'진행중',   label:'매칭/거래중', color:'#f9a825', filter:function(x){
      var ms = x.match_status;
      if(!ms) return false;
      // 매칭 시간(20~05시)에는 진행중 표시 안 함
      if(_isMatchingTime && (ms==='pending'||ms==='matched')) return false;
      // 05시 이후: pending/matched도 진행중으로 표시 (매칭 결과 공개)
      if(!_isMatchingTime && (ms==='pending'||ms==='matched')) return true;
      return ms==='paid' || ms==='confirmed' || ms==='unpaid' || ms==='failed';
    }}
  ];

  function renderCard(item){
    var ms = item.match_status;
    var _isBuyerRole = (item._role === 'buyer');
    var _roleBadge = _isBuyerRole
      ? '<span style="font-size:10px;background:#1565c033;color:#90caf9;padding:1px 6px;border-radius:6px;margin-left:4px">구매</span>'
      : '';
    var _stLabel = ms ? (msKr[ms]||ms) : (item.status_label||(item.status||''));
    var _stColor = ms ? (msColor[ms]||'#888') : (
      _stLabel==='판매가능'?'#66bb6a':_stLabel==='보유중'?'#64b5f6':
      _stLabel==='판매예약중'?'#ab47bc':_stLabel==='매칭완료'?'#f9a825':
      _stLabel==='판매완료'?'#888':'#aaa');
    // 상대방 정보 (매칭 시간 20~05시에는 pending/matched는 숨김)
    var _hidePendingInfo = _isMatchingTime && (ms==='pending'||ms==='matched');
    var _counterpart = _hidePendingInfo ? '' : (_isBuyerRole
      ? (item.seller_username ? '판매자: '+item.seller_username+(item.seller_account_name?' ('+item.seller_account_name+')':'') : '')
      : (item.buyer_username  ? '구매자: '+item.buyer_username+(item.buyer_account_name?' ('+item.buyer_account_name+')':'') : ''));
    // 액션 버튼
    var actionBtns = '';
    var _isBuyerRoleAct = _isBuyerRole;
    if(_hidePendingInfo){
      // 매칭 시간(20~05시)에는 pending/matched 버튼 완전 숨김
    } else
    if(item.match_id && ms && ms !== 'cancelled' && ms !== 'confirmed' && !_isBuyerRoleAct){
      var _mRound = item.match_round || 1;
      var _sh = _sellServerHour||0, _sm = _sellServerMin||0;
      var _totalMin = _sh*60+_sm;
      var _inPayWin  = (_mRound===2)?(_totalMin>=900&&_totalMin<1140):(_totalMin>=300&&_totalMin<780);
      var _inWarnWin = (_mRound===2)?(_totalMin>=1110&&_totalMin<1140):(_totalMin>=750&&_totalMin<780);
      var _inConfWin = (_mRound===2)?(_totalMin>=1140&&_totalMin<1200):(_totalMin>=780&&_totalMin<840);
      var _isPaid = (ms==='paid');
      var _isConf = (ms==='confirmed' || ms==='failed' || ms==='unpaid') || !!_confirmedUnpaidMatchIds[item.match_id];
      var _lastMin = (_sellUnpaidClickedAt[item.match_id]||0);
      var _coolOk = (_lastMin===0)||((_totalMin-_lastMin)>=9);
      if(item.receipt_url){
        actionBtns += '<a href="'+item.receipt_url+'" target="_blank" style="padding:3px 8px;background:#37474f;color:#80cbc4;border:1px solid #546e7a;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px;text-decoration:none">🖼️ 이미지</a>';
      }
      if(_isPaid && _inPayWin){ actionBtns += '<button onclick="userConfirmPayment('+item.match_id+')" style="padding:3px 8px;background:#1976d2;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px">✅ 입금확인</button>'; }
      else { actionBtns += '<button disabled style="padding:3px 8px;background:rgba(0,0,0,0.2);color:#555;border:1px solid #333;border-radius:4px;font-size:11px;cursor:not-allowed;margin-right:4px">✅ 입금확인</button>'; }
      if(!_isPaid && !_isConf && _inWarnWin && _coolOk){ actionBtns += '<button onclick="userWarnUnpaid('+item.match_id+')" style="padding:3px 8px;background:#f57c00;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px">📨 입금요청</button>'; }
      else { actionBtns += '<button disabled style="padding:3px 8px;background:rgba(0,0,0,0.2);color:#555;border:1px solid #333;border-radius:4px;font-size:11px;cursor:not-allowed;margin-right:4px">📨 입금요청</button>'; }
      var _alreadyConfirmedUnpaid = !!_confirmedUnpaidMatchIds[item.match_id];
      if(!_isConf && !_alreadyConfirmedUnpaid && _inConfWin){ actionBtns += '<button onclick="userConfirmUnpaid('+item.match_id+')" style="padding:3px 8px;background:#c62828;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer">🚫 미입금확인</button>'; }
      else { actionBtns += '<button disabled style="padding:3px 8px;background:rgba(0,0,0,0.2);color:#555;border:1px solid #333;border-radius:4px;font-size:11px;cursor:not-allowed">🚫 미입금확인</button>'; }
      if(ms==='matched'){ actionBtns += '<span style="font-size:11px;color:#f9a825;margin-left:4px">⏳ 송금 대기</span>'; }
    }
    return '<div style="background:var(--card-bg);border:1px solid var(--border);border-radius:8px;padding:10px;margin-bottom:6px">'
      +'<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">'
        +'<span style="font-size:13px;font-weight:700;color:'+(tC[item.bar_type]||'#fff')+'">'+( tN[item.bar_type]||item.bar_type)+' '+(item.stage||1)+'단계'+_roleBadge+'</span>'
        +'<span style="padding:2px 8px;border-radius:10px;font-size:11px;background:'+_stColor+'22;color:'+_stColor+';border:1px solid '+_stColor+'44">'+_stLabel+'</span>'
      +'</div>'
      +(item.purchase_date ? '<div style="font-size:11px;color:var(--text2);margin-bottom:2px">구매일: '+item.purchase_date+(item.days!=null?' ('+(item.days+1)+'일째)':'')+(item.reserve_date&&item.reserve_date!==item.purchase_date?' | 예약: '+item.reserve_date:'')+'</div>' : '')
      +(_counterpart ? '<div style="font-size:11px;color:#64b5f6;margin-bottom:4px">'+_counterpart+'</div>' : '')
      +(actionBtns ? '<div style="margin-top:6px">'+actionBtns+'</div>' : '')
      +'</div>';
  }

  var html = '';
  stages.forEach(function(stage){
    var group = filtered.filter(stage.filter);
    if(!group.length) return;
    html += '<div style="margin-bottom:14px">'
      +'<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px;padding:4px 0;border-bottom:1px solid var(--border)">'
        +'<span style="width:8px;height:8px;border-radius:50%;background:'+stage.color+';flex-shrink:0;display:inline-block"></span>'
        +'<span style="font-size:12px;font-weight:700;color:'+stage.color+'">'+stage.label+'</span>'
        +'<span style="font-size:11px;color:var(--text2)">'+group.length+'개</span>'
      +'</div>'
      +group.map(renderCard).join('')
      +'</div>';
  });
  listEl.innerHTML = html || '<div style="text-align:center;color:var(--text2);padding:20px;font-size:13px">아이템 없음</div>';
}

// 판매탭: 입금확인
async function userConfirmPayment(matchId){
  // 즉시 버튼 비활성화
  var clickedEl = event && event.target;
  if(clickedEl){ clickedEl.disabled=true; clickedEl.style.opacity='0.5'; clickedEl.style.cursor='not-allowed'; }
  try {
    var r = await api('/match/confirm-payment', {method:'POST', body:JSON.stringify({match_id:matchId})});
    if(r.success) { toast('입금확인 완료!','success'); loadSellTab(); }
    else { toast(r.error||'처리 실패','error'); loadSellTab(); }
  } catch(e){ toast('오류: '+e.message,'error'); loadSellTab(); }
}

// 판매탭: 입금요청 (9분 쿨타임)
async function userWarnUnpaid(matchId){
  try {
    var r = await api('/match/report-unpaid', {method:'POST', body:JSON.stringify({match_id:matchId})});
    if(r.success){
      _sellUnpaidClickedAt[matchId] = _sellServerHour*60 + _sellServerMin;
      toast('입금 요청 발송 완료 (9분 후 재활성화)', 'success');
      loadSellTab();
    } else toast(r.error||'처리 실패','error');
  } catch(e){ toast('오류: '+e.message,'error'); }
}

// 판매탭: 미입금확인 처리
// 미입금확인 팝업 열기/닫기
var _pendingUnpaidMatchId = null;
function userConfirmUnpaid(matchId){
  _pendingUnpaidMatchId = matchId;
  // 팝업 열기
  var ov = document.getElementById('unpaid-confirm-overlay');
  if(ov){ if(ov.parentElement!==document.body) document.body.appendChild(ov); ov.classList.add('show'); }
}
function closeUnpaidConfirm(){
  var ov = document.getElementById('unpaid-confirm-overlay');
  if(ov) ov.classList.remove('show');
  _pendingUnpaidMatchId = null;
}
async function doConfirmUnpaid(){
  var matchId = _pendingUnpaidMatchId;
  if(!matchId) return;
  // 팝업 닫기 + 버튼 비활성화
  closeUnpaidConfirm();
  document.querySelectorAll('button').forEach(function(b){
    if(b.textContent.includes('미입금확인')){ b.disabled=true; b.style.opacity='0.5'; b.style.cursor='not-allowed'; }
  });
  try {
    var r = await api('/user/confirm-unpaid', {method:'POST', body:JSON.stringify({match_id:matchId})});
    if(r.success){ _confirmedUnpaidMatchIds[matchId]=true; toast('미입금 처리 완료', 'success'); loadSellTab(); }
    else { toast(r.error||'처리 실패','error'); loadSellTab(); }
  } catch(e){ toast('오류: '+e.message,'error'); loadSellTab(); }
}

