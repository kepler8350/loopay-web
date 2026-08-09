// 판매탭 매치 라벨 (전역)
window.getMatchLabel = function(item) {
  var ms = item.match_status;
  var round = item.match_round || 1;
  var isLoopay = item.is_loopay_match || item.buyer_username === 'loopay';
  if(!ms || ms === 'confirmed' || ms === 'failed') return null;
  if(isLoopay) {
    if(ms === 'pending') return {label:'시스템 입금대기', color:'#ab47bc', bg:'#ab47bc22'};
    if(ms === 'paid')    return {label:'시스템 입금확인중', color:'#ab47bc', bg:'#ab47bc22'};
  }
  if(round === 2) {
    if(ms === 'pending') return {label:'2차 입금대기', color:'#ff9800', bg:'#ff980022'};
    if(ms === 'paid')    return {label:'2차 입금확인중', color:'#ff9800', bg:'#ff980022'};
  }
  if(ms === 'pending') return {label:'1차 입금대기', color:'#f9a825', bg:'#f9a82522'};
  if(ms === 'paid')    return {label:'1차 입금확인중', color:'#42a5f5', bg:'#42a5f522'};
  return null;
};

// ── 공통 커스텀 confirm 팝업 ──

// ── 판매예약 버튼 상태 통합 관리 ──
window._hasSellableItem = false;  // 초기값: 아이템 로드 전까지 false(비활성)
window._isReserveTimeCached = false;
function _updateSellBtn(isReserveTime){
  if(window._isSuspended) return;
  var _canSell = !!isReserveTime && !!window._hasSellableItem;
  // 상태 변화 없으면 스킵 (깜박임 방지)
  if(window._lastSellBtnState === _canSell) return;
  window._lastSellBtnState = _canSell;
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
  window._lastSellBtnState = undefined;  // 아이템 변경 시 버튼 강제 업데이트
  // 서버 시간 직접 조회 (오프셋 미설정 문제 방지)
  var _ctHeaders = {};
  var _ct_tok = localStorage.getItem('lp_token');
  if(_ct_tok) _ctHeaders['Authorization'] = 'Bearer '+_ct_tok;
  fetch('/api/current-time',{headers:_ctHeaders}).then(function(r){return r.json();}).then(function(ct){
    // 거래정지 즉시 반영 (1.5초마다 체크)
    if(ct && typeof ct.suspended_until !== 'undefined'){
      if(window.userData) window.userData.suspended_until = ct.suspended_until;
      if(typeof checkSuspended === 'function') checkSuspended({suspended_until: ct.suspended_until});
    }
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
  document.getElementById('common-confirm-body').innerHTML = (opts.message||'').replace(/\n/g,'<br>');
  var okBtn = document.getElementById('common-confirm-ok-btn');
  var cancelBtn = document.getElementById('common-confirm-cancel-btn');
  okBtn.textContent = opts.okText||'확인';
  okBtn.style.background = opts.okColor||'';
  cancelBtn.style.display = opts.hideCancelBtn ? 'none' : '';
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
  1:{bz_min:1,bz_max:3,sv_min:0,sv_max:1,gd_min:0,gd_max:1,cum:150},
  2:{bz_min:4,bz_max:6,sv_min:0,sv_max:3,gd_min:0,gd_max:2,cum:450},
  3:{bz_min:7,bz_max:10,sv_min:0,sv_max:5,gd_min:0,gd_max:3,cum:960},
  4:{bz_min:11,bz_max:14,sv_min:0,sv_max:7,gd_min:0,gd_max:5,cum:1740},
  5:{bz_min:15,bz_max:20,sv_min:0,sv_max:9,gd_min:0,gd_max:7,cum:2850},
  6:{bz_min:21,bz_max:27,sv_min:0,sv_max:13,gd_min:0,gd_max:9,cum:4350},
  7:{bz_min:28,bz_max:34,sv_min:0,sv_max:17,gd_min:0,gd_max:12,cum:6450},
  8:{bz_min:1,bz_max:42,sv_min:0,sv_max:22,gd_min:0,gd_max:15,cum:9450},
  9:{bz_min:1,bz_max:51,sv_min:0,sv_max:27,gd_min:0,gd_max:20,cum:12450},
  10:{bz_min:1,bz_max:60,sv_min:0,sv_max:34,gd_min:0,gd_max:26,cum:null}
};
// bz 수량 → sv 가능 수량 단계 테이블
var BZ_TO_SV_JS={
  1:0,2:0,3:1,
  4:2,5:2,6:3,
  7:4,8:4,9:4,10:5,
  11:6,12:6,13:6,14:7,
  15:8,16:8,17:8,18:8,19:8,20:9,
  21:12,22:12,23:12,24:12,25:12,26:12,27:13,
  28:16,29:16,30:16,31:16,32:16,33:16,34:17
};
// sv 수량 → gd 가능 수량 단계 테이블
var SV_TO_GD_JS={
  1:1,2:1,3:2,
  4:2,5:3,
  6:4,7:5,
  8:6,9:7,
  10:8,11:8,12:8,13:9,
  14:10,15:11,16:11,17:12
};
function getSvFromBz(bz){ var v=BZ_TO_SV_JS[bz]; return (v!=null)?v:1; }
function getGdFromSv(sv){ return SV_TO_GD_JS[sv]||1; }
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
      level_config:{bz_min:1,bz_max:3,sv_min:1,sv_max:2,gd_min:1,gd_max:1},
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
  // 패널티 탭이 열려있으면 자동 갱신 (다른 PC에서 타이밍 문제 방지)
  if(document.getElementById('tab-penalty')?.classList?.contains('active')){
    loadPenaltyTab();
  }
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
    message: '충전 포인트: <b>'+pts.toLocaleString()+'P</b><br>입금 금액: <b>'+won.toLocaleString()+'원</b><br><br><span style="font-size:24px;font-weight:700">📌 입금 계좌번호는 신청 후 알림에서 확인하세요.</span>',
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
  1:{bz_min:1,bz_max:3,sv_min:0,sv_max:1,gd_min:0,gd_max:1,cum:150},
  2:{bz_min:1,bz_max:6,sv_min:2,sv_max:3,gd_min:1,gd_max:2,cum:450},
  3:{bz_min:1,bz_max:10,sv_min:4,sv_max:5,gd_min:2,gd_max:3,cum:960},
  4:{bz_min:1,bz_max:14,sv_min:6,sv_max:7,gd_min:4,gd_max:5,cum:1740},
  5:{bz_min:1,bz_max:20,sv_min:8,sv_max:9,gd_min:6,gd_max:7,cum:2850},
  6:{bz_min:1,bz_max:27,sv_min:10,sv_max:13,gd_min:8,gd_max:9,cum:4350},
  7:{bz_min:1,bz_max:34,sv_min:14,sv_max:17,gd_min:10,gd_max:12,cum:6450},
  8:{bz_min:1,bz_max:42,sv_min:18,sv_max:22,gd_min:13,gd_max:15,cum:9450},
  9:{bz_min:1,bz_max:51,sv_min:23,sv_max:27,gd_min:16,gd_max:20,cum:12450},
  10:{bz_min:1,bz_max:60,sv_min:28,sv_max:34,gd_min:21,gd_max:26,cum:99999},
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

if(token){showMainApp();loadUserData();startMatchEventSource();}
loadPrices();

// ── 매칭 완료 자동 새로고침 (30초마다 체크) ──
var _lastMatchState = null;
async function checkMatchRefresh(){
  if(!localStorage.getItem('lp_token')) return;
  try{
    // 판매탭이 활성이면 매 폴링마다 즉시 재렌더링 (시간 경계 버튼 즉시 갱신)
    var _sellTabEl = document.getElementById('tab-sell');
    var _sellVisible = _sellTabEl && (_sellTabEl.classList.contains('active') || _sellTabEl.offsetHeight > 0);
    if(_sellVisible && typeof renderSellTab === 'function') renderSellTab();

    var d = await api('/user/me');
    // 거래정지 즉시 반영
    if(d && typeof d.suspended_until !== 'undefined'){
      if(window.userData) window.userData.suspended_until = d.suspended_until;
      checkSuspended(d);
    }
    var curState = JSON.stringify({
      bronze: d.items?.bronze?.length,
      silver: d.items?.silver?.length,
      gold: d.items?.gold?.length,
      maintain: d.maintain_points,
      total: d.total_points
    });
    // 서버 시간 기준으로 자동 입금확인 트리거
    var _eff = getEffectiveDate ? getEffectiveDate() : new Date();
    var _hm = _eff.getHours()*60 + _eff.getMinutes();
    if(_hm >= 840 || _hm >= 1200){
      api('/user/auto-confirm-paid', {method:'POST', body:'{}'}).catch(function(){});
    // 스케줄러 자동 처리 (미입금/입금확인) - 인증 없이 호출 가능
    fetch('/api/scheduler/auto-process',{method:'POST',headers:{'X-Scheduler-Key':'loopay-scheduler-2026'}}).catch(function(){});
    // 매일 강등 체크 (클라이언트가 트리거)
    api('/user/check-level-demotion', {method:'POST', body:'{}'}).catch(function(){});
    }
    // paid 상태 매치 감지에 포함
    var _sellPaidKey = '';
    try{
      var _mt = await api('/user/matching');
      _sellPaidKey = JSON.stringify((_mt.sell||[]).map(function(m){ return m.id+'_'+m.status; }));
    }catch(e2){}
    var _timeBucket = Math.floor(_hm / 1);
    var _fullState = curState + '|' + _sellPaidKey + '|t' + _timeBucket;
    if(_lastMatchState !== _fullState){
      if(_lastMatchState !== undefined){
        userData = d;
        renderHeader(d);
        renderBars && renderBars(d);
        renderLevelTab && renderLevelTab();
        loadUserData().then(function(){
          if(window.userData){
            renderHeader(window.userData);
            if(typeof updateReserveDefaults==='function') updateReserveDefaults(window.userData.level||1);
          }
        });
        // 구매탭 갱신
        var _buyTabEl = document.getElementById('tab-matching');
        var _buyVisible = _buyTabEl && (_buyTabEl.classList.contains('active') || _buyTabEl.offsetHeight > 0);
        // 구매탭 갱신 - active 여부 무관하게 항상 갱신 (21:00 자동입금확인 즉시 반영)
        if(typeof loadMatchingTab === 'function') loadMatchingTab();
        // 판매탭 갱신 (match_status=paid 변화 시 _myItems 새로 로드)
        var _sellTabEl2 = document.getElementById('tab-sell');
        var _sellVisible2 = _sellTabEl2 && _sellTabEl2.classList.contains('active');
        if(_sellVisible2 && typeof loadSellTab === 'function') loadSellTab();
      }
      _lastMatchState = _fullState;
    }
  }catch(e){}
}
setInterval(checkMatchRefresh, 5000);  // 5초마다 포인트/매칭 상태 감지

// 거래정지 전용 폴링 (5초, 독립적 - checkMatchRefresh 실패해도 작동)
setInterval(function(){
  var tok = localStorage.getItem('lp_token');
  if(!tok) return;
  fetch('/api/user/me', {headers:{'Authorization':'Bearer '+tok}})
    .then(function(r){ return r.json(); })
    .then(function(d){
      if(d && typeof d.suspended_until !== 'undefined'){
        if(window.userData) window.userData.suspended_until = d.suspended_until;
        checkSuspended(d);
      }
    }).catch(function(){});
}, 5000);
// 판매탭 버튼 상태 갱신: 5초마다 renderSellTab 직접 호출 (시간 경계 즉시 반영)
// paid 변화는 checkMatchRefresh에서 loadSellTab() 호출로 처리
setInterval(function(){
  var _sellTabEl = document.getElementById('tab-sell');
  if(_sellTabEl && _sellTabEl.classList.contains('active') && typeof renderSellTab === 'function'){
    // 서버 시간 동기화 후 렌더링 (mock_time 환경 포함하여 정확한 시간 보장)
    if(typeof syncServerTime === 'function'){
      syncServerTime().then(function(){ renderSellTab(); }).catch(function(){ renderSellTab(); });
    } else {
      renderSellTab();
    }
  }
}, 5000);
setInterval(loadNotifBadge, 5000);  // 5초마다 알림 체크 → 새 알림 시 포인트 갱신

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
  stopMatchEventSource();
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
    startMatchEventSource();  // SSE 연결
    // 로그인 후 홈 탭 기본 표시
    var homeBtn=document.querySelector(".nav-btn[onclick*=\"'home'\"]");
    if(homeBtn) showTab('home',homeBtn);
    // 로그인 후 레벨업 가능 여부 체크
    setTimeout(checkLevelUpAvailable, 800);
  }catch(e){errEl.textContent='서버 오류: '+e.message;}
}

// ── 레벨업 체크 & 팝업 ──────────────────────────────────────────
async function checkLevelUpAvailable(){
  try{
    var res = await api('/user/level-up-check');
    if(!res.available) return;
    showLevelUpModal(res);
  }catch(e){ console.log('level-up-check err', e); }
}

function showLevelUpModal(info){
  var exist = document.getElementById('level-up-modal');
  if(exist) exist.remove();

  var nextCost = info.next_level_cost || 0;
  var costTxt = nextCost > 0 ? nextCost+'P' : '무료';

  // 비용 내역 HTML 생성
  var breakdownHtml = '';
  (info.maintain_breakdown || []).forEach(function(b){
    breakdownHtml += '<div style="display:flex;justify-content:space-between;">'
      + '<span style="color:#7a9abf;">'+b.level+'레벨 유지비</span>'
      + '<span style="color:#fff;">'+b.cost+'P</span></div>';
  });

  var modal = document.createElement('div');
  modal.id = 'level-up-modal';
  modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center;';

  var box = document.createElement('div');
  box.style.cssText = 'background:#1e2a3a;border-radius:16px;padding:28px 24px;max-width:320px;width:90%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,0.5);';
  box.innerHTML = '<div style="font-size:36px;margin-bottom:12px;">🎉</div>'
    + '<div style="color:#fff;font-size:18px;font-weight:700;margin-bottom:8px;">'+info.next_level+'레벨 달성 조건 충족!</div>'
    + '<div style="color:#aac4e0;font-size:13px;margin-bottom:16px;line-height:1.6;">'
    + '누적 예약 '+info.cumulative_count+'회로<br>'
    + '<b style="color:#f5c842;">'+info.next_level+'레벨</b> 업그레이드가 가능합니다.</div>'
    + '<div style="background:#0d1b2a;border-radius:8px;padding:10px 14px;margin-bottom:12px;text-align:left;font-size:12px;line-height:2;">'
    + '<div style="display:flex;justify-content:space-between;"><span style="color:#7a9abf;">레벨업 비용</span><span style="color:#fff;">'+(info.level_up_fee||100)+'P</span></div>'
    + breakdownHtml
    + '<div style="border-top:1px solid #2a3a4a;margin-top:6px;padding-top:6px;display:flex;justify-content:space-between;font-weight:700;">'
    + '<span style="color:#aac4e0;">합계</span><span style="color:#4fc3f7;">'+costTxt+'</span></div></div>'
    + '<div style="font-size:11px;color:#7a9abf;margin-bottom:16px;">결제일부터 30일간 '+info.next_level+'레벨 유지</div>'
    + '<div style="display:flex;gap:10px;">'
    + '<button id="lv-decline-btn" style="flex:1;padding:12px;border-radius:10px;border:none;background:#2a3a4a;color:#aac4e0;font-size:14px;cursor:pointer;">기존 레벨 유지</button>'
    + '<button id="lv-upgrade-btn" style="flex:1;padding:12px;border-radius:10px;border:none;background:linear-gradient(135deg,#2196f3,#1565c0);color:#fff;font-size:14px;font-weight:700;cursor:pointer;">'+info.next_level+'레벨 업그레이드</button>'
    + '</div>';

  modal.appendChild(box);
  document.body.appendChild(modal);

  document.getElementById('lv-decline-btn').onclick = async function(){
    try{ await api('/user/level-up-decide',{method:'POST',body:JSON.stringify({upgrade:false})}); }catch(e){}
    modal.remove();
  };
  document.getElementById('lv-upgrade-btn').onclick = async function(){
    try{
      var r = await api('/user/level-up-decide',{method:'POST',body:JSON.stringify({upgrade:true})});
      modal.remove();
      await loadUserData();
      toast('🎉 '+r.new_level+'레벨로 업그레이드되었습니다!');
    }catch(e){
      toast('❌ '+(e.message||'레벨업 실패'));
    }
  };
}
// ─────────────────────────────────────────────────────────────────

// ── 매칭 타임스탬프 폴링: 매칭 완료 즉시 감지 ──────────────────
var _lastMatchTs = 0;
var _matchTsInterval = null;

async function _pollMatchTs(){
  if(!localStorage.getItem('lp_token')) return;
  try{
    var r = await fetch('/api/user/match-ts').then(function(r){return r.json();});
    var ts = r.ts || 0;
    if(_lastMatchTs && ts > _lastMatchTs){
      // 매칭 완료 감지 → 즉시 전체 갱신
      loadUserData().then(function(){
        if(window.userData){
          renderHeader(window.userData);
          renderBars && renderBars(window.userData);
          if(typeof updateReserveDefaults==='function') updateReserveDefaults(window.userData.level||1);
        }
      });
    }
    _lastMatchTs = ts;
  }catch(e){}
}

function startMatchEventSource(){
  if(_matchTsInterval) return;
  _lastMatchTs = 0;
  _pollMatchTs();  // 즉시 1회 실행해서 기준값 설정
  _matchTsInterval = setInterval(_pollMatchTs, 2000);  // 2초마다 체크
}

function stopMatchEventSource(){
  if(_matchTsInterval){ clearInterval(_matchTsInterval); _matchTsInterval=null; }
  _lastMatchTs = 0;
}
// ────────────────────────────────────────────────────────────────


// ── 약관 모달 ──────────────────────────────────────────
var _termsData = {
  terms: { title: '루페이 이용약관', checkId: 'agree-terms', text: "루페이 이용약관\n\n서비스 게시용 최종안 v3.0 (전체본 · 삭제 없이 보강)\n\n시행일: ______년 ______월 ______일\n회사명: 루페이 주식회사\n서비스명: 루페이\n대표자: ____________________\n사업자등록번호: ____________________\n통신판매업 신고번호: ____________________\n주소: ____________________\n고객센터: ____________________\n전자우편: ____________________\n\n제1장 총칙\n\n제1조 (목적)\n\n본 약관은 루페이 주식회사(이하 “회사”라 합니다)가 제공하는 루페이 플랫폼\n및 이에 부수하여 제공하는 웹사이트, 모바일 애플리케이션, 포인트, 아이템,\n구매예약, 판매예약, 매칭, 거래중개, 신고, 분쟁처리, 패널티, 고객지원\n기타 관련 서비스(이하 통칭하여 “서비스”라 합니다)의 이용과 관련하여\n회사와 회원 사이의 권리, 의무, 책임사항, 서비스 이용조건, 절차 및 기타\n필요한 사항을 정하는 것을 목적으로 합니다.\n\n회사는 루페이 서비스를 디지털 거래 아이템의 예약, 매칭, 직접송금,\n거래확인 및 사후처리를 지원하는 플랫폼 서비스로 운영하며, 대외 설명자료,\n서비스 화면, 광고물, 안내문에서 투자, 재테크, 원금보장, 수익보장,\n확정수익 등 오인될 수 있는 표현을 사용하지 않습니다.\n\n본 약관은 회사가 제공하는 서비스의 기본 계약 조건이며, 회원은 본 약관,\n개인정보처리방침, 운영정책 및 서비스 화면에서 안내되는 세부 기준에\n동의한 경우에 한하여 서비스를 이용할 수 있습니다.\n\n제2조 (정의)\n\n본 약관에서 사용하는 용어의 뜻은 다음과 같습니다.\n\n1.  “회사”란 루페이 서비스를 운영하고 제공하는 루페이 주식회사를\n    말합니다.\n\n2.  “서비스”란 회사가 제공하는 루페이 플랫폼 및 이에 부수하여 제공하는\n    웹사이트, 모바일 애플리케이션, 포인트 충전, 아이템 거래, 구매예약,\n    판매예약, 매칭, 신고, 분쟁처리, 고객지원 기타 관련 서비스를\n    말합니다.\n\n3.  “회원”이란 본 약관에 동의하고 회사가 정한 절차에 따라 회원가입을\n    완료한 자로서 서비스를 이용할 수 있는 자를 말합니다.\n\n4.  “이용자”란 회원 및 서비스를 이용하는 자를 통칭합니다.\n\n5.  “구매자”란 서비스 내에서 아이템 구매예약을 완료한 후 회사의 매칭\n    시스템에 따라 판매자와 매칭되어, 서비스 화면에 표시된 거래금액을\n    판매자에게 송금할 의무를 부담하는 회원을 말합니다. 단순히 구매예약을\n    신청한 상태의 회원은 본 약관에서 정한 매칭 완료 후 구매자와\n    구분됩니다.\n\n6.  “판매자”란 서비스 내에서 보유 아이템에 대한 판매예약을 완료한 후\n    회사의 매칭 시스템에 따라 구매자와 매칭되어, 구매자로부터 거래대금을\n    수령하고 입금확인 또는 신고 의무를 부담하는 회원을 말합니다. 단순히\n    판매예약을 신청한 상태의 회원은 본 약관에서 정한 매칭 완료 후\n    판매자와 구분됩니다.\n\n7.  “아이템”이란 서비스 내에서 회원이 구매, 보유, 판매예약, 판매, 교환,\n    합성 또는 소각할 수 있도록 회사가 정한 디지털 형식의 거래 대상 또는\n    서비스 이용 단위를 말합니다.\n\n8.  “수정”, “루비”, “다이아”란 회사가 서비스 내에서 제공하는 디지털 거래\n    아이템의 종류를 말합니다. 각 디지털 거래 아이템의 가격 구조,\n    단계(레벨), 예약조건, 보유기간, 판매 가능 조건, 포인트교환 가능 여부\n    및 기타 이용조건은 회사가 정한 운영정책에 따릅니다.\n\n9.  “포인트”란 회원이 서비스 내에서 아이템 구매예약, 유료서비스 이용,\n    패널티 납부, 교환 기타 회사가 정한 용도로 사용할 수 있는 서비스상\n    지급수단을 말합니다.\n\n10. “충전포인트”란 회원이 현금, 카드 또는 회사가 정한 결제수단으로\n    충전한 포인트를 말합니다.\n\n11. “교환포인트”란 회원이 보유 아이템을 포인트로 교환하거나, 회사가 정한\n    아이템 교환·포인트교환·이벤트·보상·정책상 조정 등의 방식에 따라\n    취득한 포인트를 말합니다. 교환포인트는 충전포인트와 구분하여\n    관리되며, 현금 환불 대상이 아니라 회사가 정한 서비스 내 사용 또는\n    아이템 재교환 대상입니다.\n\n12. “구매예약”이란 회원이 아이템을 구매하기 위하여 서비스 내에서 예약을\n    신청하는 행위를 말합니다.\n\n13. “판매예약”이란 회원이 보유 아이템을 판매하기 위하여 서비스 내에서\n    예약을 신청하는 행위를 말합니다.\n\n14. “매칭”이란 회사의 시스템이 구매예약과 판매예약을 기준으로 구매자와\n    판매자를 연결하는 절차를 말합니다.\n\n15. “랜덤매칭”이란 회사의 시스템 기준에 따라 구매자와 판매자를 무작위\n    또는 자동 방식으로 연결하는 매칭 방식을 말합니다.\n\n16. “거래”란 매칭된 구매자와 판매자 사이에서 아이템의 이전, 거래대금의\n    송금, 입금확인, 거래완료, 신고 및 분쟁처리가 이루어지는 일련의\n    절차를 말합니다.\n\n17. “직접송금”이란 매칭된 구매자가 회사가 안내한 판매자의 계좌정보를\n    확인한 후 판매자에게 거래대금을 직접 계좌이체하는 방식을 말합니다.\n\n18. “계좌정보”란 회원이 서비스 이용을 위하여 등록한 은행명, 계좌번호,\n    예금주명, 계좌명 기타 거래대금 송금 또는 환불에 필요한 정보를\n    말합니다.\n\n19. “플랫폼 참여 거래”란 거래 안정화, 매칭률 조정, 구매예약과 판매예약의\n    균형 유지, 1차·2차 매칭 후 미입금 거래의 사후처리, 판매자 보호 및\n    서비스 운영상 필요를 위하여 회사가 구매자 또는 판매자의 지위에서\n    직접 참여하는 거래를 말합니다.\n\n20. “행운구매”란 회사가 정한 조건에 따라 2개의 아이템 구매가 이루어진\n    경우 그 중 일부 또는 전부를 소각하고 상위 단계 또는 회사가 정한\n    조건의 아이템을 생성하는 기능을 말합니다.\n\n21. “소각합성(결합판매)”이란 회원이 보유한 동일 또는 회사가 정한 조건의\n    아이템을 합성하여 새로운 아이템을 생성하거나 기존 아이템을 소각하는\n    기능을 말합니다.\n\n22. “포인트교환”이란 회사가 정한 조건에 따라 아이템을 포인트 또는 회사가\n    정한 서비스상 가치로 전환하는 절차를 말합니다.\n\n23. “2차매칭”이란 1차 매칭 이후 미입금, 거래 미완료 기타 회사가 정한\n    사유가 발생한 경우 판매자의 판매 완료 가능성을 높이기 위하여 회사가\n    정한 조건에 따라 추가로 진행하는 매칭 절차를 말합니다. 2차매칭\n    후에도 미입금 또는 거래 미완료가 발생한 경우 회사는 운영정책에서\n    정한 기준에 따라 플랫폼 참여 거래 방식으로 직접 구매에 참여할 수\n    있습니다.\n\n24. “자동예약”이란 회원이 별도로 매일 예약 절차를 수행하지 않더라도\n    회사가 정한 기준에 따라 구매예약 또는 판매예약을 자동으로 진행하는\n    유료서비스를 말합니다.\n\n25. “레벨”이란 회원의 예약 누적횟수, 예약 유지기간, 이용 상태 기타\n    회사가 정한 기준에 따라 부여되는 서비스 이용 등급을 말합니다.\n\n26. “패널티”란 회원이 미입금, 금액 오류, 허위신고, 이체영수증 조작,\n    부정거래, 운영정책 위반 기타 회사가 정한 위반행위를 한 경우 부과되는\n    포인트 차감, 계정정지, 거래제한, 영구 이용제한 기타 제재를 말합니다.\n\n27. “운영정책”이란 서비스 이용방법, 거래절차, 매칭기준, 포인트정책,\n    패널티, 신고 및 분쟁처리 등 서비스 운영에 필요한 세부 기준을 정한\n    문서를 말합니다.\n\n28. “개인정보처리방침”이란 회사가 회원의 개인정보를 수집, 이용, 보관,\n    제공, 위탁, 파기하는 기준과 절차를 정한 문서를 말합니다.\n\n29. 본 조에서 정하지 않은 용어의 의미는 관련 법령, 본 약관, 운영정책,\n    개인정보처리방침, 서비스 화면의 안내 및 일반적인 거래 관행에\n    따릅니다.\n\n제3조 (약관의 효력)\n\n1.  본 약관은 회원이 서비스 가입 또는 이용 과정에서 본 약관에 동의하고\n    회사가 이를 승낙함으로써 효력이 발생합니다.\n\n2.  회사는 본 약관의 내용을 회원이 쉽게 확인할 수 있도록 서비스 초기\n    화면, 회원가입 화면, 설정 화면, 웹사이트 또는 기타 회사가 정한\n    방법으로 게시합니다.\n\n3.  회원은 서비스를 이용하기 전에 본 약관, 운영정책 및\n    개인정보처리방침의 내용을 충분히 확인하여야 하며, 이를 확인하지 않아\n    발생한 불이익에 대하여 회사는 회사의 고의 또는 중대한 과실이 없는 한\n    책임을 부담하지 않습니다.\n\n4.  본 약관은 회사와 회원 사이의 기본 계약으로 적용되며, 운영정책은 본\n    약관을 보충하는 세부 운영 기준으로 적용됩니다.\n\n5.  본 약관과 운영정책의 내용이 충돌하는 경우에는 본 약관이 우선\n    적용됩니다. 다만, 본 약관에서 구체적으로 정하지 않은 서비스\n    이용방법, 거래절차, 매칭기준, 패널티 기준, 신고 및 분쟁처리 기준 등\n    세부 사항은 운영정책에 따릅니다.\n\n제4조 (약관의 변경)\n\n1.  회사는 관련 법령을 위반하지 않는 범위에서 본 약관을 변경할 수\n    있습니다.\n\n2.  회사가 약관을 변경하는 경우 변경되는 내용, 변경 사유 및 시행일자를\n    명시하여 시행일 전 상당한 기간 동안 서비스 내 공지사항, 앱 알림,\n    전자우편, 문자메시지 또는 기타 회사가 정한 방법으로 회원에게\n    고지합니다.\n\n3.  회원에게 불리하거나 중요한 내용의 변경이 있는 경우 회사는 관련\n    법령에서 정한 절차에 따라 사전 고지하고 필요한 경우 회원의 동의를\n    받습니다.\n\n4.  회원이 변경 약관의 시행일 이후에도 서비스를 계속 이용하는 경우, 관련\n    법령상 별도의 동의가 필요한 경우를 제외하고 변경 약관에 동의한\n    것으로 볼 수 있습니다.\n\n5.  회원이 변경 약관에 동의하지 않는 경우 회원은 서비스 이용을 중단하고\n    탈퇴를 요청할 수 있습니다.\n\n6.  회사는 약관 변경으로 인하여 회원에게 중대한 불이익이 발생하지 않도록\n    필요한 범위에서 사전 안내, 유예기간 부여 또는 별도 조치를 할 수\n    있습니다.\n\n제5조 (운영정책 등 세부 기준)\n\n본 약관은 회원에게 적용되는 기본 계약 조건이며, 운영정책은 본 약관에서\n정한 내용을 구체화하는 세부 기준입니다. 회사는 운영정책을 통해 매칭\n시간, 입금 시간, 입금확인 시간, 신고 가능 시간, 자동처리 기준, 1차·2차\n매칭 기준, 플랫폼 참여 거래 기준, 포인트 사용순서, 교환포인트 처리,\n패널티 기준, 고객센터 접수 방식 등 서비스 운영에 필요한 세부사항을 정할\n수 있습니다.\n\n다만 운영정책은 본 약관 또는 관련 법령에 반하여 회원에게 부당하게 불리한\n내용을 정할 수 없으며, 회원의 권리·의무에 중대한 영향을 미치는 운영정책\n변경이 있는 경우 회사는 서비스 내 공지, 앱 알림, 문자메시지, 전자우편 등\n합리적인 방법으로 사전 안내합니다.\n\n1.  회사는 서비스의 안정적인 운영을 위하여 본 약관과 별도로 운영정책을\n    둘 수 있습니다.\n\n2.  운영정책에는 다음 각 호의 사항이 포함될 수 있습니다.\n\n    1.  회원가입 및 계좌 등록 기준\n    2.  서비스 이용 가능 시간\n    3.  구매예약 및 판매예약 방법\n    4.  매칭 방식 및 매칭 실패 처리\n    5.  플랫폼 참여 거래 기준\n    6.  포인트 충전, 사용, 교환 및 환불 기준\n    7.  레벨 및 예약 가능 수량 기준\n    8.  자동예약 및 유료서비스 기준\n    9.  행운구매, 소각합성(결합판매), 포인트교환 기준\n    10. 입금, 입금확인, 신고 및 자동처리 기준\n    11. 미입금, 금액 오류, 허위신고, 증빙자료 조작에 대한 패널티 기준\n    12. 분쟁처리 및 사후처리 기준\n    13. 고객센터 운영 기준\n    14. 기타 서비스 운영에 필요한 사항\n\n3.  운영정책은 본 약관의 일부를 구성하며, 회원은 서비스 이용 시\n    운영정책을 준수하여야 합니다.\n\n4.  회사는 서비스 운영상 필요한 경우 운영정책을 변경할 수 있으며, 중요한\n    변경이 있는 경우 사전에 공지합니다.\n\n제2장 회원가입 및 계정\n\n제6조 (회원가입)\n\n1.  서비스를 이용하려는 자는 회사가 정한 가입 절차에 따라 본 약관,\n    개인정보처리방침, 개인정보 수집·이용 동의, 개인정보 제3자 제공 동의,\n    운영정책 및 기타 회사가 요구하는 필수사항에 동의하고 회원가입을\n    신청하여야 합니다.\n\n2.  회사는 가입 신청자가 회사가 요구하는 정보를 정확하게 입력하고 본\n    약관 및 운영정책에 동의한 경우 회원가입을 승낙할 수 있습니다.\n\n3.  회원가입 시 필수 입력정보는 다음 각 호와 같습니다.\n\n    1.  이름\n    2.  생년월일\n    3.  휴대전화번호\n    4.  계좌번호\n    5.  은행명\n    6.  계좌명 또는 예금주명\n    7.  성인 여부 확인 정보\n    8.  기타 회사가 서비스 제공을 위해 필요하다고 정한 정보\n\n4.  회원은 가입 신청 시 정확하고 최신의 정보를 제공하여야 하며,\n    허위정보, 타인 명의, 타인 휴대전화번호, 타인 계좌정보 또는 부정확한\n    정보를 입력하여서는 안 됩니다.\n\n5.  회원이 허위정보 또는 타인의 정보를 이용하여 가입한 사실이 확인되거나\n    의심되는 경우 회사는 가입 승낙을 거절하거나 회원자격을 제한, 정지\n    또는 상실시킬 수 있습니다.\n\n제7조 (성인인증 및 가입 제한)\n\n1.  루페이 서비스는 만 19세 이상의 성인에 한하여 이용할 수 있습니다.\n\n2.  회사는 회원가입 또는 서비스 이용 과정에서 회원의 성인 여부를\n    확인하기 위하여 생년월일, 이름, 휴대전화번호, 본인확인 결과값 기타\n    필요한 정보를 확인할 수 있습니다.\n\n3.  만 19세 미만인 자는 서비스를 이용할 수 없습니다.\n\n4.  회원이 만 19세 미만임이 확인되거나 의심되는 경우 회사는 해당 계정의\n    이용을 제한하고 거래, 포인트, 환불, 분쟁처리, 계좌확인 기타 필요한\n    절차를 보류하거나 확인할 수 있습니다.\n\n5.  회원이 허위 생년월일, 타인 명의 또는 타인의 인증정보를 이용하여\n    가입한 경우 회사는 해당 계정의 이용을 제한하거나 탈퇴 처리할 수\n    있으며, 필요한 경우 관련 법령 및 운영정책에 따라 추가 조치를 할 수\n    있습니다.\n\n6.  회사는 미성년자 보호 및 서비스 안정성을 위하여 성인인증 방식,\n    본인확인 방식, 가입 제한 기준을 변경할 수 있습니다.\n\n제8조 (회원가입 승낙의 제한)\n\n1.  회사는 다음 각 호의 어느 하나에 해당하는 경우 회원가입 신청을\n    승낙하지 않거나 승낙 후에도 회원자격을 제한, 정지 또는 상실시킬 수\n    있습니다.\n\n    1.  만 19세 미만인 경우\n    2.  타인의 명의 또는 정보를 이용한 경우\n    3.  허위정보 또는 부정확한 정보를 입력한 경우\n    4.  이미 가입된 회원이 중복으로 가입을 신청한 경우\n    5.  과거 본 약관 또는 운영정책 위반으로 이용 제한을 받은 이력이 있는\n        경우\n    6.  부정거래, 허위신고, 이체영수증 조작, 명의도용, 계좌도용 등의\n        이력이 있는 경우\n    7.  회사가 요구하는 필수 동의 절차를 완료하지 않은 경우\n    8.  회사의 서비스 운영을 방해할 우려가 있다고 판단되는 경우\n    9.  관련 법령 또는 본 약관에 위반되는 목적으로 서비스를 이용하려는\n        경우\n    10. 기타 회사가 합리적인 사유로 가입 승낙이 어렵다고 판단하는 경우\n\n2.  회사는 가입 신청의 승낙을 보류하거나 거절하는 경우, 관련 법령에서\n    허용되는 범위 내에서 그 사유를 안내할 수 있습니다.\n\n제9조 (계정 관리)\n\n1.  회원의 계정은 회원 본인만 이용할 수 있으며, 회원은 자신의 계정을\n    제3자에게 양도, 대여, 담보 제공, 공유 또는 이용하게 하여서는 안\n    됩니다.\n\n2.  회원은 계정정보, 비밀번호, 인증수단, 휴대전화, 계좌정보 등을\n    안전하게 관리하여야 합니다.\n\n3.  회원의 관리 소홀, 부정 사용, 제3자의 사용, 휴대전화 분실, 인증수단\n    유출 등으로 발생한 손해는 회원 본인의 책임으로 합니다. 다만, 회사의\n    고의 또는 중대한 과실로 인한 경우에는 그러하지 않습니다.\n\n4.  회원은 계정이 도용되었거나 제3자가 무단으로 사용하고 있음을 알게 된\n    경우 즉시 회사에 알려야 합니다.\n\n5.  회사는 계정 도용, 부정사용, 이상거래 또는 서비스 안정성 저해 우려가\n    있는 경우 계정 이용을 일시적으로 제한하고 본인확인, 거래확인 또는\n    증빙자료 제출을 요청할 수 있습니다.\n\n제10조 (1인 1계정 원칙)\n\n1.  회원은 원칙적으로 1인 1계정만 보유할 수 있습니다.\n\n2.  회사는 중복가입, 다중계정, 명의도용, 계좌도용, 가족 또는 지인의\n    정보를 이용한 우회 가입, 동일 기기 또는 동일 IP를 이용한 비정상 가입\n    등이 의심되는 경우 추가 확인을 요청할 수 있습니다.\n\n3.  회사는 다중계정 또는 부정가입이 확인된 경우 해당 계정의 전부 또는\n    일부에 대하여 이용 제한, 거래 제한, 포인트 사용 제한, 탈퇴 처리,\n    재가입 제한 기타 필요한 조치를 할 수 있습니다.\n\n4.  다중계정 또는 부정가입으로 인해 발생한 거래 문제, 포인트 손실, 환불\n    제한, 분쟁 및 제3자의 손해는 해당 회원이 책임집니다.\n\n제11조 (계좌 등록)\n\n1.  회원은 서비스 이용을 위하여 본인 명의의 계좌를 등록하여야 합니다.\n\n2.  회원의 계정에 등록된 이름과 계좌의 예금주명은 원칙적으로 동일하여야\n    합니다.\n\n3.  회사는 다음 각 호의 계좌 등록을 제한할 수 있습니다.\n\n    1.  타인 명의 계좌\n    2.  허위 계좌\n    3.  예금주명과 회원명이 일치하지 않는 계좌\n    4.  법인 명의 계좌. 단, 회사가 별도로 승인한 경우는 제외합니다.\n    5.  거래 제한, 사고 신고, 압류, 지급정지 기타 정상 송금이 어렵다고\n        판단되는 계좌\n    6.  기타 회사가 서비스 안정성 또는 부정거래 방지를 위하여 제한이\n        필요하다고 판단하는 계좌\n\n4.  개명, 표기 차이, 오타, 외국인명 표기, 띄어쓰기 등으로 인하여 동일인\n    여부 확인이 필요한 경우 회사는 회원에게 추가 자료 제출을 요청할 수\n    있습니다.\n\n5.  회원은 계좌정보를 정확하게 입력하여야 하며, 잘못된 계좌정보 입력으로\n    인하여 발생하는 미입금, 오입금, 초과입금, 환불 지연, 거래 실패,\n    패널티, 분쟁 기타 불이익은 회원 본인이 책임집니다.\n\n6.  계좌 변경 가능 횟수, 변경 절차, 변경 후 적용 시점 등은 운영정책에\n    따릅니다.\n\n제3장 서비스의 내용\n\n제12조 (서비스의 기본 구조)\n\n루페이 서비스는 회원이 회사가 정한 아이템을 구매예약하고, 보유기간 또는\n판매 가능 조건을 충족한 후 판매예약을 하며, 회사의 시스템이 구매예약과\n판매예약을 기준으로 구매자와 판매자를 매칭하는 구조로 운영됩니다. 매칭\n이후 구매자는 판매자에게 직접 거래대금을 송금하고, 판매자는 실제 입금\n여부를 확인하여 입금확인 또는 신고를 진행합니다.\n\n회원은 서비스의 거래가 회사가 특정 수익을 지급하거나 투자금을 모집하는\n구조가 아니라, 서비스 내 아이템의 예약·매칭·직접송금·거래확인 절차를\n기반으로 한 플랫폼형 거래 구조임을 확인합니다. 회사는 회원에게 원금,\n이자, 확정수익, 고정수익, 특정 기간 내 회수, 특정 매칭률, 특정\n판매완료율을 보장하지 않습니다.\n\n회사는 서비스 안정성, 부정거래 방지, 미입금 거래 처리, 회원 보호 및 거래\n균형 유지를 위하여 플랫폼 참여 거래, 2차매칭, 자동처리, 신고 및 사후처리\n기능을 운영할 수 있습니다. 이러한 기능은 거래 안정화를 위한 운영 기능일\n뿐 회원에게 수익 또는 판매완료를 무조건 보장하는 제도가 아닙니다.\n\n1.  회사는 회원에게 다음 각 호의 서비스를 제공합니다.\n\n    1.  회원가입 및 성인인증 서비스\n    2.  계좌 등록 및 계좌정보 관리 서비스\n    3.  포인트 충전, 사용, 교환 및 환불 관련 서비스\n    4.  아이템 구매예약 서비스\n    5.  아이템 판매예약 서비스\n    6.  구매자와 판매자 간 매칭 서비스\n    7.  아이템 보유, 판매 가능일 관리 및 거래이력 관리 서비스\n    8.  이용자 간 직접송금 거래를 위한 정보 제공 서비스\n    9.  입금확인, 신고, 자동처리 및 사후처리 서비스\n    10. 행운구매, 소각합성(결합판매), 포인트교환 서비스\n    11. 레벨 관리 및 예약 가능 수량 관리 서비스\n    12. 자동예약 및 기타 유료서비스\n    13. 2차매칭 서비스\n    14. 플랫폼 참여 거래\n    15. 부정거래 탐지 및 이상거래 방지 서비스\n    16. 고객센터, 신고 및 분쟁처리 서비스\n    17. 기타 회사가 정하는 서비스\n\n2.  회사는 서비스의 안정성, 거래 균형, 회원 보호, 부정거래 방지, 법령\n    준수 및 운영 효율성을 위하여 서비스의 구체적인 내용, 제공 방식, 이용\n    조건, 수수료, 포인트 기준, 매칭 방식, 예약 가능 수량 등을 정하거나\n    변경할 수 있습니다.\n\n3.  회원은 서비스가 아이템의 구매예약, 판매예약 및 매칭을 제공하는\n    플랫폼 서비스임을 이해하고, 회사가 특정 매칭 결과, 판매 성사, 수익,\n    차익, 회수금액 또는 거래 완료를 보장하지 않는다는 점에 동의합니다.\n\n제13조 (서비스 이용 가능 시간)\n\n1.  서비스의 이용 가능 시간은 회사가 정한 운영정책 및 서비스 화면의\n    안내에 따릅니다.\n\n2.  회사는 매칭, 입금, 입금확인, 신고, 자동처리, 2차매칭 등 주요\n    절차별로 별도의 시간을 정할 수 있습니다.\n\n3.  회원은 회사가 정한 시간 내에 필요한 의무를 이행하여야 하며, 시간\n    초과 시 별도 통보 없이 미입금, 자동처리, 거래완료, 예약종료, 패널티\n    기타 운영정책상 결과가 발생할 수 있습니다.\n\n4.  시스템 점검, 장애, 보안 조치, 서비스 개선, 법령 준수, 긴급상황, 외부\n    결제·인증·통신망 장애 등의 사유가 있는 경우 회사는 서비스의 전부\n    또는 일부를 일시 중단할 수 있습니다.\n\n제14조 (서비스 변경 및 중단)\n\n1.  회사는 다음 각 호의 사유가 있는 경우 서비스의 전부 또는 일부를 변경,\n    제한, 중단할 수 있습니다.\n\n    1.  시스템 점검, 보수, 교체, 장애 복구가 필요한 경우\n    2.  통신망, 결제망, 인증기관, 클라우드, 서버 등 외부 인프라 장애가\n        발생한 경우\n    3.  서비스 이용량 폭주 또는 이상거래 증가로 정상 운영이 어려운 경우\n    4.  부정거래, 해킹, 보안사고, 개인정보 침해 우려가 있는 경우\n    5.  관련 법령, 행정기관의 명령, 수사기관의 요청 또는 법원의 결정이\n        있는 경우\n    6.  서비스 구조, 정책, 수수료, 포인트, 아이템, 매칭 방식의 변경이\n        필요한 경우\n    7.  천재지변, 전쟁, 폭동, 화재, 정전, 파업, 감염병, 국가비상사태 등\n        불가항력 사유가 있는 경우\n    8.  기타 회사가 서비스 운영상 필요하다고 합리적으로 판단하는 경우\n\n2.  회사는 서비스 변경 또는 중단이 예정된 경우 사전에 공지합니다. 다만,\n    긴급한 사유가 있는 경우 사후에 공지할 수 있습니다.\n\n3.  회사는 회사의 고의 또는 중대한 과실이 없는 한 서비스 변경 또는\n    중단으로 인하여 회원에게 발생한 손해에 대해 책임을 부담하지\n    않습니다.\n\n제4장 포인트\n\n제15조 (포인트의 종류)\n\n충전포인트와 교환포인트는 취득 원인, 사용 범위, 환불 가능 여부가\n다르므로 회사는 이를 구분하여 표시·관리할 수 있습니다. 회원은 서비스\n화면에서 포인트의 종류, 잔액, 사용 가능 범위 및 제한사항을 확인하여야\n합니다.\n\n충전포인트는 회원이 실제 결제수단을 통해 회사에 대금을 지급하고 충전한\n포인트로서, 사용하지 않은 잔액은 본 약관 및 운영정책에서 정한 절차에\n따라 환불 신청의 대상이 될 수 있습니다.\n\n교환포인트는 아이템을 포인트로 교환하거나 회사가 정한 서비스 내\n교환·조정·보상·정책상 지급 절차를 통해 발생한 포인트로서, 현금 충전에\n따라 발생한 포인트가 아니므로 원칙적으로 현금 환불 대상이 아닙니다.\n교환포인트는 회사가 정한 범위 내에서 아이템 재교환, 구매예약, 유료서비스\n이용, 패널티 납부 또는 기타 서비스 내 용도로 사용할 수 있습니다.\n\n회사는 부정거래, 시스템 오류, 이상거래, 약관 위반, 운영정책 위반,\n허위신고, 증빙자료 조작 또는 분쟁 발생이 의심되는 경우 충전포인트와\n교환포인트의 사용, 교환, 환불 또는 이전 처리를 일시 보류할 수 있습니다.\n\n1.  회사는 서비스 이용을 위하여 충전포인트와 교환포인트를 운영할 수\n    있습니다.\n\n2.  충전포인트는 회원이 회사가 정한 결제수단을 통해 충전한 포인트입니다.\n\n3.  교환포인트는 회원이 아이템을 포인트로 교환하거나 회사가 정한 방식에\n    따라 취득한 포인트입니다.\n\n4.  포인트는 서비스 내에서만 사용할 수 있으며, 회사가 명시적으로 허용한\n    경우를 제외하고 현금처럼 외부에서 사용하거나 제3자에게 이전, 양도,\n    담보 제공, 대여, 매매할 수 없습니다.\n\n5.  포인트에는 이자가 발생하지 않습니다.\n\n제16조 (포인트 충전)\n\n교환포인트는 회원이 결제수단으로 직접 충전하는 방식으로 발생하지 않으며,\n아이템 교환, 포인트교환, 회사가 정한 보상 또는 조정 절차 등 서비스 내\n사유가 발생한 경우에만 부여될 수 있습니다.\n\n회사는 충전포인트와 교환포인트를 별도의 항목으로 표시할 수 있으며, 결제\n취소, 환불, 거래 취소, 시스템 오류 정정, 부정거래 확인 등의 사유가 있는\n경우 포인트 잔액을 정정할 수 있습니다.\n\n회원은 포인트 충전 전 충전 금액, 사용 가능 서비스, 환불 기준, 결제수단별\n취소 가능 여부, 부가세 또는 수수료 여부, 포인트 반영 시점을 확인하여야\n합니다.\n\n1.  회원은 회사가 정한 결제수단과 절차에 따라 충전포인트를 충전할 수\n    있습니다.\n\n2.  포인트 충전 가능 금액, 단위, 한도, 결제수단, 충전 완료 시점은 회사가\n    정한 기준에 따릅니다.\n\n3.  결제수단 제공업체, 결제대행사, 카드사, 은행, 통신사 등의 장애 또는\n    정책에 따라 포인트 충전이 제한되거나 지연될 수 있습니다.\n\n4.  회사는 부정결제, 명의도용, 결제수단 도용, 환불 악용, 이상거래가\n    의심되는 경우 포인트 충전 또는 사용을 제한하고 본인확인 또는\n    증빙자료 제출을 요청할 수 있습니다.\n\n제17조 (포인트 사용)\n\n회원이 충전포인트와 교환포인트를 함께 보유한 경우 포인트 사용순서는\n서비스 화면 또는 운영정책에서 정한 기준에 따릅니다. 회사는 서비스\n안정성, 회계처리, 환불처리, 부정거래 방지 및 회원 보호를 위하여 포인트\n사용순서를 구분하여 운영할 수 있습니다.\n\n교환포인트는 현금성 환불을 전제로 한 포인트가 아니므로, 회사가 정한\n서비스 내 기능에서만 사용할 수 있습니다. 회원은 교환포인트를 제3자에게\n양도하거나 외부에서 매매하거나 현금화하여서는 안 됩니다.\n\n패널티 납부, 유료서비스 이용, 아이템 재교환, 포인트교환 취소, 사후정산\n등에서 사용할 수 있는 포인트 종류와 차감 순서는 운영정책에 따르며,\n회사는 서비스 화면을 통해 회원이 이를 확인할 수 있도록 안내합니다.\n\n1.  회원은 보유 포인트 범위 내에서 구매예약, 유료서비스 이용, 패널티\n    납부, 교환 기타 회사가 정한 용도로 포인트를 사용할 수 있습니다.\n\n2.  구매예약 신청 시 포인트가 즉시 차감되는지, 매칭 완료 시 차감되는지,\n    거래 완료 시 차감되는지는 회사가 정한 운영정책에 따릅니다.\n\n3.  회원이 보유한 포인트가 부족한 경우 구매예약, 유료서비스 이용, 패널티\n    납부 또는 기타 서비스 이용이 제한될 수 있습니다.\n\n4.  포인트 사용 순서, 차감 기준, 사용 가능 포인트 종류는 서비스 화면 및\n    운영정책에 따릅니다.\n\n제18조 (포인트 환불)\n\n충전포인트 환불 시 회사는 결제수단, 결제대행사, 은행, 카드사,\n간편결제사, 통신사 등의 정책과 관련 법령에 따라 환불을 처리합니다.\n결제수단 환불이 불가능하거나 현저히 곤란한 경우 회사는 회원 본인 명의의\n계좌로 환불할 수 있습니다.\n\n교환포인트는 현금으로 충전된 포인트가 아니므로 현금 환불이 불가능합니다.\n다만 회사가 운영정책에서 허용하는 경우 회원은 교환포인트를 아이템으로\n재교환하거나 회사가 정한 서비스 내 용도로 사용할 수 있습니다.\n\n회원이 보유한 포인트 중 충전포인트와 교환포인트가 혼재되어 있는 경우\n회사는 환불 대상 금액을 충전포인트 잔액 기준으로 산정합니다. 이미 사용한\n포인트, 패널티로 차감된 포인트, 교환 완료된 포인트, 부정거래 또는 약관\n위반과 관련된 포인트는 환불이 제한될 수 있습니다.\n\n회사는 환불 과정에서 본인확인, 계좌확인, 거래내역 확인, 부정거래 조사,\n미입금 또는 초과입금 분쟁 처리, 패널티 정산이 필요한 경우 환불 처리를\n보류할 수 있습니다. 보류 사유가 해소된 경우 회사는 운영정책에서 정한\n절차에 따라 환불 또는 사용 가능 상태 회복 여부를 결정합니다.\n\n1.  회원은 사용하지 않은 충전포인트에 대하여 회사가 정한 절차에 따라\n    환불을 신청할 수 있습니다.\n\n2.  충전포인트의 환불은 원칙적으로 결제수단 환불 또는 회사가 정한 환불\n    방식에 따라 처리됩니다.\n\n3.  교환포인트는 현금 환불이 불가능하며, 회사가 정한 방식에 따라\n    아이템으로 재교환하거나 서비스 내에서 사용할 수 있습니다.\n\n4.  다음 각 호의 경우 회사는 환불을 제한, 보류 또는 거절할 수 있습니다.\n\n    1.  부정결제 또는 명의도용이 의심되는 경우\n    2.  부정거래, 허위신고, 이체영수증 조작 등 조사 중인 경우\n    3.  미입금, 패널티, 분쟁 또는 사후처리가 진행 중인 경우\n    4.  회원의 계좌정보가 부정확하거나 본인 확인이 필요한 경우\n    5.  법령 또는 수사기관, 법원, 행정기관의 요청에 따라 지급 제한이\n        필요한 경우\n    6.  기타 회사가 합리적인 사유로 환불 보류가 필요하다고 판단하는 경우\n\n5.  환불 처리 기간은 회사가 정한 운영정책에 따르며, 결제수단 제공업체,\n    은행, 카드사, 결제대행사 등의 사정에 따라 지연될 수 있습니다.\n\n제19조 (포인트 소멸)\n\n1.  포인트는 회사가 별도로 정한 경우를 제외하고 유효기간 없이\n    유지됩니다.\n\n2.  다만, 회원 탈퇴, 계정 영구정지, 부정가입, 명의도용, 부정거래, 법령\n    위반, 서비스 종료 등의 사유가 있는 경우 포인트의 사용, 환불 또는\n    교환이 제한될 수 있습니다.\n\n3.  회원은 탈퇴 신청 전에 보유 충전포인트의 환불 또는 교환포인트의\n    사용·교환 여부를 확인하여야 합니다.\n\n4.  회원이 탈퇴 후 일정 기간 내 환불 또는 교환 절차를 진행하지 않거나,\n    본인확인 및 계좌확인이 불가능한 경우 회사는 관련 법령 및 운영정책에\n    따라 포인트를 처리할 수 있습니다.\n\n제5장 아이템, 예약 및 레벨\n\n제20조 (디지털 거래 아이템)\n\n1.  아이템은 회사가 서비스 내에서 정한 디지털 거래 대상 또는 서비스 이용\n    단위입니다.\n\n2.  아이템의 종류, 가격, 단계, 인상률, 예약 조건, 판매 가능 시점, 판매\n    방식, 교환 방식, 소각 또는 합성 기준은 운영정책 및 서비스 화면의\n    안내에 따릅니다.\n\n3.  아이템은 서비스 내에서만 이용할 수 있으며, 회사가 허용하지 않은 외부\n    거래, 양도, 담보 제공, 대여, 현금화, 계정 간 이전은 금지됩니다.\n\n4.  회원은 아이템의 가격 구조, 판매 가능 시점, 예약 조건, 매칭 가능성,\n    거래 절차 및 위험성을 충분히 확인한 후 서비스를 이용하여야 합니다.\n\n5.  회사는 특정 아이템의 판매 성사, 가격 상승, 수익 발생, 차익, 환금성\n    또는 회수 가능성을 보장하지 않습니다.\n\n제21조 (구매예약)\n\n1.  회원은 보유 포인트, 레벨, 아이템 종류, 예약 가능 수량, 서비스 이용\n    상태 기타 회사가 정한 조건에 따라 구매예약을 신청할 수 있습니다.\n\n2.  구매예약은 회원이 아이템 구매 의사를 표시하는 절차이며, 구매예약\n    신청만으로 반드시 매칭이 성사되거나 아이템 구매가 완료되는 것은\n    아닙니다.\n\n3.  구매예약 시 필요한 포인트 기준, 예약 가능 수량, 포인트 차감 시점,\n    예약 제한 조건은 운영정책에 따릅니다.\n\n4.  구매예약은 신청 완료 후 원칙적으로 취소할 수 없습니다.\n\n5.  회원은 구매예약 전 아이템 종류, 예약 수량, 필요 포인트, 매칭 방식,\n    입금 의무, 패널티 기준 및 운영정책을 충분히 확인하여야 합니다.\n\n6.  회원의 착오, 오입력, 미확인, 알림 미확인으로 인한 예약, 매칭, 입금,\n    패널티 기타 불이익은 회원 본인이 책임집니다.\n\n제22조 (판매예약)\n\n판매예약은 매칭을 신청하는 절차이며, 판매예약 신청 또는 매칭 진행만으로\n판매가 100% 완료되는 것은 아닙니다. 구매자가 매칭 후 지정된 시간 내\n입금하지 않거나, 입금완료 처리를 하지 않거나, 금액 오류 또는 증빙자료\n문제가 발생하는 경우 판매완료가 지연되거나 별도 처리될 수 있습니다.\n\n회사는 판매예약된 아이템에 대하여 운영정책에 따라 1차 매칭을 진행할 수\n있고, 1차 매칭에서 구매자의 미입금 또는 거래 미완료가 발생한 경우\n2차매칭을 진행할 수 있습니다. 2차매칭은 판매자의 판매 완료 가능성을\n높이기 위한 보조 절차이나, 모든 경우에 판매 완료를 보장하는 것은\n아닙니다.\n\n회사가 별도로 정한 운영정책에 따라 1차매칭 및 2차매칭 모두에서 미입금\n또는 거래 미완료가 발생한 경우, 회사는 판매자 보호 및 거래 안정화를\n위하여 플랫폼 참여 거래 방식으로 해당 아이템을 직접 구매할 수 있습니다.\n이 경우 회사가 구매자로 참여하는 거래는 플랫폼 참여 거래로 처리되며,\n거래금액, 처리시점, 대상 아이템, 제외 기준, 제한 사유는 운영정책 및\n서비스 화면의 안내에 따릅니다.\n\n회사의 직접 구매 참여는 미입금 거래의 사후처리를 위한 운영 기능이며,\n모든 판매예약에 대해 회사가 무조건 구매한다는 의미가 아닙니다. 부정거래,\n허위신고, 자료 미제출, 계정 제한, 아이템 이상, 시스템 오류, 법령 위반\n의심, 운영정책 위반, 서비스 중단 등 사유가 있는 경우 회사는 직접 구매를\n제한하거나 보류할 수 있습니다.\n\n1.  회원은 보유 아이템이 회사가 정한 보유기간 또는 판매 가능 조건을\n    충족한 경우 판매예약을 신청할 수 있습니다.\n\n2.  판매예약은 회원이 아이템 판매 의사를 표시하는 절차이며, 판매예약\n    신청만으로 반드시 매칭이 성사되거나 판매가 완료되는 것은 아닙니다.\n\n3.  판매예약 가능 시점, 보유기간, 판매예약 가능 수량, 동일 날짜 아이템\n    처리 기준, 서로 다른 판매 가능일의 판매예약 제한 기준은 운영정책에\n    따릅니다.\n\n4.  판매예약은 신청 완료 후 원칙적으로 취소할 수 없습니다.\n\n5.  회원은 판매예약 전 아이템 종류, 판매 가능일, 판매 수량, 매칭 방식,\n    입금확인 의무, 신고 가능 시간, 자동처리 기준 및 패널티 기준을 충분히\n    확인하여야 합니다.\n\n제23조 (레벨 및 예약 가능 수량)\n\n1.  회사는 서비스의 거래 균형, 예약 수량 조정, 아이템 밸런스 유지 및\n    안정적인 운영을 위하여 회원별 레벨 제도를 운영할 수 있습니다.\n\n2.  레벨은 예약 누적횟수, 예약 유지기간, 이용 상태, 패널티 여부,\n    운영정책 준수 여부 기타 회사가 정한 기준에 따라 산정됩니다.\n\n3.  레벨별 구매예약 가능 수량, 판매예약 가능 수량, 아이템별 최소·최대\n    예약 수량, 단계 유지기간, 레벨 상승·하락·초기화 기준은 운영정책에\n    따릅니다.\n\n4.  회원이 회사가 정한 기간 동안 예약을 유지하지 않거나 예약을 하지 않은\n    경우 레벨이 하락하거나 1레벨로 초기화될 수 있습니다.\n\n5.  회사는 거래 균형, 서비스 안정성, 아이템 수량 조정, 부정거래 방지 및\n    운영상 필요에 따라 레벨 기준을 변경할 수 있습니다.\n\n6.  레벨은 서비스 이용 조건일 뿐 수익, 매칭 성공, 판매 완료 또는 특정\n    금액의 회수를 보장하는 기준이 아닙니다.\n\n제24조 (자동예약)\n\n1.  자동예약은 회원이 회사가 정한 포인트를 사용하여 구매예약 또는\n    판매예약을 자동으로 진행할 수 있도록 하는 유료서비스입니다.\n\n2.  자동예약의 이용요금, 이용기간, 실행시간, 적용 범위, 사용 가능 포인트\n    종류, 해지 및 환불 기준은 운영정책 및 서비스 화면의 안내에 따릅니다.\n\n3.  자동예약은 회원의 편의를 위한 기능일 뿐이며, 자동예약을 이용하더라도\n    매칭 성공, 판매 완료, 수익 발생 또는 특정 결과가 보장되지 않습니다.\n\n4.  회원은 자동예약 설정 전 예약 대상, 수량, 포인트, 실행시간, 매칭\n    위험, 취소 제한을 충분히 확인하여야 합니다.\n\n5.  자동예약 설정 오류, 보유 포인트 부족, 계정 제한, 서비스 장애, 정책\n    변경, 회원의 미확인 등으로 자동예약이 실행되지 않거나 일부만 실행될\n    수 있습니다.\n\n제6장 매칭 및 거래\n\n제25조 (매칭)\n\n매칭은 구매예약자와 판매예약자를 연결하는 절차이며, 매칭 후에도 구매자의\n입금, 구매자의 입금완료 처리, 판매자의 입금확인, 신고 가능 시간의 경과\n또는 분쟁처리 완료 등 회사가 정한 절차가 완료되어야 거래가 최종\n완료됩니다.\n\n회사는 매칭률, 매칭 수량, 매칭 대상, 플랫폼 참여 거래 수량, 2차매칭\n수량, 미입금 이력 제외 기준을 서비스 안정성, 거래 균형, 부정거래 방지 및\n운영상 필요에 따라 조정할 수 있습니다. 이러한 조정은 회원에게 특정한\n경제적 이익을 보장하기 위한 것이 아니라 서비스 운영을 위한 기준입니다.\n\n1.  매칭은 회사의 시스템이 구매예약과 판매예약을 기준으로 구매자와\n    판매자를 연결하는 절차입니다.\n\n2.  회사는 아이템 종류, 수량, 판매 가능일, 예약 상태, 레벨, 운영정책,\n    거래 균형, 플랫폼 참여 필요성, 부정거래 방지 기준 기타 회사가 정한\n    조건에 따라 매칭을 진행할 수 있습니다.\n\n3.  매칭은 운영정책에서 정한 기준에 따라 자동 또는 랜덤 방식으로\n    이루어질 수 있습니다.\n\n4.  회사는 특정 회원에게 특정 상대방, 특정 금액, 특정 아이템, 특정\n    매칭률 또는 특정 매칭 결과가 발생할 것을 보장하지 않습니다.\n\n5.  매칭이 성사되지 않은 경우 해당 예약은 운영정책에 따라 종료, 유지,\n    재예약 또는 기타 방식으로 처리될 수 있습니다.\n\n6.  매칭 실패에 대하여 회원에게 별도 패널티가 부과되지 않는 것을\n    원칙으로 하되, 회원의 약관 위반, 부정행위 또는 운영정책 위반이 있는\n    경우에는 예외로 합니다.\n\n제26조 (랜덤매칭 및 매칭 결과의 비보장)\n\n1.  랜덤매칭은 회사가 정한 시스템 기준에 따라 자동으로 이루어집니다.\n\n2.  랜덤매칭은 회원의 요청, 지인 관계, 거래 이력, 희망 상대방, 특정 금액\n    선호 등에 따라 임의로 지정되지 않습니다.\n\n3.  회사는 매칭의 공정성, 거래 균형 및 서비스 안정성을 위하여 필요한\n    경우 매칭 알고리즘, 기준, 순서, 수량, 매칭률 또는 플랫폼 참여 기준을\n    조정할 수 있습니다.\n\n4.  회사는 매칭 결과에 따라 회원에게 수익, 차익, 판매 완료, 회수금액,\n    거래 상대방의 입금 또는 입금확인을 보장하지 않습니다.\n\n5.  회원은 매칭이 성사된 경우 운영정책에서 정한 시간 내에 입금, 입금완료\n    처리, 입금확인, 신고 기타 필요한 의무를 이행하여야 합니다.\n\n제27조 (이용자 간 직접송금 거래)\n\n회원은 이용자 간 직접송금 거래에서 회사가 제공하는 계좌정보와 거래금액을\n반드시 확인하여야 하며, 회사가 표시한 금액과 다른 금액을 송금하거나\n잘못된 계좌로 송금한 경우 그 귀책사유가 있는 회원이 책임을 부담합니다.\n\n판매자는 구매자로부터 입금된 금액이 서비스 화면의 거래금액보다 많은 경우\n초과입금 사실을 인지한 즉시 고객센터 또는 서비스 내 신고 절차를 통해\n알려야 하며, 구매자 또는 회사의 반환 요청이 있는 경우 정당한 사유 없이\n반환을 거부하여서는 안 됩니다.\n\n회사는 이용자 간 직접송금 거래에서 사실확인과 중재를 지원할 수 있으나,\n회사가 거래 당사자로 참여한 플랫폼 참여 거래를 제외하고 송금 자체,\n계좌이체의 성공 여부, 상대방의 반환 이행, 금액 회수를 보장하지 않습니다.\n\n1.  루페이 서비스의 거래는 원칙적으로 매칭된 구매자가 판매자에게 직접\n    거래대금을 송금하는 방식으로 이루어질 수 있습니다.\n\n2.  회사는 구매자에게 판매자의 계좌정보, 거래금액, 매칭번호 기타 송금에\n    필요한 정보를 제공할 수 있습니다.\n\n3.  구매자는 매칭 결과 및 서비스 화면에 표시된 거래금액을 정확히 확인한\n    후 지정된 시간 내에 판매자에게 정확한 금액을 송금하여야 합니다.\n\n4.  구매자는 송금 후 회사가 정한 방식에 따라 이체영수증 또는 송금\n    확인자료를 첨부하고 입금완료 버튼을 눌러야 합니다.\n\n5.  구매자가 실제 송금만 하고 이체영수증 첨부 또는 입금완료 처리를 하지\n    않은 경우 시스템상 미입금으로 처리될 수 있으며, 이로 인한 불이익은\n    구매자 본인이 책임집니다.\n\n6.  판매자는 실제 입금 여부, 입금액, 입금자명, 거래금액 일치 여부를\n    확인한 후 입금확인 처리를 하여야 합니다.\n\n7.  판매자가 실제 입금 여부를 확인하지 않거나 신고 가능 시간 내 신고하지\n    않은 경우 해당 거래는 시스템상 정상 거래로 자동 처리될 수 있으며,\n    이로 인한 불이익은 판매자 본인이 책임집니다.\n\n8.  회사는 이용자 간 직접송금 거래를 중개하는 플랫폼을 제공하며, 회사가\n    직접 거래 당사자로 참여하는 플랫폼 참여 거래를 제외하고 이용자 간\n    송금 자체의 성공, 반환, 회수 또는 상대방의 의무 이행을 보장하지\n    않습니다.\n\n제28조 (입금 및 입금확인)\n\n1.  구매자는 매칭 완료 후 운영정책에서 정한 입금 가능 시간 내에\n    판매자에게 정확한 거래금액을 송금하여야 합니다.\n\n2.  구매자는 송금 후 운영정책에서 정한 방식에 따라 이체영수증, 이체\n    화면, 송금 확인자료 등을 첨부하고 입금완료 처리를 하여야 합니다.\n\n3.  판매자는 입금확인 가능 시간 내에 실제 입금 여부와 금액 일치 여부를\n    확인하여야 합니다.\n\n4.  판매자는 미입금, 금액 부족, 금액 초과, 입금자명 불일치, 증빙자료\n    조작 의심, 거래번호 불일치 기타 문제가 있는 경우 운영정책에서 정한\n    시간 내에 신고하여야 합니다.\n\n5.  판매자가 신고 가능 시간 내 신고하지 않은 경우 해당 거래는 자동으로\n    정상 처리될 수 있습니다.\n\n6.  입금, 입금확인, 신고, 자동처리의 구체적인 시간과 절차는 운영정책에\n    따릅니다.\n\n제29조 (미입금, 금액 오류 및 초과입금)\n\n구매자가 초과입금 또는 오입금을 주장하는 경우 회사는 구매자의 이의신청을\n접수하고, 구매자와 판매자에게 입금내역, 계좌거래내역, 이체확인증,\n송금확인자료, 거래번호, 매칭번호, 기타 사실확인에 필요한 자료 제출을\n요청할 수 있습니다.\n\n판매자는 회사가 초과입금 또는 오입금 여부 확인을 위하여 입금내역 또는\n관련 자료를 요청하는 경우 정당한 사유 없이 이를 거부하거나 지연하여서는\n안 됩니다. 판매자가 자료 제출을 거부하거나 불충분한 자료를 제출하는 경우\n회사는 시스템 기록, 구매자 제출자료, 신고내역, 입금시간, 입금자명,\n거래금액 등 확인 가능한 자료를 기준으로 판단할 수 있습니다.\n\n초과입금 사실이 확인된 경우 판매자는 확인된 초과입금액을 구매자에게\n반환하여야 합니다. 반환 방법, 반환 기한, 증빙 제출 방식은 회사가\n안내하거나 운영정책에서 정한 기준에 따릅니다.\n\n판매자가 정당한 사유 없이 초과입금액 반환을 거부하거나 자료 제출 요청에\n협조하지 않는 경우 회사는 해당 판매자에게 경고, 거래제한, 판매예약 제한,\n구매예약 제한, 포인트 사용 제한, 환불 보류, 계정 일시정지, 영구\n이용제한, 재가입 제한 등 운영정책상 필요한 조치를 할 수 있습니다.\n\n회사는 초과입금 또는 오입금 분쟁에서 사실확인과 반환 협조 요청을 할 수\n있으나, 판매자가 반환을 거부하거나 계좌이체가 이미 완료된 경우 회사가\n금액 회수를 보장하지 않습니다. 이 경우 구매자는 필요에 따라 금융기관,\n수사기관, 법원 기타 관계기관을 통한 구제 절차를 진행할 수 있습니다.\n\n구매자가 고의 또는 중대한 과실로 반복적인 초과입금, 오입금, 금액 오류를\n발생시키는 경우 회사는 해당 구매자에게도 운영정책에 따른 제한 또는\n패널티를 부과할 수 있습니다.\n\n1.  구매자가 지정된 시간 내 거래금액을 송금하지 않은 경우 미입금으로\n    처리될 수 있습니다.\n\n2.  구매자가 거래금액보다 적은 금액을 송금한 경우 금액 오류로 처리될 수\n    있습니다.\n\n3.  구매자가 거래금액보다 많은 금액을 송금한 경우 초과입금으로 처리될 수\n    있으며, 초과입금액의 반환은 원칙적으로 구매자와 판매자 사이에서\n    처리하여야 합니다.\n\n4.  회사는 초과입금 또는 오입금이 발생한 경우 증빙자료를 확인한 후\n    판매자에게 반환 협조를 요청하는 등 중개 역할을 할 수 있으나, 금액\n    회수를 보장하지 않습니다.\n\n5.  금액 오류, 오입금, 초과입금, 계좌정보 오입력, 입금자명 불일치 등으로\n    발생한 불이익은 귀책사유가 있는 회원이 책임집니다.\n\n6.  미입금, 금액 오류 또는 허위 입금처리가 확인되는 경우 운영정책에 따른\n    패널티가 부과될 수 있습니다.\n\n제30조 (이체영수증 및 증빙자료)\n\n1.  구매자는 송금 완료 후 회사가 정한 방식에 따라 이체영수증,\n    송금확인증, 이체 화면 캡처 등 거래금액과 송금 상대방을 확인할 수\n    있는 자료를 제출하여야 합니다.\n\n2.  회원은 증빙자료를 조작, 편집, 위조, 변조하거나 사실과 다른 자료를\n    제출하여서는 안 됩니다.\n\n3.  허위 또는 조작된 이체영수증 제출은 중대한 위반행위로 보며, 회사는\n    해당 회원에게 계정정지, 영구 이용제한, 거래 제한, 포인트 사용 제한,\n    수사기관 신고, 손해배상 청구 기타 필요한 조치를 할 수 있습니다.\n\n4.  회사는 제출된 증빙자료의 진위 확인을 위하여 계좌거래내역, 은행 발급\n    자료, 추가 캡처, 통신기록, 시스템 로그 기타 자료 제출을 요청할 수\n    있습니다.\n\n5.  회원이 정당한 사유 없이 자료 제출을 거부하거나 지연하는 경우 회사는\n    해당 회원에게 불리한 판단을 할 수 있습니다.\n\n제31조 (자동처리)\n\n1.  구매자가 입금완료 처리를 하지 않거나 판매자가 입금확인 또는 신고를\n    하지 않은 경우, 회사의 시스템은 운영정책에서 정한 기준에 따라 해당\n    거래를 미입금, 정상 거래, 자동 거래완료 또는 기타 상태로 처리할 수\n    있습니다.\n\n2.  자동처리는 서비스 운영의 안정성, 거래 진행의 명확성 및 분쟁 방지를\n    위하여 필요한 절차입니다.\n\n3.  회원은 자동처리 기준과 시간을 사전에 확인하여야 하며, 이를 확인하지\n    않아 발생한 불이익은 회원 본인이 책임집니다.\n\n4.  자동처리된 거래에 대하여 사후적으로 문제가 발견된 경우 회원은\n    고객센터를 통해 이의제기할 수 있으며, 회사는 제출자료와 시스템\n    기록을 기준으로 사후처리 여부를 판단합니다.\n\n제32조 (2차매칭)\n\n2차매칭은 1차 매칭 이후 미입금 또는 거래 미완료가 발생한 거래에 대하여\n회사가 운영정책에서 정한 시간과 기준에 따라 추가로 구매자를 연결하는\n절차입니다. 2차매칭은 판매자의 거래 완료 가능성을 높이기 위한 절차이나,\n구매자의 최종 입금과 거래 완료까지 보장하는 것은 아닙니다.\n\n회사는 2차매칭 참여 대상에서 당일 또는 과거 미입금 이력이 있는 회원,\n계정 제한 상태의 회원, 부정거래가 의심되는 회원, 포인트 또는 본인확인이\n완료되지 않은 회원, 운영정책에서 정한 제한 사유가 있는 회원을 제외할 수\n있습니다.\n\n1차매칭과 2차매칭 모두에서 구매자의 미입금 또는 거래 미완료가 발생한\n경우 회사는 판매자 보호 및 서비스 안정화를 위하여 운영정책에서 정한\n기준에 따라 플랫폼 참여 거래로 직접 구매를 진행할 수 있습니다. 단, 해당\n직접 구매는 회사가 모든 판매예약 또는 모든 미입금 거래를 무조건\n인수한다는 의미가 아니며, 부정거래, 허위신고, 자료 미제출, 법령 위반\n의심, 시스템 오류, 계정 제한, 서비스 중단, 운영상 불가피한 사유가 있는\n경우 제한될 수 있습니다.\n\n회사의 직접 구매가 이루어지는 경우 판매자는 회사가 요청하는 계좌정보\n확인, 입금확인, 거래상태 확인, 아이템 이전 또는 거래완료 처리에\n협조하여야 하며, 회사는 해당 거래의 당사자로서 운영정책 및 서비스\n화면에서 안내한 범위의 책임을 부담합니다.\n\n1.  회사는 1차 매칭 이후 미입금 또는 거래 미완료가 발생한 경우\n    운영정책에 따라 2차매칭을 진행할 수 있습니다.\n\n2.  2차매칭은 판매자의 당일 판매 가능성을 높이고 거래 균형을 유지하기\n    위한 보조 절차이며, 2차매칭을 통한 판매 완료를 보장하지 않습니다.\n\n3.  2차매칭 신청 가능 대상, 제한 대상, 진행시간, 제외 기준, 미입금 이력\n    조회 기준은 운영정책에 따릅니다.\n\n4.  과거 미입금 이력이 있거나 당일 1차 매칭에서 미입금이 발생한 회원은\n    2차매칭 참여가 제한될 수 있습니다.\n\n5.  회사는 서비스 안정성, 거래 균형 또는 부정거래 방지를 위하여\n    2차매칭의 운영 여부, 조건, 방식 또는 시간을 변경할 수 있습니다.\n\n제33조 (플랫폼 참여 거래)\n\n플랫폼 참여 거래는 회사가 서비스 운영상 필요에 따라 구매자 또는 판매자의\n지위에서 직접 참여하는 거래이며, 회사가 참여하는 거래에 한하여 회사는\n해당 거래의 직접 당사자로서 책임을 부담합니다.\n\n회사는 1차매칭 및 2차매칭 후에도 미입금 또는 거래 미완료가 발생한 경우,\n운영정책에서 정한 기준에 따라 판매자의 아이템을 직접 구매할 수 있습니다.\n이 경우 회사는 거래 안정화, 판매자 보호, 미입금 거래 사후처리 및 서비스\n신뢰도 유지를 목적으로 참여합니다.\n\n플랫폼 참여 거래의 대상, 수량, 가격, 진행시간, 제외 대상, 제한 사유,\n표시 방식, 입금 및 거래완료 절차는 운영정책 및 서비스 화면의 안내에\n따릅니다. 회사는 부정거래, 비정상 거래, 계정 제한, 허위신고, 자료\n미제출, 법령 위반 의심, 시스템 장애 또는 서비스 운영상 중대한 사유가\n있는 경우 플랫폼 참여 거래를 보류하거나 거절할 수 있습니다.\n\n플랫폼 참여 거래는 회사가 서비스 전체의 모든 거래를 보증하거나, 모든\n회원에게 판매완료·수익·차익·회수금액을 보장하는 제도가 아닙니다. 회원은\n플랫폼 참여 거래가 예외적 또는 보조적 운영 장치임을 이해하고 서비스 이용\n여부를 스스로 판단하여야 합니다.\n\n1.  회사는 구매예약과 판매예약의 균형 유지, 매칭률 안정화, 서비스 초기\n    운영, 거래 안정성 확보 또는 기타 운영상 필요가 있는 경우 구매자 또는\n    판매자의 지위에서 거래에 직접 참여할 수 있습니다.\n\n2.  회사가 거래에 참여하는 경우 해당 거래는 “플랫폼 참여 거래”로 표시될\n    수 있습니다.\n\n3.  플랫폼 참여 거래에서 회사는 해당 거래의 당사자로서 운영정책 및\n    서비스 화면에서 정한 책임을 부담합니다.\n\n4.  회사는 플랫폼 참여 거래의 기준, 수량, 가격, 시점, 참여 방식, 표시\n    방식 등을 서비스 안정성 및 운영상 필요에 따라 정할 수 있습니다.\n\n5.  플랫폼 참여 거래는 회원에게 특정 매칭 결과, 수익, 판매 완료 또는\n    차익을 보장하는 것으로 해석되지 않습니다.\n\n6.  회사의 플랫폼 참여 거래는 거래 안정화, 미입금 거래의 사후처리,\n    판매자 보호 및 서비스 운영을 위한 보조적 운영 기능입니다.\n\n7.  회사는 플랫폼 참여 거래를 통하여 회원보다 우선적인 거래상 이익을\n    취하지 않으며, 특정 회원에게 우선 매칭, 우선 판매, 우선 회수, 수익,\n    차익 또는 거래 완료를 보장하지 않습니다.\n\n8.  플랫폼 참여 거래는 서비스 운영을 위한 기능일 뿐 회원에게 투자수익,\n    확정수익, 원금보장 또는 판매완료를 보장하는 제도가 아닙니다.\n\n제7장 행운구매, 소각합성 및 교환\n\n제34조 (행운구매)\n\n1.  행운구매는 회사가 정한 조건에 따라 2개의 아이템 구매가 이루어진 경우\n    그 중 일부 또는 전부를 소각하고 새로운 아이템을 생성하거나 상위 단계\n    아이템으로 변경하는 기능입니다.\n\n2.  행운구매는 구매예약 및 판매예약의 매칭률 조정, 아이템 수량 조정,\n    서비스 내 수량 균형 유지를 위한 운영 기능입니다.\n\n3.  행운구매의 적용 조건, 대상 아이템, 생성 아이템, 소각 기준, 적용\n    시점, 판매 가능 시점, 추가 수익 구조는 운영정책 및 서비스 화면의\n    안내에 따릅니다.\n\n4.  행운구매를 통하여 생성된 아이템의 가격, 판매 가능 여부, 매칭 여부,\n    수익 또는 판매 완료는 보장되지 않습니다.\n\n5.  회사는 거래 균형, 서비스 안정성, 아이템 수량 조정, 부정거래 방지를\n    위하여 행운구매 기준을 변경하거나 일시 중단할 수 있습니다.\n\n제35조 (소각합성/결합판매)\n\n1.  소각합성(결합판매)은 회원이 보유한 아이템을 회사가 정한 조건에 따라\n    합성하여 새로운 아이템을 생성하거나 기존 아이템을 소각하는\n    기능입니다.\n\n2.  소각합성(결합판매)의 대상, 필요 아이템 수량, 생성 아이템, 적용\n    수수료, 사용 가능 포인트, 판매예약 가능 시점 및 기타 조건은\n    운영정책에 따릅니다.\n\n3.  회원은 소각합성(결합판매) 신청 전 대상 아이템, 소각 결과, 생성\n    아이템, 판매 가능 시점, 취소 제한 여부를 충분히 확인하여야 합니다.\n\n4.  소각합성(결합판매)이 완료된 후에는 원칙적으로 취소할 수 없습니다.\n\n5.  회사는 소각합성(결합판매) 결과로 특정 수익, 특정 가격, 특정 매칭,\n    판매 완료 또는 차익을 보장하지 않습니다.\n\n제36조 (포인트교환)\n\n회원이 아이템을 교환포인트로 전환한 경우 해당 아이템은 운영정책에서 정한\n기준에 따라 소멸, 교환완료 또는 별도 상태로 처리될 수 있으며, 교환 완료\n후에는 원칙적으로 취소할 수 없습니다.\n\n교환포인트는 회원이 현금 결제를 통해 충전한 충전포인트와 달리 현금 환불\n대상이 아니며, 회사가 정한 아이템 재교환 또는 서비스 내 사용 범위에서만\n사용할 수 있습니다.\n\n회사는 교환포인트의 부정 취득, 시스템 오류 지급, 중복 지급, 허위거래,\n약관 위반, 운영정책 위반, 분쟁 발생 또는 법령 위반 의심이 있는 경우\n교환포인트의 사용을 제한하거나 정정할 수 있습니다.\n\n회원은 교환포인트의 취득 경로, 사용 가능 서비스, 재교환 가능 여부, 사용\n제한, 소멸 또는 정정 가능성을 서비스 화면과 운영정책을 통해 확인하여야\n합니다.\n\n1.  회원은 회사가 정한 조건을 충족한 경우 아이템을 포인트 또는 회사가\n    정한 서비스상 가치로 교환할 수 있습니다.\n\n2.  포인트교환, 아이템 재교환의 대상, 조건, 교환비율, 교환 가능 시점,\n    교환 제한 기준은 운영정책 및 서비스 화면의 안내에 따릅니다.\n\n3.  교환이 완료된 이후에는 원칙적으로 취소할 수 없습니다.\n\n4.  교환포인트는 현금 환불이 불가능하며, 회사가 정한 방식으로만 사용할\n    수 있습니다.\n\n5.  회사는 부정거래, 이상거래, 시스템 오류, 정책 위반 또는 분쟁이 발생한\n    경우 교환 처리를 보류하거나 취소할 수 있습니다.\n\n제8장 유료서비스\n\n제37조 (유료서비스)\n\n1.  회사는 자동예약, 레벨 업그레이드 기타 회사가 정한 유료서비스를\n    제공할 수 있습니다.\n\n2.  유료서비스의 종류, 이용요금, 이용기간, 사용 가능 포인트, 적용 조건,\n    제한사항은 운영정책 및 서비스 화면의 안내에 따릅니다.\n\n3.  유료서비스는 결제 또는 포인트 차감 완료 시점부터 적용됩니다.\n\n4.  회원은 유료서비스 신청 전 이용요금, 이용기간, 환불 제한, 적용 범위,\n    자동연장 여부, 취소 가능 여부를 확인하여야 합니다.\n\n5.  유료서비스는 서비스 이용 편의를 제공하는 기능일 뿐이며, 매칭 성공,\n    판매 완료, 수익 발생, 차익 또는 특정 결과를 보장하지 않습니다.\n\n제38조 (유료서비스 해지 및 환불)\n\n1.  유료서비스의 해지, 환불, 취소 가능 여부는 운영정책 및 서비스\n    화면에서 안내한 기준에 따릅니다.\n\n2.  이용기간이 정해진 유료서비스는 회원이 해당 기능을 실제로 이용하지\n    않더라도 이용기간이 진행됩니다.\n\n3.  회원의 단순 변심, 미사용, 설정 오류, 알림 미확인, 예약 미확인, 계정\n    제한 또는 패널티로 인한 이용 불가에 대해서는 환불이 제한될 수\n    있습니다.\n\n4.  다만, 회사의 귀책사유로 유료서비스가 정상적으로 제공되지 않은 경우\n    회사는 관련 법령 및 운영정책에 따라 환불, 기간 연장 또는 이에\n    상응하는 조치를 할 수 있습니다.\n\n제9장 회원의 의무 및 금지행위\n\n제39조 (회원의 일반 의무)\n\n1.  회원은 본 약관, 운영정책, 개인정보처리방침, 서비스 화면의 안내 및\n    관련 법령을 준수하여야 합니다.\n\n2.  회원은 서비스 이용 시 정확한 정보를 제공하고, 변경된 정보가 있는\n    경우 지체 없이 수정하여야 합니다.\n\n3.  회원은 매칭 결과를 확인하고 정해진 시간 내 입금, 입금완료 처리,\n    입금확인, 신고, 자료 제출 등 필요한 의무를 성실히 이행하여야 합니다.\n\n4.  회원은 자신의 계정, 비밀번호, 휴대전화, 인증수단, 계좌정보를\n    안전하게 관리하여야 합니다.\n\n5.  회원은 서비스 내 거래, 포인트, 아이템, 예약, 매칭, 신고 및 고객센터\n    이용 과정에서 신의성실의 원칙에 따라 행동하여야 합니다.\n\n제40조 (금지행위)\n\n회원은 다음 각 호의 행위를 하여서는 안 됩니다.\n\n1.  타인의 명의, 휴대전화번호, 계좌정보 또는 인증정보를 이용하는 행위\n\n2.  허위정보 또는 부정확한 정보를 입력하는 행위\n\n3.  다중계정, 중복가입, 우회가입 또는 계정 공유 행위\n\n4.  실제 송금하지 않았음에도 입금완료 처리하는 행위\n\n5.  이체영수증, 송금확인증, 캡처 이미지 기타 증빙자료를 조작, 위조, 변조\n    또는 편집하여 제출하는 행위\n\n6.  고의 또는 반복적으로 미입금하는 행위\n\n7.  거래금액과 다른 금액을 고의 또는 반복적으로 입금하는 행위\n\n8.  허위신고 또는 악의적 신고를 하는 행위\n\n9.  정당한 사유 없이 입금확인 또는 신고를 지연하여 상대방에게 손해를\n    발생시키는 행위\n\n10. 계좌정보를 고의로 잘못 등록하거나 타인에게 오입금을 유도하는 행위\n\n11. 포인트, 아이템, 계정, 매칭 결과를 외부에서 매매, 양도, 대여, 담보\n    제공 또는 현금화하는 행위\n\n12. 회사의 매칭 시스템, 레벨 시스템, 예약 시스템, 포인트 시스템 또는\n    거래 시스템을 악용하는 행위\n\n13. 매크로, 봇, 자동화 프로그램, 비정상 접속수단을 이용하는 행위\n\n14. 서비스의 정상 운영을 방해하거나 서버에 과도한 부하를 주는 행위\n\n15. 회사, 다른 회원 또는 제3자의 개인정보를 수집, 저장, 공개, 유포 또는\n    악용하는 행위\n\n16. 회사, 다른 회원 또는 제3자를 비방, 협박, 모욕, 기망하거나 명예를\n    훼손하는 행위\n\n17. 사기, 자금세탁, 불법 금융거래, 도박, 유사수신, 다단계, 범죄수익 은닉\n    기타 위법행위에 서비스를 이용하는 행위\n\n18. 회사의 사전 승인 없이 영리 목적 광고, 홍보, 모집, 권유, 외부 거래\n    유도 행위를 하는 행위\n\n19. 회사의 지식재산권, 영업비밀, 시스템 구조, 데이터, 화면, 콘텐츠를\n    무단 복제, 분석, 변형, 배포하는 행위\n\n20. 기타 관련 법령, 본 약관, 운영정책 또는 공서양속에 반하는 행위\n\n제41조 (부정거래 및 이상거래 방지)\n\n1.  회사는 허위 송금, 증빙자료 조작, 허위신고, 미입금, 다중계정,\n    명의도용, 계좌도용, 시스템 악용, 이상거래, 부정거래를 방지하기\n    위하여 필요한 범위에서 회원의 서비스 이용기록, 거래기록, 접속기록,\n    계좌정보, 신고기록, 제출자료를 확인할 수 있습니다.\n\n2.  회사는 부정거래 또는 이상거래가 의심되는 경우 해당 거래, 포인트\n    사용, 예약, 매칭, 환불, 출금, 교환 또는 계정 이용을 일시적으로\n    제한할 수 있습니다.\n\n3.  회사는 필요 시 회원에게 본인확인, 계좌내역, 이체확인증, 은행\n    발급자료, 추가 캡처, 거래경위서 기타 자료 제출을 요청할 수 있습니다.\n\n4.  회원이 자료 제출을 거부하거나 허위자료를 제출하는 경우 회사는 해당\n    회원에게 불리한 판단을 할 수 있습니다.\n\n5.  부정거래가 확인된 경우 회사는 운영정책에 따른 패널티, 영구 이용제한,\n    수사기관 신고, 손해배상 청구 기타 필요한 조치를 할 수 있습니다.\n\n제10장 신고, 분쟁처리 및 패널티\n\n제42조 (신고)\n\n1.  판매자는 미입금, 금액 오류, 허위 송금, 증빙자료 조작 의심 기타\n    문제가 있는 경우 운영정책에서 정한 신고 가능 시간 내에 신고하여야\n    합니다.\n\n2.  회원은 신고 시 사실에 근거한 내용을 제출하여야 하며, 허위 또는\n    과장된 신고를 하여서는 안 됩니다.\n\n3.  신고가 접수된 경우 회사는 시스템 기록, 입금자료, 계좌내역, 증빙자료,\n    회원 진술 기타 자료를 기준으로 사실관계를 확인할 수 있습니다.\n\n4.  신고 가능 시간 내 신고하지 않은 경우 해당 거래는 자동으로 정상\n    처리될 수 있으며, 이후 사후처리 가능 여부는 회사의 판단 및\n    운영정책에 따릅니다.\n\n제43조 (분쟁처리)\n\n초과입금, 오입금, 미입금, 금액 부족, 입금자명 불일치, 이체영수증 조작\n의심, 판매자 입금확인 지연, 구매자 입금완료 처리 누락, 계좌정보 오류 등\n거래 분쟁이 발생한 경우 회사는 구매자와 판매자에게 필요한 자료 제출을\n요청하고 시스템 기록과 제출자료를 기준으로 사실관계를 확인할 수\n있습니다.\n\n회원은 분쟁처리 과정에서 회사가 요청하는 자료를 성실히 제출하여야 하며,\n정당한 사유 없이 자료 제출을 거부하거나 지연하거나 허위자료를\n제출하여서는 안 됩니다. 자료 제출 거부 또는 허위자료 제출은 운영정책상\n불리하게 판단될 수 있으며, 이용제한 또는 패널티 사유가 될 수 있습니다.\n\n회사는 분쟁처리 과정에서 합리적인 중재와 사실확인 지원을 제공하되,\n회사가 거래 당사자로 참여한 플랫폼 참여 거래를 제외하고 회원 간 직접송금\n거래에서 발생한 손해, 금액 회수, 상대방의 반환 이행을 보장하지 않습니다.\n\n1.  회원 간 거래와 관련하여 분쟁이 발생한 경우 회원은 고객센터를 통해\n    회사에 분쟁처리를 요청할 수 있습니다.\n\n2.  회사는 분쟁처리를 위하여 필요한 자료 제출을 요청할 수 있으며, 회원은\n    이에 성실히 협조하여야 합니다.\n\n3.  회사는 제출된 자료, 시스템 기록, 입금 기록, 신고 시간, 거래 시간,\n    입금확인 여부, 자동처리 여부, 운영정책을 종합하여 합리적으로\n    판단합니다.\n\n4.  회사는 분쟁처리 과정에서 거래 제한, 계정 제한, 포인트 사용 제한,\n    환불 보류, 아이템 이동 보류 기타 임시 조치를 할 수 있습니다.\n\n5.  회사는 분쟁의 중재 또는 사실확인 지원을 제공할 수 있으나, 회사가\n    거래 당사자로 참여한 경우를 제외하고 회원 간 직접송금 거래에서\n    발생한 모든 손해를 보상할 의무를 부담하지 않습니다.\n\n6.  분쟁처리 기간은 사안의 복잡성, 자료 제출 여부, 은행 확인, 외부기관\n    협조 여부에 따라 달라질 수 있습니다.\n\n제44조 (사후처리)\n\n1.  정상 거래 완료 또는 자동처리 이후 문제가 확인된 경우 회원은\n    고객센터에 사후처리를 요청할 수 있습니다.\n\n2.  사후처리를 요청하는 회원은 계좌내역증명서, 이체확인증, 송금확인자료,\n    거래번호, 매칭번호, 캡처 이미지 기타 회사가 요구하는 자료를\n    제출하여야 합니다.\n\n3.  회사는 제출자료와 시스템 기록을 검토하여 아이템 복원, 포인트 조정,\n    패널티 취소, 계정 복구, 상대방 제재, 수사기관 신고 안내 기타 필요한\n    조치를 할 수 있습니다.\n\n4.  사후처리 요청이 지연되거나 자료가 불충분한 경우 회사는 처리를\n    제한하거나 거절할 수 있습니다.\n\n5.  회사는 사후처리를 통해 모든 손해 회복, 금액 회수 또는 거래 복원을\n    보장하지 않습니다.\n\n제45조 (패널티)\n\n판매자가 초과입금 또는 오입금이 확인되었음에도 정당한 사유 없이 반환을\n거부하거나, 회사의 입금내역·계좌내역·증빙자료 제출 요청에 협조하지 않는\n경우 회사는 이를 중대한 운영정책 위반으로 보아 패널티를 부과할 수\n있습니다.\n\n구매자가 고의 또는 반복적으로 미입금, 금액 부족 입금, 초과입금, 허위\n입금완료 처리, 조작된 이체영수증 제출, 허위신고를 하는 경우 회사는 해당\n구매자에게 패널티를 부과할 수 있습니다.\n\n회사는 패널티를 부과할 때 위반행위의 고의성, 반복성, 피해 규모,\n거래상대방의 손해, 자료 제출 여부, 과거 위반 이력, 서비스 운영에 미친\n영향을 종합적으로 고려합니다. 다만 이체영수증 조작, 명의도용, 계좌도용,\n사기, 자금세탁 등 중대한 위반행위는 사전 경고 없이 강한 제재가 가능할 수\n있습니다.\n\n1.  회사는 회원이 본 약관, 운영정책 또는 관련 법령을 위반한 경우\n    패널티를 부과할 수 있습니다.\n\n2.  패널티의 종류는 다음 각 호와 같습니다.\n\n    1.  경고\n    2.  포인트 차감 또는 패널티 포인트 부과\n    3.  구매예약 제한\n    4.  판매예약 제한\n    5.  자동예약 제한\n    6.  포인트 사용 제한\n    7.  교환 제한\n    8.  환불 보류\n    9.  계정 일시정지\n    10. 거래 제한\n    11. 영구 이용제한\n    12. 재가입 제한\n    13. 수사기관 신고\n    14. 손해배상 청구\n    15. 기타 회사가 필요하다고 판단하는 조치\n\n3.  미입금, 금액 오류, 허위신고, 이체영수증 조작, 부정거래 등에 대한\n    구체적인 패널티 기준은 운영정책에 따릅니다.\n\n4.  회사는 위반행위의 내용, 고의성, 반복성, 피해 규모, 분쟁 발생 여부,\n    자료 제출 여부, 과거 위반 이력 등을 고려하여 패널티를 가중 또는\n    감경할 수 있습니다.\n\n5.  이체영수증 조작, 명의도용, 계좌도용, 사기, 시스템 악용, 불법행위가\n    확인된 경우 회사는 사전 경고 없이 영구 이용제한 및 법적 조치를 할 수\n    있습니다.\n\n제46조 (이용제한 절차 및 이의제기)\n\n1.  회사는 회원에게 이용제한을 하는 경우 원칙적으로 그 사유와 제한\n    내용을 안내합니다. 다만, 긴급한 조치가 필요하거나 법령상 제한이 있는\n    경우 사후 안내할 수 있습니다.\n\n2.  회원은 이용제한에 이의가 있는 경우 고객센터를 통해 이의제기를 할 수\n    있습니다.\n\n3.  회사는 회원의 이의제기를 검토하고 필요한 경우 추가 자료 제출을\n    요청할 수 있습니다.\n\n4.  회사는 이의제기가 타당하다고 판단하는 경우 패널티 취소, 계정 복구,\n    포인트 복구, 거래상태 정정 기타 필요한 조치를 할 수 있습니다.\n\n5.  이의제기가 허위자료에 기반하거나 반복적으로 악용되는 경우 회사는\n    추가 패널티를 부과할 수 있습니다.\n\n제11장 개인정보 보호\n\n제47조 (개인정보의 처리)\n\n회사는 구매자와 판매자 간 직접송금 거래를 진행하기 위하여 거래\n상대방에게 필요한 최소한의 계좌정보, 예금주명, 거래금액, 매칭번호,\n거래상태, 신고 및 확인에 필요한 정보를 제공할 수 있습니다. 회원은 서비스\n구조상 이러한 정보 제공이 거래 이행과 분쟁처리에 필수적임을 확인합니다.\n\n회사는 초과입금, 오입금, 미입금, 허위신고, 증빙자료 조작, 부정거래 조사\n및 분쟁처리를 위하여 필요한 범위에서 거래기록, 입금확인자료, 이체영수증,\n신고기록, 고객센터 상담기록, 접속기록, 기기정보, 계정정보, 계좌정보를\n확인할 수 있습니다.\n\n개인정보의 수집·이용·제공·위탁·보관·파기에 관한 구체적 사항은\n개인정보처리방침에 따르며, 본 약관과 개인정보처리방침의 내용이 충돌하는\n경우 개인정보 처리에 관한 사항은 개인정보처리방침과 관련 법령이 우선\n적용됩니다.\n\n1.  회사는 서비스 제공을 위하여 필요한 범위에서 회원의 개인정보를 수집,\n    이용, 보관, 제공, 위탁 및 파기합니다.\n\n2.  회사는 개인정보 보호 관련 법령을 준수하며, 개인정보 처리에 관한\n    구체적인 사항은 개인정보처리방침에 따릅니다.\n\n3.  회원은 회원가입, 성인인증, 계좌 등록, 거래 매칭, 직접송금, 포인트\n    이용, 신고, 분쟁처리, 부정거래 방지 등을 위하여 필요한 개인정보\n    처리에 동의하여야 합니다.\n\n4.  회사는 이용자 간 직접송금 거래 진행을 위하여 필요한 최소한의\n    계좌정보 또는 거래 확인정보를 거래 상대방에게 제공할 수 있습니다.\n\n5.  회원이 개인정보 제공 또는 처리에 필요한 필수 동의를 거부하는 경우\n    서비스 이용이 제한될 수 있습니다.\n\n제48조 (개인정보의 정확성 및 회원의 책임)\n\n1.  회원은 이름, 생년월일, 휴대전화번호, 계좌번호, 은행명, 예금주명 등\n    서비스 이용에 필요한 정보를 정확하게 입력하고 최신 상태로 유지하여야\n    합니다.\n\n2.  회원이 부정확한 개인정보 또는 계좌정보를 입력하여 발생한 거래 오류,\n    환불 지연, 오입금, 패널티, 분쟁 기타 불이익은 회원 본인이\n    책임집니다.\n\n3.  회원은 자신의 개인정보가 변경된 경우 지체 없이 회사가 정한 방법에\n    따라 수정하여야 합니다.\n\n4.  회사는 회원정보의 정확성 확인이 필요한 경우 본인확인, 계좌확인,\n    증빙자료 제출을 요청할 수 있습니다.\n\n제12장 회사의 의무와 책임 제한\n\n제49조 (회사의 의무)\n\n1.  회사는 관련 법령과 본 약관을 준수하며, 안정적인 서비스 제공을 위하여\n    노력합니다.\n\n2.  회사는 회원의 개인정보 보호를 위하여 개인정보처리방침에 따른\n    보호조치를 이행합니다.\n\n3.  회사는 서비스 장애, 오류, 보안사고, 부정거래 또는 분쟁이 발생한 경우\n    합리적인 범위에서 이를 해결하기 위하여 노력합니다.\n\n4.  회사는 회원으로부터 정당한 의견 또는 불만이 접수된 경우 이를\n    처리하기 위하여 노력합니다.\n\n제50조 (수익 및 거래 결과의 비보장)\n\n회사가 서비스 화면, 안내자료, 설명자료, 통계자료, 시뮬레이션 또는\n예시에서 매칭률, 거래량, 평균 수치, 과거 사례, 예상 수치를 표시하더라도\n이는 서비스 이해를 돕기 위한 참고자료일 뿐이며, 회원 개인의 장래 거래\n결과, 판매완료, 수익, 차익 또는 원금 회수를 보장하는 의미가 아닙니다.\n\n회원은 아이템 보유, 판매예약, 매칭, 2차매칭, 플랫폼 참여 거래,\n포인트교환, 행운구매, 소각합성(결합판매) 등 서비스 기능이 운영정책과\n시스템 상황에 따라 달라질 수 있음을 이해하고, 거래 참여 여부와 포인트\n사용 여부를 스스로 판단하여야 합니다.\n\n회사는 약관규제법 등 관련 법령상 허용되는 범위를 넘어 회사의 고의 또는\n중대한 과실로 인한 책임을 배제하지 않습니다. 본 약관의 면책 또는\n책임제한 조항은 관련 법령상 허용되는 범위 내에서만 적용됩니다.\n\n1.  회사는 회원의 구매예약, 판매예약, 매칭 결과, 아이템 판매, 수익,\n    차익, 원금 회수, 포인트 가치, 아이템 가치, 특정 금액 지급 또는 특정\n    기간 내 거래 완료를 보장하지 않습니다.\n\n2.  서비스 내 표시되는 예시, 시뮬레이션, 예상 수치, 과거 데이터, 평균값,\n    매칭률, 거래 사례는 이해를 돕기 위한 자료일 뿐이며, 장래의 결과를\n    보장하지 않습니다.\n\n3.  회원은 자신의 판단과 책임으로 서비스를 이용하여야 하며, 서비스 이용\n    결과 발생하는 경제적 손익은 회원 본인이 부담합니다.\n\n4.  회사는 회원에게 투자 자문, 금융 자문, 수익 보장, 원금 보장, 특정\n    거래 권유를 제공하지 않습니다.\n\n제51조 (면책)\n\n본 약관의 면책조항은 회사의 고의 또는 중대한 과실로 인한 법률상 책임을\n배제하거나 제한하는 것으로 해석되지 않습니다.\n\n회사는 이용자 간 직접송금 거래에서 중개 플랫폼과 사실확인 지원을\n제공하지만, 플랫폼 참여 거래를 제외하고 구매자 또는 판매자의 계좌이체\n이행, 반환 이행, 손해배상 이행을 보증하지 않습니다. 다만 회사는 신고\n접수, 자료 확인, 이용제한, 패널티 부과 등 서비스 운영자로서 합리적으로\n가능한 조치를 할 수 있습니다.\n\n회원이 본 약관 또는 운영정책을 위반하여 발생한 손해에 대해서는\n귀책사유가 있는 회원이 책임을 부담합니다. 회사는 회원의 위반행위로\n인하여 다른 회원 또는 제3자에게 손해가 발생한 경우 관련 자료 보존,\n사실확인, 제재 조치 및 관계기관 신고 안내를 할 수 있습니다.\n\n1.  회사는 천재지변, 전쟁, 폭동, 화재, 정전, 감염병, 국가비상사태, 정부\n    명령, 법원 결정, 수사기관 요청, 통신망 장애, 결제망 장애, 인증기관\n    장애, 은행 시스템 장애, 클라우드 장애, 해킹 등 회사의 합리적 통제를\n    벗어난 사유로 서비스를 제공할 수 없는 경우 책임을 부담하지 않습니다.\n\n2.  회사는 회원의 귀책사유로 인한 서비스 이용 장애, 거래 실패, 미입금,\n    오입금, 초과입금, 계좌정보 오류, 알림 미확인, 예약 착오, 증빙자료\n    미제출, 패널티 발생에 대하여 책임을 부담하지 않습니다.\n\n3.  회사는 회원 간 직접송금 거래에서 발생한 분쟁에 대하여 합리적인\n    중재와 사실확인 지원을 할 수 있으나, 회사가 거래 당사자인 경우를\n    제외하고 거래 상대방의 의무 이행, 금액 회수, 손해배상을 보장하지\n    않습니다.\n\n4.  회사는 회원이 서비스를 이용하여 기대하는 수익, 차익, 매칭률, 판매\n    완료, 아이템 가치 상승을 얻지 못한 것에 대하여 책임을 부담하지\n    않습니다.\n\n5.  회사는 회원이 본 약관, 운영정책, 관련 법령을 위반하여 발생한 손해에\n    대하여 책임을 부담하지 않습니다.\n\n6.  회사는 무료로 제공되는 서비스의 변경, 중단 또는 종료에 대하여 관련\n    법령에 특별한 규정이 없는 한 책임을 부담하지 않습니다.\n\n제52조 (손해배상)\n\n1.  회사 또는 회원이 본 약관, 운영정책 또는 관련 법령을 위반하여\n    상대방에게 손해를 입힌 경우 귀책 당사자는 그 손해를 배상하여야\n    합니다.\n\n2.  회원이 허위정보 입력, 명의도용, 계좌도용, 미입금, 허위신고,\n    이체영수증 조작, 부정거래, 시스템 악용, 불법행위로 회사 또는\n    제3자에게 손해를 발생시킨 경우 회원은 해당 손해를 배상하여야 합니다.\n\n3.  회사는 회원의 위반행위로 인하여 발생한 조사비용, 법률비용, 민원처리\n    비용, 시스템 복구비용, 제3자 손해배상금 기타 손해에 대하여 회원에게\n    배상을 청구할 수 있습니다.\n\n4.  회사의 손해배상 책임은 회사의 고의 또는 과실이 있는 경우에 한하며,\n    특별손해, 간접손해, 영업손실, 기대수익 상실에 대해서는 회사가 이를\n    알았거나 알 수 있었던 경우를 제외하고 책임을 부담하지 않습니다.\n\n제13장 지식재산권 및 서비스 자료\n\n제53조 (지식재산권)\n\n1.  서비스, 시스템, 알고리즘, 화면, 디자인, 로고, 상표, 데이터베이스,\n    콘텐츠, 운영정책, 문서, 소프트웨어, 매칭 구조, 아이템 구조 기타\n    회사가 제공하는 자료에 관한 지식재산권은 회사 또는 정당한 권리자에게\n    귀속됩니다.\n\n2.  회원은 회사의 사전 서면 동의 없이 서비스 또는 서비스 관련 자료를\n    복제, 배포, 전송, 출판, 전시, 판매, 대여, 2차적 저작물 작성, 역설계,\n    분석, 모방, 변형, 상업적 이용할 수 없습니다.\n\n3.  회원이 서비스 이용 과정에서 회사에 제공한 의견, 제안, 개선 아이디어,\n    오류 신고 등은 회사가 서비스 개선 및 운영을 위하여 무상으로 사용할\n    수 있습니다. 단, 회원의 개인정보는 개인정보처리방침에 따라\n    처리됩니다.\n\n4.  회원이 회사 또는 제3자의 지식재산권을 침해한 경우 회사는 해당 회원의\n    서비스 이용을 제한하고 손해배상을 청구할 수 있습니다.\n\n제54조 (특허 및 시스템 구조의 보호)\n\n1.  회사가 제공하는 서비스에는 아이템 구매예약, 판매예약, 매칭, 포인트\n    또는 씨앗 관리, 단계관리, 랜덤매칭, 행운구매, 소각합성(결합판매),\n    안전거래, 2차매칭, 아이템 밸런스 관리 등 회사 또는 권리자가\n    보유하거나 사용할 권한을 가진 기술적·영업적 구조가 포함될 수\n    있습니다.\n\n2.  회원은 서비스의 기술 구조, 매칭 구조, 가격 구조, 데이터 구조, 운영\n    방식, 알고리즘 또는 특허 관련 내용을 무단으로 분석, 복제, 모방,\n    우회, 상업적 이용하거나 제3자에게 제공하여서는 안 됩니다.\n\n3.  본 조는 회원의 정상적인 서비스 이용을 제한하기 위한 것이 아니며,\n    회사의 정당한 지식재산권, 영업비밀 및 서비스 운영상 이익을 보호하기\n    위한 것입니다.\n\n제14장 탈퇴 및 계약 종료\n\n제55조 (회원탈퇴)\n\n1.  회원은 언제든지 회사가 정한 절차에 따라 회원탈퇴를 신청할 수\n    있습니다.\n\n2.  회사는 회원의 탈퇴 신청이 있는 경우 관련 법령 및 운영정책에 따라\n    탈퇴를 처리합니다.\n\n3.  다음 각 호의 경우 회사는 탈퇴 처리를 보류할 수 있습니다.\n\n    1.  진행 중인 거래가 있는 경우\n    2.  미입금, 신고, 분쟁, 사후처리가 진행 중인 경우\n    3.  환불 또는 포인트 정산이 필요한 경우\n    4.  패널티 또는 이용제한 상태인 경우\n    5.  부정거래 또는 법령 위반 조사가 진행 중인 경우\n    6.  기타 탈퇴 전 정산 또는 확인이 필요한 경우\n\n4.  회원은 탈퇴 전 보유 포인트, 아이템, 진행 중인 예약, 거래, 신고, 분쟁\n    여부를 확인하여야 합니다.\n\n5.  탈퇴 후에는 관련 법령상 보관이 필요한 정보를 제외하고 회원의\n    개인정보는 개인정보처리방침에 따라 파기됩니다.\n\n제56조 (계약 해지 및 자격 상실)\n\n1.  회사는 회원이 다음 각 호의 어느 하나에 해당하는 경우 서비스\n    이용계약을 해지하거나 회원자격을 상실시킬 수 있습니다.\n\n    1.  본 약관 또는 운영정책을 중대하게 위반한 경우\n    2.  허위정보 또는 타인 명의로 가입한 경우\n    3.  만 19세 미만 가입 사실이 확인된 경우\n    4.  다중계정 또는 부정가입이 확인된 경우\n    5.  이체영수증 조작, 허위송금, 사기, 명의도용, 계좌도용이 확인된\n        경우\n    6.  회사 또는 다른 회원에게 중대한 손해를 발생시킨 경우\n    7.  법령 위반 행위에 서비스를 이용한 경우\n    8.  서비스 운영을 고의로 방해한 경우\n    9.  수사기관, 법원, 행정기관의 요청 또는 명령이 있는 경우\n    10. 기타 회원자격 유지가 부적절하다고 합리적으로 판단되는 경우\n\n2.  회사가 이용계약을 해지하는 경우 회원에게 그 사유를 안내합니다. 다만,\n    긴급한 조치가 필요하거나 법령상 제한이 있는 경우 사후 안내할 수\n    있습니다.\n\n3.  이용계약 해지 후에도 이미 발생한 회원의 책임, 손해배상 의무,\n    분쟁처리 의무, 법령상 보관 의무는 소멸하지 않습니다.\n\n제15장 기록 보관 및 증빙\n\n제57조 (거래기록 보관)\n\n1.  회사는 관련 법령 및 개인정보처리방침에 따라 서비스 이용기록, 계약\n    또는 청약철회 기록, 대금결제 및 재화 등의 공급 기록, 소비자 불만\n    또는 분쟁처리 기록, 표시·광고 기록 등을 보관할 수 있습니다.\n\n2.  거래 및 결제 관련 기록의 보관기간은 관련 법령에서 정한 기간에\n    따릅니다.\n\n3.  회사는 부정거래 방지, 분쟁 대응, 법적 의무 이행, 수사기관 또는\n    법원의 적법한 요청 대응을 위하여 필요한 범위에서 관련 기록을 보관할\n    수 있습니다.\n\n4.  회원은 자신의 거래기록 확인이 필요한 경우 회사가 정한 절차에 따라\n    열람 또는 자료 제공을 요청할 수 있습니다.\n\n제58조 (전자문서 및 통지)\n\n회원은 서비스 이용 과정에서 약관 동의, 개인정보 처리 동의, 구매예약,\n판매예약, 매칭 결과, 입금완료, 입금확인, 신고, 분쟁처리, 포인트 사용,\n유료서비스 신청, 환불 신청 등 주요 절차가 전자적 방식으로 처리될 수\n있음을 확인합니다.\n\n회사는 전자문서 및 전자적 기록을 관련 법령과 개인정보처리방침에서 정한\n기간 동안 보관할 수 있으며, 분쟁 발생 시 해당 기록은 거래 사실과 절차\n이행 여부를 확인하는 자료로 활용될 수 있습니다.\n\n1.  회사와 회원 사이의 통지, 안내, 동의, 거래내역, 영수증, 신고, 답변,\n    공지 등은 전자문서 또는 전자적 방법으로 제공될 수 있습니다.\n\n2.  회사는 회원이 등록한 휴대전화번호, 전자우편, 앱 푸시 알림, 서비스 내\n    알림, 공지사항, 문자메시지 기타 전자적 방법으로 통지할 수 있습니다.\n\n3.  회원이 연락처를 정확하게 입력하지 않거나 변경된 정보를 수정하지 않아\n    회사의 통지를 받지 못한 경우, 이에 따른 불이익은 회원 본인이\n    책임집니다.\n\n4.  회사가 서비스 내 공지사항에 게시한 경우 게시 시점부터 회원에게\n    도달한 것으로 볼 수 있습니다. 다만, 회원에게 중대한 영향을 미치는\n    사항은 관련 법령에 따라 별도 통지할 수 있습니다.\n\n제16장 기타\n\n제15장의2 서비스 게시 및 소비자 안내 보강\n\n제58조의2 (통신판매 및 거래조건 표시)\n\n회사는 전자상거래 등 관련 법령에서 정한 범위에 따라 상호, 대표자 성명,\n주소, 전화번호 또는 고객센터 연락처, 전자우편주소, 사업자등록번호,\n통신판매업 신고번호, 서비스명, 거래조건, 청약철회 또는 환불 기준,\n분쟁처리 절차 등 소비자가 거래 전에 확인할 수 있는 정보를 서비스 화면,\n웹사이트, 공지사항 또는 약관에 게시합니다.\n\n회원은 구매예약, 판매예약, 포인트 충전, 유료서비스 신청, 아이템 교환,\n포인트교환 전 서비스 화면에 표시되는 거래조건, 금액, 포인트 차감 기준,\n환불 제한, 매칭 및 미입금 처리 기준을 확인하여야 합니다. 회원의 단순\n미확인 또는 착오로 발생한 불이익은 회원 본인이 부담합니다. 다만 회사의\n고의 또는 과실로 잘못된 정보가 제공된 경우 관련 법령에 따라 처리합니다.\n\n제58조의3 (청약철회·환불 및 서비스 특성)\n\n회원이 충전포인트 또는 유료서비스에 관하여 청약철회 또는 환불을 요청하는\n경우 회사는 전자상거래 등 관련 법령, 본 약관, 운영정책 및 서비스\n화면에서 고지한 기준에 따라 처리합니다.\n\n이미 사용된 포인트, 이미 제공이 개시된 유료서비스, 회원의 신청에 따라\n즉시 실행된 자동예약, 매칭 또는 교환 절차가 완료된 아이템, 회원의 책임\n있는 사유로 가치가 감소하거나 절차가 완료된 서비스에 대해서는 관련\n법령상 허용되는 범위에서 청약철회 또는 환불이 제한될 수 있습니다.\n\n충전포인트와 달리 교환포인트는 현금 결제에 따라 발생한 포인트가 아니므로\n현금 환불 대상이 아닙니다. 교환포인트의 사용, 재교환, 제한, 정정 및 소멸\n기준은 본 약관과 운영정책에 따릅니다.\n\n제58조의4 (불공정 약관 방지 및 해석 원칙)\n\n본 약관의 조항 중 관련 법령에 따라 무효로 판단되는 부분이 있는 경우 해당\n부분은 법령상 허용되는 범위 내에서만 효력을 가지며, 나머지 조항의\n효력에는 영향을 미치지 않습니다.\n\n본 약관에서 회사의 책임을 제한하거나 면책하는 내용은 회사의 고의 또는\n중대한 과실로 인한 책임을 배제하는 것으로 해석되지 않습니다. 또한\n회원에게 부당하게 과중한 손해배상 의무를 부과하거나, 회원의 법령상\n권리를 부당하게 제한하는 것으로 해석되지 않습니다.\n\n약관의 의미가 명확하지 않거나 서로 다른 해석이 가능한 경우에는 관련\n법령, 서비스의 목적, 거래 구조, 신의성실의 원칙, 회원 보호 필요성 및\n일반적인 거래 관행을 고려하여 합리적으로 해석합니다.\n\n제58조의5 (법령 및 행정기관 조치에 따른 서비스 제한)\n\n회사는 관련 법령의 제·개정, 행정기관의 명령 또는 권고, 수사기관의 요청,\n법원의 결정, 금융기관의 조치, 통신판매 또는 개인정보 보호 관련 규제\n변화가 있는 경우 서비스의 전부 또는 일부, 포인트 충전·사용·환불, 매칭,\n플랫폼 참여 거래, 유료서비스, 회원가입 또는 계정 이용을 변경·제한·중단할\n수 있습니다.\n\n회사는 위 사유로 서비스 조건을 변경하는 경우 가능한 범위에서 사전에\n안내하되, 긴급한 법령 준수, 보안사고, 부정거래 방지, 금융사고 방지 또는\n회원 보호를 위하여 필요한 경우 사후 안내할 수 있습니다.\n\n제58조의6 (회원 고지 및 중요사항 확인)\n\n회사는 회원이 구매예약, 판매예약, 포인트 충전, 유료서비스 신청, 아이템\n교환, 포인트교환, 행운구매, 소각합성(결합판매), 2차매칭 또는 플랫폼 참여\n거래를 이용하기 전에 거래금액, 포인트 차감 기준, 환불 제한, 매칭 방식,\n미입금 처리, 신고 가능 시간, 자동처리 기준 등 중요사항을 확인할 수\n있도록 서비스 화면 또는 운영정책에서 안내합니다.\n\n회원은 중요사항 확인 화면, 체크박스, 알림, 공지, 운영정책 및 본 약관을\n확인한 후 서비스를 이용하여야 합니다. 회원이 알림을 확인하지 않았거나,\n서비스 화면에 표시된 거래조건을 확인하지 않았거나, 본인의 착오로 잘못된\n수량·금액·계좌를 입력한 경우 그로 인한 불이익은 회원 본인이 부담합니다.\n\n회사는 회원에게 중대한 영향을 미치는 사항을 변경하는 경우 변경 내용,\n변경 사유, 시행일, 기존 회원에 대한 적용 여부, 회원이 취할 수 있는 조치\n등을 가능한 범위에서 명확히 안내합니다.\n\n제58조의7 (구매예약 전 확인사항)\n\n회원은 구매예약을 신청하기 전에 아이템 종류, 단계, 거래금액, 필요\n포인트, 매칭 방식, 입금 가능 시간, 미입금 시 패널티, 이체영수증 제출\n방식, 구매예약 취소 제한, 판매 가능 시점, 보유기간 및 서비스 이용 위험을\n확인하여야 합니다.\n\n구매예약은 회원의 구매 의사를 표시하는 절차이며, 구매예약 신청만으로\n아이템 취득, 판매 가능성, 판매 완료, 차익 또는 수익이 보장되지 않습니다.\n매칭 후 구매자는 회사가 안내한 판매자 계좌로 지정된 시간 내 정확한\n금액을 송금하여야 합니다.\n\n구매자가 매칭 후 송금하지 않거나, 송금하였더라도 입금완료 처리를 하지\n않거나, 잘못된 금액 또는 잘못된 계좌로 송금한 경우 미입금, 금액 오류,\n오입금 또는 초과입금으로 처리될 수 있으며, 운영정책상 패널티 또는 거래\n제한이 발생할 수 있습니다.\n\n제58조의8 (판매예약 전 확인사항)\n\n회원은 판매예약을 신청하기 전에 자신이 보유한 아이템의 판매 가능일,\n보유기간 충족 여부, 판매예약 가능 수량, 판매예약 취소 제한, 매칭 방식,\n구매자 미입금 가능성, 1차매칭 및 2차매칭 절차, 회사 직접구매의 적용\n가능성과 제한 사유를 확인하여야 합니다.\n\n판매예약 또는 1차매칭이 이루어졌다는 사정만으로 판매가 확정되는 것은\n아닙니다. 구매자의 미입금, 금액 오류, 허위 입금완료 처리, 이체영수증\n조작 의심, 판매자의 입금확인 지연 또는 신고 누락 등으로 거래 완료가\n지연되거나 사후처리 대상이 될 수 있습니다.\n\n판매자는 매칭 후 입금확인 가능 시간 내 실제 입금 여부, 입금액, 입금자명,\n거래금액 일치 여부를 확인하여야 하며, 문제가 있는 경우 신고 가능 시간\n내에 신고하여야 합니다. 판매자가 신고 가능 시간 내 신고하지 않은 경우\n시스템은 거래를 정상 처리할 수 있습니다.\n\n제58조의9 (1차·2차 매칭 및 회사 직접구매의 세부 원칙)\n\n회사는 운영정책에서 정한 시간과 기준에 따라 1차매칭을 진행하며,\n1차매칭에서 구매자의 미입금 또는 거래 미완료가 발생한 경우 2차매칭을\n진행할 수 있습니다. 2차매칭 대상, 시간, 제외 기준, 신청 방식 및 처리\n기준은 운영정책에 따릅니다.\n\n1차매칭 및 2차매칭 모두에서 미입금 또는 거래 미완료가 발생한 경우 회사는\n운영정책에서 정한 기준에 따라 플랫폼 참여 거래 방식으로 직접 구매에\n참여할 수 있습니다. 이 기능은 판매자의 거래 지연을 줄이고 서비스 신뢰를\n유지하기 위한 보조적 운영 장치입니다.\n\n회사의 직접구매는 모든 판매예약, 모든 미입금 거래 또는 모든 아이템을\n회사가 무조건 인수한다는 의미가 아닙니다. 부정거래, 허위신고, 계정 제한,\n자료 미제출, 아이템 이상, 거래금액 불일치, 시스템 장애, 법령 위반 의심,\n운영정책 위반, 서비스 중단 또는 회사가 합리적으로 직접구매가\n부적절하다고 판단하는 경우 회사는 직접구매를 보류하거나 거절할 수\n있습니다.\n\n회사가 직접구매에 참여하는 경우 회사는 해당 거래의 구매자로서 서비스\n화면 또는 운영정책에서 정한 거래대금을 지급하고 거래완료 절차를\n진행합니다. 판매자는 회사가 요청하는 확인 절차, 계좌확인, 입금확인,\n거래상태 정정, 아이템 처리에 협조하여야 합니다.\n\n제58조의10 (초과입금 및 반환절차의 상세 기준)\n\n구매자가 거래금액보다 많은 금액을 송금한 경우 구매자는 고객센터 또는\n서비스 내 절차를 통해 초과입금 이의를 신청할 수 있습니다. 이 경우\n구매자는 이체확인증, 계좌거래내역, 송금시간, 송금인명, 수취계좌,\n거래번호, 매칭번호 등 회사가 요구하는 자료를 제출하여야 합니다.\n\n회사는 초과입금 이의신청이 접수된 경우 판매자에게 입금내역,\n계좌거래내역, 수취내역, 반환 여부, 반환 증빙자료를 요청할 수 있습니다.\n판매자는 정당한 사유 없이 자료 제출을 거부하거나 지연하여서는 안 되며,\n사실확인에 필요한 범위에서 성실히 협조하여야 합니다.\n\n초과입금이 확인된 경우 판매자는 확인된 초과입금액을 구매자에게\n반환하여야 합니다. 판매자가 이미 반환하였다고 주장하는 경우 반환 일시,\n반환 계좌, 반환 금액, 이체확인증 등 객관적인 자료를 제출하여야 합니다.\n\n회사는 초과입금 반환을 중재하고 판매자에게 반환 협조를 요청할 수 있으나,\n이용자 간 직접송금 구조상 판매자의 반환 자체를 물리적으로 강제하거나\n금액 회수를 보장하지 않습니다. 판매자가 반환을 거부하는 경우 회사는\n운영정책에 따라 이용제한 등 제재를 할 수 있고, 구매자는 필요한 경우\n금융기관, 수사기관 또는 법원 절차를 이용할 수 있습니다.\n\n제58조의11 (미입금 및 허위 입금완료 처리)\n\n구매자가 실제 송금하지 않았음에도 입금완료 처리를 하거나 허위\n이체영수증을 제출하는 행위는 중대한 약관 위반입니다. 회사는 이러한\n행위가 확인되거나 합리적으로 의심되는 경우 즉시 거래 제한, 포인트 사용\n제한, 계정 제한, 영구 이용제한, 수사기관 신고 등 필요한 조치를 할 수\n있습니다.\n\n구매자가 실제 송금하였으나 입금완료 버튼을 누르지 않았거나 증빙자료를\n제출하지 않은 경우 시스템은 미입금으로 처리할 수 있습니다. 이 경우\n구매자는 사후적으로 자료를 제출하여 이의제기를 할 수 있으나,\n운영정책에서 정한 시간과 절차를 준수하지 않아 발생한 패널티 또는 거래\n지연은 구매자 본인이 부담합니다.\n\n구매자의 미입금으로 판매자에게 거래 지연이 발생한 경우 회사는 운영정책에\n따라 2차매칭 또는 플랫폼 참여 거래를 진행할 수 있으며, 미입금\n구매자에게는 위반 내용과 반복 여부에 따라 패널티를 부과할 수 있습니다.\n\n제58조의12 (교환포인트와 아이템 재교환의 상세 기준)\n\n교환포인트는 아이템이 회사가 정한 교환 조건을 충족한 경우 서비스 내\n절차를 통해 발생하는 포인트입니다. 교환포인트는 충전포인트와 달리 회원이\n현금으로 직접 충전한 포인트가 아니므로 현금 환불 대상이 아니며, 서비스\n내에서 회사가 허용한 범위로만 사용할 수 있습니다.\n\n회원이 교환포인트를 아이템으로 재교환하는 경우 재교환 가능한 아이템\n종류, 필요 포인트, 교환 가능 시간, 교환 완료 후 취소 제한, 판매 가능\n시점, 보유기간 산정 기준은 운영정책 및 서비스 화면의 안내에 따릅니다.\n\n교환포인트가 시스템 오류, 중복 처리, 부정거래, 허위신고, 약관 위반,\n운영정책 위반으로 잘못 지급된 경우 회사는 해당 포인트를 정정하거나\n회수할 수 있습니다. 회원이 이미 해당 포인트를 사용한 경우 회사는 포인트\n잔액 차감, 아이템 상태 정정, 거래 제한 또는 사후정산을 할 수 있습니다.\n\n제58조의13 (행운구매 및 소각합성의 상세 고지)\n\n행운구매와 소각합성(결합판매)은 아이템 수량 조정, 서비스 내 거래 균형\n유지, 회원의 선택 기능 제공을 위한 서비스 내 기능입니다. 해당 기능은\n특정 수익, 특정 판매가, 특정 매칭, 특정 판매완료, 원금 회수 또는 차익을\n보장하지 않습니다.\n\n회원은 행운구매 또는 소각합성(결합판매)을 신청하기 전에 소각되는 아이템\n수량, 생성되는 아이템 종류, 필요한 포인트, 취소 제한, 생성 아이템의 판매\n가능 시점, 보유기간, 매칭 가능성, 포인트 환불 제한을 확인하여야 합니다.\n\n행운구매 또는 소각합성(결합판매)이 완료된 후에는 원칙적으로 취소할 수\n없으며, 시스템 오류 또는 회사의 귀책사유가 확인되는 경우 회사는 아이템\n복원, 포인트 복구, 거래상태 정정 또는 이에 상응하는 조치를 할 수\n있습니다.\n\n제58조의14 (부정거래 조사 및 임시조치)\n\n회사는 미입금 반복, 초과입금 반복, 허위신고, 이체영수증 조작, 다중계정,\n명의도용, 계좌도용, 가족 또는 지인 계정을 이용한 우회거래, 동일 IP 또는\n동일 기기에서의 비정상 거래, 시스템 악용, 자금세탁 또는 불법행위 의심\n거래를 탐지하기 위하여 서비스 이용기록과 거래기록을 확인할 수 있습니다.\n\n부정거래 또는 이상거래가 의심되는 경우 회사는 사실확인이 완료될 때까지\n구매예약, 판매예약, 매칭, 포인트 사용, 포인트 환불, 교환포인트 사용,\n아이템 교환, 자동예약, 계정 이용, 고객센터 처리 또는 플랫폼 참여 거래를\n일시 제한할 수 있습니다.\n\n회원은 회사의 조사에 필요한 자료를 성실히 제출하여야 하며, 자료 제출을\n거부하거나 허위자료를 제출하는 경우 회사는 해당 회원에게 불리한 판단을\n할 수 있습니다. 부정거래가 확인된 경우 회사는 이용제한, 손해배상 청구,\n수사기관 신고 등 필요한 조치를 할 수 있습니다.\n\n제58조의15 (회원 보호 및 분쟁예방 조치)\n\n회사는 회원 간 직접송금 구조에서 발생할 수 있는 미입금, 오입금,\n초과입금, 허위신고, 증빙자료 조작, 입금자명 불일치, 계좌정보 오류 등의\n위험을 줄이기 위하여 거래금액 표시, 계좌정보 확인, 이체영수증 제출,\n입금확인, 신고, 자동처리, 사후처리, 패널티 기능을 운영합니다.\n\n회원은 회사가 제공하는 분쟁예방 장치를 정확히 이용하여야 하며, 입금 전\n거래금액과 계좌정보를 다시 확인하고, 송금 후 입금완료 처리와 증빙자료\n제출을 완료하여야 합니다. 판매자는 입금확인 가능 시간 내 실제 입금\n여부를 확인하고 문제가 있는 경우 즉시 신고하여야 합니다.\n\n제58조의16 (서비스 위험 고지 및 이용자 자기책임 원칙)\n\n회원은 루페이 서비스가 구매예약, 판매예약, 매칭, 직접송금, 입금확인,\n신고, 자동처리, 포인트교환, 행운구매, 소각합성(결합판매) 등 여러 절차가\n결합된 서비스임을 이해하고, 각 절차의 시간 제한과 처리 기준을 확인한 후\n이용하여야 합니다.\n\n회원은 아이템의 가격 구조, 단계 구조, 보유기간, 판매 가능일, 매칭\n가능성, 미입금 가능성, 포인트 사용 및 환불 제한, 교환포인트의 현금 환불\n불가, 회사 직접구매의 제한 가능성을 충분히 확인한 후 서비스 이용 여부를\n결정하여야 합니다.\n\n회사는 서비스 이용 전 중요사항을 고지하고 회원이 이를 확인할 수 있도록\n노력하지만, 회원이 서비스 화면, 약관, 운영정책, 공지사항, 알림을\n확인하지 않아 발생한 불이익에 대해서는 회사의 고의 또는 과실이 없는 한\n책임을 부담하지 않습니다.\n\n본 조는 회사의 고의 또는 중대한 과실로 인한 법률상 책임을 배제하는 것이\n아니며, 회원이 자신의 의사와 판단에 따라 서비스 이용 여부를 결정하여야\n한다는 점을 명확히 하기 위한 조항입니다.\n\n제58조의17 (아이템 가격·단계·보유기간의 변경)\n\n회사는 서비스 안정성, 거래 균형, 아이템 수량 조정, 부정거래 방지, 법령\n준수, 시스템 운영상 필요에 따라 아이템의 종류, 단계, 가격 구조, 인상률,\n보유기간, 판매 가능일, 구매예약 가능 수량, 판매예약 가능 수량, 교환\n조건을 변경할 수 있습니다.\n\n회사가 아이템 가격 또는 단계 구조를 변경하는 경우 변경 내용, 적용 대상,\n적용 시점, 기존 보유 아이템에 대한 처리 기준을 서비스 화면 또는\n공지사항을 통해 안내합니다. 회원에게 중대한 불이익이 발생하는 변경은\n관련 법령과 본 약관에서 정한 절차에 따라 사전 고지합니다.\n\n아이템 가격 또는 단계 구조가 변경되더라도 이미 완료된 거래의 효력은\n원칙적으로 유지됩니다. 다만 시스템 오류, 명백한 표시 오류, 부정거래,\n법령 위반, 허위자료 제출 등 사유가 확인된 경우 회사는 거래상태를\n정정하거나 사후처리를 할 수 있습니다.\n\n회원은 아이템 가격·단계·보유기간이 고정 수익이나 확정된 회수금액을\n의미하지 않으며, 서비스 운영정책과 시장 상황, 예약 수량, 매칭 상황에\n따라 거래 결과가 달라질 수 있음을 확인합니다.\n\n제58조의18 (예약 취소·보류·제한의 상세 기준)\n\n구매예약과 판매예약은 신청 완료 후 원칙적으로 취소할 수 없습니다. 다만\n회사가 운영정책에서 별도로 정한 사유가 있거나, 시스템 오류, 중복 신청,\n명백한 오입력, 법령상 필요한 조치가 있는 경우 회사는 예약을\n취소·보류·정정할 수 있습니다.\n\n회사는 회원의 계정이 이용제한 상태이거나, 본인확인 또는 계좌확인이\n완료되지 않았거나, 포인트가 부족하거나, 분쟁·신고·환불·패널티·부정거래\n조사가 진행 중인 경우 예약 신청 또는 예약 유지, 매칭 진행을 제한할 수\n있습니다.\n\n회원이 반복적으로 예약 후 미입금하거나, 예약 시스템을 악용하거나, 타인의\n계정 또는 계좌를 이용하거나, 동일 기기·동일 IP·동일 계좌 등으로 비정상\n예약을 하는 경우 회사는 예약 가능 수량을 제한하거나 계정을 제한할 수\n있습니다.\n\n예약 취소, 보류 또는 제한으로 인하여 회원에게 발생한 손해에 대해서는 그\n사유와 귀책 여부에 따라 본 약관, 운영정책 및 관련 법령에 따라\n처리합니다.\n\n제58조의19 (계좌정보 오류 및 송금 책임)\n\n회원은 본인 명의의 정확한 계좌정보를 등록하고 최신 상태로 유지하여야\n합니다. 잘못된 계좌번호, 은행명, 예금주명, 계좌명, 휴대전화번호,\n생년월일 또는 회원정보 입력으로 인하여 발생하는 미입금, 오입금, 환불\n지연, 거래 실패, 패널티, 분쟁은 귀책사유가 있는 회원이 책임집니다.\n\n회사는 계좌정보의 정확성 확인을 위하여 본인확인, 예금주 확인, 계좌 사본,\n거래내역, 신분확인 자료 등 필요한 자료 제출을 요청할 수 있습니다. 회원이\n자료 제출을 거부하거나 부정확한 자료를 제출하는 경우 서비스 이용이\n제한될 수 있습니다.\n\n구매자는 송금 전 판매자의 계좌정보와 거래금액을 재확인하여야 하며,\n판매자는 자신의 계좌정보가 정확히 등록되어 있는지 확인하여야 합니다.\n회원 간 직접송금 구조에서는 송금 실행 후 금융기관을 통한 반환 절차가\n필요할 수 있으므로 각 회원은 특히 주의하여야 합니다.\n\n회사는 계좌정보 오류 또는 오입금 발생 시 사실확인과 중재를 지원할 수\n있으나, 회사가 거래 당사자로 참여한 경우를 제외하고 금융기관 송금의\n취소, 반환 또는 금액 회수를 보장하지 않습니다.\n\n제58조의20 (자료 제출 및 증빙의 원칙)\n\n회원은 입금, 입금확인, 신고, 사후처리, 환불, 포인트 정정, 계정 복구,\n이용제한 이의제기, 초과입금 반환, 부정거래 조사 등과 관련하여 회사가\n요청하는 자료를 정확하고 완전하게 제출하여야 합니다.\n\n회사가 요청할 수 있는 자료에는 이체확인증, 계좌거래내역, 은행 발급 내역,\n송금화면 캡처, 입금자명 확인자료, 본인확인자료, 계좌확인자료, 거래번호,\n매칭번호, 고객센터 상담내역, 오류 화면 캡처, 기타 사실확인에 필요한\n자료가 포함될 수 있습니다.\n\n회원은 자료를 위조, 변조, 편집, 삭제, 은폐하거나 사실과 다르게\n제출하여서는 안 됩니다. 회사는 자료의 진위가 의심되는 경우 추가 자료를\n요청하거나 금융기관, 수사기관, 법원 기타 관계기관 절차를 안내할 수\n있습니다.\n\n회원이 정당한 사유 없이 자료 제출을 거부하거나 제출기한을 지키지 않는\n경우 회사는 보유한 시스템 기록과 상대방 제출자료를 기준으로 판단할 수\n있으며, 그 결과 회원에게 불리한 조치가 이루어질 수 있습니다.\n\n제58조의21 (고객센터 접수 및 처리 기준)\n\n회원은 서비스 이용 중 문의, 신고, 환불, 사후처리, 초과입금 반환 요청,\n이용제한 이의제기, 개인정보 관련 요청, 계정 복구 요청이 필요한 경우\n고객센터 또는 회사가 정한 전자적 접수 방식으로 신청하여야 합니다.\n\n고객센터 접수 시 회원은 본인확인에 필요한 정보와 사건 확인에 필요한\n자료를 제출하여야 하며, 접수 내용이 불명확하거나 자료가 부족한 경우\n회사는 보완을 요청할 수 있습니다.\n\n회사는 접수된 문의 또는 신고를 합리적인 기간 내 처리하기 위하여\n노력하되, 사안의 복잡성, 거래 상대방의 자료 제출 여부, 금융기관 확인,\n외부기관 협조, 시스템 기록 확인 필요성에 따라 처리기간이 달라질 수\n있습니다.\n\n회원이 폭언, 협박, 반복적인 허위민원, 업무방해, 동일 내용의 과도한 반복\n접수, 직원 또는 다른 회원에 대한 모욕·비방을 하는 경우 회사는 고객센터\n이용을 제한하거나 필요한 조치를 할 수 있습니다.\n\n제58조의22 (서비스 종료·장기 중단 시 처리)\n\n회사가 서비스의 전부 또는 중요한 일부를 종료하거나 장기간 중단하는 경우\n회사는 종료 또는 중단 사유, 예정일, 회원이 보유한 포인트와 아이템의 처리\n기준, 환불 또는 교환 절차, 고객센터 접수 기간을 사전에 공지합니다. 다만\n긴급한 법령상 사유, 보안사고, 천재지변 등 불가피한 사유가 있는 경우 사후\n공지할 수 있습니다.\n\n서비스 종료 시 사용하지 않은 충전포인트는 본 약관 및 운영정책에서 정한\n절차에 따라 환불 대상이 될 수 있습니다. 교환포인트는 현금 환불 대상이\n아니므로 회사가 정한 서비스 내 사용, 재교환 또는 종료 정책에 따라\n처리됩니다.\n\n서비스 종료 또는 장기 중단 시 진행 중인 거래, 미입금 신고, 초과입금\n반환, 환불, 부정거래 조사, 분쟁처리는 종료 공지에서 정한 기간과 방법에\n따라 처리하며, 법령상 보관이 필요한 기록은 개인정보처리방침과 관련\n법령에 따라 보관됩니다.\n\n본 조는 회사가 언제든지 임의로 회원의 권리를 박탈할 수 있다는 의미가\n아니며, 서비스 운영이 불가능하거나 현저히 곤란한 경우 회원 보호를 위한\n절차를 명확히 하기 위한 조항입니다.\n\n제58조의23 (관련 법령 우선 적용 및 회원 권리 보장)\n\n본 약관의 어떤 조항도 전자상거래 등에서의 소비자보호에 관한 법률, 약관의\n규제에 관한 법률, 개인정보 보호법, 전자문서 및 전자거래 관련 법령, 민법,\n상법 등 관련 법령에 따라 회원에게 보장되는 권리를 부당하게 제한하는\n것으로 해석되지 않습니다.\n\n본 약관과 운영정책 또는 서비스 화면 안내가 서로 충돌하는 경우에는 본\n약관이 우선합니다. 다만 개인정보 처리에 관한 사항은 개인정보처리방침과\n개인정보 보호 관련 법령이 우선하며, 청약철회·환불 등 소비자 보호에 관한\n사항은 관련 법령상 강행규정이 우선합니다.\n\n회사는 약관 또는 운영정책의 일부 조항이 관련 법령 또는 행정기관의 판단에\n따라 수정이 필요한 경우 해당 조항을 법령에 맞게 변경할 수 있으며, 나머지\n조항은 계속 유효하게 적용됩니다.\n\n회원은 회사의 조치에 이의가 있는 경우 고객센터를 통해 이의제기할 수\n있으며, 회사의 답변에 만족하지 못하는 경우 관련 법령에 따른\n소비자분쟁조정, 수사기관 신고, 법원 절차 등 외부 구제수단을 이용할 수\n있습니다.\n\n제58조의24 (서비스 화면 표시와 약관의 관계)\n\n서비스 화면에 표시되는 거래금액, 포인트 차감액, 아이템명, 매칭번호, 입금\n가능 시간, 입금확인 가능 시간, 신고 가능 시간, 자동처리 예정 시간,\n2차매칭 진행 여부, 플랫폼 참여 거래 여부는 회원의 구체적인 거래에\n적용되는 중요한 정보입니다. 회원은 각 거래별 화면 표시를 확인한 후 거래\n절차를 진행하여야 합니다.\n\n서비스 화면의 개별 거래정보가 본 약관 또는 운영정책에서 정한 일반 기준을\n구체화하는 경우에는 해당 거래에 한하여 서비스 화면의 개별 안내가 우선\n적용될 수 있습니다. 다만 서비스 화면의 안내가 관련 법령 또는 본 약관의\n본질적 내용과 충돌하는 경우에는 관련 법령과 본 약관이 우선합니다.\n\n회사는 시스템 오류, 표시 오류, 계산 오류, 중복 매칭, 중복 포인트 지급,\n아이템 상태 오류 등 명백한 오류가 확인된 경우 회원에게 안내하고\n거래상태, 포인트, 아이템, 예약상태를 합리적인 범위에서 정정할 수\n있습니다.\n\n회원은 명백한 표시 오류 또는 시스템 오류를 인지하였음에도 이를 악용하여\n부당한 이익을 취하거나 다른 회원 또는 회사에 손해를 발생시켜서는 안\n됩니다.\n\n제58조의25 (전자상거래상 청약 및 계약성립 보강)\n\n포인트 충전, 유료서비스 신청, 아이템 교환 또는 회사가 제공하는 유료\n기능에 관하여 회원이 서비스 화면에서 신청 버튼을 누르고 결제 또는 포인트\n차감 절차가 완료된 경우 해당 절차에 관한 이용계약이 성립합니다.\n\n구매예약 및 판매예약은 회원이 매칭을 희망한다는 의사표시이며, 구매자와\n판매자 사이의 개별 거래는 회사의 매칭 시스템에 의해 거래 상대방,\n거래금액, 입금정보가 표시되고 회원이 정해진 절차를 이행하는 때에\n진행됩니다.\n\n회원 간 직접송금 거래에서는 회사가 결제대금을 보관하거나 정산하는 구조가\n아닐 수 있으며, 구매자가 판매자에게 직접 계좌이체하는 방식으로 거래가\n진행됩니다. 회사는 플랫폼과 절차를 제공하고 거래정보를 안내하며, 신고 및\n분쟁처리를 지원합니다.\n\n회사가 플랫폼 참여 거래로 직접 구매자 또는 판매자가 되는 경우에는 해당\n거래에 한하여 회사가 거래 당사자로서 본 약관과 운영정책에서 정한 책임을\n부담합니다.\n\n제58조의26 (청약철회 제한 사유의 구체화)\n\n회원이 포인트를 사용하여 즉시 실행되는 서비스, 자동예약, 매칭 절차,\n아이템 교환, 포인트교환, 행운구매, 소각합성(결합판매) 등 디지털 방식의\n서비스를 이용한 경우, 해당 서비스가 이미 제공되었거나 회원의 신청에 따라\n즉시 실행된 범위에서는 관련 법령상 허용되는 범위에서 청약철회 또는\n환불이 제한될 수 있습니다.\n\n회원이 충전포인트를 사용하지 않은 상태에서 환불을 신청하는 경우 회사는\n본인확인, 계좌확인, 결제내역 확인, 부정거래 여부 확인 후 환불을\n진행합니다. 다만 이미 사용된 충전포인트, 패널티로 차감된 포인트,\n부정거래와 관련된 포인트, 분쟁처리 중인 포인트는 환불이 제한되거나\n보류될 수 있습니다.\n\n교환포인트는 현금 환불 대상이 아니므로 회원이 교환포인트를 보유한\n상태에서 탈퇴하거나 서비스 이용을 중단하는 경우에도 현금 환불을 청구할\n수 없습니다. 다만 회사가 운영정책에서 별도로 정한 경우 아이템 재교환\n또는 서비스 내 사용 기회를 제공할 수 있습니다.\n\n회사는 청약철회 또는 환불 제한 사유가 있는 경우 그 사유를 회원에게\n안내하고, 회원이 이의가 있는 경우 고객센터를 통해 자료를 제출하여\n이의제기를 할 수 있도록 합니다.\n\n제58조의27 (미성년자 및 허위 성인정보 처리 보강)\n\n루페이 서비스는 만 19세 이상 성인 회원을 대상으로 합니다. 회사는\n회원가입 또는 서비스 이용 과정에서 생년월일, 이름, 휴대전화번호,\n본인확인 결과값, 계좌정보 등을 통해 성인 여부와 본인 여부를 확인할 수\n있습니다.\n\n회원이 허위 생년월일, 타인 명의, 타인 휴대전화번호, 타인 계좌정보,\n조작된 인증정보를 이용하여 가입하거나 서비스를 이용한 사실이 확인되는\n경우 회사는 계정 이용을 제한하고 거래, 포인트, 아이템, 환불, 분쟁처리를\n보류할 수 있습니다.\n\n미성년자 또는 허위 성인정보 이용자가 서비스를 이용하여 발생한 거래에\n대해서는 관련 법령, 거래 진행 상태, 상대방 회원의 선의 여부, 포인트 및\n아이템 상태, 회사의 고의·과실 여부를 종합하여 처리합니다.\n\n회사는 미성년자 보호와 부정가입 방지를 위하여 성인인증 방식, 본인확인\n방식, 계좌확인 방식, 가입 제한 기준을 변경할 수 있으며, 필요한 경우 추가\n자료 제출을 요청할 수 있습니다.\n\n제58조의28 (회사 직접구매와 수익보장 금지의 관계)\n\n회사가 1차매칭 및 2차매칭 후 미입금 거래에 대하여 플랫폼 참여 거래\n방식으로 직접 구매할 수 있다는 조항은 판매자 보호와 거래 안정화를 위한\n운영 장치입니다.\n\n회사의 직접구매 가능성이 존재하더라도 이는 회사가 모든 아이템의\n판매완료, 특정 판매가, 특정 수익, 차익, 원금 회수, 특정 기간 내 현금화를\n보장한다는 의미가 아닙니다.\n\n회사는 직접구매 대상과 제외 기준을 운영정책으로 정할 수 있으며,\n부정거래, 허위신고, 미확인 거래, 자료 미제출, 시스템 오류, 법령 위반\n의심, 계정 제한, 서비스 중단, 운영상 현저한 곤란이 있는 경우 직접구매를\n제한할 수 있습니다.\n\n회원은 회사 직접구매 조항을 투자보장, 원금보장, 확정수익, 고정수익 또는\n금융상품의 상환 약정으로 해석하여서는 안 됩니다.\n\n제58조의29 (분쟁자료 보존과 외부기관 협조)\n\n회사는 회원 간 거래 분쟁, 초과입금 반환, 미입금, 허위신고, 부정거래\n조사, 계정도용, 명의도용, 계좌도용, 이체영수증 조작과 관련하여 필요한\n범위에서 관련 자료를 보존할 수 있습니다.\n\n회원이 수사기관, 법원, 소비자분쟁조정기관, 금융기관 기타 외부기관에 신고\n또는 구제절차를 진행하는 경우 회사는 관련 법령과 개인정보처리방침에서\n허용되는 범위 내에서 자료 제출 또는 사실확인에 협조할 수 있습니다.\n\n회사는 외부기관의 적법한 요청이 있는 경우 관련 법령에 따라 회원정보,\n거래기록, 접속기록, 신고기록, 증빙자료를 제공할 수 있습니다. 이 경우\n회사는 관련 법령상 통지 제한이 있는 경우를 제외하고 필요한 범위에서\n회원에게 안내할 수 있습니다.\n\n회원은 분쟁 또는 법적 절차가 예상되는 경우 관련 이체내역, 영수증, 캡처,\n고객센터 상담내역, 거래번호, 매칭번호를 스스로 보관하여야 합니다.\n\n제58조의30 (약관 게시 전 최종 확인사항)\n\n회사는 본 약관을 서비스에 게시하기 전에 회사명, 대표자명,\n사업자등록번호, 통신판매업 신고번호, 주소, 고객센터, 전자우편, 시행일,\n개인정보처리방침 링크, 운영정책 링크 등 표시사항이 정확히 기재되었는지\n확인하여야 합니다.\n\n회사는 본 약관과 개인정보처리방침, 운영정책, 서비스 화면 안내, 회원가입\n동의 화면, 포인트 충전 화면, 구매예약 화면, 판매예약 화면, 매칭 결과\n화면, 신고 화면, 환불 신청 화면의 내용이 서로 충돌하지 않도록 점검하여야\n합니다.\n\n회사는 약관의 중요한 내용, 특히 수익 및 거래 결과 비보장, 충전포인트와\n교환포인트의 구분, 교환포인트 현금 환불 불가, 미입금 패널티, 초과입금\n반환 절차, 1차·2차매칭 및 회사 직접구매 제한, 개인정보 제3자 제공,\n이용제한 기준을 회원이 쉽게 확인할 수 있도록 표시하여야 합니다.\n\n본 약관은 서비스 운영 구조를 반영한 최종 약관 초안이며, 실제 게시 전에는\n회사의 사업자정보, 개인정보처리방침, 운영정책, 결제수단, 통신판매업 신고\n현황, 서비스 화면 구현 상태에 맞추어 최종 확인하여야 합니다.\n\n제58조의31 (운영정책 필수 연동사항)\n\n회사는 본 약관 시행과 동시에 운영정책에서 최소한 다음 사항을 구체적으로\n정하여야 합니다. 첫째, 구매예약 가능 시간과 판매예약 가능 시간, 둘째,\n1차매칭 진행 시간과 결과 확인 시간, 셋째, 구매자의 입금 가능 시간과\n입금완료 처리 방식, 넷째, 판매자의 입금확인 가능 시간과 신고 가능 시간,\n다섯째, 2차매칭 진행 기준과 제외 기준, 여섯째, 회사 직접구매의 대상과\n제한 사유, 일곱째, 포인트 사용순서와 환불 기준, 여덟째, 초과입금 반환\n절차와 자료 제출 기준입니다.\n\n운영정책은 본 약관의 내용을 구체화하는 문서이므로, 서비스 화면과\n운영정책의 내용이 서로 다르게 표시되지 않도록 회사는 게시 전 최종\n점검하여야 합니다. 특히 교환포인트의 현금 환불 불가, 회사 직접구매의\n제한 가능성, 미입금 패널티, 초과입금 반환 의무는 회원에게 명확히\n고지되어야 합니다.\n\n운영정책이 변경되는 경우 회사는 변경 내용과 시행일을 사전에 공지하고,\n회원에게 중대한 불이익이 있는 변경은 관련 법령에서 정한 절차에 따라 고지\n또는 동의 절차를 진행합니다.\n\n회원은 본 약관뿐 아니라 운영정책도 서비스 이용계약의 일부로 적용됨을\n확인하며, 운영정책에서 정한 시간, 자료 제출 방식, 신고 방식, 패널티\n기준을 준수하여야 합니다.\n\n제58조의32 (서비스 화면 구현과 회원 동의 절차)\n\n회사는 회원가입 화면에서 본 약관, 개인정보처리방침, 개인정보 수집·이용\n동의, 개인정보 제3자 제공 동의, 운영정책 동의, 만 19세 이상 여부 확인 등\n필수 동의 항목을 회원이 확인할 수 있도록 구성하여야 합니다.\n\n포인트 충전 화면에서는 충전포인트의 환불 가능성, 환불 제한 사유,\n결제수단별 처리 기간, 사용 후 환불 제한을 안내하여야 하며, 포인트교환\n또는 아이템 교환 화면에서는 교환포인트가 현금 환불 대상이 아니라는 점을\n명확히 안내하여야 합니다.\n\n구매예약 화면에서는 매칭 후 구매자의 입금 의무, 미입금 시 패널티,\n입금완료 처리 필요성, 이체영수증 제출 기준을 안내하여야 하며, 판매예약\n화면에서는 매칭 후에도 구매자 미입금이 발생할 수 있다는 점, 1차·2차매칭\n및 회사 직접구매의 적용 기준과 제한 사유를 안내하여야 합니다.\n\n초과입금 또는 오입금 신고 화면에서는 구매자가 제출해야 하는 자료,\n판매자의 자료 제출 의무, 확인된 초과입금 반환 의무, 반환 거부 시\n이용제한 가능성, 회사가 금액 회수를 보장하지 않는다는 점을 안내하여야\n합니다.\n\n제58조의33 (게시용 문서와 내부 운영문서의 구분)\n\n본 약관은 회원에게 공개되는 서비스 이용계약 조건이며, 회사의 내부 운영\n기준, 매칭 알고리즘, 부정거래 탐지 기준, 플랫폼 참여 거래의 세부 수량\n산정 방식 등 공개 시 서비스 안정성을 해칠 수 있는 정보는 내부 운영문서로\n별도 관리할 수 있습니다.\n\n다만 내부 운영문서가 회원의 권리·의무에 중대한 영향을 미치는 경우 회사는\n그 핵심 기준을 운영정책 또는 서비스 화면을 통해 회원이 이해할 수 있는\n수준으로 고지하여야 합니다.\n\n회사는 내부 운영문서를 이유로 본 약관 또는 관련 법령에서 정한 회원의\n권리를 부당하게 제한할 수 없습니다. 내부 운영문서와 본 약관이 충돌하는\n경우 회원에게 공개된 본 약관과 관련 법령이 우선합니다.\n\n회사는 서비스 운영 중 발생하는 미입금, 초과입금, 허위신고, 부정거래\n사례를 반영하여 운영정책과 내부 운영 기준을 지속적으로 개선할 수\n있습니다.\n\n제58조의34 (최종 게시 전 회사 확인 의무)\n\n회사는 본 약관을 실제 서비스에 게시하기 전에 회사의 실제 사업자정보,\n통신판매업 신고 여부, 고객센터 운영방식, 결제수단, 본인확인 방식,\n계좌확인 방식, 포인트 충전·환불 프로세스, 구매예약·판매예약 화면, 신고\n화면, 2차매칭 화면, 회사 직접구매 처리 화면이 본 약관의 내용과\n일치하는지 확인하여야 합니다.\n\n회사는 회원가입 화면과 서비스 주요 화면에서 회원이 본 약관과 운영정책을\n쉽게 확인할 수 있도록 링크 또는 게시 위치를 제공하여야 하며, 약관의\n중요한 내용을 회원이 인식할 수 있도록 별도 표시, 확인 체크박스, 팝업,\n안내문구 등 적절한 방법을 사용할 수 있습니다.\n\n회사는 실제 서비스 운영 중 약관과 다른 방식으로 서비스를 운영하게 되는\n경우, 즉시 약관 또는 운영정책을 정비하고 회원에게 변경사항을 안내하여야\n합니다. 약관과 서비스 화면이 장기간 불일치하는 경우 회원 분쟁과 규제\n위험이 발생할 수 있으므로 회사는 정기적으로 약관·운영정책·서비스 화면을\n점검하여야 합니다.\n\n본 조는 회원에게 새로운 의무를 부과하기 위한 조항이 아니라, 회사가 본\n약관을 실제 서비스에 적용하기 전에 내부적으로 확인하여야 할 사항을\n명확히 하여 회원 보호와 분쟁 예방을 강화하기 위한 조항입니다.\n\n제58조의35 (운영 초기 안정화 조치)\n\n회사는 서비스 초기 운영, 거래량 급증, 특정 아이템 또는 특정 단계의 예약\n쏠림, 미입금 증가, 신고 증가, 시스템 장애, 부정거래 의심 증가 등 서비스\n안정화가 필요한 경우 매칭 수량, 예약 가능 수량, 2차매칭 운영시간, 플랫폼\n참여 거래 수량, 포인트 사용 한도, 자동예약 실행 범위를 일시적으로 조정할\n수 있습니다.\n\n회사는 운영 초기 안정화 조치를 하는 경우 가능한 범위에서 그 사유와 적용\n기간을 공지합니다. 다만 부정거래 방지 또는 시스템 보호를 위하여 구체적인\n알고리즘, 탐지 기준, 내부 수량 산정 방식은 공개하지 않을 수 있습니다.\n\n운영 초기 안정화 조치는 회원에게 특정 수익이나 거래 결과를 보장하기 위한\n것이 아니라 서비스의 정상 작동과 회원 간 거래 지연을 줄이기 위한\n조치입니다. 회원은 안정화 조치로 인해 매칭 결과, 예약 처리, 판매 가능\n시점이 달라질 수 있음을 확인합니다.\n\n회사는 안정화 조치가 회원에게 불필요하게 과도한 불이익을 주지 않도록\n합리적인 범위에서 운영하며, 조치 사유가 해소된 경우 정상 기준으로\n복귀하도록 노력합니다.\n\n제58조의36 (반복 위반 회원에 대한 누적 관리)\n\n회사는 미입금, 금액 오류, 초과입금, 허위신고, 자료 제출 지연, 입금확인\n지연, 고객센터 업무방해, 다중계정 사용, 계좌정보 오류 등 위반행위가\n반복되는 회원에 대하여 누적 이력을 관리할 수 있습니다.\n\n반복 위반 이력은 2차매칭 참여 제한, 예약 가능 수량 제한, 포인트 사용\n제한, 환불 보류, 계정 일시정지, 영구 이용제한, 재가입 제한 등 운영정책상\n제재 판단에 활용될 수 있습니다.\n\n회사는 반복 위반 여부를 판단할 때 위반 횟수뿐 아니라 위반의 고의성, 피해\n규모, 상대방 회원에게 발생한 불편, 회사의 업무 부담, 자료 제출 협조\n여부, 사후 시정 여부를 함께 고려합니다.\n\n회원은 반복 위반으로 인한 제한에 이의가 있는 경우 고객센터를 통해\n이의제기할 수 있으며, 회사는 제출자료와 시스템 기록을 기준으로 제한\n유지, 완화 또는 해제 여부를 검토합니다.\n\n제58조의37 (정상 이용 회원 보호)\n\n회사는 정상적으로 예약, 입금, 입금확인, 신고, 자료 제출 의무를 이행하는\n회원이 반복 미입금자, 허위신고자, 증빙자료 조작자, 초과입금 반환 거부자\n등으로 인해 불필요한 손해나 불편을 겪지 않도록 운영정책과 시스템을\n개선할 수 있습니다.\n\n정상 이용 회원 보호를 위하여 회사는 미입금 이력이 있는 회원의 2차매칭\n참여를 제한하거나, 초과입금 반환 거부 회원의 판매예약을 제한하거나,\n허위신고 회원의 신고 기능을 제한할 수 있습니다.\n\n회사는 정상 이용 회원 보호 조치가 특정 회원에게 부당한 차별이 되지\n않도록 객관적 기준, 시스템 기록, 제출자료, 위반 이력에 근거하여\n판단합니다.\n\n회원 보호 조치와 관련한 세부 기준은 운영정책으로 정하며, 회사는 서비스\n운영 경험과 분쟁 사례를 반영하여 기준을 보완할 수 있습니다.\n\n회사는 분쟁 발생 시 가능한 범위에서 사실확인과 중재를 지원하지만, 회원의\n잘못된 송금, 자료 미제출, 신고 지연, 허위자료 제출, 계좌정보 오입력,\n약관 위반으로 인한 손해를 전부 보전하지 않습니다.\n\n제59조 (고객센터)\n\n1.  회원은 서비스 이용과 관련한 문의, 신고, 이의제기, 분쟁처리 요청을\n    고객센터를 통해 접수할 수 있습니다.\n\n2.  고객센터 운영시간, 접수방법, 처리기간, 제출자료 기준은 운영정책 및\n    서비스 화면의 안내에 따릅니다.\n\n3.  회사는 문의 내용의 사실확인, 분쟁처리 또는 부정거래 조사를 위하여\n    회원에게 추가 자료 제출을 요청할 수 있습니다.\n\n4.  회원이 폭언, 협박, 욕설, 반복적 허위민원, 업무방해를 하는 경우\n    회사는 고객센터 이용을 제한하거나 필요한 조치를 할 수 있습니다.\n\n제60조 (약관 외 준칙)\n\n1.  본 약관에서 정하지 않은 사항은 관련 법령, 운영정책,\n    개인정보처리방침, 서비스 화면의 안내 및 일반적인 거래 관행에\n    따릅니다.\n\n2.  회사는 개별 서비스에 대하여 별도의 약관 또는 정책을 둘 수 있으며,\n    해당 내용이 본 약관과 충돌하는 경우 별도 약관 또는 정책에서 달리\n    정한 경우를 제외하고 본 약관이 우선합니다.\n\n제61조 (분쟁 해결)\n\n1.  회사와 회원은 서비스 이용과 관련하여 분쟁이 발생한 경우 상호\n    협의하여 원만하게 해결하도록 노력합니다.\n\n2.  회원은 회사의 고객센터를 통해 분쟁 해결을 요청할 수 있으며, 회사는\n    합리적인 범위에서 사실확인과 조정을 지원합니다.\n\n3.  회원 간 직접송금 거래에서 발생한 분쟁은 원칙적으로 거래 당사자\n    사이에서 해결하여야 하며, 회사는 운영정책에 따른 중재 및 확인 절차를\n    지원할 수 있습니다.\n\n4.  회사와 회원 사이의 소송이 제기되는 경우 관할법원은 관련 법령에\n    따릅니다.\n\n제62조 (준거법)\n\n본 약관은 대한민국 법령에 따라 해석되고 적용됩니다.\n\n부칙\n\n제1조 (시행일)\n\n본 약관은 ______년 ______월 ______일부터 시행합니다.\n\n제2조 (기존 회원에 대한 적용)\n\n본 약관 시행일 이전에 가입한 회원에게도 본 약관이 적용됩니다. 다만,\n회원에게 불리하거나 중요한 변경사항이 있는 경우 회사는 관련 법령에 따라\n사전 고지 또는 동의 절차를 진행합니다.\n\n제3조 (운영정책과의 관계)\n\n본 약관은 회사와 회원 사이의 기본 계약으로 적용되며, 운영정책은 본\n약관에서 정한 내용을 구체화하는 세부 기준으로 적용됩니다. 본 약관과\n운영정책이 충돌하는 경우 본 약관이 우선 적용됩니다. 다만, 서비스\n이용방법, 시간 기준, 예약 수량, 매칭 절차, 패널티 기준, 신고 및 분쟁처리\n등 세부 운영사항은 운영정책에 따릅니다.\n\n문서 끝. 본 문서는 기존 이용약관 전체 조문을 기준으로 수정 TXT 반영사항\n및 법령상 유의사항을 삭제 없이 보강한 FINAL v3.6 전체본입니다. 추가 보강\n조항 포함." },
  policy: { title: '루페이 운영정책', checkId: 'agree-policy', text: "루페이 운영정책 FINAL v2.0\n\n서비스 게시용 전체본\n\n  -----------------------------------------------------------------------\n  구분                                내용\n  ----------------------------------- -----------------------------------\n  시행일                              ______년 ______월 ______일\n\n  회사명                              루페이 주식회사\n\n  서비스명                            루페이\n\n  대표자                              ____________________\n\n  사업자등록번호                      ____________________\n\n  통신판매업 신고번호                 ____________________\n\n  주소                                ____________________\n\n  고객센터                            ____________________\n\n  전자우편                            ____________________\n\n  운영정책 담당부서                   ____________________\n  -----------------------------------------------------------------------\n\n본 운영정책은 루페이 주식회사(이하 “회사”라 합니다)가 제공하는 루페이\n플랫폼, 웹사이트, 모바일 애플리케이션 및 이에 부수하는 포인트, 디지털\n거래 아이템, 구매예약, 판매예약, 매칭, 직접송금, 입금확인, 신고,\n분쟁처리, 패널티, 고객지원 기타 관련 서비스의 구체적인 이용 기준과 처리\n절차를 정한 문서입니다.\n\n회사는 루페이 서비스를 디지털 거래 아이템의 예약, 매칭, 직접송금,\n거래확인 및 사후처리를 지원하는 플랫폼 서비스로 운영하며, 대외 설명자료,\n서비스 화면, 광고물, 안내문에서 투자, 재테크, 원금보장, 수익보장,\n확정수익 등 오인될 수 있는 표현을 사용하지 않습니다.\n\n본 운영정책은 루페이 이용약관 및 개인정보처리방침을 보충하는 세부\n기준으로서, 이용약관에서 운영정책에 위임한 회원가입 및 계좌 등록 기준,\n서비스 이용 가능 시간, 구매예약 및 판매예약 방법, 매칭 방식, 매칭 실패\n처리, 플랫폼 참여 거래 기준, 포인트 충전·사용·교환·환불 기준, 레벨 및\n예약 가능 수량 기준, 자동예약 및 유료서비스 기준, 행운구매,\n소각합성(결합판매), 포인트교환 기준, 입금·입금확인·신고·자동처리 기준,\n미입금·금액 오류·허위신고·증빙자료 조작에 대한 패널티 기준, 분쟁처리 및\n사후처리 기준, 고객센터 운영 기준을 상세히 정합니다.\n\n본 운영정책은 회원에게 원금, 이자, 확정수익, 고정수익, 특정 기간 내\n회수, 특정 매칭률, 특정 판매완료율을 보장하기 위한 문서가 아닙니다. 본\n운영정책의 목적은 서비스 이용 절차를 명확히 하고, 회원 간 직접송금\n거래에서 발생할 수 있는 착오, 미입금, 오입금, 허위신고, 증빙자료 조작,\n계정도용, 명의도용, 계좌도용, 이상거래, 분쟁을 예방·처리하기 위한 기준을\n공개하는 데 있습니다.\n\n실제 게시 전 회사는 본 문서의 빈칸, 시간, 금액, 수수료, 포인트 단위,\n레벨별 수량, 고객센터 운영시간, 본인확인기관, 결제수단, 수탁사, 앱 화면\n문구, 신고 화면, 환불 화면, 개인정보 처리위탁 현황과 일치하는지 반드시\n최종 확인하여야 합니다.\n\n목차\n\n  • 제1장 총칙\n\n  • 제2장 회원가입·성인인증·계정관리\n\n  • 제3장 계좌 등록 및 직접송금 거래 기준\n\n  • 제4장 디지털 거래 아이템·구매예약·판매예약\n\n  • 제5장 매칭·입금·입금확인·신고·자동처리\n\n  • 제6장 2차매칭 및 플랫폼 참여 거래\n\n  • 제7장 포인트·환불·교환포인트·아이템 재교환\n\n  • 제8장 레벨·예약 가능 수량·자동예약\n\n  • 제9장 행운구매·소각합성(결합판매)·포인트교환\n\n  • 제10장 패널티·이용제한·부정거래 방지\n\n  • 제11장 신고·분쟁처리·자료제출·외부기관 협조\n\n  • 제12장 고객센터·공지·정책 변경·게시 전 점검\n\n  • 부속서 1 주요 시간표\n\n  • 부속서 2 패널티 기준표\n\n  • 부속서 3 서비스 화면 필수 고지문\n\n  • 부속서 4 약관·개인정보처리방침 대조 검수표\n\n제1장 총칙\n\n제1조 (목적)\n\n본 운영정책은 이용약관에서 정한 서비스 이용조건을 실제 서비스 화면과\n운영 절차에 맞게 구체화하여 회원이 루페이 서비스를 이용하기 전에 반드시\n확인하여야 할 세부 기준을 안내하는 것을 목적으로 합니다.\n\n본 운영정책은 회원 간 직접송금 거래 구조, 만 19세 이상 성인 전용 서비스\n구조, 디지털 거래 아이템의 예약·매칭·보유·판매 구조, 포인트의\n충전·사용·교환·환불 구조, 신고·분쟁처리·패널티 구조, 회사의 플랫폼 참여\n거래 구조를 전제로 작성됩니다.\n\n회사는 본 운영정책을 통해 서비스 이용 과정에서 발생할 수 있는 착오와\n분쟁을 줄이고, 회원의 자기책임 원칙, 회사의 중개 및 사후처리 범위,\n개인정보 처리 기준과의 관계를 명확히 합니다.\n\n제2조 (적용 범위)\n\n본 운영정책은 루페이 서비스에 가입하거나 서비스를 이용하는 모든 회원에게\n적용됩니다.\n\n본 운영정책은 회원가입, 성인인증, 계좌 등록, 포인트 충전·사용·교환·환불,\n디지털 거래 아이템의 구매예약·판매예약·매칭·보유·판매, 직접송금,\n입금확인, 신고, 자동처리, 2차매칭, 플랫폼 참여 거래, 행운구매,\n소각합성(결합판매), 포인트교환, 레벨, 자동예약, 패널티, 고객센터,\n분쟁처리 절차에 적용됩니다.\n\n회사가 별도 이벤트, 프로모션, 베타 기능, 임시 기능 또는 특정 아이템에\n대한 별도 안내를 게시하는 경우 해당 안내는 본 운영정책의 일부로\n적용됩니다. 다만 별도 안내가 이용약관 또는 관련 법령에 반하거나 회원에게\n부당하게 불리한 경우에는 적용되지 않을 수 있습니다.\n\n제3조 (다른 문서와의 관계)\n\n서비스 이용에 관한 기본 계약 조건은 이용약관이 우선 적용됩니다. 본\n운영정책은 이용약관을 보충하는 세부 운영 기준입니다.\n\n개인정보의 수집, 이용, 제공, 위탁, 보관, 파기, 정보주체 권리행사에\n관하여는 개인정보처리방침과 관련 법령이 우선 적용됩니다.\n\n본 운영정책과 이용약관이 충돌하는 경우 이용약관이 우선 적용됩니다. 본\n운영정책과 개인정보처리방침이 개인정보 처리에 관하여 충돌하는 경우\n개인정보처리방침 및 관련 법령이 우선 적용됩니다.\n\n서비스 화면 안내, 알림, 공지사항은 본 운영정책을 구체적으로 표시하기\n위한 수단입니다. 회원은 서비스 화면에서 안내되는 거래금액, 입금기한,\n입금확인기한, 신고기한, 패널티, 포인트 차감 여부를 반드시 확인하여야\n합니다.\n\n제4조 (용어의 정의)\n\n본 운영정책에서 사용하는 용어는 이용약관의 정의를 따릅니다. 특히 회사,\n서비스, 회원, 이용자, 구매자, 판매자, 디지털 거래 아이템, 수정, 루비,\n다이아, 포인트, 충전포인트, 교환포인트, 구매예약, 판매예약, 매칭,\n직접송금, 계좌정보, 플랫폼 참여 거래, 행운구매, 소각합성(결합판매),\n포인트교환, 2차매칭, 자동예약, 레벨, 패널티, 운영정책,\n개인정보처리방침의 의미는 이용약관에서 정한 바에 따릅니다.\n\n본 운영정책에서 “입금완료 처리”란 구매자가 판매자에게 거래대금을 송금한\n후 서비스 화면에서 입금완료 버튼을 누르거나 회사가 정한 방식으로 송금\n사실을 표시하는 절차를 말합니다.\n\n본 운영정책에서 “입금확인”이란 판매자가 실제 계좌 입금 여부, 입금자명,\n입금액, 입금시각을 확인한 후 서비스 화면에서 거래 정상 완료를 표시하는\n절차를 말합니다.\n\n본 운영정책에서 “신고”란 매칭 후 미입금, 금액 부족, 초과입금, 오입금,\n입금자명 불일치, 허위 송금, 증빙자료 조작, 계좌 오류, 계정도용 등 문제가\n발생한 경우 회원이 회사에 사실확인을 요청하는 절차를 말합니다.\n\n제5조 (중요 고지 및 비보장 원칙)\n\n루페이 서비스는 디지털 거래 아이템의 구매예약, 판매예약, 매칭, 직접송금,\n입금확인, 신고, 사후처리 절차를 제공하는 플랫폼형 서비스입니다.\n\n회사는 특정 회원에게 원금, 이자, 확정수익, 고정수익, 특정 기간 내 회수,\n특정 매칭률, 특정 판매완료율, 특정 금액의 차익 또는 환금성을 보장하지\n않습니다.\n\n루페이 서비스는 투자상품, 금융상품, 예금, 적금, 대출, 유사수신, 수익형\n상품이 아니며, 회원은 서비스 이용으로 인한 매칭 결과, 판매 완료, 차익\n발생, 회수 가능성 및 회수 시점을 스스로 판단하여야 합니다.\n\n본 서비스는 투자상품이 아니며, 원금 및 수익을 보장하지 않습니다.\n\n아이템의 가격 구조, 단계 구조, 보유기간, 판매 가능일, 매칭 가능성,\n미입금 가능성, 포인트 사용 및 환불 제한, 교환포인트의 현금 환불 불가,\n플랫폼 참여 거래의 제한 가능성은 회원이 서비스 이용 전에 반드시\n확인하여야 하는 중요사항입니다.\n\n회사는 중요한 내용을 서비스 화면, 가입 화면, 구매예약 화면, 판매예약\n화면, 매칭 결과 화면, 포인트 충전 화면, 환불 신청 화면, 신고 화면,\n공지사항에서 쉽게 확인할 수 있도록 노력합니다.\n\n제6조 (운영 원칙)\n\n회사는 서비스 안정성, 거래 균형, 부정거래 방지, 회원 보호, 법령 준수 및\n분쟁 예방을 위하여 합리적인 운영 기준을 정하고 이를 적용할 수 있습니다.\n\n회원은 본 운영정책, 이용약관, 개인정보처리방침, 서비스 화면 안내,\n공지사항을 확인하고 자신의 판단과 책임으로 서비스를 이용하여야 합니다.\n\n회원은 구매예약, 판매예약, 매칭, 입금, 입금완료 처리, 입금확인, 신고,\n이의제기, 환불 신청 등 각 절차의 시간 제한과 처리 기준을 준수하여야\n합니다.\n\n회사는 회원의 고의, 과실, 착오, 알림 미확인, 잘못된 계좌정보 입력, 타인\n명의 사용, 증빙자료 미제출, 허위신고, 자료 조작으로 발생한 불이익에\n대하여 회사의 고의 또는 중대한 과실이 없는 한 책임을 부담하지 않습니다.\n\n제2장 회원가입·성인인증·계정관리\n\n제7조 (회원가입 기본 기준)\n\n서비스는 만 19세 이상의 성인만 가입하고 이용할 수 있습니다.\n\n가입 신청자는 회사가 요구하는 필수정보를 정확하게 입력하고, 이용약관,\n운영정책, 개인정보처리방침, 개인정보 수집·이용 동의, 개인정보 제3자 제공\n동의, 만 19세 이상 확인, 계좌 등록 기준에 동의하여야 합니다.\n\n필수 입력정보에는 이름, 생년월일, 휴대전화번호, 계좌번호, 은행명,\n예금주명 또는 계좌명, 성인 여부 확인정보, 본인확인 결과값, 서비스 이용에\n필요한 인증정보가 포함될 수 있습니다.\n\n회사는 가입 신청자가 필수정보를 누락하거나 허위정보를 입력한 경우 가입\n승낙을 보류하거나 거절할 수 있습니다.\n\n제8조 (성인인증 및 본인확인 기준)\n\n회사는 성인 전용 서비스 제공, 미성년자 가입 제한, 타인 명의 가입 방지,\n부정거래 예방을 위하여 회원가입 또는 서비스 이용 과정에서 본인확인 및\n성인확인을 요구할 수 있습니다.\n\n본인확인 방식은 휴대전화 본인확인, 본인확인기관 인증, 계좌 예금주 확인,\n추가 증빙자료 제출, 서비스 화면 확인 절차 등 회사가 정한 방식으로 진행될\n수 있습니다.\n\n회원이 허위 생년월일, 타인 명의, 타인의 휴대전화번호, 타인의 계좌정보,\n조작된 인증정보를 이용한 사실이 확인되거나 의심되는 경우 회사는 계정\n이용을 제한하고 거래, 포인트, 아이템, 환불, 분쟁처리를 보류할 수\n있습니다.\n\n만 19세 미만인 자의 가입 또는 이용이 확인되거나 의심되는 경우 회사는\n해당 계정을 즉시 제한하고, 진행 중인 거래의 상태, 상대방 회원의 선의\n여부, 포인트 및 아이템 상태, 회사의 고의·과실 여부, 관련 법령을 종합하여\n사후처리합니다.\n\n제9조 (1인 1계정 및 중복가입 제한)\n\n회원은 원칙적으로 1인 1계정만 보유할 수 있습니다.\n\n동일인, 동일 휴대전화번호, 동일 계좌, 동일 본인확인값, 동일 기기, 동일\nIP, 동일 결제수단, 가족 또는 지인의 정보를 이용한 우회 가입이 의심되는\n경우 회사는 추가 확인을 요청할 수 있습니다.\n\n다중계정 또는 부정가입이 확인된 경우 회사는 해당 계정의 전부 또는 일부에\n대하여 로그인 제한, 구매예약 제한, 판매예약 제한, 포인트 사용 제한, 환불\n보류, 거래 제한, 탈퇴 처리, 재가입 제한, 패널티 부과를 할 수 있습니다.\n\n다중계정 또는 부정가입으로 발생한 거래 문제, 포인트 손실, 환불 제한,\n분쟁 및 제3자의 손해는 귀책사유가 있는 회원이 책임집니다.\n\n제10조 (계정 보안 및 회원 의무)\n\n회원은 자신의 계정, 비밀번호, 휴대전화, 인증수단, 계좌정보, 알림 수단을\n안전하게 관리하여야 합니다.\n\n회원은 자신의 계정을 제3자에게 양도, 대여, 담보 제공, 공유하거나 제3자가\n이용하게 하여서는 안 됩니다.\n\n계정 도용, 휴대전화 분실, 인증수단 유출, 타인의 무단 사용을 인지한\n회원은 즉시 회사에 알려야 합니다.\n\n회사는 계정 도용, 이상거래, 부정사용 우려가 있는 경우 로그인 제한, 거래\n제한, 본인확인, 계좌확인, 증빙자료 제출 요청을 할 수 있습니다.\n\n제11조 (회원정보 변경 및 최신성 유지)\n\n회원은 이름, 휴대전화번호, 계좌정보, 알림 수신 정보 등 서비스 이용에\n필요한 정보가 변경된 경우 지체 없이 회사가 정한 방법으로 수정하여야\n합니다.\n\n회원정보가 부정확하거나 오래되어 발생하는 입금 오류, 오입금, 환불 지연,\n알림 미수신, 거래 실패, 패널티, 신고 지연, 분쟁은 회원 본인이\n책임집니다.\n\n회사는 서비스 안정성 또는 부정거래 방지를 위하여 일정 기간마다 회원정보,\n본인확인, 계좌정보의 재확인을 요구할 수 있습니다.\n\n제3장 계좌 등록 및 직접송금 거래 기준\n\n제12조 (계좌 등록 원칙)\n\n회원은 서비스 이용을 위하여 원칙적으로 본인 명의의 계좌를 등록하여야\n합니다.\n\n회원의 이름과 예금주명은 원칙적으로 일치하여야 합니다. 개명, 띄어쓰기,\n외국인명 표기, 특수문자, 은행 표기 방식 차이 등으로 동일인 여부 확인이\n필요한 경우 회사는 추가 증빙자료 제출을 요청할 수 있습니다.\n\n타인 명의 계좌, 허위 계좌, 정상 송금이 어려운 계좌, 사고 신고 계좌,\n지급정지 계좌, 예금주 확인이 불가능한 계좌, 서비스 안정성을 해칠 우려가\n있는 계좌는 등록이 제한될 수 있습니다.\n\n회원이 잘못된 계좌정보를 입력하거나 타인 명의 계좌를 등록하여 발생한\n오입금, 환불 지연, 거래 실패, 패널티, 분쟁은 귀책사유가 있는 회원이\n책임집니다.\n\n제13조 (계좌 변경 기준)\n\n계좌 변경은 회사가 정한 절차에 따라 가능하며, 변경 가능 횟수, 변경 적용\n시점, 추가 본인확인 여부는 서비스 화면에서 안내합니다.\n\n매칭이 진행 중인 거래가 있는 경우 회사는 거래 안정성을 위하여 계좌\n변경을 제한하거나, 기존 매칭 거래에는 변경 전 계좌정보를 적용할 수\n있습니다.\n\n회원은 계좌 변경 전 진행 중인 구매예약, 판매예약, 매칭, 환불, 신고, 분쟁\n상태를 확인하여야 합니다.\n\n계좌 변경 직후 오입금, 입금자명 불일치, 환불 지연 또는 확인 지연이\n발생한 경우 회사는 회원에게 계좌확인 자료, 은행 거래내역, 이체확인증\n제출을 요청할 수 있습니다.\n\n제14조 (직접송금 거래의 기본 절차)\n\n루페이의 매칭 거래는 원칙적으로 구매자가 판매자에게 거래대금을 직접\n계좌이체하는 방식으로 진행됩니다.\n\n구매자는 매칭 화면에 표시된 판매자 정보, 계좌정보, 거래금액, 입금기한,\n입금완료 처리 방법, 증빙자료 제출 기준을 반드시 확인하여야 합니다.\n\n판매자는 자신의 계좌에 실제 입금되었는지 확인한 후 입금확인을 하여야\n하며, 입금액 부족, 초과입금, 입금자명 불일치, 미입금, 오입금이 있는 경우\n정해진 시간 내 신고하여야 합니다.\n\n회사는 회원 간 직접송금 거래에서 사실확인과 중재를 지원할 수 있으나,\n회사가 해당 거래의 직접 당사자로 참여한 경우를 제외하고 금융기관 송금의\n취소, 반환 또는 회수를 보장하지 않습니다.\n\n제15조 (송금 전 확인 의무)\n\n구매자는 송금 전 다음 사항을 반드시 확인하여야 합니다.\n\n  • 서비스 화면에 표시된 판매자 계좌의 은행명, 계좌번호, 예금주명\n\n  • 거래번호, 매칭번호, 아이템 종류, 거래금액\n\n  • 입금기한과 입금완료 처리기한\n\n  • 입금자명이 회원 본인명 또는 회사가 정한 표시 기준과 일치하는지 여부\n\n  • 동일 판매자에게 여러 건을 송금하는 경우 각 거래별 금액과 거래번호가\n  구분되는지 여부\n\n구매자가 송금 전 확인 의무를 이행하지 않아 발생한 금액 오류, 오입금, 타\n계좌 송금, 입금자명 불일치, 입금확인 지연, 패널티 또는 분쟁은 구매자에게\n귀책사유가 있는 범위에서 구매자가 책임집니다.\n\n제16조 (판매자의 계좌 관리 의무)\n\n판매자는 매칭 전후 자신의 등록 계좌가 정상적으로 입금 가능한 계좌인지\n확인하여야 합니다.\n\n판매자는 예금주명, 계좌번호, 은행명, 계좌 상태가 부정확하거나 변경된\n경우 즉시 수정하여야 합니다.\n\n판매자가 잘못된 계좌정보를 등록하여 구매자가 해당 정보대로 송금한 경우\n회사는 사실확인을 지원할 수 있으나, 오입금 반환 또는 회수가 보장되지\n않을 수 있습니다.\n\n판매자는 구매자의 입금 여부를 실제 계좌 기준으로 확인하여야 하며, 단순\n알림, 문자, 캡처, 상대방 진술만으로 입금확인을 해서는 안 됩니다.\n\n제4장 디지털 거래 아이템·구매예약·판매예약\n\n제17조 (디지털 거래 아이템의 성격)\n\n수정, 루비, 다이아 등은 서비스 내에서 회사가 정한 조건에 따라 구매,\n보유, 판매예약, 판매, 교환, 합성 또는 소각할 수 있는 디지털 거래\n아이템입니다.\n\n디지털 거래 아이템은 서비스 내 이용 단위이며, 회사가 명시적으로 허용하지\n않은 외부 거래, 양도, 담보 제공, 대여, 현금화, 계정 간 이전은\n금지됩니다.\n\n아이템의 종류, 가격, 단계, 인상률, 예약 조건, 보유기간, 판매 가능 시점,\n판매 방식, 교환 방식, 소각 또는 합성 기준은 서비스 화면 및 본 운영정책에\n따릅니다.\n\n회사는 아이템의 판매 성사, 가격 상승, 수익 발생, 차익, 환금성, 특정\n시점의 회수를 보장하지 않습니다.\n\n제18조 (구매예약 기준)\n\n회원은 보유 포인트, 레벨, 아이템 종류, 예약 가능 수량, 서비스 이용 상태,\n패널티 여부, 운영정책 준수 여부에 따라 구매예약을 신청할 수 있습니다.\n\n구매예약은 아이템 구매 의사를 표시하는 절차이며, 구매예약 신청만으로\n매칭 또는 구매가 완료되는 것은 아닙니다.\n\n구매예약 신청 후에는 원칙적으로 취소할 수 없습니다. 다만 회사의 시스템\n오류, 중복예약, 법령상 취소 필요, 회사가 인정하는 명백한 착오가 있는\n경우 회사는 예외적으로 취소 또는 정정할 수 있습니다.\n\n구매예약 시 포인트 차감 시점, 예약 가능 수량, 예약 제한 조건, 예약 유지\n조건, 매칭 우선순위는 서비스 화면의 안내와 본 운영정책에 따릅니다.\n\n제19조 (판매예약 기준)\n\n회원은 보유 아이템이 회사가 정한 보유기간 또는 판매 가능 조건을 충족한\n경우 판매예약을 신청할 수 있습니다.\n\n판매예약은 아이템 판매 의사를 표시하는 절차이며, 판매예약 신청 또는 매칭\n진행만으로 판매 완료가 보장되는 것은 아닙니다.\n\n판매예약 신청 후에는 원칙적으로 취소할 수 없습니다. 다만 시스템 오류,\n중복 판매예약, 법령상 필요, 회사가 인정하는 명백한 착오가 있는 경우\n회사는 예외적으로 취소 또는 정정할 수 있습니다.\n\n판매예약 가능 시점, 동일 날짜 아이템 처리 기준, 서로 다른 판매 가능일의\n판매예약 제한 기준, 판매예약 가능 수량, 판매예약 순서는 서비스 화면 및\n본 운영정책에 따릅니다.\n\n제20조 (보유기간 및 판매 가능일)\n\n아이템의 보유기간은 서비스 화면 또는 별도 공지에서 정한 기준에 따릅니다.\n기본 보유기간은 회사가 별도로 변경 공지하지 않는 한 4일을 기준으로\n운영할 수 있습니다.\n\n판매 가능일은 아이템 취득일, 매칭 완료일, 입금확인일, 보유기간, 서비스\n점검일, 휴일 운영 기준, 정책 변경에 따라 달라질 수 있습니다.\n\n보유기간 계산 방식은 서비스 화면에 표시된 기준을 우선하며, 시스템 점검,\n장애, 부정거래 조사, 계정 제한, 분쟁 발생 시 판매 가능일이 보류 또는\n조정될 수 있습니다.\n\n회원은 판매예약 전 서비스 화면에 표시된 판매 가능일과 판매예약 가능\n수량을 확인하여야 합니다.\n\n제21조 (예약 제한 사유)\n\n회사는 다음 사유가 있는 경우 구매예약 또는 판매예약을 제한하거나 보류할\n수 있습니다.\n\n  • 만 19세 미만 이용 또는 허위 성인정보 사용 의심\n\n  • 본인확인 또는 계좌확인이 완료되지 않은 경우\n\n  • 포인트 부족, 패널티 미납, 환불 또는 분쟁 진행 중인 경우\n\n  • 미입금, 허위신고, 증빙자료 조작, 부정거래 이력이 있는 경우\n\n  • 시스템 오류, 서비스 점검, 이상거래 탐지, 법령상 제한 사유가 있는\n  경우\n\n  • 아이템 보유기간 또는 판매 가능 조건을 충족하지 않은 경우\n\n예약 제한은 문제 해결 후 해제될 수 있으나, 위반의 정도가 중대한 경우\n회사는 추가 패널티 또는 영구 이용제한을 할 수 있습니다.\n\n제5장 매칭·입금·입금확인·신고·자동처리\n\n제22조 (매칭의 기본 원칙)\n\n매칭은 회사의 시스템이 구매예약과 판매예약을 기준으로 구매자와 판매자를\n연결하는 절차입니다.\n\n매칭 방식은 서비스 안정성, 거래 균형, 예약 순서, 아이템 종류, 레벨, 예약\n가능 수량, 판매 가능일, 미입금 이력, 부정거래 위험, 시스템 상태를\n고려하여 운영될 수 있습니다.\n\n회사는 매칭 결과, 매칭 시간, 매칭 수량, 판매 완료, 수익, 회수금액을\n보장하지 않습니다.\n\n매칭 기준은 부정거래 방지와 시스템 안정성을 위하여 전부 공개되지 않을 수\n있으나, 회원에게 중대한 영향을 미치는 기준은 서비스 화면 또는\n공지사항으로 안내합니다.\n\n제23조 (매칭 절차)\n\n구매예약과 판매예약이 회사가 정한 기준을 충족하면 시스템은 매칭을\n진행합니다.\n\n매칭이 완료되면 구매자에게 판매자의 계좌정보, 거래금액, 입금기한,\n입금완료 처리기준이 표시되고, 판매자에게 구매자 정보, 거래금액,\n입금확인기한, 신고기준이 표시될 수 있습니다.\n\n회원은 매칭 알림을 받은 즉시 서비스 화면에서 거래내용을 확인하여야\n합니다. 알림 미수신, 알림 지연, 앱 미접속, 휴대전화 오류 등으로 확인하지\n못한 경우에도 서비스 화면에 표시된 기한이 적용될 수 있습니다.\n\n회사는 시스템 장애, 외부 통신망 장애, 결제·인증 장애, 보안사고, 대량\n이상거래 발생 시 매칭을 일시 중단하거나 순서를 조정할 수 있습니다.\n\n제24조 (입금기한)\n\n구매자는 매칭 완료 후 서비스 화면에 표시된 입금기한 내에 판매자에게\n정확한 거래금액을 직접 송금하여야 합니다.\n\n입금기한은 서비스 화면에서 개별 거래별로 표시하며, 회사가 별도로 정하지\n않은 경우 기본 입금기한은 매칭 시점부터 ______분 또는 ______시간으로\n운영할 수 있습니다.\n\n입금기한이 경과한 경우 회사는 거래를 미입금 상태로 처리하고, 2차매칭,\n자동처리, 패널티, 구매예약 제한, 계정 제한을 적용할 수 있습니다.\n\n구매자가 입금기한 내 송금하였더라도 입금완료 처리를 하지 않거나 증빙자료\n제출이 필요한데 제출하지 않은 경우 거래처리가 지연되거나 미입금으로\n판단될 수 있습니다.\n\n제25조 (입금완료 처리)\n\n구매자는 판매자에게 거래대금을 송금한 후 즉시 서비스 화면에서 입금완료\n처리를 하여야 합니다.\n\n회사는 입금완료 처리 시 이체영수증, 송금확인증, 이체 화면 캡처,\n입금자명, 입금시각, 입금액 등 증빙자료 제출을 요구할 수 있습니다.\n\n구매자는 실제 송금하지 않았음에도 입금완료 처리를 하거나, 허위 캡처,\n조작된 영수증, 타 거래 영수증을 제출하여서는 안 됩니다.\n\n허위 입금완료 처리 또는 증빙자료 조작이 확인되는 경우 회사는 중대한\n위반으로 보아 패널티, 이용제한, 영구 이용제한, 손해배상 청구, 수사기관\n신고 등 필요한 조치를 할 수 있습니다.\n\n제26조 (입금확인 기준)\n\n판매자는 구매자의 입금완료 표시 또는 제출자료만으로 거래를 확정하지\n말고, 본인의 실제 계좌 입금내역을 확인한 후 입금확인을 하여야 합니다.\n\n판매자는 입금액, 입금자명, 입금시각, 계좌번호, 거래번호 또는 매칭번호를\n대조하여야 합니다.\n\n정상 입금이 확인되면 판매자는 서비스 화면에서 입금확인을 진행하여 거래를\n완료하여야 합니다.\n\n정상 입금이 확인되지 않거나 금액 오류, 입금자명 불일치, 초과입금,\n오입금, 허위증빙 의심이 있는 경우 판매자는 정해진 시간 내 신고하여야\n합니다.\n\n제27조 (신고 가능 시간 및 신고 의무)\n\n판매자는 입금확인 가능 시간 내 실제 입금 여부를 확인하고 문제가 있는\n경우 신고하여야 합니다.\n\n신고 가능 시간은 서비스 화면에서 개별 거래별로 표시하며, 회사가 별도로\n정하지 않은 경우 기본 신고 가능 시간은 입금기한 종료 후 ______분 또는\n______시간으로 운영할 수 있습니다.\n\n판매자가 신고 가능 시간 내 신고하지 않고 입금확인을 지연하거나 방치한\n경우 자동처리 기준에 따라 거래가 완료 또는 별도 상태로 처리될 수\n있습니다.\n\n판매자가 실제 입금을 받았음에도 허위로 미입금 신고를 하거나 입금확인을\n거부하는 경우 중대한 위반으로 처리될 수 있습니다.\n\n제28조 (자동처리 기준)\n\n회사는 정해진 시간 내 구매자 또는 판매자가 필요한 처리를 하지 않는 경우\n거래 안정성을 위하여 자동처리 기준을 적용할 수 있습니다.\n\n자동처리는 입금기한 경과, 입금완료 미처리, 입금확인 미처리, 신고기한\n경과, 신고자료 미제출, 거래상태 불명확, 시스템 기록과 회원 제출자료의\n불일치 등 사유가 있는 경우 적용될 수 있습니다.\n\n자동처리 결과에는 거래완료, 미입금 처리, 2차매칭 진행, 플랫폼 참여 거래\n검토, 포인트 보류, 아이템 보류, 패널티 부과, 추가자료 요청, 고객센터\n이관이 포함될 수 있습니다.\n\n자동처리 기준은 회원의 권리·의무에 영향을 미치는 중요 기준이므로 회사는\n서비스 화면 또는 공지사항을 통해 확인 가능하도록 안내합니다.\n\n제29조 (금액 오류 처리)\n\n구매자가 거래금액보다 적게 송금한 경우 회사는 금액 부족 거래로 처리할 수\n있으며, 구매자는 부족분 추가 송금, 증빙자료 제출, 판매자 확인 절차를\n완료하여야 합니다.\n\n구매자가 거래금액보다 많이 송금한 경우 초과입금으로 처리되며, 초과분\n반환은 구매자와 판매자 간 협의 및 금융기관 절차에 따라 진행됩니다.\n회사는 사실확인과 연락을 지원할 수 있으나 반환을 보장하지 않습니다.\n\n입금자명 불일치, 가족명의 송금, 법인명의 송금, 제3자 송금, 여러 거래\n합산 송금은 확인 지연 또는 분쟁의 원인이 될 수 있으므로 원칙적으로\n금지하거나 제한될 수 있습니다.\n\n금액 오류가 반복되는 회원에 대해서는 구매예약 제한, 입금완료 처리 제한,\n패널티, 추가 본인확인이 적용될 수 있습니다.\n\n제30조 (오입금 및 초과입금 반환 협조)\n\n회원이 잘못된 계좌로 송금하거나 초과입금한 경우 즉시 고객센터와 거래\n상대방에게 알려야 합니다.\n\n회사는 오입금 또는 초과입금과 관련하여 거래번호, 매칭번호, 계좌정보,\n입금액, 입금시각, 제출자료를 확인하고 양 당사자의 연락 및 사실확인을\n지원할 수 있습니다.\n\n오입금 또는 초과입금 반환은 원칙적으로 송금인과 수취인 및 금융기관\n절차에 따라 처리됩니다. 회사는 회사가 직접 수취한 금액이 아닌 한 반환을\n보장하지 않습니다.\n\n수취인이 명백한 초과입금 또는 오입금 사실을 알면서도 반환을 거부하거나\n지연하는 경우 회사는 이용제한, 패널티, 거래 제한, 외부기관 협조 등\n필요한 조치를 할 수 있습니다.\n\n제6장 2차매칭 및 플랫폼 참여 거래\n\n제31조 (2차매칭의 목적)\n\n2차매칭은 1차 매칭 이후 구매자의 미입금, 거래 미완료, 입금확인 지연,\n기타 회사가 정한 사유로 판매가 완료되지 않은 경우 판매자의 판매 완료\n가능성을 높이고 거래 흐름을 안정화하기 위한 보조 절차입니다.\n\n2차매칭은 모든 거래에 자동으로 보장되는 절차가 아니며, 서비스 상태,\n아이템 상태, 신고 및 분쟁 여부, 부정거래 의심 여부, 회사의 운영 가능성에\n따라 제한될 수 있습니다.\n\n2차매칭은 회원에게 판매 완료, 수익, 회수, 특정 매칭률을 보장하는 제도가\n아닙니다.\n\n제32조 (2차매칭 진행 기준)\n\n회사는 다음 사유가 있는 경우 2차매칭을 진행할 수 있습니다.\n\n  • 1차 매칭 후 구매자가 입금기한 내 입금하지 않은 경우\n\n  • 구매자가 입금완료 처리를 하지 않았고 실제 입금 확인도 어려운 경우\n\n  • 입금액 부족, 입금자명 불일치, 증빙자료 미제출로 거래 완료가 어려운\n  경우\n\n  • 판매자 보호 및 서비스 안정화를 위하여 추가 매칭이 필요하다고 회사가\n  판단한 경우\n\n다음 사유가 있는 경우 회사는 2차매칭을 보류하거나 제한할 수 있습니다.\n\n  • 판매자 또는 구매자의 부정거래, 허위신고, 자료조작 의심\n\n  • 아이템 상태 이상, 계정 제한, 본인확인 미완료, 계좌확인 미완료\n\n  • 시스템 장애, 법령상 제한, 수사·분쟁·외부기관 절차 진행\n\n  • 서비스 운영상 2차매칭이 거래 안정성을 해칠 우려가 있는 경우\n\n제33조 (플랫폼 참여 거래의 목적과 성격)\n\n플랫폼 참여 거래는 거래 안정화, 매칭률 조정, 구매예약과 판매예약의 균형\n유지, 1차·2차 매칭 후 미입금 거래의 사후처리, 판매자 보호 및 서비스\n운영상 필요를 위하여 회사가 구매자 또는 판매자의 지위에서 직접 참여하는\n거래를 말합니다.\n\n플랫폼 참여 거래는 회사가 모든 판매예약을 무조건 구매하거나 모든 미입금\n거래를 보전한다는 의미가 아닙니다.\n\n플랫폼 참여 거래는 회사의 운영 기능이며, 회원에게 원금, 이자, 확정수익,\n판매완료, 특정 기간 내 회수를 보장하는 제도가 아닙니다.\n\n회사는 플랫폼 참여 거래의 대상, 시점, 수량, 금액, 제외 기준, 제한 사유를\n서비스 안정성, 법령 준수, 부정거래 방지, 재무 및 운영 가능성을 고려하여\n정합니다.\n\n제34조 (플랫폼 참여 거래 적용 기준)\n\n회사는 다음 사유가 있는 경우 플랫폼 참여 거래를 검토할 수 있습니다.\n\n  • 1차 및 2차매칭 모두에서 구매자의 미입금 또는 거래 미완료가 발생한\n  경우\n\n  • 판매예약 수량이 과다하여 거래 균형 조정이 필요한 경우\n\n  • 회원 보호와 서비스 안정성을 위하여 회사의 직접 참여가 필요하다고\n  판단되는 경우\n\n  • 회사가 서비스 화면 또는 공지사항에서 별도로 정한 조건을 충족한 경우\n\n회사는 다음 사유가 있는 경우 플랫폼 참여 거래를 제한, 보류 또는 거절할\n수 있습니다.\n\n  • 판매자 또는 구매자의 부정거래, 허위신고, 증빙자료 조작, 미입금 반복\n\n  • 아이템 이상, 계정 제한, 본인확인 미완료, 계좌확인 미완료\n\n  • 분쟁, 수사, 법원·행정기관·금융기관 절차 진행\n\n  • 서비스 중단, 시스템 장애, 법령상 제한, 회사의 재무·운영상 불가피한\n  사유\n\n제35조 (플랫폼 참여 거래 처리 절차)\n\n회사가 구매자로 참여하는 경우 회사는 서비스 화면 또는 내부 처리 기준에\n따라 판매자의 계좌로 거래대금을 송금하거나, 회사가 정한 정산 방식으로\n처리할 수 있습니다.\n\n회사가 판매자로 참여하는 경우 회사는 회사 소유 또는 운영상 보유한\n아이템, 신규 발행 아이템, 사후처리용 아이템을 이용하여 거래 균형을\n조정할 수 있습니다.\n\n플랫폼 참여 거래에 필요한 개인정보 제공, 계좌정보 표시, 거래기록 보관은\n개인정보처리방침과 관련 법령에 따릅니다.\n\n플랫폼 참여 거래가 완료된 경우 해당 거래의 아이템 상태, 포인트 상태,\n거래기록, 신고 가능 여부는 일반 거래와 동일하거나 회사가 별도로 정한\n기준에 따릅니다.\n\n제7장 포인트·환불·교환포인트·아이템 재교환\n\n제36조 (포인트 종류 및 표시)\n\n회사는 충전포인트와 교환포인트를 구분하여 운영할 수 있습니다.\n\n충전포인트는 회원이 현금, 카드 또는 회사가 정한 결제수단으로 충전한\n포인트입니다.\n\n교환포인트는 회원이 보유 아이템을 포인트로 교환하거나 회사가 정한 아이템\n교환, 포인트교환, 이벤트, 보상, 정책상 조정 등의 방식에 따라 취득한\n포인트입니다.\n\n회원은 서비스 화면에서 포인트 종류, 잔액, 사용 가능 범위, 환불 가능\n여부, 사용 제한 여부를 확인하여야 합니다.\n\n제37조 (포인트 충전 기준)\n\n회원은 회사가 정한 결제수단과 절차에 따라 충전포인트를 충전할 수\n있습니다.\n\n충전 가능 금액, 최소 충전 단위, 최대 보유 한도, 결제수단, 충전 완료\n시점, 결제 취소 가능 여부는 서비스 화면에서 안내합니다.\n\n부정결제, 명의도용, 결제수단 도용, 환불 악용, 이상거래가 의심되는 경우\n회사는 포인트 충전 또는 사용을 제한하고 본인확인 또는 증빙자료 제출을\n요청할 수 있습니다.\n\n결제대행사, 카드사, 은행, 간편결제사, 통신사 등 외부기관의 장애 또는\n정책에 따라 충전이 지연되거나 제한될 수 있습니다.\n\n제38조 (포인트 사용 순서)\n\n충전포인트와 교환포인트를 함께 보유한 경우 포인트 사용순서는 서비스 화면\n또는 회사가 정한 기준에 따릅니다.\n\n회사는 회계처리, 환불처리, 부정거래 방지, 서비스 안정성, 회원 보호를\n위하여 사용순서를 구분할 수 있습니다.\n\n기본 사용순서는 회사가 별도로 달리 정하지 않는 한 교환포인트를 먼저\n사용하고, 부족분에 대하여 충전포인트를 사용할 수 있도록 운영할 수\n있습니다. 다만 환불 가능성, 유료서비스 성격, 패널티 납부, 아이템 재교환\n등 기능별로 다른 사용순서가 적용될 수 있습니다.\n\n회원은 구매예약, 자동예약, 패널티 납부, 아이템 재교환, 유료서비스 이용\n전에 어떤 포인트가 차감되는지 확인하여야 합니다.\n\n제39조 (충전포인트 환불)\n\n회원은 사용하지 않은 충전포인트에 대하여 회사가 정한 절차에 따라 환불을\n신청할 수 있습니다.\n\n충전포인트 환불은 원칙적으로 결제수단 취소 또는 회원 본인 명의 계좌 환불\n방식으로 처리됩니다.\n\n회사는 환불 전 본인확인, 계좌확인, 결제내역 확인, 포인트 사용내역 확인,\n부정거래 여부 확인, 미입금 또는 분쟁 상태 확인, 패널티 정산을 진행할 수\n있습니다.\n\n이미 사용된 충전포인트, 패널티로 차감된 포인트, 부정거래와 관련된\n포인트, 분쟁처리 중인 포인트, 법령상 지급 제한이 필요한 포인트는 환불이\n제한되거나 보류될 수 있습니다.\n\n환불 처리 기간은 회사가 정한 기준에 따르며, 결제수단 제공업체, 은행,\n카드사, 결제대행사 사정에 따라 지연될 수 있습니다.\n\n제40조 (교환포인트 처리)\n\n교환포인트는 현금으로 충전된 포인트가 아니므로 현금 환불 대상이\n아닙니다.\n\n교환포인트는 회사가 정한 범위 내에서 아이템 재교환, 구매예약, 유료서비스\n이용, 패널티 납부 또는 기타 서비스 내 용도로 사용할 수 있습니다.\n\n회원이 교환포인트를 보유한 상태에서 탈퇴하거나 서비스 이용을 중단하는\n경우에도 현금 환불을 청구할 수 없습니다.\n\n다만 회사가 운영정책 또는 서비스 화면에서 별도로 허용한 경우 회원은\n교환포인트를 아이템으로 재교환하거나 서비스 내 사용 기회를 제공받을 수\n있습니다.\n\n제41조 (아이템 재교환 기준)\n\n아이템 재교환은 교환포인트를 회사가 정한 조건에 따라 디지털 거래\n아이템으로 다시 전환하는 절차입니다.\n\n아이템 재교환 가능 수량, 필요 포인트, 재교환 가능 아이템 종류, 재교환\n신청 가능 시간, 재교환 후 보유기간 및 판매 가능일은 서비스 화면에서\n안내합니다.\n\n회사가 별도로 정하지 않는 한 아이템 재교환은 최소 40개 이상부터\n가능하며, 39개 이하의 수량은 재교환이 제한될 수 있습니다. 이 기준은\n서비스 화면에 명확히 표시하여야 합니다.\n\n아이템 재교환 신청 후에는 원칙적으로 취소할 수 없으며, 시스템 오류 또는\n회사가 인정하는 명백한 착오가 있는 경우 예외적으로 정정할 수 있습니다.\n\n제42조 (포인트 정정 및 보류)\n\n회사는 시스템 오류, 중복 지급, 잘못된 차감, 부정거래, 허위신고, 증빙자료\n조작, 결제 취소, 환불, 법령상 제한 사유가 있는 경우 포인트 잔액을 정정할\n수 있습니다.\n\n회사는 포인트 정정 전후 회원에게 정정 사유와 내역을 안내할 수 있습니다.\n다만 보안, 부정거래 조사, 법령상 제한이 있는 경우 안내가 제한될 수\n있습니다.\n\n분쟁, 신고, 수사, 계정도용, 명의도용, 계좌도용이 의심되는 경우 회사는\n포인트 사용, 교환, 환불을 일시 보류할 수 있습니다.\n\n보류 사유가 해소된 경우 회사는 포인트 사용 가능 상태 회복, 환불, 정정,\n패널티 차감, 아이템 재교환 가능 여부를 결정합니다.\n\n제8장 레벨·예약 가능 수량·자동예약\n\n제43조 (레벨 제도의 목적)\n\n회사는 거래 균형, 예약 수량 조정, 아이템 밸런스 유지, 서비스 안정성\n확보, 부정거래 방지를 위하여 회원별 레벨 제도를 운영할 수 있습니다.\n\n레벨은 서비스 이용 조건일 뿐 수익, 매칭 성공, 판매 완료, 특정 금액 회수,\n특정 기간 내 회수를 보장하는 기준이 아닙니다.\n\n레벨 기준은 예약 누적횟수, 예약 유지기간, 이용 상태, 패널티 여부,\n운영정책 준수 여부, 부정거래 위험, 서비스 안정성 등을 고려하여 산정될 수\n있습니다.\n\n제44조 (레벨 상승·하락·초기화 기준)\n\n레벨 상승은 회사가 정한 누적예약 기준, 예약 유지기간, 이용상태 조건을\n충족한 경우 적용될 수 있습니다.\n\n회원이 회사가 정한 기간 동안 예약을 유지하지 않거나 예약을 하지 않은\n경우 레벨이 하락하거나 1레벨로 초기화될 수 있습니다.\n\n기본 운영 기준은 회사가 별도로 변경하지 않는 한 1~2레벨은 무료 이용\n구간, 3레벨 이상은 유료 기능 또는 충전포인트 사용이 필요한 구간으로\n운영할 수 있습니다.\n\n회원이 4일 유지 조건을 충족하지 못하거나 하루라도 필수 예약 기준을\n이행하지 않은 경우 레벨이 1레벨로 초기화될 수 있습니다. 단, 시스템 장애,\n회사 귀책 사유, 회사가 인정하는 예외 사유가 있는 경우 조정할 수\n있습니다.\n\n레벨 상승·하락·초기화 기준은 회원에게 중대한 영향을 미칠 수 있으므로\n회사는 서비스 화면 또는 공지사항으로 안내합니다.\n\n제45조 (레벨별 예약 가능 수량)\n\n레벨별 구매예약 가능 수량, 판매예약 가능 수량, 아이템별 최소·최대 예약\n수량은 서비스 화면에서 안내합니다.\n\n회사는 거래 균형, 아이템 수량, 판매예약 과다, 구매예약 과다, 서비스\n안정성, 부정거래 위험에 따라 레벨별 예약 가능 수량을 조정할 수 있습니다.\n\n예약 가능 수량 조정은 사전 공지 후 적용하는 것을 원칙으로 하되, 긴급한\n보안사고, 시스템 장애, 부정거래 급증, 법령상 제한이 있는 경우 사후\n공지할 수 있습니다.\n\n회원은 예약 전 현재 레벨과 예약 가능 수량을 확인하여야 하며, 레벨\n변동으로 인한 예약 제한을 이유로 회사에 수익 또는 판매완료를 청구할 수\n없습니다.\n\n제46조 (자동예약의 성격)\n\n자동예약은 회원이 별도로 매일 예약 절차를 수행하지 않더라도 회사가 정한\n기준에 따라 구매예약 또는 판매예약을 자동으로 진행하는 유료서비스입니다.\n\n자동예약은 회원의 편의를 위한 기능이며, 자동예약을 이용하더라도 매칭\n성공, 판매 완료, 수익 발생, 특정 결과가 보장되지 않습니다.\n\n자동예약의 이용요금, 이용기간, 실행시간, 적용 범위, 사용 가능 포인트\n종류, 해지 및 환불 기준은 서비스 화면에서 안내합니다.\n\n자동예약 서비스의 이용요금, 포인트 차감 시점, 이용기간, 적용 범위 및\n해지 방법은 서비스 화면에 표시합니다.\n회원은 언제든지 자동예약 기능을 해지할 수 있으며, 해지 이후에는 신규\n자동예약이 진행되지 않습니다.\n이미 사용된 자동예약 서비스, 이미 진행된 예약, 이미 차감된 포인트에\n대하여는 환불되지 않을 수 있습니다.\n회사의 시스템 오류 또는 회사의 귀책사유로 자동예약 서비스가 정상\n제공되지 못한 경우 회사는 환불, 포인트 복구, 이용기간 연장 또는 이에\n상응하는 조치를 할 수 있습니다.\n\n회원의 단순 변심, 포인트 부족, 계정 제한, 레벨 미충족, 알림 미확인 또는\n회원 귀책사유로 인하여 자동예약이 진행되지 못한 경우 환불이 제한될 수\n있습니다.\n\n회원은 자동예약 설정 전 예약 대상, 수량, 포인트, 실행시간, 매칭 위험,\n취소 제한, 레벨 조건을 충분히 확인하여야 합니다.\n\n자동예약 유료서비스의 이용요금, 결제 또는 포인트 차감 시점, 이용기간,\n해지 가능 시점, 환불 가능 여부, 환불 제한 사유는 서비스 화면에 명확히\n표시합니다.\n\n회사의 귀책사유로 자동예약이 정상 제공되지 않은 경우에는 관련 법령 및\n운영정책에 따라 환불, 기간 연장 또는 이에 상응하는 조치를 할 수\n있습니다. 다만 회원의 설정 오류, 포인트 부족, 레벨 미충족, 계정 제한,\n알림 미확인 또는 단순 변심으로 인한 미사용은 환불이 제한될 수 있습니다.\n\n제47조 (자동예약 실행 및 실패 처리)\n\n자동예약은 회사가 정한 실행시간 또는 시스템 처리 순서에 따라 진행됩니다.\n\n다음 사유가 있는 경우 자동예약이 실행되지 않거나 일부만 실행될 수\n있습니다.\n\n  • 보유 포인트 부족, 사용 가능 포인트 종류 불일치\n\n  • 레벨 부족, 예약 가능 수량 초과, 계정 제한\n\n  • 아이템 판매 가능 조건 미충족, 보유기간 미충족\n\n  • 서비스 점검, 시스템 장애, 통신망 장애, 보안조치\n\n  • 회원의 자동예약 설정 오류 또는 해지\n\n자동예약 실패가 회사의 고의 또는 중대한 과실 없이 발생한 경우 회사는\n매칭 실패, 판매 지연, 레벨 변동, 예약 누락으로 인한 손해를 보상하지\n않습니다.\n\n제9장 행운구매·소각합성(결합판매)·포인트교환\n\n제48조 (행운구매 기준)\n\n행운구매는 회사가 정한 조건에 따라 2개의 아이템 구매가 이루어진 경우 그\n중 일부 또는 전부를 소각하고 상위 단계 또는 회사가 정한 조건의 아이템을\n생성하는 기능입니다.\n\n행운구매는 이벤트성 또는 정책상 조정 기능으로 운영될 수 있으며, 적용\n아이템, 적용 수량, 생성 아이템, 소각 아이템, 적용 시점은 서비스 화면에서\n안내합니다.\n\n행운구매에 따라 소각된 아이템은 원칙적으로 복구되지 않습니다. 다만\n시스템 오류, 명백한 처리 오류가 확인된 경우 회사는 정정할 수 있습니다.\n\n행운구매는 수익 또는 판매완료를 보장하는 기능이 아니며, 생성된 아이템의\n판매 가능일, 보유기간, 매칭 가능성은 별도 기준에 따릅니다.\n\n제49조 (소각합성(결합판매) 기준)\n\n소각합성(결합판매)은 회원이 보유한 동일 또는 회사가 정한 조건의 아이템을\n합성하여 새로운 아이템을 생성하거나 기존 아이템을 소각하는 기능입니다.\n\n소각합성(결합판매)의 기본 구조는 회사가 정한 2개 아이템 소각 후 1개\n아이템 생성 방식으로 운영될 수 있으며, 적용 조건은 아이템 종류, 단계,\n보유기간, 이벤트 여부, 서비스 안정성에 따라 달라질 수 있습니다.\n\n소각합성(결합판매)에 필요한 포인트, 수수료, 대상 아이템, 생성 아이템,\n부모 아이템 기록, 처리 완료 시점은 서비스 화면에서 안내합니다.\n\n회원은 소각합성(결합판매) 신청 전 소각 대상 아이템, 생성 아이템, 포인트\n차감, 취소 제한, 판매 가능일 변경 여부를 확인하여야 합니다.\n\n제50조 (포인트교환 기준)\n\n포인트교환은 회사가 정한 조건에 따라 아이템을 포인트 또는 회사가 정한\n서비스상 가치로 전환하는 절차입니다.\n\n포인트교환으로 발생한 포인트는 교환포인트로 분류되며, 현금 환불 대상이\n아닙니다.\n\n포인트교환 가능 아이템, 필요 수량, 최소 수량, 교환 비율, 처리 시점, 취소\n가능 여부는 서비스 화면에서 안내합니다.\n\n포인트교환 신청 후 처리 완료된 아이템은 원칙적으로 복구되지 않으며,\n교환포인트는 회사가 정한 서비스 내 용도로만 사용할 수 있습니다.\n\n제51조 (이벤트 및 정책상 조정)\n\n회사는 서비스 안정성, 거래 균형, 회원 보호, 오류 정정, 이벤트 운영을\n위하여 행운구매, 소각합성(결합판매), 포인트교환, 아이템 재교환 기준을\n일시적으로 조정할 수 있습니다.\n\n정책상 조정은 사전 공지 후 적용하는 것을 원칙으로 하며, 시스템 오류,\n보안사고, 부정거래 방지 등 긴급한 사유가 있는 경우 사후 공지할 수\n있습니다.\n\n이벤트 또는 정책상 조정은 모든 회원에게 동일한 조건으로 적용하는 것을\n원칙으로 하되, 레벨, 아이템 종류, 예약상태, 거래상태, 부정거래 여부에\n따라 적용 대상이 달라질 수 있습니다.\n\n회사는 이벤트 안내에서 참여 조건, 기간, 대상, 지급 또는 차감 기준, 취소\n또는 회수 기준, 개인정보 처리 기준을 명확히 안내합니다.\n\n제10장 패널티·이용제한·부정거래 방지\n\n제52조 (패널티의 목적)\n\n패널티는 미입금, 금액 오류, 허위신고, 이체영수증 조작, 부정거래,\n운영정책 위반 등으로부터 정상 이용 회원을 보호하고 서비스 안정성을\n유지하기 위한 제재 기준입니다.\n\n패널티는 위반행위의 유형, 고의성, 반복성, 피해 규모, 거래 상태, 자료\n제출 여부, 사후 협조 여부를 고려하여 적용됩니다.\n\n회사는 패널티 적용 전후 회원에게 사유를 안내할 수 있으며, 회원은 정해진\n기간 내 이의제기를 할 수 있습니다. 다만 긴급한 부정거래, 보안사고,\n법령상 제한이 있는 경우 선제적으로 이용제한을 할 수 있습니다.\n\n제53조 (패널티 유형)\n\n회사는 위반행위에 대하여 다음 조치를 단독 또는 병행하여 적용할 수\n있습니다.\n\n  • 경고 및 주의 안내\n\n  • 포인트 차감 또는 패널티 포인트 부과\n\n  • 구매예약 제한, 판매예약 제한, 자동예약 제한\n\n  • 입금완료 처리 제한, 신고 기능 제한 또는 추가 확인\n\n  • 포인트 사용·교환·환불 보류\n\n  • 아이템 보유·판매·교환 보류\n\n  • 계정 일시정지, 영구 이용제한, 재가입 제한\n\n  • 손해배상 청구, 수사기관 신고, 법원·행정기관·금융기관 협조\n\n패널티의 구체적 기준은 부속서 2 패널티 기준표에 따르며, 회사는\n위반행위의 정도에 따라 가중 또는 감경할 수 있습니다.\n\n제54조 (미입금 처리)\n\n구매자가 입금기한 내 정확한 거래금액을 송금하지 않은 경우 미입금으로\n처리될 수 있습니다.\n\n미입금이 발생한 경우 회사는 거래 취소, 2차매칭, 판매자 보호 조치, 구매자\n패널티, 구매예약 제한, 계정 제한을 적용할 수 있습니다.\n\n구매자가 실제 입금하였다고 주장하는 경우 이체확인증, 은행 거래내역,\n입금자명, 입금시각, 입금액을 제출하여야 합니다.\n\n반복 미입금 또는 고의 미입금이 확인되는 경우 중대한 위반으로 보아 영구\n이용제한 또는 재가입 제한이 적용될 수 있습니다.\n\n제55조 (허위신고 및 입금확인 거부)\n\n판매자가 실제 입금을 받았음에도 허위로 미입금 신고를 하거나 입금확인을\n거부하는 행위는 중대한 위반입니다.\n\n허위신고가 확인되는 경우 회사는 판매예약 제한, 포인트 보류, 아이템 보류,\n패널티, 계정정지, 영구 이용제한, 손해배상 청구 등 필요한 조치를 할 수\n있습니다.\n\n구매자가 허위로 입금완료 처리를 하거나 조작된 증빙자료를 제출한 경우에도\n중대한 위반으로 처리됩니다.\n\n허위신고 또는 허위 입금완료 처리로 상대방 회원 또는 회사에 손해가 발생한\n경우 귀책사유가 있는 회원은 그 손해를 배상할 책임이 있습니다.\n\n제56조 (증빙자료 조작 금지)\n\n회원은 이체영수증, 송금확인증, 은행 거래내역, 캡처, 신분확인자료,\n계좌확인자료, 고객센터 제출자료를 위조, 변조, 편집, 합성, 일부 삭제,\n허위 제출하여서는 안 됩니다.\n\n증빙자료 조작이 의심되는 경우 회사는 원본자료, 은행 발급자료, 추가 캡처,\n화면 녹화, 거래경위서, 본인확인, 계좌확인을 요청할 수 있습니다.\n\n증빙자료 조작이 확인된 경우 회사는 즉시 거래 제한, 포인트 및 아이템\n보류, 영구 이용제한, 손해배상 청구, 수사기관 신고 등 필요한 조치를 할 수\n있습니다.\n\n회사는 자료 조작 여부를 판단하기 위하여 제출시각, 파일정보, 화면정보,\n거래번호, 매칭번호, 은행 거래내역, 상대방 진술, 시스템 로그를 종합적으로\n확인할 수 있습니다.\n\n제57조 (부정거래 및 이상거래)\n\n부정거래 또는 이상거래에는 다중계정, 명의도용, 계좌도용, 가족·지인 계정\n동원, 시세 또는 매칭 조작, 허위 예약, 반복 미입금, 허위신고, 증빙자료\n조작, 시스템 우회, 자동화 프로그램 사용, 회사의 운영을 방해하는 행위가\n포함됩니다.\n\n회사는 부정거래 또는 이상거래가 의심되는 경우 계정, 포인트, 아이템,\n예약, 매칭, 환불, 신고, 자동예약, 플랫폼 참여 거래를 일시 제한하고\n필요한 자료 제출을 요청할 수 있습니다.\n\n부정거래가 확인된 경우 회사는 거래 취소, 포인트 회수, 아이템 회수,\n패널티, 이용제한, 영구 이용제한, 재가입 제한, 손해배상 청구, 외부기관\n협조를 할 수 있습니다.\n\n부정거래 방지를 위한 세부 탐지 기준은 악용 방지를 위하여 공개하지 않을\n수 있습니다.\n\n제58조 (이용제한의 절차와 이의제기)\n\n회사는 이용제한을 하는 경우 제한 사유, 제한 범위, 제한 기간, 이의제기\n방법을 회원에게 안내할 수 있습니다.\n\n회원은 이용제한 통지를 받은 날부터 ______일 이내에 고객센터를 통해\n이의제기를 할 수 있습니다.\n\n회사는 이의제기 자료, 시스템 기록, 거래자료, 상대방 진술, 금융자료,\n개인정보처리방침상 보관자료를 검토하여 이용제한 유지, 해제, 감경, 가중\n여부를 결정합니다.\n\n긴급한 부정거래, 보안사고, 법령 위반, 수사기관 요청, 회원 또는 제3자의\n피해 확대 우려가 있는 경우 회사는 이의제기 전에도 선제적으로 이용제한을\n적용할 수 있습니다.\n\n제11장 신고·분쟁처리·자료제출·외부기관 협조\n\n제59조 (신고 접수 기준)\n\n회원은 거래와 관련하여 미입금, 금액 오류, 초과입금, 오입금, 입금자명\n불일치, 허위 송금, 증빙자료 조작, 계좌 오류, 계정도용, 명의도용,\n계좌도용, 시스템 오류가 발생한 경우 고객센터 또는 서비스 내 신고 기능을\n통해 신고할 수 있습니다.\n\n신고 시 회원은 거래번호, 매칭번호, 아이템 종류, 거래금액, 입금시각,\n입금자명, 계좌정보, 이체영수증, 은행 거래내역, 문제 상황 설명을\n제출하여야 합니다.\n\n회사는 신고 내용이 불명확하거나 자료가 부족한 경우 추가자료 제출을\n요청할 수 있습니다.\n\n회원이 정해진 기간 내 자료를 제출하지 않거나 허위자료를 제출한 경우\n회사는 시스템 기록과 보유자료를 기준으로 처리할 수 있습니다.\n\n제60조 (분쟁처리 원칙)\n\n회원 간 분쟁은 원칙적으로 당사자 간 해결을 기본으로 하며, 회사는 서비스\n운영자 및 거래중개자로서 사실확인, 자료 확인, 연락 지원, 거래상태 조정,\n패널티 적용, 외부기관 협조를 지원할 수 있습니다.\n\n회사는 법원, 수사기관, 금융기관, 소비자분쟁조정기관 등 권한 있는 기관의\n판단을 대체하지 않습니다.\n\n회사는 제출자료, 시스템 기록, 입금내역, 계좌정보, 회원 진술, 고객센터\n상담내역, 접속기록, 기존 위반 이력을 종합하여 합리적으로 판단합니다.\n\n분쟁처리 결과에 따라 회사는 거래완료, 거래보류, 2차매칭, 플랫폼 참여\n거래 검토, 포인트 보류 또는 정정, 아이템 보류 또는 정정, 패널티 부과,\n계정 제한을 할 수 있습니다.\n\n제61조 (자료 제출 및 보관)\n\n회사는 신고, 분쟁처리, 부정거래 조사, 환불, 초과입금 반환, 외부기관\n협조를 위하여 필요한 범위에서 회원에게 자료 제출을 요청할 수 있습니다.\n\n제출자료에는 이체영수증, 송금확인증, 은행 거래내역, 계좌거래내역,\n계좌확인자료, 본인확인자료, 캡처, 화면녹화, 거래경위서, 고객센터\n대화내역이 포함될 수 있습니다.\n\n회사는 제출자료를 개인정보처리방침에서 정한 목적과 보유기간 범위 내에서\n처리하며, 분쟁 또는 법적 절차가 계속 중인 경우 해당 사유가 해소될 때까지\n보관할 수 있습니다.\n\n회원은 분쟁 또는 법적 절차가 예상되는 경우 본인의 이체내역, 영수증,\n캡처, 고객센터 상담내역, 거래번호, 매칭번호를 스스로 보관하여야 합니다.\n\n제62조 (외부기관 협조)\n\n회원이 수사기관, 법원, 행정기관, 소비자분쟁조정기관, 금융기관 기타\n외부기관에 신고 또는 구제절차를 진행하는 경우 회사는 관련 법령과\n개인정보처리방침에서 허용되는 범위 내에서 자료 제출 또는 사실확인에\n협조할 수 있습니다.\n\n외부기관의 적법한 요청이 있는 경우 회사는 회원정보, 거래기록, 접속기록,\n신고기록, 증빙자료를 제공할 수 있습니다.\n\n회사는 법령상 통지 제한이 있는 경우를 제외하고 필요한 범위에서 회원에게\n외부기관 요청 또는 자료제공 사실을 안내할 수 있습니다.\n\n회사는 외부기관의 최종 판단 또는 금융기관의 송금 반환 결과를 보장하지\n않습니다.\n\n제63조 (처리기간)\n\n회사는 신고 또는 분쟁 접수 후 가능한 한 신속하게 처리합니다.\n\n일반 문의는 접수일로부터 ______영업일 이내, 거래분쟁은 자료가 모두\n제출된 날부터 ______영업일 이내, 복잡한 분쟁 또는 외부기관 확인이 필요한\n사안은 ______영업일 이상 소요될 수 있습니다.\n\n자료 미제출, 회원 연락 불가, 금융기관 확인 지연, 외부기관 절차 진행,\n시스템 장애, 대량 신고 발생 시 처리기간은 연장될 수 있습니다.\n\n회사는 처리기간이 연장되는 경우 가능한 범위에서 회원에게 사유를\n안내합니다.\n\n제12장 고객센터·공지·정책 변경·게시 전 점검\n\n제64조 (고객센터 운영)\n\n고객센터의 운영시간, 접수 방법, 처리 순서, 휴무일, 긴급 신고 접수 기준은\n서비스 화면에서 안내합니다.\n\n고객센터는 회원 본인확인 후 상담을 진행할 수 있으며, 개인정보 보호를\n위하여 본인이 아닌 제3자에게 계정정보, 거래정보, 신고정보를 제공하지\n않습니다.\n\n회원은 고객센터 문의 시 거래번호, 매칭번호, 아이템 종류, 발생일시, 문제\n내용, 증빙자료를 정확히 제출하여야 합니다.\n\n욕설, 협박, 반복 민원, 허위 신고, 업무방해, 상담원 보호가 필요한 행위가\n있는 경우 회사는 상담을 제한하거나 법적 조치를 검토할 수 있습니다.\n\n제65조 (공지 및 알림)\n\n회사는 서비스 운영에 필요한 공지사항을 앱 알림, 문자메시지, 전자우편,\n서비스 화면, 웹사이트, 고객센터 안내 등 합리적인 방법으로 안내할 수\n있습니다.\n\n회원에게 불리하거나 중요한 정책 변경, 패널티 기준 변경, 포인트 환불 기준\n변경, 레벨 기준 변경, 플랫폼 참여 거래 기준 변경, 개인정보 처리 변경이\n있는 경우 회사는 관련 법령과 이용약관에 따라 사전 고지합니다.\n\n회원은 알림 수신 설정, 휴대전화번호, 전자우편, 앱 권한을 최신 상태로\n유지하여야 합니다.\n\n회원이 알림을 확인하지 않아 발생한 불이익은 회사의 고의 또는 중대한\n과실이 없는 한 회원 본인이 책임집니다.\n\n제66조 (운영정책 변경)\n\n회사는 관련 법령을 위반하지 않는 범위에서 서비스 안정성, 거래 균형,\n부정거래 방지, 회원 보호, 기능 개선, 법령 준수를 위하여 본 운영정책을\n변경할 수 있습니다.\n\n회원에게 불리하거나 중요한 변경이 있는 경우 회사는 시행일 전 상당한 기간\n동안 변경 내용, 변경 사유, 시행일을 공지합니다.\n\n긴급한 보안사고, 시스템 장애, 부정거래 급증, 법령상 요구, 외부기관 요청\n등 사유가 있는 경우 회사는 사후 공지할 수 있습니다.\n\n회원이 변경 운영정책 시행 후 서비스를 계속 이용하는 경우 관련 법령상\n별도 동의가 필요한 경우를 제외하고 변경 운영정책에 동의한 것으로 볼 수\n있습니다.\n\n제67조 (서비스 화면과 문서의 일치)\n\n회사는 서비스 화면, 이용약관, 개인정보처리방침, 운영정책, 회원가입 동의\n화면, 포인트 충전 화면, 구매예약 화면, 판매예약 화면, 매칭 결과 화면,\n신고 화면, 환불 신청 화면의 내용이 서로 충돌하지 않도록 점검하여야\n합니다.\n\n서비스 화면에는 최소한 거래금액, 입금기한, 입금확인기한, 신고기한,\n포인트 차감 여부, 환불 가능 여부, 교환포인트 현금 환불 불가, 미입금\n패널티, 허위신고 패널티, 플랫폼 참여 거래 제한 가능성을 표시하여야\n합니다.\n\n문서와 화면 사이에 차이가 발생한 경우 회사는 지체 없이 정정하고,\n회원에게 중대한 영향을 미치는 사항은 별도 공지합니다.\n\n회원은 거래 전 서비스 화면에 표시된 최신 정보를 확인하여야 합니다.\n\n제68조 (면책의 한계)\n\n본 운영정책의 어떠한 조항도 회사의 고의 또는 중대한 과실로 인한 법률상\n책임을 배제하지 않습니다.\n\n회사는 회원 간 직접송금 거래에서 회사가 직접 당사자로 참여한 경우를\n제외하고 금융기관 송금 취소, 반환, 회수를 보장하지 않습니다.\n\n회사는 천재지변, 전쟁, 화재, 정전, 통신망 장애, 결제망 장애, 인증기관\n장애, 클라우드 장애, 법령상 제한, 외부기관 조치 등 회사의 합리적 통제\n범위를 벗어난 사유로 발생한 손해에 대하여 관련 법령상 책임이 없는\n범위에서 책임을 부담하지 않습니다.\n\n회사는 수익, 차익, 판매 완료, 매칭 성공, 회수 가능성을 보장하지 않으며,\n회원은 서비스의 위험과 구조를 확인한 후 이용 여부를 결정하여야 합니다.\n\n부속서 1 주요 시간표\n\n  -----------------------------------------------------------------------\n  항목                    기본 기준               서비스 게시 전 확정\n                                                  필요사항\n  ----------------------- ----------------------- -----------------------\n  매칭 진행 시간          회사 시스템 기준에 따라 일별 매칭 시작·종료\n                          진행                    시간 입력\n\n  구매자 입금기한         매칭 화면에 표시된 기한 기본 ______분/시간 확정\n\n  입금완료 처리기한       송금 후 즉시 처리       처리 지연 시 미입금\n                                                  판단 기준 확정\n\n  판매자 입금확인기한     입금확인 화면에 표시된  기본 ______분/시간 확정\n                          기한                    \n\n  신고 가능 시간          입금확인 가능 시간 내   기본 ______분/시간 확정\n                          신고                    \n\n  2차매칭 진행            1차 매칭 미완료 후 회사 진행 시점·횟수·제외\n                          기준에 따라 진행        기준 확정\n\n  플랫폼 참여 거래        1차·2차 매칭 실패 등    대상·제한·보류 기준\n                          회사 기준 충족 시 검토  확정\n\n  고객센터 처리           접수 순서 및 긴급도     운영시간·처리기간 확정\n                          기준                    \n  -----------------------------------------------------------------------\n\n부속서 2 패널티 기준표\n\n  -------------------------------------------------------------------------\n  위반 유형           예시              가능 조치         가중 사유\n  ------------------- ----------------- ----------------- -----------------\n  미입금              입금기한 내       경고, 포인트      반복, 고의,\n                      미송금, 입금완료  차감, 구매예약    다중계정\n                      미처리            제한, 계정정지    \n\n  금액 오류           부족 입금,        정정 요청, 거래   반복, 자료 미제출\n                      초과입금,         보류, 패널티,     \n                      거래번호 혼동     예약 제한         \n\n  허위 입금완료       송금 없이         즉시 제한,        증빙자료 조작,\n                      입금완료 처리, 타 포인트·아이템     피해 발생\n                      거래 영수증 제출  보류, 영구정지    \n\n  허위신고            실제 입금 수령 후 판매예약 제한,    반복, 피해 발생,\n                      미입금 신고       패널티, 영구정지  고의\n\n  증빙자료 조작       캡처 편집, 영수증 영구정지,         조직적 행위, 금액\n                      위조, 은행내역    손해배상,         큼\n                      변조              외부기관 협조     \n\n  다중계정            동일인 복수 계정, 계정 통합 제한,   수익 조작, 패널티\n                      지인 명의 우회    전체 계정 정지,   회피\n                                        재가입 제한       \n\n  계좌도용·명의도용   타인 계좌·명의    즉시 제한, 환불   피해 발생, 문서\n                      사용              보류, 외부기관    위조\n                                        협조              \n\n  업무방해            반복 허위민원,    상담 제한,        상담원 피해,\n                      협박, 시스템 악용 이용제한, 법적    서비스 장애\n                                        조치              \n  -------------------------------------------------------------------------\n\n부속서 3 서비스 화면 필수 고지문\n\n1. 회원가입 화면 필수 고지\n\n본 서비스는 만 19세 이상 성인만 이용할 수 있습니다. 허위 생년월일, 타인\n명의, 타인 휴대전화번호, 타인 계좌정보로 가입하는 경우 계정 제한, 거래\n보류, 환불 보류, 패널티 및 법적 조치가 이루어질 수 있습니다.\n\n회원은 이용약관, 운영정책, 개인정보처리방침, 개인정보 수집·이용 동의,\n개인정보 제3자 제공 동의, 만 19세 이상 확인에 동의하여야 서비스를 이용할\n수 있습니다.\n\n2. 구매예약 화면 필수 고지\n\n구매예약은 매칭을 보장하지 않으며, 매칭 후 구매자는 표시된 기한 내\n정확한 금액을 판매자에게 직접 송금하고 입금완료 처리를 하여야 합니다.\n\n미입금, 금액 오류, 허위 입금완료, 증빙자료 조작 시 패널티 및 이용제한이\n적용될 수 있습니다.\n\n3. 판매예약 화면 필수 고지\n\n판매예약은 판매 완료를 보장하지 않습니다. 매칭 후 판매자는 실제 계좌\n입금 여부를 확인하고, 문제가 있는 경우 신고 가능 시간 내 신고하여야\n합니다.\n\n실제 입금을 받았음에도 허위신고를 하거나 입금확인을 거부하는 경우 패널티\n및 이용제한이 적용될 수 있습니다.\n\n4. 포인트 화면 필수 고지\n\n충전포인트는 사용하지 않은 잔액에 한하여 회사가 정한 절차에 따라 환불\n신청이 가능할 수 있습니다.\n\n교환포인트는 현금 환불 대상이 아니며, 회사가 정한 서비스 내 사용 또는\n아이템 재교환 대상입니다. 아이템 재교환은 회사가 정한 최소수량 및 조건을\n충족하여야 합니다.\n\n5. 매칭 결과 화면 필수 고지\n\n구매자는 송금 전 판매자의 계좌정보, 거래금액, 입금기한을 반드시\n확인하여야 합니다.\n\n판매자는 입금확인 전 실제 계좌 입금내역을 반드시 확인하여야 하며, 입금액\n부족, 초과입금, 입금자명 불일치, 미입금 등 문제가 있는 경우 정해진 시간\n내 신고하여야 합니다.\n\n부속서 4 약관·개인정보처리방침 대조 검수표\n\n  --------------------------------------------------------------------------------\n  검수 항목               운영정책 반영 여부               게시 전 확인사항\n  ----------------------- -------------------------------- -----------------------\n  운영정책의 법적 지위    이용약관 보충문서로 명시         약관 링크와 동시 게시\n\n  성인 전용 및 본인확인   회원가입·성인인증 기준 반영      본인확인기관·화면 구현\n                                                           확인\n\n  계좌정보 및 직접송금    거래 상대방 제공정보와 송금 확인 개인정보 제3자 제공\n                          절차 반영                        동의 화면 확인\n\n  충전포인트/교환포인트   환불 가능 여부와 사용범위 반영   포인트 화면 표시 확인\n  구분                                                     \n\n  디지털 거래 아이템 용어 수정·루비·다이아를 디지털 거래   서비스 화면 용어 통일\n                          아이템으로 통일                  \n\n  매칭·2차매칭·플랫폼     비보장 원칙과 제한 기준 반영     중요 고지 표시 확인\n  참여 거래                                                \n\n  패널티 및 신고 처리     미입금·허위신고·자료조작 기준    패널티 표와 화면 안내\n                          반영                             확인\n\n  개인정보 보관·자료제출  개인정보처리방침 우선 적용 명시  보관기간·접근권한 확인\n\n  고객센터 및 외부기관    분쟁처리와 자료제출 기준 반영    고객센터 운영시간 입력\n  협조                                                     \n\n  게시 전 빈칸            시행일·회사정보·시간·수량·금액   실제 오픈 전 확정값\n                          빈칸 유지                        입력\n  --------------------------------------------------------------------------------\n\n끝.\n\nFINAL v2.0 추가 반영사항\n\n1. 구매확정 포인트 기준: 디지털 거래 아이템 구매확정 완료 시 회원에게\n40포인트를 지급할 수 있으며, 세부 지급기준은 서비스 화면에 표시합니다.\n\n2. 아이템 재교환 기준: 재교환 최소 기준은 40개 이상으로 운영합니다.\n\n3. 레벨표 공개: 레벨별 예약 가능 수량, 유지조건, 무료/유료 구간은 서비스\n화면에 표 형태로 공개합니다.\n\n4. 8~10레벨 공개: 기존 비공개 운영 가능 조항 대신 8~10레벨 기준도 서비스\n화면에 공개할 수 있습니다.\n\n5. 시간표 확정: 매칭시간, 입금기한, 입금확인기한, 신고기한,\n자동처리시간은 서비스 화면 및 부속서 시간표에 명시합니다." },
  privacy: { title: '루페이 개인정보처리방침', checkId: 'agree-privacy', text: "루페이 개인정보처리방침 FINAL v1.0\n서비스 게시용 전체본\n\n  -----------------------------------------------------------------------\n  구분              내용\n  ----------------- -----------------------------------------------------\n  시행일            ______년 ______월 ______일\n\n  회사명            루페이 주식회사\n\n  서비스명          루페이\n\n  대표자            ____________________\n\n  사업자등록번호    ____________________\n\n  통신판매업        ____________________\n  신고번호          \n\n  주소              ____________________\n\n  고객센터          ____________________\n\n  전자우편          ____________________\n\n  개인정보          성명: __________ / 직책: __________ / 연락처:\n  보호책임자        __________ / 전자우편: __________\n  -----------------------------------------------------------------------\n\n본 개인정보처리방침은 루페이 주식회사(이하 “회사”라 합니다)가 제공하는\n루페이 플랫폼, 웹사이트, 모바일 애플리케이션 및 이에 부수하는 포인트,\n디지털 거래 아이템, 구매예약, 판매예약, 매칭, 직접송금, 입금확인, 신고,\n분쟁처리, 패널티, 고객지원 기타 관련 서비스(이하 통칭하여 “서비스”라\n합니다)와 관련하여 회사가 개인정보를 어떠한 목적과 방식으로 처리하는지를\n정보주체가 쉽게 확인할 수 있도록 정한 문서입니다.\n\n본 방침은 루페이 이용약관 FINAL v3.6의 회원가입, 성인인증, 계좌 등록,\n직접송금 거래, 포인트, 디지털 거래 아이템, 신고, 분쟁처리, 부정거래\n방지, 서비스 화면 동의 절차와 충돌하지 않도록 작성되었습니다. 실제 게시\n전 회사의 실제 결제수단, 본인확인기관, 문자발송업체, 클라우드 사업자,\n고객센터 운영도구, 개인정보 보호책임자 정보는 반드시 확정 정보로\n교체하여야 합니다.\n\n목차\n\n제1장 총칙\n\n제1조 목적\n\n제2조 용어의 정의\n\n제3조 적용 범위 및 다른 문서와의 관계\n\n제4조 개인정보 처리 원칙\n\n제2장 개인정보의 처리 목적·항목·보유기간\n\n제5조 개인정보의 처리 목적\n\n제6조 처리하는 개인정보 항목\n\n제7조 개인정보의 보유 및 이용기간\n\n제8조 법령에 따른 보관 및 분쟁자료 보존\n\n제3장 개인정보 수집 및 이용\n\n제9조 회원가입 및 성인확인 관련 처리\n\n제10조 계좌 등록 및 직접송금 거래 관련 처리\n\n제11조 포인트, 아이템, 예약, 매칭 관련 처리\n\n제12조 신고, 분쟁처리, 부정거래 방지 관련 처리\n\n제13조 고객센터 및 고충처리 관련 처리\n\n제4장 제공·위탁·이전\n\n제14조 개인정보의 제3자 제공\n\n제15조 개인정보 처리업무의 위탁\n\n제16조 개인정보의 국외 이전\n\n제5장 정보주체의 권리와 선택\n\n제17조 정보주체와 법정대리인의 권리·의무 및 행사방법\n\n제18조 동의 거부권 및 필수 동의 거부 시 제한\n\n제19조 개인정보 자동 수집 장치의 설치·운영 및 거부\n\n제20조 행태정보의 처리\n\n제21조 자동화된 결정에 관한 사항\n\n제6장 보호조치·파기·책임자\n\n제22조 개인정보의 파기 절차 및 방법\n\n제23조 개인정보의 안전성 확보조치\n\n제24조 개인정보 보호책임자 및 고충처리 부서\n\n제25조 권익침해 구제방법\n\n제26조 개인정보처리방침의 공개 및 변경\n\n부속서 1 개인정보 수집·이용 동의서\n\n부속서 2 개인정보 제3자 제공 동의서\n\n부속서 3 개인정보 처리위탁 현황\n\n부속서 4 이용약관 대조 검수표\n\n부속서 5 게시 전 필수 확인표\n\n제1장 총칙\n\n제1조 (목적)\n\n본 방침은 회사가 개인정보 보호법 등 관련 법령에 따라 정보주체의\n개인정보를 보호하고, 개인정보 처리와 관련한 정보주체의 권리·의무 및\n행사방법, 개인정보의 수집·이용·제공·위탁·보관·파기, 안전성 확보조치,\n고충처리 절차를 명확히 안내하기 위하여 정합니다.\n\n회사는 서비스 제공에 필요한 최소한의 개인정보를 처리하며, 처리 목적이\n달성된 개인정보는 관련 법령 또는 본 방침에서 정한 보관기간이 남아 있는\n경우를 제외하고 지체 없이 파기합니다.\n\n회사는 회원 간 직접송금 거래 구조, 성인 전용 서비스 구조, 계좌 등록 및\n본인확인 구조, 신고·분쟁처리·부정거래 방지 구조를 고려하여 필요한\n범위에서 개인정보를 처리합니다.\n\n제2조 (용어의 정의)\n\n1. “개인정보”란 살아 있는 개인에 관한 정보로서 성명, 생년월일,\n휴대전화번호, 계좌정보, 접속기록 등 특정 개인을 알아볼 수 있는 정보 및\n다른 정보와 쉽게 결합하여 특정 개인을 알아볼 수 있는 정보를 말합니다.\n\n2. “정보주체”란 처리되는 개인정보에 의하여 알아볼 수 있는 사람으로서\n해당 개인정보의 주체가 되는 회원 또는 이용자를 말합니다.\n\n3. “회원”이란 회사의 이용약관에 동의하고 회사가 정한 절차에 따라 가입을\n완료한 만 19세 이상의 이용자를 말합니다.\n\n4. “계좌정보”란 은행명, 계좌번호, 예금주명, 계좌명 및 거래대금 송금 또는\n환불에 필요한 정보를 말합니다.\n\n5. “직접송금 거래”란 매칭된 구매자가 회사가 안내한 판매자의 계좌정보를\n확인한 후 판매자에게 거래대금을 직접 계좌이체하는 거래 방식을 말합니다.\n\n6. “디지털 거래 아이템”이란 서비스 내에서 구매, 보유, 판매예약, 판매,\n교환, 합성 또는 소각할 수 있도록 회사가 정한 디지털 형식의 거래 대상\n또는 서비스 이용 단위를 말하며, 서비스 내 명칭은 수정, 루비, 다이아 등이\n될 수 있습니다.\n\n7. “포인트”란 서비스 내에서 구매예약, 유료서비스 이용, 패널티 납부, 교환\n기타 회사가 정한 용도로 사용할 수 있는 서비스상 지급수단을 말하며,\n충전포인트와 교환포인트로 구분될 수 있습니다.\n\n8. “처리”란 개인정보의 수집, 생성, 기록, 저장, 보유, 가공, 편집, 검색,\n출력, 정정, 복구, 이용, 제공, 공개, 파기 및 그 밖에 이와 유사한 행위를\n말합니다.\n\n9. 본 조에서 정하지 않은 용어는 개인정보 보호법, 전자상거래 등에서의\n소비자보호에 관한 법률, 회사의 이용약관, 운영정책 및 서비스 화면 안내에\n따릅니다.\n\n제3조 (적용 범위 및 다른 문서와의 관계)\n\n1. 본 방침은 회사가 제공하는 루페이 서비스, 웹사이트, 모바일\n애플리케이션, 고객센터, 이벤트, 공지, 알림, 거래중개, 직접송금, 포인트,\n디지털 거래 아이템, 신고 및 분쟁처리 기능에 적용됩니다.\n\n2. 서비스 이용과 관련한 계약 조건은 이용약관 및 운영정책이 적용되며,\n개인정보 처리에 관한 사항은 본 방침과 개인정보 보호 관련 법령이 우선\n적용됩니다.\n\n3. 이용약관, 운영정책 또는 서비스 화면 안내와 본 방침이 충돌하는 경우\n개인정보의 수집·이용·제공·위탁·보관·파기 및 정보주체 권리행사에 관하여는\n본 방침과 관련 법령을 우선합니다.\n\n4. 회사는 회원가입 화면, 서비스 초기 화면, 설정 화면, 웹사이트 또는 기타\n정보주체가 쉽게 확인할 수 있는 방법으로 본 방침을 공개합니다.\n\n5. 회사는 본 방침과 별도로 개인정보 수집·이용 동의서, 개인정보 제3자\n제공 동의서, 선택적 마케팅 수신 동의서, 이벤트별 개인정보 처리 안내를 둘\n수 있습니다.\n\n제4조 (개인정보 처리 원칙)\n\n1. 회사는 서비스 제공 목적에 필요한 최소한의 개인정보를 적법하고\n정당하게 수집·이용합니다.\n\n2. 회사는 개인정보의 처리 목적을 명확하게 하며, 목적에 필요한 범위에서\n개인정보를 정확하고 최신 상태로 관리하기 위하여 노력합니다.\n\n3. 회사는 정보주체의 권리가 침해되지 않도록 개인정보의 안전성 확보에\n필요한 기술적·관리적·물리적 조치를 취합니다.\n\n4. 회사는 회원 간 직접송금 거래의 이행, 신고, 분쟁처리, 부정거래 방지 및\n법령상 의무 이행에 필요한 경우를 제외하고 개인정보를 목적 외로\n이용하거나 제3자에게 제공하지 않습니다.\n\n5. 회사는 개인정보 처리방침을 공개하여 정보주체가 자신의 개인정보 처리\n현황을 쉽게 확인할 수 있도록 합니다.\n\n제2장 개인정보의 처리 목적·항목·보유기간\n\n제5조 (개인정보의 처리 목적)\n\n회사는 다음 각 호의 목적을 위하여 개인정보를 처리합니다. 회사는 처리\n목적이 변경되는 경우 관련 법령에 따라 별도 동의를 받거나 필요한 고지\n절차를 이행합니다.\n\n1. 회원가입 의사 확인, 회원 식별, 계정 생성 및 관리, 1인 1계정 원칙\n운영, 중복가입 및 부정가입 방지\n\n2. 만 19세 이상 성인 여부 확인, 미성년자 가입 제한, 허위 생년월일 또는\n타인 명의 가입 확인\n\n3. 휴대전화번호 기반 본인확인, 인증, 알림 발송, 고객센터 응대 및\n고지사항 전달\n\n4. 계좌 등록, 예금주 확인, 거래대금 직접송금 안내, 환불, 초과입금 또는\n오입금 확인, 계좌정보 오류 처리\n\n5. 디지털 거래 아이템의 구매예약, 판매예약, 매칭, 보유기간 관리, 판매\n가능일 관리, 거래상태 관리 및 거래이력 관리\n\n6. 포인트 충전, 사용, 교환, 환불, 패널티 납부, 충전포인트와 교환포인트의\n구분 관리, 정산 및 회계처리\n\n7. 입금완료, 입금확인, 이체영수증 제출, 신고, 자동처리, 사후처리,\n2차매칭, 플랫폼 참여 거래 처리\n\n8. 미입금, 금액 오류, 초과입금, 오입금, 입금자명 불일치, 허위신고,\n증빙자료 조작, 계정도용, 명의도용, 계좌도용 등 분쟁 및 부정거래 조사\n\n9. 서비스 이용제한, 패널티, 계정정지, 탈퇴, 재가입 제한, 이상거래 탐지\n및 정상 이용 회원 보호\n\n10. 공지사항 전달, 약관 및 운영정책 변경 안내, 개인정보처리방침 변경\n안내, 서비스 장애 및 보안사고 안내\n\n11. 고객 문의, 민원, 신고, 이의제기, 분쟁조정, 법령상 권리행사 요청 처리\n\n12. 법령상 의무 이행,\n수사기관·법원·행정기관·소비자분쟁조정기관·금융기관의 적법한 요청 대응\n\n13. 서비스 품질 개선, 접속환경 분석, 보안점검, 오류 확인, 통계 작성. 단,\n통계 작성 시 특정 개인을 식별할 수 없도록 필요한 조치를 취합니다.\n\n제6조 (처리하는 개인정보 항목)\n\n회사가 처리하는 개인정보 항목은 서비스 이용 단계, 이용 기능, 분쟁 발생\n여부, 회원의 동의 내용에 따라 달라질 수 있습니다. 회사는 서비스 제공에\n필요한 범위에서 다음의 개인정보를 처리할 수 있습니다.\n\n  ----------------------------------------------------------------------------------------\n  구분                    처리 항목                      처리 목적\n  ----------------------- ------------------------------ ---------------------------------\n  회원가입 및 계정관리    이름, 생년월일, 휴대전화번호,  회원 식별, 성인 여부 확인,\n                          아이디 또는 회원번호, 비밀번호 계정관리, 1인 1계정 운영,\n                          또는 인증정보, 가입일, 탈퇴일, 부정가입 방지\n                          계정상태, 만 19세 이상 여부,   \n                          약관·운영정책·개인정보 동의    \n                          이력                           \n\n  본인확인 및 성인확인    이름, 생년월일,                성인 전용 서비스 제공, 본인확인,\n                          성별(본인확인기관이 제공하는   타인 명의 가입 방지\n                          경우), 휴대전화번호, 통신사,   \n                          CI/DI 또는 본인확인 결과값,    \n                          인증일시, 인증성공 여부        \n\n  계좌 등록 및 환불       은행명, 계좌번호, 예금주명,    직접송금 거래 안내, 환불,\n                          계좌명, 계좌 등록·변경일, 환불 오입금·초과입금 처리, 계좌 오류\n                          신청 내역, 환불 계좌정보,      방지\n                          예금주 확인 결과, 계좌확인     \n                          증빙자료                       \n\n  포인트 및 결제          충전포인트·교환포인트 잔액,    포인트 운영, 결제 확인, 환불,\n                          충전·사용·교환·환불·패널티     정산, 부정결제 방지\n                          차감 내역, 결제수단,           \n                          결제승인번호, 결제일시,        \n                          결제금액, 결제취소 내역, PG사  \n                          처리정보                       \n\n  아이템·예약·매칭·거래   아이템 종류, 단계,             서비스 핵심 기능 제공, 거래이행,\n                          구매예약·판매예약 내역,        거래상태 관리, 분쟁 예방\n                          매칭번호, 거래번호, 거래금액,  \n                          구매자·판매자 정보, 거래상태,  \n                          보유기간, 판매 가능일,         \n                          입금완료·입금확인 내역, 플랫폼 \n                          참여 거래 여부                 \n\n  직접송금 및 증빙        이체영수증, 송금확인증, 이체   입금확인,\n                          화면 캡처, 입금자명, 입금일시, 미입금·금액오류·초과입금·오입금\n                          입금액, 계좌거래내역, 은행     확인, 신고 및 분쟁처리\n                          발급자료, 추가 캡처,           \n                          거래경위서                     \n\n  신고·분쟁처리·패널티    신고 내용, 신고일시, 첨부자료, 사실확인, 분쟁처리, 부정거래\n                          고객센터 상담내용, 이의제기    방지, 회원 보호\n                          내용, 처리결과, 패널티 이력,   \n                          이용제한 이력, 자료 제출 이력  \n\n  서비스 이용 및 보안     접속일시, IP주소, 쿠키,        서비스 보안, 이상거래 탐지, 오류\n                          기기정보, OS, 브라우저, 앱     개선, 접속환경 확인\n                          버전, 광고식별자(수집 시),     \n                          서비스 이용기록, 로그기록,     \n                          오류기록, 알림 수신 기록       \n\n  선택 서비스 및 마케팅   이벤트 참여정보, 선택          이벤트 운영, 혜택 안내, 서비스\n                          입력정보, 마케팅 수신 동의     소식 제공. 선택 동의 거부 시에도\n                          여부, 푸시·문자·이메일 수신    필수 서비스 이용은 가능\n                          내역                           \n  ----------------------------------------------------------------------------------------\n\n1. 회원이 고객센터, 신고, 이의제기, 분쟁처리 과정에서 자발적으로 제출한\n자료에는 제출자료에 포함된 개인정보가 포함될 수 있습니다. 회사는 제출\n목적에 필요한 범위에서만 해당 자료를 이용합니다.\n\n2. 회사는 주민등록번호를 원칙적으로 수집하지 않습니다. 다만 관련 법령에\n따라 주민등록번호 처리가 허용되는 경우 또는 관계기관의 적법한 요청이\n있는 경우에는 법령이 허용하는 범위에서 처리할 수 있습니다.\n\n3. 회사는 민감정보를 원칙적으로 수집하지 않습니다. 회원은 고객센터나\n신고자료 제출 시 건강정보, 정치적 견해, 종교, 노동조합 가입 여부 등\n민감정보가 포함되지 않도록 주의하여야 합니다.\n\n4. 서비스 안정성, 부정거래 방지 또는 법령 준수를 위하여 필요한 경우\n회사는 본인확인자료, 계좌확인자료, 거래내역 확인자료의 추가 제출을\n요청할 수 있습니다.\n\n제7조 (개인정보의 보유 및 이용기간)\n\n회사는 개인정보의 처리 목적이 달성되거나 보유기간이 경과한 때에는 지체\n없이 해당 개인정보를 파기합니다. 다만, 다음 각 호의 어느 하나에 해당하는\n경우에는 해당 기간 동안 개인정보를 보관할 수 있습니다.\n\n  -----------------------------------------------------------------------------------\n  개인정보 유형                  보유 및 이용기간                 비고\n  ------------------------------ -------------------------------- -------------------\n  회원가입 및 계정관리 정보      회원 탈퇴 시까지. 다만 부정가입, 탈퇴 후 재가입\n                                 이용제한, 분쟁, 미정산, 환불,    제한, 분쟁 대응,\n                                 법령상 의무가 남아 있는 경우     법령상 의무 이행\n                                 해당 사유 해소 시까지            \n\n  성인확인 및 본인확인 기록      회원 탈퇴 시까지 또는 관련       성인 전용 서비스\n                                 법령·본인확인기관 정책상 필요한  제공, 명의도용 방지\n                                 기간                             \n\n  계좌정보                       회원 탈퇴 또는 계좌 삭제 시까지. 직접송금 거래,\n                                 다만 진행 중인 거래, 환불,       환불, 분쟁처리\n                                 초과입금 반환, 분쟁, 법령상 보관 \n                                 필요가 있는 경우 해당 기간까지   \n\n  거래·아이템·매칭·포인트 기록   거래 완료 후 5년 또는 관계       전자상거래 기록\n                                 법령상 보관기간. 분쟁이 계속     보존, 분쟁 대응,\n                                 중인 경우 분쟁 종료 시까지       정산 확인\n\n  이체영수증·증빙자료·신고자료   분쟁 또는 신고 처리 완료 후 3년. 분쟁처리, 허위자료\n                                 단, 법령상 더 긴 보관기간이      조사, 회원 보호\n                                 적용되거나 수사·소송·분쟁이 계속 \n                                 중인 경우 해당 종료 시까지       \n\n  고객센터 상담 및 민원 기록     처리 완료 후 3년                 소비자 불만 및\n                                                                  분쟁처리 기록 보존\n\n  접속기록 및 보안 로그          최소 3개월 이상. 이상거래,       통신비밀보호법 등\n                                 보안사고, 분쟁 관련 로그는 해당  법령 준수, 보안사고\n                                 사유 해소 시까지                 대응\n\n  마케팅 수신 동의 정보          동의 철회 또는 회원 탈퇴 시까지. 수신 동의 관리,\n                                 발송 이력은 법령 및 분쟁 대응에  불법 스팸 방지\n                                 필요한 기간                      \n  -----------------------------------------------------------------------------------\n\n제8조 (법령에 따른 보관 및 분쟁자료 보존)\n\n회사는 전자상거래 등에서의 소비자보호에 관한 법률, 통신비밀보호법,\n국세기본법, 전자금융거래 관련 법령 등 관계 법령에 따라 일정 기간\n개인정보 또는 거래기록을 보관할 수 있습니다. 또한 회원 간 직접송금\n구조의 특성상 미입금, 오입금, 초과입금, 허위신고, 증빙자료 조작,\n계정도용, 명의도용, 계좌도용과 관련된 자료를 분쟁 해결에 필요한 범위에서\n보존할 수 있습니다.\n\n  ------------------------------------------------------------------------\n  보관 항목              보관기간          근거 또는 목적\n  ---------------------- ----------------- -------------------------------\n  계약 또는 청약철회     5년               전자상거래 등에서의\n  등에 관한 기록                           소비자보호에 관한 법률\n\n  대금결제 및 재화 등의  5년               전자상거래 등에서의\n  공급에 관한 기록                         소비자보호에 관한 법률\n\n  소비자의 불만 또는     3년               전자상거래 등에서의\n  분쟁처리에 관한 기록                     소비자보호에 관한 법률\n\n  표시·광고에 관한 기록  6개월             전자상거래 등에서의\n                                           소비자보호에 관한 법률\n\n  웹사이트 또는 앱       3개월 이상        통신비밀보호법\n  접속기록                                 \n\n  전자금융거래에 관한    관련 법령상       전자금융거래 관련 법령이\n  기록                   요구되는 기간     적용되는 경우\n\n  세무·회계 관련         관련 법령상       국세기본법, 법인세법 등 관련\n  증빙자료               요구되는 기간     법령이 적용되는 경우\n\n  수사·소송·분쟁 관련    해당 절차 종료    법원, 수사기관, 행정기관,\n  자료                   또는 보존         금융기관, 분쟁조정기관 요청\n                         필요성이 소멸할   또는 분쟁 대응\n                         때까지            \n  ------------------------------------------------------------------------\n\n1. 법령에 따라 보관하는 개인정보는 해당 보관 목적 범위 내에서만\n이용하며, 일반 서비스 제공 목적으로 이용하지 않습니다.\n\n2. 회원이 탈퇴하더라도 진행 중인 거래, 환불, 신고, 이의제기, 초과입금\n반환, 부정거래 조사, 수사·소송·분쟁이 있는 경우 회사는 해당 사유가\n해소될 때까지 필요한 개인정보를 보관할 수 있습니다.\n\n3. 회원은 분쟁 또는 법적 절차가 예상되는 경우 본인의 이체내역, 영수증,\n캡처, 고객센터 상담내역, 거래번호, 매칭번호를 스스로 보관하여야 합니다.\n\n제3장 개인정보 수집 및 이용\n\n제9조 (회원가입 및 성인확인 관련 처리)\n\n1. 회사는 만 19세 이상 성인에 한하여 서비스를 제공하기 위하여 회원가입\n단계에서 이름, 생년월일, 휴대전화번호, 성인 여부 확인정보, 본인확인\n결과값을 처리할 수 있습니다.\n\n2. 회원이 허위 생년월일, 타인 명의, 타인의 휴대전화번호 또는 인증정보를\n이용하여 가입한 사실이 확인되거나 의심되는 경우 회사는 본인확인,\n계좌확인, 증빙자료 제출을 요청할 수 있습니다.\n\n3. 만 19세 미만인 자의 가입 또는 이용이 확인되거나 의심되는 경우 회사는\n해당 계정의 이용을 제한하고 거래, 포인트, 환불, 분쟁처리, 계좌확인\n절차를 보류하거나 확인할 수 있습니다.\n\n4. 회사는 1인 1계정 원칙 운영, 다중계정 방지, 명의도용 방지를 위하여\n회원정보, 본인확인 결과값, 휴대전화번호, 기기정보, 접속기록, 계좌정보를\n대조할 수 있습니다.\n\n5. 회사는 미성년자 보호 및 서비스 안정성을 위하여 성인확인 방식,\n본인확인 방식 및 가입 제한 기준을 변경할 수 있으며, 변경 시 서비스 화면\n또는 공지사항으로 안내합니다.\n\n제10조 (계좌 등록 및 직접송금 거래 관련 처리)\n\n1. 회원은 서비스 이용을 위하여 원칙적으로 본인 명의의 계좌를 등록하여야\n하며, 회사는 은행명, 계좌번호, 예금주명, 계좌명, 계좌 등록·변경 이력 및\n계좌확인 자료를 처리할 수 있습니다.\n\n2. 회사는 구매자와 판매자 간 직접송금 거래를 이행하기 위하여 매칭된 거래\n상대방에게 필요한 최소한의 계좌정보, 예금주명, 거래금액, 매칭번호,\n거래상태, 입금확인에 필요한 정보를 제공할 수 있습니다.\n\n3. 구매자는 송금 전 서비스 화면에 표시된 판매자의 계좌정보와 거래금액을\n확인하여야 하며, 판매자는 자신의 계좌정보가 정확히 등록되어 있는지\n확인하여야 합니다.\n\n4. 초과입금, 오입금, 금액 부족, 입금자명 불일치, 계좌정보 오류가 발생한\n경우 회사는 구매자와 판매자에게 이체확인증, 계좌거래내역, 은행 발급자료,\n송금화면 캡처, 거래경위서 등 사실확인 자료 제출을 요청할 수 있습니다.\n\n5. 회사는 직접송금 거래에서 사실확인과 중재를 지원할 수 있으나, 회사가\n해당 거래의 직접 당사자로 참여한 경우를 제외하고 금융기관 송금의 취소,\n반환 또는 금액 회수를 보장하지 않습니다.\n\n6. 회원이 부정확한 계좌정보를 입력하거나 타인 명의 계좌를 등록하여\n발생한 오입금, 환불 지연, 거래 실패, 패널티, 분쟁 기타 불이익은\n귀책사유가 있는 회원이 책임집니다.\n\n제11조 (포인트, 아이템, 예약, 매칭 관련 처리)\n\n1. 회사는 충전포인트와 교환포인트의 구분 관리, 포인트 충전, 사용, 교환,\n환불, 패널티 납부, 잔액 표시 및 정산을 위하여 포인트 이용기록을\n처리합니다.\n\n2. 회사는 디지털 거래 아이템의 구매예약, 판매예약, 보유기간, 판매\n가능일, 매칭, 거래상태, 행운구매, 소각합성(결합판매), 포인트교환,\n2차매칭, 플랫폼 참여 거래를 처리하기 위하여 필요한 거래기록을\n생성·보관할 수 있습니다.\n\n3. 매칭은 서비스 화면과 운영정책에 따른 시스템 절차로 처리되며, 회사는\n매칭번호, 거래번호, 구매자·판매자 정보, 거래금액, 거래상태, 입금완료 및\n입금확인 정보를 처리합니다.\n\n4. 회사는 특정 매칭 결과, 판매 완료, 수익, 차익, 회수금액을 보장하지\n않으며, 개인정보 처리는 거래 이행과 분쟁 예방을 위한 범위에서\n이루어집니다.\n\n5. 부정거래 또는 이상거래가 의심되는 경우 회사는 구매예약, 판매예약,\n매칭, 포인트 사용, 포인트 환불, 교환포인트 사용, 아이템 교환, 자동예약,\n계정 이용, 고객센터 처리 또는 플랫폼 참여 거래를 일시 제한하고 필요한\n개인정보를 확인할 수 있습니다.\n\n제12조 (신고, 분쟁처리, 부정거래 방지 관련 처리)\n\n1. 회사는 미입금, 금액 오류, 초과입금, 오입금, 허위 송금, 증빙자료 조작,\n허위신고, 입금자명 불일치, 계정도용, 명의도용, 계좌도용, 시스템 악용 등\n분쟁 및 부정거래 방지를 위하여 거래기록, 입금자료, 신고기록, 고객센터\n상담기록, 접속기록, 기기정보, 계정정보, 계좌정보를 확인할 수 있습니다.\n\n2. 신고가 접수된 경우 회사는 시스템 기록, 입금자료, 계좌내역, 증빙자료,\n회원 진술, 고객센터 상담내역 기타 자료를 기준으로 사실관계를 확인할 수\n있습니다.\n\n3. 회원은 회사의 조사에 필요한 자료를 정확하고 완전하게 제출하여야 하며,\n자료 제출을 거부하거나 허위자료를 제출하는 경우 회사는 해당 회원에게\n불리한 판단을 할 수 있습니다.\n\n4. 부정거래가 확인된 경우 회사는 운영정책에 따른 패널티, 거래 제한,\n포인트 사용 제한, 환불 보류, 계정정지, 영구 이용제한, 재가입 제한,\n수사기관 신고, 손해배상 청구 기타 필요한 조치를 할 수 있습니다.\n\n5. 회사는 외부기관의 적법한 요청이 있는 경우 관련 법령에 따라 회원정보,\n거래기록, 접속기록, 신고기록, 증빙자료를 제공할 수 있으며, 법령상 통지\n제한이 있는 경우를 제외하고 필요한 범위에서 회원에게 안내할 수 있습니다.\n\n제13조 (고객센터 및 고충처리 관련 처리)\n\n1. 회원은 서비스 이용과 관련한 문의, 신고, 이의제기, 분쟁처리 요청,\n권리행사 요청을 고객센터를 통해 접수할 수 있습니다.\n\n2. 회사는 고객센터 운영을 위하여 회원의 이름, 휴대전화번호, 회원번호,\n문의내용, 상담내용, 첨부자료, 처리결과, 통화 또는 메시지 기록,\n접수·처리일시를 처리할 수 있습니다.\n\n3. 회사는 문의 내용의 사실확인, 분쟁처리 또는 부정거래 조사를 위하여\n회원에게 추가 자료 제출을 요청할 수 있습니다.\n\n4. 회원이 폭언, 협박, 욕설, 반복적 허위민원, 업무방해를 하는 경우 회사는\n고객센터 이용을 제한하거나 필요한 조치를 할 수 있습니다.\n\n5. 고객센터를 통한 권리행사 및 고충처리 절차는 본 방침 제17조 및\n제24조에 따릅니다.\n\n제4장 제공·위탁·이전\n\n제14조 (개인정보의 제3자 제공)\n\n회사는 정보주체의 동의가 있거나 법령에 특별한 규정이 있는 경우를\n제외하고 개인정보를 제3자에게 제공하지 않습니다. 다만, 루페이 서비스는\n회원 간 직접송금 거래 구조를 포함하므로 거래 이행에 필요한 최소한의\n정보가 거래 상대방에게 제공될 수 있습니다.\n\n  ------------------------------------------------------------------------------------\n  제공받는 자          제공 목적          제공 항목                   보유 및 이용기간\n  -------------------- ------------------ --------------------------- ----------------\n  매칭된 거래          직접송금 거래      매칭번호, 거래번호,         거래 완료 및\n  상대방(구매자 또는   이행, 입금확인,    거래금액, 거래상태,         분쟁처리 종료\n  판매자)              거래금액 확인,     판매자의                    시까지. 단,\n                       신고 및 분쟁처리   은행명·계좌번호·예금주명,   법령상 보관기간\n                                          구매자의 입금완료 정보,     또는 분쟁 대응\n                                          입금자명 등 거래확인에      기간 동안 보관\n                                          필요한 최소 정보            가능\n\n  본인확인기관         본인확인,          이름, 생년월일,             본인확인기관의\n                       성인확인, 명의도용 휴대전화번호, 통신사,       보유기간 및 관련\n                       방지               본인확인 요청정보, 본인확인 법령에 따름\n                                          결과값                      \n\n  결제대행사, 카드사,  포인트 충전, 결제  결제금액, 결제수단,         결제 처리 및\n  은행, 간편결제사 등  승인, 결제 취소,   승인번호, 거래일시,         법령상\n  결제 관련 사업자     환불, 부정결제     환불정보, 결제처리정보      보관기간까지\n                       방지                                           \n\n  수사기관, 법원,      법령상 의무 이행,  요청 범위 내 회원정보,      해당 기관의 요청\n  행정기관, 금융기관,  수사·소송·분쟁     거래기록, 접속기록,         및 관련 법령에\n  소비자분쟁조정기관   대응, 금융사고     계좌정보, 신고기록,         따름\n                       대응               증빙자료                    \n  ------------------------------------------------------------------------------------\n\n1. 회사는 제3자 제공이 필요한 경우 제공받는 자, 제공 목적, 제공 항목,\n보유 및 이용기간을 정보주체에게 알리고 동의를 받습니다. 다만 법령상 동의\n없이 제공할 수 있는 경우에는 관련 법령에 따릅니다.\n\n2. 회원이 직접송금 거래를 이용하는 경우 거래 상대방에게 계좌정보 또는\n거래확인 정보가 제공되는 것은 거래 이행에 필수적인 사항입니다. 회원이\n필수 제공에 동의하지 않는 경우 서비스 이용이 제한될 수 있습니다.\n\n3. 회사는 직접송금 거래의 이행을 위하여 매칭된 거래 상대방에게 필요한\n범위의 계좌정보, 예금주명, 거래금액, 거래번호, 입금확인 관련 정보를\n제공할 수 있으며, 회원은 회원가입 또는 거래 진행 전 별도 동의 화면을\n통해 이를 확인하고 동의하여야 합니다.\n\n제15조 (개인정보 처리업무의 위탁)\n\n회사는 원활한 서비스 제공 및 개인정보 처리업무의 효율적 수행을 위하여\n개인정보 처리업무의 일부를 외부 전문업체에 위탁할 수 있습니다. 실제\n서비스 게시 전 아래 표의 수탁사명, 위탁업무, 보유 및 이용기간을 실제\n계약 내용에 맞게 확정하여 공개하여야 합니다.\n\n  -----------------------------------------------------------------------\n  수탁사              위탁업무                        보유 및 이용기간\n  ------------------- ------------------------------- -------------------\n  본인확인기관(예:    휴대전화 본인확인, 성인확인,    위탁계약 및 관련\n  NICE평가정보, KCB,  본인확인 결과값 제공            법령에 따른 기간\n  SCI평가정보 등 실제                                 \n  계약기관 기재)                                      \n\n  문자메시지/알림     인증번호, 거래 알림, 공지, 고객 발송 완료 및 법령상\n  발송업체(실제       안내 문자 또는 알림 발송        보관기간까지\n  업체명 기재)                                        \n\n  결제대행사(PG) 및   포인트 충전 결제, 결제취소,     결제 처리 및 법령상\n  결제 관련           환불, 부정결제 방지             보관기간까지\n  사업자(실제 업체명                                  \n  기재)                                               \n\n  클라우드/서버/IDC   서비스 인프라 제공, 데이터      위탁계약 종료 또는\n  사업자(실제 업체명  저장, 백업, 보안관제            서비스 제공 목적\n  기재)                                               달성 시까지\n\n  고객상담 시스템     고객 문의, 신고, 분쟁처리,      상담 처리 완료 및\n  또는 콜센터         상담이력 관리                   법령상 보관기간까지\n  운영업체(실제                                       \n  업체명 기재)                                        \n\n  이메일 발송 및 푸시 공지, 약관 변경,                발송 완료 및 법령상\n  알림 서비스         개인정보처리방침 변경, 서비스   보관기간까지\n  사업자(실제 업체명  알림 발송                       \n  기재)                                               \n\n  데이터 보안, 로그   보안점검, 이상거래 탐지, 장애   위탁 목적 달성 또는\n  분석, 장애 대응     분석, 로그 관리                 계약 종료 시까지\n  사업자(실제 업체명                                  \n  기재)                                               \n  -----------------------------------------------------------------------\n\n1. 회사는 위탁계약 체결 시 개인정보 보호법에 따라 위탁업무 수행 목적 외\n개인정보 처리 금지, 기술적·관리적 보호조치, 재위탁 제한, 수탁자에 대한\n관리·감독, 손해배상 등 책임에 관한 사항을 계약서 또는 이에 준하는 문서에\n명시하고 수탁자가 개인정보를 안전하게 처리하는지 감독합니다.\n\n2. 위탁업무의 내용 또는 수탁사가 변경되는 경우 회사는 본 방침을 통하여\n공개하거나 서비스 화면, 공지사항 등으로 안내합니다.\n\n3. 수탁사가 국외에 소재하거나 개인정보가 국외로 이전되는 경우 회사는 본\n방침 제16조에 따라 이전 국가, 이전 일시 및 방법, 이전받는 자, 이전 목적,\n이전 항목, 보유 및 이용기간을 공개하고 필요한 동의를 받습니다.\n\n제16조 (개인정보의 국외 이전)\n\n회사는 원칙적으로 정보주체의 개인정보를 국외로 이전하지 않습니다. 다만\n클라우드, 이메일, 고객상담, 데이터 보안, 장애 대응 도구 등 실제 운영\n과정에서 국외 이전이 발생하는 경우 회사는 관련 법령에 따라 아래 사항을\n본 방침에 공개하고 필요한 경우 정보주체의 동의를 받습니다.\n\n  -----------------------------------------------------------------------\n  구분              내용\n  ----------------- -----------------------------------------------------\n  국외 이전 여부    현재 예정 없음. 실제 국외 클라우드, 해외 SaaS, 해외\n                    고객상담 도구를 이용하는 경우 즉시 구체 정보로 변경\n                    필요\n\n  이전받는 자       해당 없음 / 실제 발생 시 회사명, 연락처, 개인정보\n                    보호 담당 연락처 기재\n\n  이전 국가         해당 없음 / 실제 발생 시 국가명 기재\n\n  이전 일시 및 방법 해당 없음 / 실제 발생 시 서비스 이용 또는 위탁업무\n                    수행 과정에서 네트워크를 통한 전송 등 구체 기재\n\n  이전 목적         해당 없음 / 실제 발생 시 클라우드 저장, 알림 발송,\n                    고객상담, 보안관제 등 구체 기재\n\n  이전 항목         해당 없음 / 실제 발생 시 이전되는 개인정보 항목 기재\n\n  보유 및 이용기간  해당 없음 / 실제 발생 시 위탁계약 종료, 목적 달성\n                    또는 법령상 보관기간까지 등 구체 기재\n\n  이전을 거부하는   국외 이전이 필수 서비스 제공에 필요한 경우 거부 시\n  방법 및 거부 효과 해당 서비스 이용이 제한될 수 있음\n  -----------------------------------------------------------------------\n\n제5장 정보주체의 권리와 선택\n\n제17조 (정보주체와 법정대리인의 권리·의무 및 행사방법)\n\n1. 정보주체는 회사에 대하여 개인정보 열람, 정정, 삭제, 처리정지,\n동의철회, 회원탈퇴를 요구할 수 있습니다.\n\n2. 정보주체는 서비스 내 설정 화면, 고객센터, 전자우편, 서면, 전화 등\n회사가 안내하는 방법으로 권리를 행사할 수 있습니다.\n\n3. 회사는 권리행사 요청을 받은 경우 관련 법령에서 정한 기간 내에\n조치하고, 조치 결과를 정보주체에게 안내합니다.\n\n4. 개인정보의 정정 또는 삭제를 요청한 경우 회사는 정정 또는 삭제가\n완료될 때까지 해당 개인정보를 이용하거나 제공하지 않습니다. 다만 법령상\n보관 의무가 있거나 분쟁 대응을 위해 필요한 경우에는 별도 보관할 수\n있습니다.\n\n5. 회사는 권리행사자가 본인 또는 정당한 대리인인지 확인하기 위하여\n본인확인 또는 위임장 등 필요한 자료 제출을 요청할 수 있습니다.\n\n6. 다른 회원의 권리 또는 이익을 침해할 우려가 있거나 법령상 보관 의무가\n있는 경우, 진행 중인 거래·환불·분쟁·부정거래 조사가 있는 경우 회사는\n열람, 삭제, 처리정지 요청의 전부 또는 일부를 제한하거나 보류할 수\n있습니다.\n\n7. 루페이 서비스는 만 19세 이상 성인 전용 서비스로 운영되므로 만 14세\n미만 아동의 개인정보를 고의로 수집하지 않습니다. 만 14세 미만 또는\n미성년자의 가입이 확인되는 경우 회사는 즉시 이용제한, 탈퇴 처리,\n거래·환불·분쟁처리 확인 등 필요한 조치를 합니다.\n\n8. 정보주체는 자신의 개인정보를 정확하고 최신 상태로 유지하여야 하며,\n부정확한 정보 입력 또는 미수정으로 발생한 거래 오류, 환불 지연, 오입금,\n패널티, 분쟁 기타 불이익은 귀책사유가 있는 정보주체가 책임집니다.\n\n제18조 (동의 거부권 및 필수 동의 거부 시 제한)\n\n1. 정보주체는 개인정보 수집·이용, 제3자 제공, 처리위탁, 선택적 마케팅\n수신에 대한 동의를 거부할 권리가 있습니다.\n\n2. 회원가입, 성인확인, 계좌 등록, 직접송금 거래, 포인트, 아이템 거래,\n신고 및 분쟁처리, 부정거래 방지에 필요한 필수 개인정보 처리에 동의하지\n않는 경우 서비스 가입 또는 이용이 제한될 수 있습니다.\n\n3. 선택적 마케팅 수신 동의를 거부하더라도 회원가입 및 기본 서비스\n이용에는 제한이 없습니다. 다만 이벤트, 혜택, 프로모션 안내를 받지 못할\n수 있습니다.\n\n4. 회원은 언제든지 서비스 설정, 고객센터 또는 회사가 안내하는 방법으로\n선택적 동의를 철회할 수 있습니다.\n\n5. 이미 체결된 거래, 진행 중인 분쟁, 환불, 법령상 보관 의무와 관련된\n개인정보는 동의 철회 또는 탈퇴 이후에도 해당 목적 달성 또는 법정\n보관기간까지 보관될 수 있습니다.\n\n제19조 (개인정보 자동 수집 장치의 설치·운영 및 거부)\n\n회사는 웹사이트 및 모바일 애플리케이션의 안정적인 운영, 로그인 유지,\n보안, 이용환경 개선, 통계 분석을 위하여 쿠키, 세션, SDK, 로그 분석 도구\n등 자동 수집 장치를 사용할 수 있습니다.\n\n  -----------------------------------------------------------------------\n  구분              내용\n  ----------------- -----------------------------------------------------\n  수집 가능 항목    쿠키, 세션정보, 접속일시, IP주소, 기기정보, OS,\n                    브라우저, 앱 버전, 서비스 이용기록, 오류기록,\n                    광고식별자(수집 시)\n\n  이용 목적         로그인 유지, 보안, 이상접속 탐지, 서비스 품질 개선,\n                    오류 분석, 통계 작성, 부정거래 방지\n\n  보유기간          목적 달성 시 또는 법령상 보관기간 경과 시까지\n\n  거부 방법         웹 브라우저 설정에서 쿠키 저장 거부 또는 삭제, 모바일\n                    OS 설정에서 광고식별자 제한, 앱 권한 설정 변경\n\n  거부 효과         쿠키 또는 자동 수집 장치를 거부할 경우 로그인 유지,\n                    일부 보안 기능, 맞춤 설정, 알림, 서비스 이용이 제한될\n                    수 있음\n  -----------------------------------------------------------------------\n\n1. Chrome: 설정 > 개인정보 보호 및 보안 > 서드 파티 쿠키 또는 사이트\n데이터 설정에서 쿠키 차단 또는 삭제\n\n2. Edge: 설정 > 쿠키 및 사이트 권한 > 쿠키 및 사이트 데이터 관리 및 삭제\n\n3. Safari: 설정 > 개인정보 보호 > 쿠키 차단 또는 웹사이트 데이터 관리\n\n4. Android/iOS: 각 기기의 설정 메뉴에서 앱 권한, 알림 권한, 광고식별자\n설정을 변경할 수 있습니다.\n\n제20조 (행태정보의 처리)\n\n회사가 광고 또는 맞춤형 서비스 제공을 위하여 행태정보를 수집·이용하는\n경우에는 처리 목적, 수집 항목, 보유기간, 거부 방법을 명확히 안내하고\n필요한 동의를 받습니다. 현재 서비스 게시 전 단계에서는 맞춤형 광고\n목적의 행태정보 처리를 예정하지 않는 것으로 작성합니다. 실제 맞춤형 광고\nSDK 또는 분석 도구를 도입하는 경우 아래 내용을 실제 운영에 맞게\n수정하여야 합니다.\n\n  -----------------------------------------------------------------------\n  구분              내용\n  ----------------- -----------------------------------------------------\n  행태정보 처리     현재 맞춤형 광고 목적의 행태정보 처리 예정 없음\n  여부              \n\n  수집하는 행태정보 해당 없음. 실제 도입 시 방문 기록, 검색 기록, 클릭\n                    기록, 구매예약·판매예약 관심정보 등 구체 항목 기재\n\n  수집 방법         해당 없음. 실제 도입 시 쿠키, SDK, 광고식별자 등 구체\n                    기재\n\n  이용 목적         해당 없음. 실제 도입 시 맞춤형 광고, 서비스 추천 등\n                    구체 기재\n\n  보유 및 이용기간  해당 없음. 실제 도입 시 기간 기재\n\n  거부 방법         해당 없음. 실제 도입 시 앱 설정, 브라우저 설정,\n                    광고식별자 제한 방법 기재\n  -----------------------------------------------------------------------\n\n제21조 (자동화된 결정에 관한 사항)\n\n회사는 서비스 운영 과정에서 매칭 시스템, 부정거래 탐지 시스템, 이상거래\n탐지, 미입금 이력 확인, 2차매칭 제한, 계정 이용제한 추천 등 자동화된\n처리 기능을 사용할 수 있습니다. 다만 자동화된 처리 결과가 회원의 권리\n또는 의무에 중대한 영향을 미치는 경우 회사는 회원이 이의제기하거나\n설명을 요청할 수 있는 절차를 제공합니다.\n\n1. 매칭 시스템은 구매예약과 판매예약, 아이템 종류, 수량, 판매 가능일,\n레벨, 운영정책, 거래 균형, 부정거래 방지 기준 등을 기준으로 자동 또는\n랜덤 방식으로 매칭 결과를 산출할 수 있습니다.\n\n2. 부정거래 탐지 시스템은 미입금 이력, 허위신고 이력, 증빙자료 조작\n의심, 다중계정 의심, 계좌정보 오류, 접속기록, 기기정보 등 서비스\n안정성에 필요한 정보를 분석할 수 있습니다.\n\n3. 자동화된 처리 결과에 따라 계정 이용, 예약, 매칭, 포인트 사용, 환불,\n신고 기능이 일시 제한될 수 있으며, 회원은 고객센터를 통해 이의제기 및\n재검토를 요청할 수 있습니다.\n\n4. 회사는 자동화된 처리 결과를 부당하게 차별적 목적으로 사용하지 않으며,\n필요한 경우 담당자가 제출자료와 시스템 기록을 검토하여 최종 조치 여부를\n결정합니다.\n\n5. 회원은 자동화된 결정에 대한 설명 요구, 의견 제출, 이의제기를 할 수\n있으며, 회사는 관련 법령 및 운영정책에 따라 처리 결과를 안내합니다.\n\n제6장 보호조치·파기·책임자\n\n제22조 (개인정보의 파기 절차 및 방법)\n\n1. 회사는 개인정보의 처리 목적이 달성되거나 보유기간이 경과한 경우 해당\n개인정보를 지체 없이 파기합니다.\n\n2. 전자적 파일 형태의 개인정보는 복구 또는 재생이 어렵도록 안전한\n방법으로 삭제합니다.\n\n3. 종이 문서 형태의 개인정보는 분쇄하거나 소각하는 방법으로 파기합니다.\n\n4. 법령에 따라 보관하여야 하는 개인정보는 다른 개인정보와 분리하여\n저장·관리하며, 해당 보관 목적 범위 내에서만 이용합니다.\n\n5. 백업 데이터에 포함된 개인정보는 기술적으로 즉시 삭제가 어려운 경우\n접근권한을 제한하고, 백업 보관주기가 경과한 때 또는 복구 목적이 소멸한\n때 파기합니다.\n\n6. 회원 탈퇴 시에도 진행 중인 거래, 환불, 신고, 분쟁, 부정거래 조사,\n법령상 보관 의무가 있는 경우 해당 개인정보는 필요한 범위에서 보관될 수\n있습니다.\n\n제23조 (개인정보의 안전성 확보조치)\n\n회사는 개인정보가 분실, 도난, 유출, 위조, 변조 또는 훼손되지 않도록\n다음과 같은 기술적·관리적·물리적 보호조치를 취합니다.\n\n  -----------------------------------------------------------------------\n  구분              조치 내용\n  ----------------- -----------------------------------------------------\n  관리적 조치       개인정보 내부관리계획 수립, 개인정보 취급자 최소화,\n                    접근권한 관리, 임직원 보안서약, 정기 교육, 수탁사\n                    관리·감독, 개인정보 처리 현황 점검\n\n  기술적 조치       비밀번호 암호화, 전송구간 암호화, 개인정보 접근권한\n                    통제, 접속기록 보관 및 점검, 침입차단 및 탐지,\n                    악성코드 방지, 취약점 점검, 중요정보 암호화 또는 이에\n                    준하는 보호조치\n\n  물리적 조치       전산실, 자료보관실, 개인정보 보관장소 접근통제, 문서\n                    잠금 보관, 출력물 관리, 파기 절차 관리\n\n  서비스 운영상     계좌정보 표시 최소화, 거래 상대방 제공 정보 최소화,\n  조치              이체영수증 등 증빙자료 접근권한 제한, 고객센터\n                    상담자료 접근권한 제한, 부정거래 조사자료 별도 관리\n\n  사고 대응 조치    개인정보 유출 또는 침해사고 발생 시 사실 확인, 피해\n                    최소화 조치, 정보주체 통지, 관계기관 신고, 재발방지\n                    대책 수립\n  -----------------------------------------------------------------------\n\n제24조 (개인정보 보호책임자 및 고충처리 부서)\n\n회사는 개인정보 처리에 관한 업무를 총괄하고 개인정보 처리와 관련한\n정보주체의 불만 처리 및 피해구제를 위하여 개인정보 보호책임자를\n지정합니다. 실제 서비스 게시 전 아래 내용을 확정 정보로 기재하여야\n합니다.\n\n  -----------------------------------------------------------------------\n  구분              내용\n  ----------------- -----------------------------------------------------\n  개인정보          성명: ____________________ / 직책:\n  보호책임자        ____________________ / 연락처: ____________________ /\n                    전자우편: ____________________\n\n  개인정보 업무     부서명: ____________________ / 담당자:\n  담당부서          ____________________ / 연락처: ____________________ /\n                    전자우편: ____________________\n\n  고객센터          전화: ____________________ / 전자우편:\n                    ____________________ / 운영시간: ____________________\n\n  주소              ____________________\n  -----------------------------------------------------------------------\n\n1. 정보주체는 회사의 서비스를 이용하면서 발생하는 모든 개인정보 보호\n관련 문의, 불만처리, 피해구제, 열람·정정·삭제·처리정지 요청을 개인정보\n보호책임자 또는 담당부서에 문의할 수 있습니다.\n\n2. 회사는 정보주체의 문의에 대하여 지체 없이 답변 및 처리하도록\n노력합니다.\n\n3. 개인정보 보호책임자 또는 담당부서 정보가 변경되는 경우 회사는 본\n방침을 지체 없이 수정하여 공개합니다.\n\n제25조 (권익침해 구제방법)\n\n정보주체는 개인정보 침해에 대한 신고, 상담 또는 분쟁조정을 아래 기관에\n문의할 수 있습니다. 아래 기관은 회사와 별개의 기관이며, 회사의 자체적인\n개인정보 불만처리 또는 피해구제 결과에 만족하지 못하거나 보다 자세한\n도움이 필요한 경우 이용할 수 있습니다.\n\n  -------------------------------------------------------------------------\n  기관                     연락처 및 홈페이지\n  ------------------------ ------------------------------------------------\n  개인정보침해신고센터     국번없이 118 / privacy.kisa.or.kr\n\n  개인정보분쟁조정위원회   1833-6972 / www.kopico.go.kr\n\n  대검찰청 사이버수사 관련 국번없이 1301 / www.spo.go.kr\n  창구                     \n\n  경찰청 사이버범죄        국번없이 182 / ecrm.police.go.kr\n  신고시스템               \n  -------------------------------------------------------------------------\n\n제26조 (개인정보처리방침의 공개 및 변경)\n\n1. 회사는 본 방침을 서비스 초기 화면, 회원가입 화면, 설정 화면, 웹사이트\n또는 기타 정보주체가 쉽게 확인할 수 있는 위치에 공개합니다.\n\n2. 회사가 본 방침을 변경하는 경우 변경 내용, 변경 사유 및 시행일을\n명시하여 시행일 전 서비스 내 공지사항, 앱 알림, 전자우편, 문자메시지\n또는 기타 합리적인 방법으로 안내합니다.\n\n3. 개인정보의 수집·이용 목적, 수집 항목, 제3자 제공, 국외 이전, 보유기간\n등 정보주체의 권리에 중대한 영향을 미치는 변경이 있는 경우 회사는 관련\n법령에 따라 필요한 동의를 받거나 별도 안내 절차를 진행합니다.\n\n4. 이전 개인정보처리방침은 정보주체가 확인할 수 있도록 별도 보관하거나\n변경 이력을 안내할 수 있습니다.\n\n5. 본 방침은 ______년 ______월 ______일부터 시행합니다.\n\n부속서 1. 개인정보 수집·이용 동의서\n\n아래 동의서는 회원가입 화면 또는 서비스 화면에서 별도 체크박스 형태로\n제공하는 것을 권장합니다. 필수 동의와 선택 동의는 명확히 구분하여야\n합니다.\n\n  ------------------------------------------------------------------------------------------\n  처리 목적                 수집 항목            이용 목적         보유 및 이용기간   구분\n  ------------------------- -------------------- ----------------- ------------------ ------\n  회원가입 및 계정관리      이름, 생년월일,      회원가입, 회원    회원 탈퇴 시까지.  필수\n                            휴대전화번호,        식별, 계정관리,   단, 법령상 보관    \n                            회원번호, 계정상태,  1인 1계정 운영    또는 분쟁 대응     \n                            동의 이력                              필요 시 해당       \n                                                                   기간까지           \n\n  성인확인 및 본인확인      이름, 생년월일,      만 19세 이상      회원 탈퇴 시까지   필수\n                            휴대전화번호,        확인, 명의도용    또는 본인확인기관  \n                            통신사, 본인확인     방지              정책 및 법령상     \n                            결과값, 인증일시                       보관기간까지       \n\n  계좌 등록 및 직접송금     은행명, 계좌번호,    직접송금 거래,    회원 탈퇴 또는     필수\n  거래                      예금주명, 계좌       거래대금 송금     계좌 삭제 시까지.  \n                            등록·변경 이력, 환불 안내, 환불,       단,                \n                            계좌정보             오입금·초과입금   거래·분쟁·법령상   \n                                                 처리              보관 필요 시 해당  \n                                                                   기간까지           \n\n  포인트·아이템·매칭·거래   포인트 내역, 아이템  서비스 제공,      거래 완료 후 5년   필수\n  관리                      내역,                거래이행, 포인트  또는 법령상        \n                            구매예약·판매예약,   정산, 분쟁예방    보관기간까지       \n                            매칭번호, 거래번호,                                       \n                            거래금액, 거래상태,                                       \n                            입금완료·입금확인                                         \n                            내역                                                      \n\n  신고·분쟁처리·부정거래    신고내용, 증빙자료,  신고 처리, 분쟁   처리 완료 후 3년.  필수\n  방지                      이체영수증,          해결, 부정거래    단, 수사·소송·분쟁 \n                            계좌거래내역,        방지, 회원 보호   계속 시 종료       \n                            상담기록, 접속기록,                    시까지             \n                            기기정보, 패널티                                          \n                            이력                                                      \n\n  마케팅 및 이벤트 안내     휴대전화번호,        이벤트, 혜택,     동의 철회 또는     선택\n                            전자우편, 앱 푸시    프로모션, 서비스  회원 탈퇴 시까지   \n                            토큰, 마케팅 수신    소식 안내                            \n                            동의 여부, 이벤트                                         \n                            참여정보                                                  \n  ------------------------------------------------------------------------------------------\n\n동의 거부 안내: 정보주체는 개인정보 수집·이용에 동의하지 않을 권리가\n있습니다. 다만 필수 항목에 대한 동의를 거부하는 경우 회원가입 또는\n서비스 이용이 제한될 수 있으며, 선택 항목에 대한 동의를 거부하더라도\n기본 서비스 이용에는 제한이 없습니다.\n\n부속서 2. 개인정보 제3자 제공 동의서\n\n직접송금 거래 구조상 매칭된 거래 상대방에게 필요한 최소한의 계좌정보 및\n거래확인 정보가 제공됩니다. 회원가입 또는 최초 거래 전 별도 체크박스\n동의를 받는 것을 권장합니다.\n\n  ----------------------------------------------------------------------------\n  제공받는 자    제공 목적         제공 항목                   보유 및\n                                                               이용기간\n  -------------- ----------------- --------------------------- ---------------\n  매칭된 구매자  직접송금 거래     매칭번호, 거래번호,         거래 완료 및\n  또는 판매자    이행, 입금확인,   거래금액, 거래상태,         분쟁처리 종료\n                 거래금액 확인,    판매자의                    시까지. 단,\n                 신고 및 분쟁처리  은행명·계좌번호·예금주명,   법령상 보관기간\n                                   구매자의 입금완료 정보,     또는 분쟁 대응\n                                   입금자명 등 거래확인에      기간까지 보관\n                                   필요한 최소 정보            가능\n\n  본인확인기관   본인확인,         이름, 생년월일,             본인확인기관\n                 성인확인,         휴대전화번호, 통신사,       정책 및 관련\n                 명의도용 방지     본인확인 요청정보, 본인확인 법령에 따름\n                                   결과값                      \n\n  결제대행사,    포인트 충전, 결제 결제금액, 결제수단,         결제 처리 및\n  카드사, 은행,  승인, 결제 취소,  승인번호, 거래일시,         법령상\n  간편결제사     환불, 부정결제    환불정보, 결제처리정보      보관기간까지\n                 방지                                          \n  ----------------------------------------------------------------------------\n\n동의 거부 안내: 정보주체는 제3자 제공에 동의하지 않을 권리가 있습니다.\n다만 직접송금 거래 이행에 필요한 제3자 제공에 동의하지 않는 경우 매칭,\n거래, 입금확인, 신고 및 분쟁처리 등 서비스 이용이 제한될 수 있습니다.\n\n부속서 3. 개인정보 처리위탁 현황\n\n아래 표는 게시 전 실제 계약 업체명으로 반드시 교체하여야 합니다. 실제\n수탁사가 확정되지 않은 항목은 “해당 없음”으로 표시하거나 게시 전\n삭제하십시오.\n\n  ------------------------------------------------------------------------\n  수탁사                 위탁업무                        게시 전 확인사항\n  ---------------------- ------------------------------- -----------------\n  본인확인기관           휴대전화 본인확인, 성인확인     실제 계약기관\n                                                         확정 필요\n\n  문자/알림 발송업체     인증번호, 거래 알림, 공지 발송  실제 계약기관\n                                                         확정 필요\n\n  결제대행사(PG)         포인트 충전 결제, 취소, 환불    실제 계약기관\n                                                         확정 필요\n\n  클라우드/서버 사업자   데이터 저장, 서버 운영, 백업    실제 계약기관\n                                                         확정 필요\n\n  고객상담 시스템        상담 접수, 신고, 분쟁처리 관리  실제 계약기관\n                                                         확정 필요\n\n  보안관제/로그 분석     보안점검, 이상거래 탐지, 장애   실제 계약기관\n  업체                   분석                            확정 필요\n  ------------------------------------------------------------------------\n\n부속서 4. 이용약관 대조 검수표\n\n본 검수표는 이용약관 v3.6의 주요 조항과 본 개인정보처리방침의 연동\n여부를 확인하기 위한 내부 점검표입니다. 실제 게시 문서에는 필요에 따라\n삭제하거나 내부 관리용으로만 보관할 수 있습니다.\n\n  ------------------------------------------------------------------------\n  이용약관 핵심사항               본 방침 반영 위치          검수 결과\n  ------------------------------- -------------------------- -------------\n  회원가입 필수정보: 이름,        제6조, 제9조, 부속서 1     반영\n  생년월일, 휴대전화번호,                                    \n  계좌번호, 은행명, 예금주명,                                \n  성인 여부                                                  \n\n  만 19세 이상 성인 전용,         제9조, 제17조              반영\n  미성년자 가입 제한                                         \n\n  1인 1계정,                      제5조, 제9조, 제12조       반영\n  다중계정·명의도용·계좌도용 방지                            \n\n  계좌 등록 및 본인 명의 계좌     제10조, 부속서 1           반영\n  원칙                                                       \n\n  구매자와 판매자 간 직접송금     제10조, 제14조, 부속서 2   반영\n  구조, 거래 상대방 정보 제공                                \n\n  포인트 충전·사용·교환·환불,     제11조, 부속서 1           반영\n  충전포인트/교환포인트 구분                                 \n\n  디지털 거래 아이템, 구매예약,   제11조, 부속서 1           반영\n  판매예약, 매칭, 보유기간, 판매                             \n  가능일                                                     \n\n  이체영수증, 계좌거래내역,       제10조, 제12조, 부속서 1   반영\n  증빙자료 제출                                              \n\n  미입금, 금액 오류, 초과입금,    제12조, 제8조              반영\n  오입금, 허위신고, 증빙자료 조작                            \n\n  부정거래 및 이상거래 탐지,      제12조, 제21조             반영\n  이용제한, 패널티, 수사기관 신고                            \n\n  고객센터, 신고, 이의제기,       제13조, 제17조, 제24조     반영\n  분쟁처리                                                   \n\n  전자문서 및 통지, 앱 푸시,      제5조, 제13조, 제19조      반영\n  문자, 이메일 안내                                          \n\n  개인정보처리방침과 관련 법령    제3조                      반영\n  우선 적용                                                  \n\n  약관 게시 전 회사정보,          표지, 제24조, 부속서 5     반영\n  고객센터, 전자우편, 시행일 확인                            \n  ------------------------------------------------------------------------\n\n부속서 5. 서비스 게시 전 필수 확인표\n\n  • 회사명, 대표자, 사업자등록번호, 통신판매업 신고번호, 주소, 고객센터,\n  전자우편, 시행일을 실제 정보로 입력\n\n  • 개인정보 보호책임자, 개인정보 담당부서, 연락처, 전자우편 확정\n\n  • 본인확인기관 사용 여부 및 수탁사명 확정\n\n  • 결제대행사(PG), 카드사, 간편결제사, 은행 등 결제 관련 사업자 확정\n\n  • 문자 발송, 푸시 알림, 이메일 발송, 고객상담 시스템, 클라우드,\n  보안관제 수탁사 확정\n\n  • 국외 클라우드 또는 해외 SaaS 사용 여부 확인 및 국외 이전 조항 수정\n\n  • 마케팅 수신 동의 사용 여부 확인 및 선택 동의 화면 분리\n\n  • 회원가입 화면에 이용약관, 개인정보처리방침, 개인정보 수집·이용 동의,\n  개인정보 제3자 제공 동의, 운영정책 동의, 만 19세 이상 확인 체크박스\n  구현\n\n  • 직접송금 거래 화면에서 거래 상대방에게 제공되는 계좌정보 범위와\n  표시방식 확인\n\n  • 이체영수증, 계좌거래내역 등 증빙자료 업로드 시 접근권한 및 보관기간\n  확인\n\n  • 탈퇴, 환불, 신고, 분쟁처리, 부정거래 조사 시 개인정보 보관 기준 확인\n\n  • 쿠키, SDK, 광고식별자, 앱 권한, 푸시 토큰 수집 여부 확인\n\n  • 개인정보처리방침 변경 이력 관리 방식 확인\n\n  • 서비스 실제 화면, 운영정책, 이용약관, 개인정보처리방침의 용어 통일:\n  디지털 거래 아이템, 수정, 루비, 다이아, 충전포인트, 교환포인트,\n  직접송금, 플랫폼 참여 거래\n\n  • 법무 또는 개인정보보호 전문가의 최종 검토 후 게시\n\n본 문서는 루페이 서비스 구조를 기준으로 작성한 서비스 게시용\n개인정보처리방침 초안입니다. 실제 서비스 오픈 전 회사의 실제 업무흐름,\n수탁사, 결제수단, 본인확인 방식, 서버 위치, 앱 권한, 데이터베이스\n보관정책, 고객센터 운영정책에 맞게 최종 확인하고 필요한 경우 전문 법률\n검토를 받아야 합니다." }
};
var _currentTermsKey = '';

function showTermsModal(key){
  _currentTermsKey = key;
  var d = _termsData[key];
  if(!d) return;
  document.getElementById('terms-modal-title').textContent = d.title;
  document.getElementById('terms-modal-body').textContent = d.text;
  var m = document.getElementById('terms-modal');
  m.style.display = 'flex';
}

function closeTermsModal(){
  document.getElementById('terms-modal').style.display = 'none';
}

function agreeFromModal(){
  if(_currentTermsKey && _termsData[_currentTermsKey]){
    var cb = document.getElementById(_termsData[_currentTermsKey].checkId);
    if(cb) cb.checked = true;
    onAgreeChange();
  }
  closeTermsModal();
}

function onAgreeAll(el){
  var ids = ['agree-age','agree-terms','agree-policy','agree-privacy','agree-account','agree-structure','agree-invest'];
  ids.forEach(function(id){ var cb=document.getElementById(id); if(cb) cb.checked=el.checked; });
}

function onAgreeChange(){
  var ids = ['agree-age','agree-terms','agree-policy','agree-privacy','agree-account','agree-structure','agree-invest'];
  var allChecked = ids.every(function(id){ var cb=document.getElementById(id); return cb&&cb.checked; });
  var allCb = document.getElementById('agree-all');
  if(allCb) allCb.checked = allChecked;
}

function onBirthday(el){
  var v = el.value.replace(/[^0-9]/g,'');
  if(v.length > 4) v = v.slice(0,4)+'-'+v.slice(4);
  if(v.length > 7) v = v.slice(0,7)+'-'+v.slice(7);
  el.value = v.slice(0,10);
}


async function doRegister(){
  var realName=(document.getElementById('reg-real-name')||{}).value||''; realName=realName.trim();
  var birthday=(document.getElementById('reg-birthday')||{}).value||''; birthday=birthday.trim();
  var username=document.getElementById('reg-username').value.trim();
  var password=document.getElementById('reg-password').value;
  var password2=(document.getElementById('reg-password2')||{}).value||'';
  var phone=document.getElementById('reg-phone').value.trim();
  var bank=document.getElementById('reg-bank').value.trim();
  var accountNo=document.getElementById('reg-account-no').value.trim();
  var accountName=document.getElementById('reg-account-name').value.trim();
  var errEl=document.getElementById('register-error');
  errEl.textContent='';

  // 필수 약관 체크
  var agreeIds=['agree-age','agree-terms','agree-policy','agree-privacy','agree-account','agree-structure','agree-invest'];
  var allAgreed=agreeIds.every(function(id){var cb=document.getElementById(id);return cb&&cb.checked;});
  if(!allAgreed){errEl.textContent='모든 필수 항목에 동의해주세요.';return;}

  if(!realName){errEl.textContent='본인 이름을 입력해주세요.';return;}
  if(!username||!password){errEl.textContent='아이디와 비밀번호는 필수입니다.';return;}
  if(!/^[a-z0-9]{6,16}$/.test(username)){errEl.textContent='아이디는 영어 소문자와 숫자만 가능, 6~16자입니다.';return;}
  if(password.length<8||password.length>20){errEl.textContent='비밀번호는 8~20자로 입력해주세요.';return;}
  if(password2&&password!==password2){errEl.textContent='비밀번호가 일치하지 않습니다.';return;}

  try{
    var body={username,password,phone,bank,account_no:accountNo,account_name:accountName,real_name:realName};
    if(birthday) body.birthday=birthday;
    var r=await fetch('/api/auth/register',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
    var d=await r.json();
    if(d.success){
      document.getElementById('register-form').style.display='none';
      document.getElementById('register-done').style.display='block';
    } else { errEl.textContent=d.error||'회원가입 실패'; }
  }catch(e){errEl.textContent='오류: '+e.message;}
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
  1:{bz_min:1,bz_max:3,sv_min:0,sv_max:1,gd_min:0,gd_max:1},
  2:{bz_min:1,bz_max:6,sv_min:2,sv_max:3,gd_min:1,gd_max:2},
  3:{bz_min:1,bz_max:10,sv_min:4,sv_max:5,gd_min:2,gd_max:3},
  4:{bz_min:1,bz_max:14,sv_min:6,sv_max:7,gd_min:4,gd_max:5},
  5:{bz_min:1,bz_max:20,sv_min:8,sv_max:9,gd_min:6,gd_max:7},
  6:{bz_min:1,bz_max:27,sv_min:10,sv_max:13,gd_min:8,gd_max:9},
  7:{bz_min:1,bz_max:34,sv_min:14,sv_max:17,gd_min:10,gd_max:12},
  8:{bz_min:1,bz_max:42,sv_min:18,sv_max:22,gd_min:13,gd_max:15},
  9:{bz_min:1,bz_max:51,sv_min:23,sv_max:27,gd_min:16,gd_max:20},
  10:{bz_min:1,bz_max:60,sv_min:28,sv_max:34,gd_min:21,gd_max:26}
};
function changeRes(t, delta){
  if(!userData) return;  // userData 로드 전엔 UI 업데이트 안 함
  var cfg=userData.level_config||LEVEL_CFG_JS[userData.level||1]||LEVEL_CFG_JS[1];
  var BZ_MIN=(cfg.bz_min!=null?cfg.bz_min:0), BZ_MAX=cfg.bz_max||3;
  var SV_MAX=cfg.sv_max||0, GD_MAX=cfg.gd_max||0;
  if(t==='bz'){
    var _prevBz = bzCnt;
    if(delta>0 && bzCnt===0){ bzCnt=BZ_MIN; }
    else if(delta<0 && bzCnt===BZ_MIN){ bzCnt=0; svCnt=0; gdCnt=0; }
    else { bzCnt=Math.min(Math.max(bzCnt+delta, BZ_MIN), BZ_MAX); }
    var _newSvMax = (typeof getSvFromBz==='function') ? getSvFromBz(bzCnt) : SV_MAX;
    if(bzCnt < BZ_MIN){ svCnt=0; gdCnt=0; }
    else if(bzCnt === BZ_MAX && _prevBz < BZ_MAX && _newSvMax > 0){
      // 수정 BZ_MAX 도달 시 루비/다이아 자동 최솟값으로 점프
      svCnt = _newSvMax;
      var _newGdMax = (typeof getGdFromSv==='function') ? getGdFromSv(svCnt) : GD_MAX;
      gdCnt = _newGdMax > 0 ? _newGdMax : 0;
    } else if(bzCnt < BZ_MAX){
      // BZ_MAX 미만으로 내려가면 루비/다이아 0으로 초기화
      svCnt=0; gdCnt=0;
    } else if(svCnt > _newSvMax){ svCnt=_newSvMax; gdCnt=0; }
  } else if(t==='sv'){
    if(bzCnt >= BZ_MAX && SV_MAX > 0){
      svCnt = Math.min(Math.max(svCnt+delta, 0), SV_MAX);
      if(svCnt < SV_MAX){
        gdCnt=0;
      } else {
        // 루비 SV_MAX 도달 시 다이아 자동 최솟값으로 점프
        var _newGdMax2 = (typeof getGdFromSv==='function') ? getGdFromSv(svCnt) : GD_MAX;
        if(delta > 0 && _newGdMax2 > 0) gdCnt = _newGdMax2;
      }
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
    // 변경 시에만 DOM 업데이트 (깜박임 방지)
    if(reserveBtn._lastBtnOk !== _btnOk){
      reserveBtn._lastBtnOk = _btnOk;
      reserveBtn.disabled = !_btnOk;
      reserveBtn.style.opacity = _btnOk ? '' : '0.4';
      reserveBtn.style.background = '';
      reserveBtn.style.cursor = _btnOk ? '' : 'not-allowed';
      if(!isReserveTime) reserveBtn.title = '구매·판매 예약은 05:00~20:00에만 가능합니다';
      else if(_noPoints) reserveBtn.title = '포인트가 부족합니다';
      else reserveBtn.title = '';
    }
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
    var _syncTok = localStorage.getItem('lp_token');
    var _syncOpts = _syncTok ? {headers:{'Authorization':'Bearer '+_syncTok}} : {};
    var res = await fetch('/api/current-time', _syncOpts);
    var d = await res.json();
    // 거래정지 상태는 loadUserData에서만 처리 (5초마다 자동 갱신)
    // syncServerTime은 시간 동기화만 담당
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
    // 정각 감지: 14:00, 19:00, 20:00에 스케줄러 자동 호출 (미입금/입금확인 즉시 처리)
    try {
      var _effNow = getEffectiveDate();
      var _hh = (_effNow.getUTCHours()+9)%24;
      var _mm = (_effNow.getUTCMinutes());
      var _ss = (_effNow.getUTCSeconds());
      // 정각 1분 이내 & 처리 시각(14, 19, 20시)
      if(_mm === 0 && (_hh===14||_hh===19||_hh===20)){
        var _schedKey = 'sched_'+_hh+'_'+_effNow.toISOString().slice(0,13);
        if(!window._lastSchedRun || window._lastSchedRun !== _schedKey){
          window._lastSchedRun = _schedKey;
          fetch('/api/scheduler/auto-process',{method:'POST',
            headers:{'X-Scheduler-Key':'loopay-scheduler-2026'}
          }).then(function(){
            // 스케줄러 실행 후 1초 후 알림 체크 (DB 반영 대기)
            setTimeout(function(){ loadNotifBadge(); }, 1000);
          }).catch(function(){});
        }
      }
    } catch(e2){}
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
  // 5초마다 거래정지 상태만 체크 (/api/user/me의 suspended_until)
  if(window._suspendCheckInterval) clearInterval(window._suspendCheckInterval);
  window._suspendCheckInterval = setInterval(function(){
    var _ck_tok = localStorage.getItem('lp_token');
    if(!_ck_tok || !window.userData) return;
    fetch('/api/user/me', {headers:{'Authorization':'Bearer '+_ck_tok}})
      .then(function(r){ return r.json(); })
      .then(function(me){
        // 현재 userData.id와 me.id가 일치할 때만 적용
        if(!me || !me.id || !window.userData || me.id !== window.userData.id) return;
        if(me.suspended_until !== window.userData.suspended_until){
          window.userData.suspended_until = me.suspended_until;
          checkSuspended(me);
          // 패널티 탭이 열려있으면 갱신
          if(document.getElementById('tab-penalty')?.classList?.contains('active')){
            if(typeof loadPenaltyTab === 'function') loadPenaltyTab();
          }
        }
      }).catch(function(){});
  }, 5000);
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
    // 구매일 기준 최신순 정렬
    items.sort(function(a,b){ return (b.purchase_date||'').localeCompare(a.purchase_date||'') || b.id - a.id; });
    // 판매선택된 아이템을 맨 위로
    items.sort(function(a,b){ return (!!_sellSelected[String(b.id)] ? 1 : 0) - (!!_sellSelected[String(a.id)] ? 1 : 0); });
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
    var _clickedBarType2 = clickedInfo ? clickedInfo.bar_type : null;
    for(var i=0;i<selectedIds.length;i++){
      var k2=selectedIds[i];
      var info2=_itemCache[k2]||_itemCache[Number(k2)];
      // 같은 bar_type 내에서만 날짜 비교
      if(info2 && info2.bar_type===_clickedBarType2 && info2.purchase_date && info2.purchase_date!==cd2){_diffDate2=true;break;}
    }
    if(_diffDate2){
      showConfirm({
        title: '📅 날짜 불일치',
        message: '같은 종류 아이템(수정/루비/다이아)은\n구매일이 같은 것끼리만 판매예약 할 수 있습니다.',
        okText: '확인',
        hideCancelBtn: true
      });
      return;
    }
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
    // 2차 매칭이 실행됐으면 unmatched(2차대기) 예약은 숨김 (완료 처리됨)
    if(d && d.r2_ran_today) {
      buys = buys.filter(function(b){ return b.status !== 'unmatched'; });
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
    var statusLabel = {waiting:'매칭대기',unmatched:'2차대기',lucky_waiting:'🍀 행운예약중',lucky_matched:'🍀 행운매칭완료',pending:'매칭완료',matched:'매칭완료',paid:'송금완료',confirmed:'✅ 거래완료',unpaid:'미입금',failed:'미입금'}[m.status]||m.status;
    var statusColor = {waiting:'#90caf9',unmatched:'#ff9800',lucky_waiting:'#7b1fa2',lucky_matched:'#7b1fa2',pending:'#f9a825',matched:'#f9a825',paid:'#1976d2',confirmed:'#66bb6a',unpaid:'#ef5350'}[m.status]||'#aaa';
    var _isLoopay = (m.seller_username==='loopay' || m.seller_nickname==='루페이');
    var hasMatchInfo = _isLoopay || !!(m.seller_phone || m.seller_bank || m.seller_account);
    var dateTxt = m.source==='reservation'?m.reserve_date:(m.match_date||'');
    var isLucky = !!(m.lucky_pair_id);
    var luckyBadge = isLucky ? '<span style="display:inline-block;background:#7b1fa2;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px;margin-left:6px;vertical-align:middle">🍀 행운</span>' : '';

    if(m.status==='waiting'){
      return '<div style="padding:10px 12px;margin-bottom:6px;border:1px solid var(--border);border-radius:8px;background:var(--bg)">'        +'<div style="display:flex;justify-content:space-between;align-items:center">'        +'<strong style="color:'+TYPE_COLOR[m.bar_type]+'">'+TYPE_NAME[m.bar_type]+(m.stage?' '+m.stage+'단계':'')+'</strong>'+luckyBadge        +'<span style="font-size:11px;color:'+statusColor+'">'+statusLabel+'</span>'        +'</div>'        +'<div style="font-size:11px;color:var(--text2);margin-top:4px">⏳ 매칭 대기 중'+(dateTxt?' · '+dateTxt:'')+'</div>'        +'</div>';
    }

    var infoHtml = '';
    if(hasMatchInfo){
      if(_isLoopay){
        var _lacct = m.seller_account||'';
        var _lbank = m.seller_bank||'루페이';
        var _lname = m.seller_account_name||'루페이';
        var _lphone = m.seller_phone||'';
        infoHtml = '<div style="font-size:12px;color:var(--text2);margin:6px 0;line-height:1.9">'
          +'<div>🤖 <span style="color:#7b1fa2;font-weight:600">루페이</span> 판매 매칭</div>'
          +'<div>🏦 은행: <span style="color:var(--text)">'+_lbank+'</span></div>'
          +'<div>💳 계좌: <span style="color:var(--text);font-weight:600">'+(_lacct||'-')+'</span>'
          +(_lacct ? ' <button onclick="_copyAcct(\''+_lacct+'\',this)" style="background:none;border:none;cursor:pointer;font-size:13px;padding:0 4px" title="복사">📋 계좌번호 복사</button>' : '')
          +'</div>'
          +'<div>👤 예금주: <span style="color:var(--text)">'+_lname+'</span></div>'
          +(_lphone ? '<div>📞 전화: <span style="color:var(--text)">'+_lphone+'</span></div>' : '')
           +(m.buy_price?'<div>💰 송금금액: <span style="color:#f9a825;font-weight:600">'+m.buy_price.toLocaleString()+'원</span></div>':'')
          +'</div>';
      } else {
      var _sellerAcct = m.seller_account||'';
      infoHtml = '<div style="font-size:12px;color:var(--text2);margin:6px 0;line-height:1.9">'
        +'<div>🏦 은행: <span style="color:var(--text)">'+(m.seller_bank||'-')+'</span></div>'
        +'<div>💳 계좌: <span style="color:var(--text);font-weight:600">'+(_sellerAcct||'-')+'</span>'
        +(_sellerAcct ? ' <button onclick="_copyAcct(\'' + _sellerAcct + '\',this)" style="background:none;border:none;cursor:pointer;font-size:13px;padding:2px 6px;color:#90caf9;vertical-align:middle;display:inline-flex;align-items:center;gap:3px;" title="계좌번호 복사">📋 계좌번호 복사</button>' : '')
        +'</div>'
        +'<div>👤 예금주: <span style="color:var(--text)">'+(m.seller_account_name||'-')+'</span></div>'
        +'<div>💰 입금액: <span style="color:#f9a825;font-weight:600">'+(m.sell_price?m.sell_price.toLocaleString()+'원':'-')+'</span></div>'
        +'</div>';
      } // end else (non-loopay)
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
    var statusLabel = {waiting:'매칭대기',unmatched:'2차대기',lucky_waiting:'예약대기',lucky_matched:'입금대기',pending:'입금대기',paid:'입금확인중',confirmed:'✅ 거래완료',unpaid:'미입금'}[m.status]||m.status;
    var statusColor = {waiting:'#90caf9',unmatched:'#ff9800',lucky_waiting:'#90caf9',lucky_matched:'#f9a825',pending:'#f9a825',paid:'#1976d2',confirmed:'#66bb6a',unpaid:'#ef5350'}[m.status]||'#aaa';
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
    // 입금확인 가능: paid 상태면 시간 무관, 아니면 1차 05~13, 2차 15~19
    var canConfirm = (m.status==='paid') || ((_sr===2) ? (h>=15 && h<19) : (h>=5 && h<13));
    // 미입금 버튼: 1차 13~14, 2차 19~20
    var canUnpaid = (_sr===2) ? (h>=19 && h<20) : (h>=13 && h<14);
    // 입금요청: 1차 12:30~13:00, 2차 18:30~19:00
    var canRequest = (_sr===2) ? (_totalMinSell >= 1110 && _totalMinSell < 1140) : (_totalMinSell >= 750 && _totalMinSell < 780);
    // paid 상태: 구매자 송금완료 → 판매자 입금확인+미입금 버튼 활성화 시간
    // 1차: paid이면 14:00까지 / 2차: paid이면 20:00까지
    // paid 상태면 시간 무관하게 입금확인/미입금 가능
    var canConfirmMin = (m.status==='paid') || ((_sr===2) ? (_totalMinSell<1200) : (_totalMinSell<840));
    var canUnpaidMin  = canConfirmMin;
    var btnHtml = '';
    if(m.status==='paid'){
      btnHtml = '<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap">';
      if(canConfirmMin){
        btnHtml += '<button onclick="doConfirmPayment('+m.id+')" style="padding:7px 14px;background:#388e3c;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">✅ 입금확인</button>';
        btnHtml += '<button onclick="doReportUnpaid('+m.id+')" style="padding:7px 14px;background:#c62828;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">❌ 미입금</button>';
      } else {
        btnHtml += '<div style="font-size:11px;color:#66bb6a;padding:4px 0">✅ 입금확인 시간 종료 (자동 처리됨)</div>';
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
      +'</div>'
      +(btnHtml?'<div style="padding:0 10px 8px">'+btnHtml+'</div>':'');
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
    if(el){el.disabled=true;el.style.opacity='0.3';}
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
  var _byUser = _reservedToday;
  var _bzM=document.getElementById('r-bz-m'); if(_bzM) _bzM.disabled=(_byUser || !_isRT || bzCnt<=0);
  var _bzP=document.getElementById('r-bz-p'); if(_bzP) _bzP.disabled=(_byUser || !_isRT || bzCnt>=BZ_MAX);
  // 예약 완료 시 수정 wrap 전체 비활성화
  var bzWrap = document.getElementById('r-bz-wrap');
  if(bzWrap){ bzWrap.style.opacity = _byUser ? '0.5' : ''; bzWrap.style.pointerEvents = _byUser ? 'none' : ''; }

  // 루비: 수정이 BZ_MIN 이상이면 자동으로 결정 (표시 목적)
  var _dynSvMax = (bzCnt>=BZ_MIN && typeof getSvFromBz==='function') ? getSvFromBz(bzCnt) : SV_MAX;
  var _svJumpMin = (bzCnt>=BZ_MIN && typeof getSvFromBz==='function') ? getSvFromBz(bzCnt) : 1;  // 현재 bz의 sv값
  var svUnlocked = (bzCnt >= BZ_MIN) && _dynSvMax > 0;
  // 수정이 BZ_MAX 미달이면 svCnt 강제 0
  if(!svUnlocked) svCnt = 0;
  sv = svCnt;
  var _svV=document.getElementById('r-sv-v'); if(_svV) _svV.textContent = sv;
  var _svRange=document.getElementById('r-sv-range'); if(_svRange) _svRange.textContent = svUnlocked
    ? '최소 '+SV_MIN+' / 최대 '+_dynSvMax
    : '(수정 '+BZ_MIN+'개 달성 시 선택 가능)';
  var _svNote=document.getElementById('r-sv-note'); if(_svNote) _svNote.textContent = '수정 '+BZ_MIN+'개 예약 시 루비 선택 가능';
  document.getElementById('r-sv-wrap').className = 'r-wrap'+(svUnlocked?'':' locked');
  var svWrap2 = document.getElementById('r-sv-wrap');
  if(svWrap2){ svWrap2.style.opacity = _byUser ? '0.5' : ''; svWrap2.style.pointerEvents = _byUser ? 'none' : ''; }
  var svMBtn = document.getElementById('r-sv-m');
  var svPBtn = document.getElementById('r-sv-p');
  if(svMBtn) svMBtn.disabled = true;  // 루비는 수정 수량에 따라 자동 결정
  if(svPBtn) svPBtn.disabled = true;

  // 다이아: 루비가 SV_MAX 도달해야 선택 가능
  var _dynGdMax = (sv>=_svJumpMin && sv>0 && typeof getGdFromSv==='function') ? getGdFromSv(sv) : GD_MAX;
  var _gdJumpMin = (sv>=_svJumpMin && sv>0 && typeof getGdFromSv==='function') ? getGdFromSv(sv) : 1;  // 현재 sv의 gd값
  var gdUnlocked = svUnlocked && (sv >= _svJumpMin) && _dynGdMax > 0;
  // bzNote: _svJumpMin, _gdJumpMin 정의 이후에 업데이트
  if(bzNote) bzNote.textContent='수정 '+BZ_MIN+'개 예약시 루비 '+_svJumpMin+'개 활성화 / 루비 '+_svJumpMin+'개 예약시 다이아 '+_gdJumpMin+'개 활성화';
  // 루비가 SV_MAX 미달이면 gdCnt 강제 0
  if(!gdUnlocked) gdCnt = 0;
  gd = gdCnt;
  var _gdV=document.getElementById('r-gd-v'); if(_gdV) _gdV.textContent = gd;
  var _gdRange=document.getElementById('r-gd-range'); if(_gdRange) _gdRange.textContent = gdUnlocked
    ? '최소 '+GD_MIN+' / 최대 '+_dynGdMax
    : '(루비 '+_svJumpMin+'개 달성 시 선택 가능)';
  var _gdNote=document.getElementById('r-gd-note'); if(_gdNote) _gdNote.textContent = '루비 '+_svJumpMin+'개 예약 시 다이아 선택 가능';
  document.getElementById('r-gd-wrap').className = 'r-wrap'+(gdUnlocked?'':' locked');
  var gdWrap2 = document.getElementById('r-gd-wrap');
  if(gdWrap2){ gdWrap2.style.opacity = _byUser ? '0.5' : ''; gdWrap2.style.pointerEvents = _byUser ? 'none' : ''; }
  var gdMBtn = document.getElementById('r-gd-m');
  var gdPBtn = document.getElementById('r-gd-p');
  if(gdMBtn) gdMBtn.disabled = true;  // 다이아는 루비/수정 수량에 따라 자동 결정
  if(gdPBtn) gdPBtn.disabled = true;

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

// ── 레벨 조정 ──────────────────────────────────────────
async function adjustLevel(delta){
  var lv = (userData && userData.level) || 1;
  var maxLv = (userData && userData.original_level) || lv;
  // 현재 레벨보다 강등된 경우 원래레벨이 max
  var topLv = Math.max(lv, maxLv);
  var newLv = lv + delta;
  if(newLv < 1 || newLv > topLv){ toast('조정 범위를 벗어났습니다 (1 ~ '+topLv+'레벨)', 'error'); return; }
  if(!confirm(lv+'레벨 → '+newLv+'레벨로 조정하시겠습니까?\n(예약 수량이 새 레벨 범위로 자동 조정됩니다)')) return;
  try{
    var r = await api('/user/adjust-level', {method:'POST', body:JSON.stringify({level: newLv})});
    if(r.success){
      toast(newLv+'레벨로 조정됐습니다', 'success');
      await loadUserData();
      renderLevelTab();
    } else { toast(r.error||'조정 실패', 'error'); }
  } catch(e){ toast('오류: '+e.message, 'error'); }
}

function _updateLevelAdjustUI(){
  var lv = (userData && userData.level) || 1;
  var origLv = (userData && userData.original_level) || lv;
  var consecutive = (userData && userData.consecutive_reserve_days) || 0;
  var topLv = Math.max(lv, origLv);

  var curLabel = document.getElementById('lv-current-label');
  var rangeLabel = document.getElementById('lv-range-label');
  var demotionLabel = document.getElementById('lv-demotion-label');
  var upBtn = document.getElementById('lv-up-btn');
  var downBtn = document.getElementById('lv-down-btn');

  if(curLabel) curLabel.textContent = lv + '레벨';
  if(rangeLabel){
    var cfg = (typeof LEVEL_CFG_JS !== 'undefined') ? LEVEL_CFG_JS[lv] : null;
    if(cfg) rangeLabel.textContent = '수정 '+cfg.bz_min+'~'+cfg.bz_max+'개 · 루비 '+(cfg.sv_max||0)+'개이하 · 다이아 '+(cfg.gd_max||0)+'개이하';
  }
  if(demotionLabel){
    if(origLv && lv < origLv){
      demotionLabel.textContent = '⚠️ 강등상태 (원래 '+origLv+'레벨) · 4일 연속 예약 시 회복 (현재 '+consecutive+'일)';
      demotionLabel.style.color = '#ef5350';
    } else {
      var remaining = 4 - (consecutive % 4);
      demotionLabel.textContent = '연속 예약 '+consecutive+'일 · '+remaining+'일 미예약 시 1레벨 강등';
      demotionLabel.style.color = consecutive >= 3 ? '#66bb6a' : '#f9a825';
    }
  }
  if(upBtn) upBtn.disabled = (lv >= topLv);
  if(downBtn) downBtn.disabled = (lv <= 1);
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

  _updateLevelAdjustUI();}



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
    // 거래정지 상태는 loadUserData에서만 처리
    // (loadNotifBadge에서 checkSuspended 호출 제거 - 다른 사용자 토큰 오적용 방지)
    // 새 알림(매칭완료 등) 감지 시 포인트 즉시 갱신
    if(unread > _lastUnreadCount && _lastUnreadCount >= 0){
      await loadUserData();
      if(window.userData) renderHeader(window.userData);
    }
    _lastUnreadCount = unread;
  }catch(e){
    // API 실패 시에도 기존 userData로 거래정지 체크 유지
    if(window.userData) checkSuspended(window.userData);
  }
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
  // suspended_until이 null이 아니면 거래정지 (서버가 null로 정리하므로 날짜 비교 불필요)
  var isSuspended = !!(d && d.suspended_until);
  // 상태 변경 없으면 스킵 (깜박임 방지)
  if(isSuspended === window._isSuspended) return;

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
      banner.innerHTML = '🚫 거래 정지 중 — 패널티 탭에서 해제하세요';
      // 처음 감지 시 toast 알림
      if(!window._suspendToastShown){
        window._suspendToastShown = true;
        if(typeof toast==='function') toast('🚫 미입금으로 인해 거래가 정지되었습니다.', 'error');
      }
    }
    // 로고 옆 거래정지 배지
    var badge = document.getElementById('suspend-badge');
    if(badge) badge.style.display='inline';
  } else {
    // ★ 정지 해제 시: cursor만 복원 (disabled는 disableReserveSection이 관리)
    ['r-bz-m','r-bz-p','r-sv-m','r-sv-p','r-gd-m','r-gd-p'].forEach(function(id){
      var el=document.getElementById(id);
      if(el){ el.style.cursor=''; }
    });
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
  // 거래정지 상태가 새로 변경됐을 때 toast
  if(isSuspended && !window._isSuspended){
    window._suspendToastShown = false;
  }
  var _wasSupended = window._isSuspended;
  // window._isSuspended 먼저 업데이트
  window._isSuspended = isSuspended;
  if(!isSuspended && _wasSupended){
    window._suspendToastShown = false;
  } else if(!isSuspended){
    window._suspendToastShown = false;
  }
}

// ── 패널티 탭 로드 ──────────────────────────────────────
async function loadPenaltyTab(){
  if(!localStorage.getItem('lp_token')) return;
  try {
    var d = await api('/user/penalties');
    if(typeof d.suspended_until !== 'undefined' && window.userData){
      window.userData.suspended_until = d.suspended_until;
    }
    var pending = d.pending_penalty;
    var btn      = document.getElementById('penalty-release-btn');
    var statusText = document.getElementById('penalty-status-text');
    var infoBox  = document.getElementById('my-penalty-info');
    var detailText = document.getElementById('penalty-detail-text');
    var isWaitingApproval = !!(pending && (pending.release_paid === 1 || pending.release_paid === true));
    var _isSuspendedNow   = !!(d.suspended_until);

    function _showBtn(){
      if(!btn) return;
      btn.removeAttribute('disabled');
      btn.disabled = false;
      btn.style.display = '';
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
      btn.textContent = '🔓 패널티 해제하기';
      btn.style.background = '#c62828';
    }
    function _hideBtn(){
      if(!btn) return;
      btn.style.display = 'none';
    }

    if(_isSuspendedNow){
      // 거래정지 중 → 반드시 버튼 표시
      if(infoBox) infoBox.style.display = 'block';
      if(!pending || pending.is_released){
        // 패널티 레코드 없거나 이미 해제 (거래정지만 남은 경우)
        _showBtn();
        if(detailText) detailText.innerHTML = '• 거래정지 상태입니다.<br>• 해제 포인트 충전 후 해제 버튼을 눌러주세요.';
        if(statusText){ statusText.textContent = ''; statusText.style.color = ''; }
      } else if(isWaitingApproval){
        // 포인트 납부 완료 → 대기중
        if(btn){
          btn.style.display = '';
          btn.disabled = true;
          btn.style.opacity = '0.5';
          btn.style.cursor = 'not-allowed';
          var suspendDays = pending.suspend_days || 0;
          btn.textContent = '⏳ 정지 ' + suspendDays + '일 후 자동 해제 예정';
          btn.style.background = '#546e7a';
        }
        var resumeAt = pending.release_at || null;
        var remainText = '';
        if(resumeAt){
          var _effD = typeof getEffectiveDate==='function' ? getEffectiveDate() : new Date();
          var todayStr = _effD.getFullYear()+'-'+String(_effD.getMonth()+1).padStart(2,'0')+'-'+String(_effD.getDate()).padStart(2,'0');
          var diffDays = Math.round((new Date(resumeAt.slice(0,10)+'T00:00:00') - new Date(todayStr+'T00:00:00')) / 86400000);
          remainText = diffDays > 0 ? resumeAt.slice(0,10)+' 01:00 자동 해제 (남은 '+diffDays+'일)' : diffDays===0 ? '오늘 01:00 자동 해제됩니다' : '곧 자동 해제됩니다';
        }
        if(statusText){ statusText.textContent = remainText || ('정지 '+(pending.suspend_days||0)+'일 경과 후 자동 해제'); statusText.style.color='#f9a825'; }
        if(detailText) detailText.innerHTML = '• 누적 미입금: '+(d.unpaid_count||0)+'회<br>• 해제 포인트: '+(pending.release_points||0).toLocaleString()+'P<br>• ⏳ '+(resumeAt?resumeAt.slice(0,10)+' 01:00':'정지 '+(pending.suspend_days||0)+'일 후')+' 자동 해제됩니다.';
      } else {
        // 미납부 → 해제 버튼 활성화
        _showBtn();
        if(statusText){ statusText.textContent = '미해제 패널티 있음 — 해제 포인트: '+(pending.release_points||0).toLocaleString()+'P'; statusText.style.color='#ef5350'; }
        if(detailText) detailText.innerHTML = '• 누적 미입금: '+(d.unpaid_count||0)+'회<br>• 해제 포인트: '+(pending.release_points||0).toLocaleString()+'P<br>• 해제 포인트 충전 후 해제 버튼을 눌러주세요.';
      }
    } else {
      // 거래정지 아님 → 버튼 숨김
      if(infoBox) infoBox.style.display = 'none';
      _hideBtn();
      if(statusText) statusText.textContent = '';
      var totalAll = d.penalties ? d.penalties.length : 0;
      if(totalAll > 0){
        var historyEl = document.getElementById('penalty-history-text');
        if(!historyEl){ historyEl=document.createElement('div'); historyEl.id='penalty-history-text'; historyEl.style.cssText='font-size:12px;color:#888;text-align:center;padding:8px;margin-bottom:8px'; var section=document.getElementById('penalty-release-section'); if(section) section.appendChild(historyEl); }
        historyEl.textContent = '누적 미입금: 총 '+totalAll+'회 (해제 완료)';
      }
    }
  } catch(e) {
    console.error('loadPenaltyTab:', e);
    // 실패 시 1.5초 후 1회 재시도
    if(localStorage.getItem('lp_token') && !loadPenaltyTab._retried){
      loadPenaltyTab._retried = true;
      setTimeout(function(){ loadPenaltyTab._retried=false; loadPenaltyTab(); }, 1500);
    }
  }
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
    // 구매일 기준 최신순 정렬
    _myItems.sort(function(a,b){ return (b.purchase_date||'').localeCompare(a.purchase_date||'') || b.id - a.id; });
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
  var msKr={pending:'대기',matched:'매칭완료',paid:'송금완료',confirmed:'거래완료',cancelled:'취소',failed:'미입금',unpaid:'미입금'};
  // match_round + buyer에 따른 라벨
  function getMatchLabel(item) {
    var ms = item.match_status;
    var round = item.match_round || 1;
    var isLoopay = item.is_loopay_match || item.buyer_username === 'loopay';
    if(!ms || ms === 'confirmed' || ms === 'failed') return null;
    if(isLoopay) {
      if(ms === 'pending') return {label:'시스템 입금대기', color:'#ab47bc', bg:'#ab47bc22'};
      if(ms === 'paid')    return {label:'시스템 입금확인중', color:'#ab47bc', bg:'#ab47bc22'};
    }
    if(round === 2) {
      if(ms === 'pending') return {label:'2차 입금대기', color:'#ff9800', bg:'#ff980022'};
      if(ms === 'paid')    return {label:'2차 입금확인중', color:'#ff9800', bg:'#ff980022'};
    }
    if(ms === 'pending') return {label:'1차 입금대기', color:'#f9a825', bg:'#f9a82522'};
    if(ms === 'paid')    return {label:'1차 입금확인중', color:'#42a5f5', bg:'#42a5f522'};
    return null;
  }
  var msColor={pending:'#888',matched:'#f9a825',paid:'#42a5f5',confirmed:'#66bb6a',cancelled:'#ef5350',failed:'#ef5350',unpaid:'#ef5350'};

  // 매칭 시간 여부: 서버에서 받은 값 사용 (더 정확)
  var _isMatchingTime = _isMatchingTimeServer;

  // 단계별 그룹 정의 (순서: 매칭/거래중 → 판매가능 → 판매예약중 → 보유중)
  var stages = [
    {key:'진행중',   label:'매칭/거래중', color:'#f9a825', filter:function(x){
      var ms = x.match_status;
      if(!ms) return false;
      // loopay 시스템 매치: 시간 무관 항상 표시
      if(x.is_loopay_match && (ms==='pending'||ms==='paid')) return true;
      // 매칭 시간(20~05시)에는 진행중 표시 안 함
      if(_isMatchingTime && (ms==='pending'||ms==='matched')) return false;
      // 05시 이후: pending/matched도 진행중으로 표시 (매칭 결과 공개)
      if(!_isMatchingTime && (ms==='pending'||ms==='matched')) return true;
      return ms==='paid' || ms==='confirmed' || ms==='unpaid' || ms==='failed';
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
    {key:'보유중',   label:'보유중',     color:'#64b5f6', filter:function(x){
      if(x.match_status && x.match_status!=='cancelled') return false;
      return x.status_label==='보유중';
    }},
  ];

  function renderCard(item){
    var ms = item.match_status;
    var _isBuyerRole = (item._role === 'buyer');
    var _roleBadge = _isBuyerRole
      ? '<span style="font-size:10px;background:#1565c033;color:#90caf9;padding:1px 6px;border-radius:6px;margin-left:4px">구매</span>'
      : '';
    var _stLabel = ms ? (msKr[ms]||ms) : (item.status_label||(item.status||''));
    // 매치 구분 배지 (1차/2차/시스템 입금대기)
    var _matchBadge = '';
    var _ml = (typeof getMatchLabel === 'function') ? getMatchLabel(item) : null;
    if(_ml) {
      _matchBadge = '<span style="font-size:10px;background:'+_ml.bg+';color:'+_ml.color+';padding:2px 7px;border-radius:6px;font-weight:700;margin-left:4px">'+_ml.label+'</span>';
    }
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
      // 서버 시간 실시간 계산 (고정값이 아닌 getEffectiveDate 사용)
      var _eff = (typeof getEffectiveDate === 'function') ? getEffectiveDate() : new Date();
      var _sh = _eff.getHours(), _sm = _eff.getMinutes();
      var _totalMin = _sh*60+_sm;
      var _inPayWin  = (_mRound===2)?(_totalMin>=900&&_totalMin<1140):(_totalMin>=300&&_totalMin<840);
      var _inWarnWin = (_mRound===2)?(_totalMin>=1110&&_totalMin<1140):(_totalMin>=750&&_totalMin<780);
      var _inConfWin = (_mRound===2)?(_totalMin>=1140&&_totalMin<1200):(_totalMin>=780&&_totalMin<840);
      // loopay 시스템 매치(paid): 시간 무관 입금확인 가능
      if(item.is_loopay_match && ms==='paid') { _inPayWin=true; _inConfWin=true; }
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
        +'<span style="font-size:13px;font-weight:700;color:'+(tC[item.bar_type]||'#fff')+'">'+( tN[item.bar_type]||item.bar_type)+' '+(item.stage||1)+'단계'+_roleBadge+_matchBadge+'</span>'
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
    if(r.success) { toast('입금확인 완료!','success'); loadSellTab(); loadUserData(); }
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

