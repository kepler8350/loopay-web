

function toast(msg, dur=2500){
  const el=document.getElementById('toast');
  el.textContent=msg;el.classList.add('show');
  setTimeout(()=>el.classList.remove('show'),dur);
}

async function api(path, opts={}){
  token = localStorage.getItem('lp_token')||''; token = localStorage.getItem('lp_token')||''; const headers={'Content-Type':'application/json'};
  if(token) headers['Authorization']='Bearer '+token;
  const r = await fetch(API+path,{...opts,headers:{...headers,...(opts.headers||{})}});
  const data = await r.json();
  if(!r.ok) throw new Error(data.error||'오류 발생');
  return data;
}

// --- auth -----------------------------------------------------------------

function loginKakao(){ toast('카카오 SDK 연동이 필요합니다. 데모 계정으로 체험해주세요.'); }

async function checkApiStatus(){
  try{
    await fetch(API+'/levels');
    document.getElementById('api-status').textContent='✅ 연결됨';
    document.getElementById('api-status').style.color='green';
  }catch{
    document.getElementById('api-status').textContent='⚠️ 서버 미실행 (데모 모드)';
    document.getElementById('api-status').style.color='orange';
  }
}

function showMainApp(){
  document.getElementById('login-screen').style.display='none';
  const m=document.getElementById('main-app');
  m.style.display='flex'; m.style.flexDirection='column'; m.style.height='100vh';

  updateTimeBanner();
}

// --- user data ------------------------------------------------------------
// (loadUserData 구버전 제거 - 신버전 사용)



function renderBars(d){
  const items=d.items; const res=d.reservable; const cfg=d.level_config;
  const types=['bronze','silver','gold'];
  const ids=['bz','sv','gd'];
  types.forEach((t,i)=>{
    const hold=items[t].length;
    const rv=res[t]||0;
    var el1=document.getElementById(ids[i]+'-hold'); if(el1) el1.textContent=hold+'개';
    var el2=document.getElementById(ids[i]+'-res'); if(el2) el2.textContent=rv+'개';
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
    if(!list||!list.length){el.innerHTML='<div style="color:var(--text2);font-size:13px;padding:8px 0">보유 아이템 없음</div>';return;}
    el.innerHTML=list.map(it=>{
      const day4note=(it.days>=4&&it.status_label==='매칭예약가능')?' — 미매칭 재예약':'';
      const profitStr=it.profit>=0?`+${it.profit.toLocaleString()}`:`${it.profit.toLocaleString()}`;
      const _barName2={bronze:'수정',silver:'루비',gold:'다이아'};
      const _canSell2=(it.days>=2&&it.status_label!=='판매중'&&it.status_label!=='매칭중'&&it.status_label!=='매칭완료'&&it.status_label!=='판매예약');
      return `<div class="item-row" onclick="toggleItemSellSelect(${it.id},'${t}')" style="cursor:pointer">
        <div class="item-hd">
          <span class="item-stage">${it.stage}단계 ${_barName2[t]}바</span>
          <span class="badge ${it.status_label==='대기중'?'badge-wait':'badge-match'}">${it.status_label}</span>
        </div>
        <div class="item-date">구매일: ${it.purchase_date} (${it.days}일째)</div>
        <div class="item-price">구매 <span style="color:#aaa">${it.buy_price.toLocaleString()}원</span> → 판매 <span style="color:#f9a825">${it.sell_price.toLocaleString()}원</span> <span style="color:#66bb6a;font-size:12px">(${profitStr}원)</span></div>
      </div>`;
    }).join('');
  });
}

// --- reservation ----------------------------------------------------------
function updateReserveDefaults(lv){
  var d=userData||{};
  var tr=d.today_reservations||{};
  var cfg=d.level_config||LEVEL_CFG_JS[lv]||LEVEL_CFG_JS[1];
  var BZ_MIN=(cfg.bz_min!=null?cfg.bz_min:0), BZ_MAX=cfg.bz_max||3;
  var todayBz=tr.bronze||0;
  bzCnt = todayBz > 0 ? Math.min(Math.max(todayBz,BZ_MIN),BZ_MAX) : BZ_MIN;
  // 루비/다이아는 항상 0으로 초기화 (매번 새로 선택)
  svCnt = 0;
  gdCnt = 0;
  updateResUI(BZ_MIN, BZ_MAX);
}


function changeRes(type,delta){
  var cfg=(userData&&userData.level_config)||LEVEL_CFG_JS[userData&&userData.level||1]||LEVEL_CFG_JS[1];
  var BZ_MIN=(cfg.bz_min!=null?cfg.bz_min:0), BZ_MAX=cfg.bz_max||3;
  var SV_MAX=cfg.sv_max||0, GD_MAX=cfg.gd_max||0;
  if(type==='bz'){
    bzCnt=Math.max(BZ_MIN,Math.min(BZ_MAX,bzCnt+delta));
    // 수정이 BZ_MAX 미달이면 루비/다이아 초기화
    if(bzCnt < BZ_MAX){ svCnt=0; gdCnt=0; }
  } else if(type==='sv'){
    // 루비는 수정이 BZ_MAX 도달해야만 조작 가능
    if(bzCnt >= BZ_MAX && SV_MAX > 0){
      svCnt=Math.max(0,Math.min(SV_MAX,svCnt+delta));
      // 루비가 SV_MAX 미달이면 다이아 초기화
      if(svCnt < SV_MAX) gdCnt=0;
    }
  } else if(type==='gd'){
    // 다이아는 루비가 SV_MAX 도달해야만 조작 가능
    if(bzCnt >= BZ_MAX && svCnt >= SV_MAX && GD_MAX > 0){
      gdCnt=Math.max(0,Math.min(GD_MAX,gdCnt+delta));
    }
  }
  updateResUI(BZ_MIN,BZ_MAX);
}

function showReserveConfirm(){
  // 모달을 body 직속으로 이동 (overflow 클리핑 방지)
  var ov=document.getElementById("reserve-confirm-overlay");
  if(ov && ov.parentElement!==document.body) document.body.appendChild(ov);
  var cfg=userData&&userData.level_config||LEVEL_CFG_JS[1];
  var BZ_MAX=cfg.bz_max||3;
  var sv=svCnt;
  var gd=gdCnt;
  var total=bzCnt+sv+gd;
  var cost=total*40;
  document.getElementById('rc-bz').textContent=bzCnt+'개';
  var svRow=document.getElementById('rc-sv-row');
  var gdRow=document.getElementById('rc-gd-row');
  svRow.style.display=sv>0?'flex':'none';
  gdRow.style.display=gd>0?'flex':'none';
  if(sv>0)document.getElementById('rc-sv').textContent=sv+'개';
  if(gd>0)document.getElementById('rc-gd').textContent=gd+'개';
  document.getElementById('rc-total').textContent=total+'회 / '+cost.toLocaleString()+'P 차감';
  document.getElementById('reserve-confirm-overlay').classList.add('show');
}
function closeReserveConfirm(){
  document.getElementById('reserve-confirm-overlay').classList.remove('show');
}

// ── 판매예약 보드 ──
function updateSellBoard(){
  var counts = {bronze:0, silver:0, gold:0};
  var names = {bronze:'수정', silver:'루비', gold:'다이아'};
  // _sellSelected 기반으로 각 바타입별 아이템 ID → 개수 계산
  // _itemCache에 아이템 정보가 있으면 사용, 없으면 id만으로 표시
  Object.keys(_sellSelected).forEach(function(id){
    if(!_sellSelected[id]) return;
    var info = _itemCache[id];
    if(info) counts[info.bar_type]++;
    else counts.bronze++; // fallback
  });
  var total = counts.bronze + counts.silver + counts.gold;
  document.getElementById('sell-board-bronze').textContent = counts.bronze;
  document.getElementById('sell-board-silver').textContent = counts.silver;
  document.getElementById('sell-board-gold').textContent = counts.gold;
  var btn = document.getElementById('sell-reserve-btn');
  var info = document.getElementById('sell-board-info');
  if(total > 0){
    var parts = [];
    if(counts.bronze) parts.push('수정 '+counts.bronze+'개');
    if(counts.silver) parts.push('루비 '+counts.silver+'개');
    if(counts.gold) parts.push('다이아 '+counts.gold+'개');
    info.textContent = parts.join(' / ') + ' 선택됨';
    info.style.color = '#7b1fa2';
    if(btn){ btn.disabled=false; btn.style.opacity='1'; }
  } else {
    info.textContent = '선택된 아이템 없음';
    info.style.color = 'var(--text2)';
    if(btn){ btn.disabled=true; btn.style.opacity='0.4'; }
  }
}

// 아이템 캐시 (id → {bar_type, stage, sell_price})
var _itemCache = {};

function showSellConfirm(){
  var names={bronze:'수정',silver:'루비',gold:'다이아'};
  // 선택된 아이템 목록 구성
  var selected = Object.keys(_sellSelected).filter(function(id){return _sellSelected[id];});
  if(!selected.length){ toast('판매예약할 아이템을 선택해주세요.'); return; }
  var rows = '';
  var totalPrice = 0;
  var groupByType = {bronze:[], silver:[], gold:[]};
  selected.forEach(function(id){
    var info = _itemCache[id];
    if(info){
      groupByType[info.bar_type].push(info);
      totalPrice += info.sell_price||0;
    }
  });
  Object.keys(groupByType).forEach(function(bt){
    var list = groupByType[bt];
    if(!list.length) return;
    list.forEach(function(it){
      rows += '<div class="reserve-confirm-row">'
        +'<span>'+names[bt]+' '+it.stage+'단계</span>'
        +'<span style="color:#f9a825">'+it.sell_price.toLocaleString()+'원</span>'
        +'</div>';
    });
  });
  rows += '<div class="reserve-confirm-row total-row">'
    +'<span>총 '+selected.length+'개 / 예상 수익</span>'
    +'<span>'+totalPrice.toLocaleString()+'원</span>'
    +'</div>';
  document.getElementById('sell-confirm-rows').innerHTML = rows;
  // 모달 body에 이동 후 표시
  var ov = document.getElementById('sell-confirm-overlay');
  if(ov.parentElement !== document.body) document.body.appendChild(ov);
  ov.classList.add('show');
}

function closeSellConfirm(){
  document.getElementById('sell-confirm-overlay').classList.remove('show');
}


// ── 회원정보 변경 ──
function loadProfileForm(){
  if(!userData) return;
  document.getElementById('prof-nickname').value = userData.nickname||'';
  document.getElementById('prof-phone').value = userData.phone||'';
  document.getElementById('prof-bank').value = userData.bank||'';
  document.getElementById('prof-account-no').value = userData.account_no||'';
  document.getElementById('prof-account-name').value = userData.account_name||'';
}
async function doUpdateProfile(){
  var data={
    nickname: document.getElementById('prof-nickname').value.trim(),
    phone: document.getElementById('prof-phone').value.trim(),
    bank: document.getElementById('prof-bank').value,
    account_no: document.getElementById('prof-account-no').value.trim(),
    account_name: document.getElementById('prof-account-name').value.trim(),
    new_password: document.getElementById('prof-new-pw').value.trim()
  };
  try{
    var d=await api('/user/update-profile',{method:'POST',body:JSON.stringify(data)});
    if(d.success){ toast('회원정보가 변경되었습니다 ✅'); await loadUserData(); }
    else toast(d.error||'변경 실패');
  }catch(e){toast('오류: '+e.message);}
}

// ── 거래내역 ──
async function loadTradeHistory(){
  var start=document.getElementById('hist-start').value;
  var end=document.getElementById('hist-end').value;
  var listEl=document.getElementById('history-list');
  listEl.innerHTML='<div style="text-align:center;color:var(--text2);padding:16px">로딩 중...</div>';
  try{
    var url='/user/trade-history';
    if(start) url+='?start='+start;
    if(end) url+=(start?'&':'?')+'end='+end;
    var d=await api(url);
    if(!d.history||!d.history.length){
      listEl.innerHTML='<div style="text-align:center;color:var(--text2);padding:20px;font-size:13px">거래내역 없음</div>';
      return;
    }
    var statusColor={'대기':'#f9a825','매칭완료':'#66bb6a','송금완료':'#42a5f5','입금확인':'#4caf50','미입금':'#ef5350','취소':'#9e9e9e'};
    listEl.innerHTML=d.history.map(function(h){
      var sc=statusColor[h.status]||'#888';
      var price=h.type==='판매예약'?(h.sell_price?h.sell_price.toLocaleString()+'원':'-'):(h.buy_price?h.buy_price.toLocaleString()+'원':'-');
      return '<div style="background:var(--bg2);border-radius:8px;padding:10px 12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">'
        +'<div><div style="font-size:13px;font-weight:600">'+h.bar_type+(h.stage?' '+h.stage+'단계':'')+'</div>'
        +'<div style="font-size:11px;color:var(--text2)">'+h.type+' · '+h.date+'</div></div>'
        +'<div style="text-align:right"><div style="font-size:13px;font-weight:700;color:var(--text1)">'+price+'</div>'
        +'<div style="font-size:11px;font-weight:600;color:'+sc+'">'+h.status+'</div></div>'
        +'</div>';
    }).join('');
  }catch(e){listEl.innerHTML='<div style="color:#ef5350;padding:12px;font-size:13px">오류: '+e.message+'</div>';}
}

async function doSellReservationBulk(){
  closeSellConfirm();
  var selected = Object.keys(_sellSelected).filter(function(id){return _sellSelected[id];});
  if(!selected.length){ toast('선택된 아이템이 없습니다.'); return; }
  var btn = document.getElementById('sell-reserve-btn');
  if(btn){ btn.disabled=true; btn.textContent='예약 중...'; }
  var successCount = 0, failCount = 0;
  for(var i=0; i<selected.length; i++){
    var id = parseInt(selected[i]);
    var info = _itemCache[id];
    try{
      await api('/reservation/sell',{method:'POST',body:JSON.stringify({item_id:id})});
      _sellSelected[id] = false;
      successCount++;
    }catch(e){ failCount++; }
  }
  toast(successCount+'개 판매예약 완료!'+(failCount?(' ('+failCount+'개 실패)'):''));
  _sellSelected = {};
  updateSellBoard();
  // 열린 상세보기 새로고침
  ['bronze','silver','gold'].forEach(function(bt){
    var panel = document.getElementById('detail-'+bt);
    if(panel && panel.style.display!=='none') loadItemDetail(bt);
  });
  if(btn){ btn.disabled=false; btn.textContent='판매 예약하기'; }
}

async function doReservation(){
  closeReserveConfirm();
  try{
    const d=await api('/reservation/create',{method:'POST',body:JSON.stringify({bronze_count:bzCnt,silver_count:svCnt,gold_count:gdCnt})});
    if(d.success){
      toast(d.message);
      disableReserveSection();
      await loadUserData();
    } else {
      toast(d.error||'예약 실패');
    }
  }catch(e){
    toast('예약 오류: '+e.message);
  }
}

// --- charge ---------------------------------------------------------------
function calcCharge(){
  const amt=parseInt(document.getElementById('charge-amount').value)||0;
  const won=amt*120;
  const el=document.getElementById('charge-result');
  if(amt>0){
    el.textContent=`${amt.toLocaleString()}P → ${won.toLocaleString()}원`;
    el.style.color='var(--accent)';
    el.style.fontWeight='600';
  } else { el.textContent=''; }
}
document.addEventListener('DOMContentLoaded',()=>{
  document.getElementById('charge-amount').addEventListener('input',calcCharge);
});

// 충전 확인 모달 표시
function showChargeConfirm(){
  const amt=parseInt(document.getElementById('charge-amount').value)||0;
  if(amt<1){
    var inp=document.getElementById('charge-amount');
    if(inp){inp.focus();inp.style.border='2px solid #e53935';setTimeout(function(){inp.style.border='';},2000);}
    toast('충전 포인트를 입력해주세요');
    return;
  }
  const won=amt*120;
  // 충전 내용 표시
  var ptsEl=document.getElementById('cc-points');
  var wonEl=document.getElementById('cc-won');
  if(ptsEl) ptsEl.textContent=amt.toLocaleString()+'P';
  if(wonEl) wonEl.textContent=won.toLocaleString()+'원';
  // 현금영수증 폼 초기화
  var form=document.getElementById('receipt-form');
  var btn=document.getElementById('receipt-toggle-btn');
  if(form) form.style.display='none';
  if(btn){ btn.textContent='🧾 현금영수증 신청하기 (선택)'; btn.style.borderColor='var(--border)'; btn.style.color='var(--text1)'; }
  var nameEl=document.getElementById('cc-name');
  var phoneEl=document.getElementById('cc-phone');
  if(nameEl) nameEl.value='';
  if(phoneEl) phoneEl.value='';
  // 모달 열기 - body 직접 자식으로 강제 이동
  var ov=document.getElementById('charge-confirm-overlay');
  if(ov){
    document.body.appendChild(ov);
    ov.style.display='flex';
    ov.classList.add('show');
  }
}

function toggleReceiptForm(){
  var form=document.getElementById('receipt-form');
  var btn=document.getElementById('receipt-toggle-btn');
  if(!form) return;
  var isOpen=form.style.display!=='none';
  form.style.display=isOpen?'none':'block';
  if(btn){
    btn.textContent=isOpen?'🧾 현금영수증 신청하기 (선택)':'🧾 현금영수증 입력 중 ▲';
    btn.style.borderColor=isOpen?'var(--border)':'#1976d2';
    btn.style.color=isOpen?'var(--text1)':'#1976d2';
  }
  // 이름 입력란에 포커스
  if(!isOpen){ setTimeout(function(){ var n=document.getElementById('cc-name'); if(n) n.focus(); },100); }
}

function closeChargeConfirm(){
  var ov=document.getElementById('charge-confirm-overlay');
  if(ov){ ov.classList.remove('show'); ov.style.display='none'; }
}

async function submitCharge(){
  const pts=parseInt(document.getElementById('charge-amount').value)||0;
  const won=pts*120; // 포인트 → 원화 (1P = 120원)
  const receiptName=(document.getElementById('cc-name')?.value||'').trim();
  const receiptPhone=(document.getElementById('cc-phone')?.value||'').trim();
  // 현금영수증 폼이 열려있으면 유효성 검사
  var form=document.getElementById('receipt-form');
  if(form && form.style.display!=='none'){
    if(!receiptName){toast('현금영수증 이름을 입력해주세요');return;}
    if(!receiptPhone || receiptPhone.length<10){toast('핸드폰번호를 정확히 입력해주세요');return;}
  }
  closeChargeConfirm();
  try{
    const body={amount:won};
    if(receiptName) body.receipt_name=receiptName;
    if(receiptPhone) body.receipt_phone=receiptPhone;
    const d=await api('/charge/request',{method:'POST',body:JSON.stringify(body)});
    toast(d.message||'충전 신청이 완료되었습니다');
    document.getElementById('charge-amount').value='';
    document.getElementById('charge-result').textContent='';
    document.getElementById('charge-refresh-wrap').style.display='block';
  }catch(e){
    toast(e.message||'충전 신청 실패. 다시 시도해주세요.','error');
  }
}

async function requestCharge(){
  showChargeConfirm();
}


function loadPrices(){
  ['bronze','silver','gold'].forEach(t=>{
    const rows=PRICES[t].map(([s,b,sl])=>`<tr><td>${s}</td><td>${b.toLocaleString()}</td><td>${sl.toLocaleString()}</td><td class="${sl-b>=0?'tag-pos':'tag-neg'}">${sl-b>=0?'+':''}${(sl-b).toLocaleString()}</td></tr>`).join('');
    document.getElementById('price-'+t).innerHTML=`<table class="price-table"><tr><th>단계</th><th>구매(원)</th><th>판매(원)</th><th>차액</th></tr>${rows}</table>`;
  });
}

function showBarPrice(type,btn){
  ['bronze','silver','gold'].forEach(t=>document.getElementById('price-'+t).style.display=t===type?'block':'none');
  btn.parentElement.querySelectorAll('button').forEach(b=>b.classList.remove('on'));
  btn.classList.add('on');
}

// --- tabs -----------------------------------------------------------------
function showTab(id,btn){
  document.querySelectorAll('.tab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('tab-'+id).classList.add('active');
  btn.classList.add('active');

  if(id === 'combine') { setTimeout(loadCombineItems, 100); 
  if(id==='matching') loadMatchingTab();
}
}

// --- detail toggle ---------------------------------------------------------


// --- admin ----------------------------------------------------------------
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
    ].map(([l,v])=>`<div style="flex:1;background:var(--bg2);border-radius:8px;padding:10px;text-align:center"><div style="font-size:11px;color:var(--text2)">${l}</div><div style="font-size:18px;font-weight:700">${v}</div></div>`).join('');

    const charges=await api('/admin/charges');
    document.getElementById('admin-charges').innerHTML=charges.charges.length?
      charges.charges.map(c=>`<div style="background:var(--bg2);border-radius:8px;padding:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:13px;font-weight:600">${c.nickname}</div><div style="font-size:12px;color:var(--text2)">${c.amount.toLocaleString()}원 → ${c.points}P</div></div>
        <button onclick="confirmCharge(${c.id})" style="padding:7px 14px;background:var(--blue);color:#fff;border:none;border-radius:8px;font-size:12px;cursor:pointer;font-weight:600">확인</button>
      </div>`).join(''):
      '<div style="color:var(--text2);font-size:13px;padding:8px">대기 중인 충전 신청 없음</div>';
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
checkApiStatus();
if(token){showMainApp();loadUserData();}
loadPrices();

// 결합판매
function getStatusBadge(s){
  if(s==='active'||s==='reservable'||!s)
    return '<span style="background:#e8f5e9;color:#2e7d32;font-size:10px;padding:1px 5px;border-radius:6px;margin-left:4px">&#48372;&#50976;</span>';
  if(s==='pending'||s==='matched')
    return '<span style="background:#fff3e0;color:#e65100;font-size:10px;padding:1px 5px;border-radius:6px;margin-left:4px">&#47588;&#52845;&#51473;</span>';
  return '';
}

function doLogout() {
  localStorage.removeItem('lp_token');
  localStorage.removeItem('lp_kakao_id');
  // 헤더 포인트 초기화
  document.getElementById('h-total').textContent='0 P';
  document.getElementById('h-maintain').textContent='0 P';
  // 충전 입력 필드 초기화
  var ca=document.getElementById('charge-amount'); if(ca) ca.value='';
  var cr=document.getElementById('charge-result'); if(cr){cr.textContent='';cr.style.color='';}
  var crw=document.getElementById('charge-refresh-wrap'); if(crw) crw.style.display='none';
  // 로그인 폼 초기화
  var lu=document.getElementById('login-username'); if(lu) lu.value='';
  var lp=document.getElementById('login-password'); if(lp) lp.value='';
  var le=document.getElementById('login-error'); if(le) le.textContent='';
  // 전역 상태 초기화
  userData = null;
  bzCnt=0; svCnt=0; gdCnt=0;
  _reservedToday=false;
  document.getElementById('main-app').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
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


