
const API='';let adminToken=null;
function toast(msg,type){const t=document.getElementById('toast');t.textContent=msg;t.className='toast show '+(type||'info');setTimeout(()=>t.classList.remove('show'),3000);}
async function apiAdmin(path,opts){opts=opts||{};const tok=localStorage.getItem('admin_token');const res=await fetch('/api'+path,Object.assign({},opts,{headers:Object.assign({'Content-Type':'application/json','Authorization':'Bearer '+tok},opts.headers||{})}));const data=await res.json();if(!res.ok)throw new Error(data.error||res.statusText);return data;}
async function doLogin(){
  const u=document.getElementById('adm-user').value;
  const p=document.getElementById('adm-pass').value;
  if(!u||!p)return;
  try{
    const r=await fetch('/api/auth/admin-login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:u,password:p})});
    const d=await r.json();
    if(d.token){
      localStorage.setItem('admin_token',d.token);
      document.getElementById('login-screen').style.display='none';
      document.getElementById('admin-app').style.display='flex';
      loadDashboard();
    }else{
      alert(d.error||'로그인 실패');
    }
  }catch(e){alert(e.message);}
}
















function doAdminLogout(){adminToken=null;document.getElementById('admin-app').style.display='none';document.getElementById('login-screen').style.display='flex';}
function showPage(name,el){var _mn=document.querySelector('.main');if(_mn){document.querySelectorAll('.page').forEach(function(pg){if(pg.parentElement!==_mn)_mn.appendChild(pg);});}var mainEl=document.querySelector('.main');if(mainEl){document.querySelectorAll('.page').forEach(function(pg){if(pg.parentElement!==mainEl)mainEl.appendChild(pg);});}document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));document.querySelectorAll('.page').forEach(p=>p.classList.remove('active'));if(el)el.classList.add('active');const pg=document.getElementById('page-'+name);if(pg)pg.classList.add('active');if(name==='dashboard')loadDashboard();else if(name==='users')loadUsers();else if(name==='members'){var pm=document.getElementById('page-members');var mn=document.querySelector('.main');if(pm&&mn&&pm.parentElement!==mn)mn.appendChild(pm);loadUsers();}else if(name==='approve'){var pa=document.getElementById('page-approve');var mn2=document.querySelector('.main');if(pa&&mn2&&pa.parentElement!==mn2)mn2.appendChild(pa);loadPendingUsers();}else if(name==='charges')loadCharges();else if(name==='matching'){
    // 패널 초기화 (매칭 실행 후 숨겨진 것 복원)
    ['1','2'].forEach(function(n){
      var sg=document.getElementById('r'+n+'-stat-grid');
      if(sg) sg.style.display='grid'; // display:grid 명시 복원
      var ts=document.getElementById('r'+n+'-type-section');
      if(ts) ts.style.display='';
      var bb=document.getElementById('r'+n+'-buy-by-type');
      if(bb){ var tc=bb.closest('.two-col'); if(tc) tc.style.display=''; }
      // 이전 매칭 결과 프리뷰 제거
      var prev=document.querySelector('.match-result-preview');
      if(prev) prev.remove();
      // match-result div 초기화
      var mr=document.getElementById('match-result-'+n);
      if(mr) mr.innerHTML='';
    });
    loadMatchingStatus();updateMatchingBtn();
  }else if(name==='notifications'){var pn=document.getElementById('page-notifications');var mn=document.querySelector('.main');if(pn&&mn&&pn.parentElement!==mn)mn.appendChild(pn);}else if(name==='reservations'){loadReservationStatus();loadExtraReservations();}else if(name==='testtools')loadTesttools();else if(name==='penalties')loadAdminPenalties();else if(name==='settings')loadSettings();}
async function loadDashboard(){try{const s=await apiAdmin('/admin/stats');document.getElementById('s-users').textContent=s.total_users||0;document.getElementById('s-items').textContent=s.total_items||0;document.getElementById('s-charges').textContent=s.pending_charges||0;document.getElementById('s-reservations').textContent=s.today_reservations||0;const charges=await apiAdmin('/admin/charges');const pending=(charges.charges||[]).filter(c=>c.status==='pending').slice(0,5);const dc=document.getElementById('dash-charges');if(pending.length){dc.innerHTML='<table><thead><tr><th>&#45769;&#45348;&#51076;</th><th>&#44552;&#50529;</th><th>&#49345;&#53468;</th></tr></thead><tbody>'+pending.map(c=>'<tr><td>'+c.nickname+'</td><td>'+(c.points||0).toLocaleString()+'P<br><small style="color:#aaa">'+(c.amount||0).toLocaleString()+'원</small></td><td><span class="badge badge-warning">&#45824;&#44592;</span></td></tr>').join('')+'</tbody></table>';}else{dc.innerHTML='<div class="empty-state"><div>&#45824;&#44592; &#51473;&#51064; &#52649;&#51204; &#50630;&#51020;</div></div>';}const users=await apiAdmin('/admin/users');document.getElementById('dash-users').innerHTML=(users.users||[]).slice(0,5).map(u=>'<tr>'
  +'<td style="font-size:11px">'+(u.username||'-')+'</td>'
  +'<td style="font-size:11px">'+(u.real_name||u.nickname||'-')+'</td>'
  +'<td style="font-size:11px">'+(u.phone||'-')+'</td>'
  +'<td style="font-size:11px">'+(u.account_no||'-')+'</td>'
  +'<td style="font-size:11px">'+(u.account_name||'-')+'</td>'
  +'</tr>').join('')||'<tr><td colspan="5">회원 없음</td></tr>';}catch(e){toast('&#45824;&#49884;&#48372;&#46300; &#49892;&#54036;: '+e.message,'error');}}
async function loadPendingUsers(){
  try{
    const d=await apiAdmin('/admin/pending-users');
    const tbody=document.getElementById('pending-users');
    if(!tbody)return;
    const list=(d.users||[]).filter(u=>!u.approved);
    if(!list.length){
      tbody.innerHTML='<tr><td colspan=9 style="text-align:center;padding:16px;color:#888">승인 대기 회원이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML=list.map((u,i)=>`<tr>
      <td>${i+1}</td>
      <td><strong>${u.username||'-'}</strong></td>
      <td>${u.account_name||u.nickname||'-'}</td>
      <td>${u.phone||'-'}</td>
      <td>${u.bank||'-'}</td>
      <td style="font-size:11px">${u.account_no||'-'}</td>
      <td>${u.account_name||'-'}</td>
      <td>${(u.created_at||'-').slice(0,10)}</td>
      <td style="white-space:nowrap">
        <button onclick="approveUser(${u.id},'approve')" style="padding:4px 10px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;margin-right:4px">승인</button>
        <button onclick="approveUser(${u.id},'reject')" style="padding:4px 10px;background:#c62828;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">거절</button>
      </td>
    </tr>`).join('');
  }catch(e){console.error('loadPendingUsers:',e);}
}
async function deleteUser(uid){if(!confirm('삭제하시겠습니까?')) return;try{await apiAdmin('/admin/delete-user/'+uid,{method:'POST'});toast('삭제됨');loadPendingUsers();}catch(e){toast(e.message,'error');}}
async function loadUsers(){
  try{
    const d=await apiAdmin('/admin/users');
    const tbody=document.getElementById('admin-users');
    if(!tbody)return;
    if(!d.users||!d.users.length){
      tbody.innerHTML='<tr><td colspan=11 style="text-align:center;padding:16px;color:#888">회원이 없습니다</td></tr>';
      return;
    }
    tbody.innerHTML=d.users.map((u,i)=>`<tr>
      <td style="text-align:center"><input type="checkbox" class="user-check" data-id="${u.id}" onchange="updateUserSelectedCount()" style="cursor:pointer;width:15px;height:15px"></td>
      <td>${i+1}</td>
      <td>${u.username||'-'}</td>
      <td>${u.real_name||u.nickname||'-'}</td>
      <td><span class="badge badge-info">${u.level||1}L</span></td>
      <td>${(u.charge_points||0).toLocaleString()}P</td>
      <td>${((u.total_charged_amount||0)||(u.charge_points||0)*120).toLocaleString()}원</td>
      <td>${(u.exchange_points||0).toLocaleString()}</td>
      <td>${u.total_reservations||0}</td>
      <td style="white-space:nowrap">
        <button onclick="showUserDetail(${u.id})" class="btn-primary btn-sm" style="margin-right:4px">상세</button>
        <button onclick="withdrawUser(${u.id})" style="background:#e53935;color:#fff;border:none;padding:3px 8px;border-radius:4px;cursor:pointer;font-size:11px">탈퇴</button>
      </td>
    </tr>`).join('');
  }catch(e){console.error('loadUsers:',e);}
}





















async function grantPoints(){
  var username = (document.getElementById('grant-username')?.value||'').trim();
  var points = parseInt(document.getElementById('grant-points')?.value||0);
  var reason = (document.getElementById('grant-reason')?.value||'관리자 지급').trim();
  var resEl = document.getElementById('grant-result');
  if(!username){ toast('사용자 아이디를 입력하세요','error'); return; }
  if(!points||points<1){ toast('포인트를 1 이상 입력하세요','error'); return; }
  if(!confirm(username+'에게 '+points.toLocaleString()+'P를 지급하시겠습니까?')) return;
  try{
    var d = await apiAdmin('/admin/grant-points',{method:'POST',body:JSON.stringify({username,points,reason})});
    if(resEl) resEl.innerHTML='<span style="color:#66bb6a">✅ '+d.username+'에게 '+d.points.toLocaleString()+'P 지급 완료 ('+d.before.toLocaleString()+'P → '+d.after.toLocaleString()+'P)</span>';
    toast('✅ '+d.points.toLocaleString()+'P 지급 완료', 'success');
    document.getElementById('grant-username').value='';
    document.getElementById('grant-points').value='';
    document.getElementById('grant-reason').value='';
  }catch(e){
    if(resEl) resEl.innerHTML='<span style="color:#ef5350">❌ '+(e.message||'실패')+'</span>';
    toast(e.message||'포인트 지급 실패','error');
  }
}

async function loadCharges(showAll){
  var _showAll = (showAll === true) || (document.getElementById('charge-filter-all')?.checked);
  // 탭 버튼 상태 업데이트
  var btnPending = document.getElementById('charge-btn-pending');
  var btnAll = document.getElementById('charge-btn-all');
  if(btnPending && btnAll){
    if(_showAll){
      btnAll.style.background='#1976d2'; btnAll.style.color='#fff';
      btnPending.style.background=''; btnPending.style.color='';
    } else {
      btnPending.style.background='#1976d2'; btnPending.style.color='#fff';
      btnAll.style.background=''; btnAll.style.color='';
    }
  }
  try{const d=await apiAdmin('/admin/charges'+(_showAll?'?all=1':''));const tbody=document.getElementById('admin-charges');const charges=d.charges||[];if(!charges.length){tbody.innerHTML='<tr><td colspan="8"><div class="empty-state" style="padding:20px"><div>&#52649;&#51204; &#50836;&#52397; &#50630;&#51020;</div></div></td></tr>';return;}const sM={pending:'&#45824;&#44592;',confirmed:'&#49849;&#51064;',rejected:'&#44144;&#51208;'};const bM={pending:'badge-warning',confirmed:'badge-success',rejected:'badge-red'};tbody.innerHTML=charges.map(c=>{
  // 현금영수증: receipt_phone에 "이름/번호" 또는 "번호"만 있음
  var receiptRaw = c.receipt_phone || '';
  var receiptDisplay = '-';
  if(receiptRaw){
    var parts = receiptRaw.split('/');
    if(parts.length >= 2){
      receiptDisplay = '<span style="font-size:11px"><strong>'+parts[0]+'</strong><br>'+parts[1]+'</span>';
    } else {
      receiptDisplay = receiptRaw;
    }
  }
  return '<tr>'
    +'<td>'+c.id+'</td>'
    +'<td>'+(c.username||'-')+'</td>'
    +'<td>'+(c.nickname||'-')+'</td>'
    +'<td style="font-weight:700">'+(c.points||0).toLocaleString()+'P<br><small style="color:#aaa;font-weight:400">'+(c.amount||0).toLocaleString()+'원</small></td>'
    +'<td>'+receiptDisplay+'</td>'
    +'<td><span class="badge '+(bM[c.status]||'')+'">&#x200B;'+(sM[c.status]||c.status)+'</span></td>'
    +'<td style="font-size:11px;color:#aaa">'+(c.created_at||'-').slice(0,16)+'</td>'
    +'<td style="white-space:nowrap">'
    +(c.status==='pending'?'<button class="btn btn-success" style="font-size:11px;padding:4px 8px;margin-right:4px" onclick="confirmCharge('+c.id+')">승인</button>':'<span style="font-size:11px;color:#aaa">완료</span> ')
    +'<button class="btn" style="font-size:11px;padding:4px 8px;background:#c62828;color:#fff;border:none;border-radius:4px;cursor:pointer" onclick="deleteCharge('+c.id+')">삭제</button>'
    +'</td>'
    +'</tr>';
}).join('');}catch(e){toast('&#52649;&#51204; &#49892;&#54036;: '+e.message,'error');}}
async function confirmCharge(id){try{await apiAdmin('/admin/charge/confirm/'+id,{method:'POST'});toast('충전 승인 완료','success');loadCharges();}catch(e){toast(e.message,'error');}}
async function deleteCharge(id){
  if(!confirm('이 충전 요청을 삭제하시겠습니까?')) return;
  try{
    await apiAdmin('/admin/charge/delete/'+id,{method:'POST'});
    toast('충전 요청이 삭제되었습니다','success');
    loadCharges();
  }catch(e){toast(e.message,'error');}
}

async function updateMatchingBtn(){
  try{
    var tok = localStorage.getItem('admin_token');
    // 시간 + failed_count를 한번에 가져오기
    var ct = await fetch('/api/current-time', {headers:{'Authorization':'Bearer '+tok}}).then(r=>r.json());
    var matchData = await fetch('/api/admin/matching-status', {headers:{'Authorization':'Bearer '+tok}}).then(r=>r.json());

    var h = ct.hour; var m = ct.minute || 0; var totalMin = h * 60 + m;
    var failedCount = matchData.failed_count || 0;

    // 1차 매칭: 20:00~05:00 활성
    // mock_time이 설정된 경우(서버 시간 기준) 또는 브라우저 KST 기준
    var _effH;
    if(ct && ct.is_mock){
      _effH = ct.hour; // mock_time은 서버 시간 그대로 사용
    } else {
      var _kst = new Date(new Date().toLocaleString('en-US', {timeZone:'Asia/Seoul'}));
      _effH = _kst.getHours();
    }
    var isActive1 = (_effH >= 20 || _effH < 5);
    var btn1 = document.getElementById('btn-run-matching-1');
    var notice = document.getElementById('matching-time-notice');
    // 매칭 성공 후 블록이 숨겨진 상태면 버튼 비활성 유지
    var _rb1 = document.getElementById('match-run-block-1');
    var _block1Hidden = _rb1 && _rb1.style.display === 'none';
    if(btn1){ 
      // 1차 매칭이 실행됐으면 버튼 비활성화 유지 (새로고침 전까지)
      var _active1 = isActive1 && !_block1Hidden && !window._r1MatchingDone;
      btn1.disabled=!_active1; btn1.style.opacity=_active1?'1':'0.45'; btn1.style.cursor=_active1?'pointer':'not-allowed'; 
    }
    if(notice){
      notice.textContent = isActive1
        ? '✅ 매칭 가능 시간 (20:00~05:00) — 서버시간 '+ct.time.slice(11,16)
        : '⏳ 매칭 실행 가능: 20:00~05:00 (현재 '+ct.time.slice(11,16)+')';
      notice.style.color = isActive1 ? '#66bb6a' : '#f9a825';
    }

    // 2차 매칭: 미입금(failed) > 0 AND 14:00~15:00 에만 활성화
    var r2BuyCount = (matchData.round2||{}).buy_count || 0;
    var _h2 = ct.hour || 0; var _m2 = ct.minute || 0;
    var _inR2Window = (_h2 === 14) || (_h2 === 15 && _m2 === 0); // 14:00~14:59
    var isActive2 = (failedCount > 0) && _inR2Window;
    var btn2 = document.getElementById('btn-run-matching-2');
    var notice2 = document.getElementById('matching-time-notice-2');
    if(btn2){ btn2.disabled=!isActive2; btn2.style.opacity=isActive2?'1':'0.45'; btn2.style.cursor=isActive2?'pointer':'not-allowed'; }
    // 상단 2차 탭 버튼도 조건 제어
    var tabBtn2 = document.getElementById('round-tab-2');
    if(tabBtn2){
      if(isActive2){
        tabBtn2.disabled = false;
        tabBtn2.style.opacity = '1';
        tabBtn2.style.cursor = 'pointer';
        tabBtn2.title = '';
      } else {
        tabBtn2.disabled = true;
        tabBtn2.style.opacity = '0.4';
        tabBtn2.style.cursor = 'not-allowed';
        tabBtn2.title = '미입금 수량이 없어 2차 매칭 불가';
      }
    }
    if(notice2){
      var msg2 = isActive2
        ? '✅ 2차 매칭 가능 — 미입금 '+failedCount+'건 — 서버시간 '+ct.time.slice(11,16)
        : '⚠️ 미입금 없음 — 2차 매칭 불필요 ('+ct.time.slice(11,16)+')';
      notice2.textContent = msg2;
      notice2.style.color = isActive2 ? '#66bb6a' : '#888';
    }
  }catch(e){
    var btn = document.getElementById('btn-run-matching-1');
    if(btn){ btn.disabled=false; btn.style.opacity='1'; btn.style.cursor='pointer'; }
  }
}

// ── 회원 선택 삭제 ──────────────────────────────────
function toggleAllUsers(checked){
  document.querySelectorAll('.user-check').forEach(function(cb){ cb.checked = checked; });
  updateUserSelectedCount();
}
function updateUserSelectedCount(){
  var n = document.querySelectorAll('.user-check:checked').length;
  var el = document.getElementById('user-selected-count');
  if(el) el.textContent = n > 0 ? n+'명 선택됨' : '';
  var allCb = document.getElementById('user-select-all');
  var total = document.querySelectorAll('.user-check').length;
  if(allCb) allCb.checked = (n > 0 && n === total);
}
async function deleteSelectedUsers(){
  // 선택된 ID를 즉시 저장 (confirm 창이 뜨기 전에)
  var ids = Array.from(document.querySelectorAll('.user-check:checked')).map(function(cb){return parseInt(cb.dataset.id);});
  if(!ids.length){ toast('선택된 회원이 없습니다.','error'); return; }
  // confirm 없이 바로 삭제 (confirm 창이 포커스를 빼앗아 체크박스 상태 초기화되는 문제 방지)
  try{
    await apiAdmin('/admin/delete-users',{method:'POST',body:JSON.stringify({user_ids:ids})});
    toast(ids.length+'명 삭제 완료','success'); loadUsers();
  }catch(e){ toast(e.message,'error'); }
}
async function deleteAllUsers(){
  var total = document.querySelectorAll('.user-check').length;
  if(!confirm('전체 회원 '+total+'명을 삭제하시겠습니까? (admin, loopay 제외)\n이 작업은 되돌릴 수 없습니다.')) return;
  try{
    await apiAdmin('/admin/delete-users',{method:'POST',body:JSON.stringify({user_ids:[]})});
    toast('전체 삭제 완료','success'); loadUsers();
  }catch(e){ toast(e.message,'error'); }
}

// ── 시스템아이템현황 ────────────────────────────────


async function adminWarnUnpaid(matchId){
  try{
    var tok = localStorage.getItem('admin_token');
    var r = await fetch('/api/match/report-unpaid',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body:JSON.stringify({match_id:matchId})});
    var d = await r.json();
    if(d.success){
      _unpaidClickedAt[matchId] = _serverHour*60 + _serverMin; // 서버 시간(분) 기록
      toast('입금 요청 알림 발송 완료 (9분 후 재활성화)','success');
      loadSystemItems();
    } else toast(d.error||'오류','error');
  }catch(e){toast(e.message,'error');}
}

async function adminConfirmUnpaid(matchId){
  if(!confirm('미입금 처리하시겠습니까?\n구매자에게 미입금 알림이 발송되고 2차 매칭으로 이전됩니다.')) return;
  try{
    var tok = localStorage.getItem('admin_token');
    var r = await fetch('/api/admin/confirm-unpaid',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body:JSON.stringify({match_id:matchId})});
    var d = await r.json();
    if(d.success){toast('미입금 확정 완료 - 2차 매칭 이전','success');loadSystemItems();}
    else toast(d.error||'오류','error');
  }catch(e){toast(e.message,'error');}
}

async function adminConfirmPayment(matchId){
  try{
    var tok=localStorage.getItem('admin_token');
    var r=await fetch('/api/match/confirm-payment',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({match_id:matchId})});
    var d=await r.json();
    if(d.success){toast('송금 확인 완료','success');loadSystemItems();}
    else toast(d.error||'오류','error');
  }catch(e){toast(e.message,'error');}
}
async function adminReportUnpaid(matchId){
  try{
    var tok=localStorage.getItem('admin_token');
    var r=await fetch('/api/match/report-unpaid',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({match_id:matchId})});
    var d=await r.json();
    if(d.success){toast('미입금 처리 완료','success');loadSystemItems();}
    else toast(d.error||'오류','error');
  }catch(e){toast(e.message,'error');}
}
function updateDeleteBtn(){
  var checked = document.querySelectorAll('.si-item-check:checked');
  var btn = document.getElementById('si-delete-btn');
  if(btn) btn.style.display = checked.length > 0 ? 'inline-block' : 'none';
  if(btn && checked.length > 0) btn.textContent = '🗑️ 선택삭제 ('+checked.length+'개)';
  var allCheck = document.getElementById('si-check-all');
  if(allCheck){
    var all = document.querySelectorAll('.si-item-check');
    allCheck.checked = all.length > 0 && checked.length === all.length;
    allCheck.indeterminate = checked.length > 0 && checked.length < all.length;
  }
}
function toggleAllItems(cb){
  document.querySelectorAll('.si-item-check').forEach(function(el){ el.checked = cb.checked; });
  updateDeleteBtn();
}
async function deleteSelectedItems(){
  var checked = document.querySelectorAll('.si-item-check:checked');
  if(!checked.length){ alert('선택된 아이템이 없습니다.'); return; }
  if(!confirm(checked.length+'개 아이템을 삭제하시겠습니까?')) return;
  var ids = Array.from(checked).map(function(el){ return parseInt(el.getAttribute('data-id')); });
  try{
    var tok = localStorage.getItem('admin_token');
    var r = await fetch('/api/admin/delete-loopay-items', {method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body: JSON.stringify({item_ids: ids})});
    var d = await r.json();
    if(d.success){ toast('✅ '+ids.length+'개 아이템 삭제 완료', 'success'); loadSystemItems(); }
    else{ toast('오류: '+(d.error||'삭제 실패'), 'error'); }
  }catch(e){ toast('오류: '+e.message, 'error'); }
}
// ── 구매 아이템 선택 삭제 ──
function updateBuyDeleteBtn(){
  var checked = document.querySelectorAll('.si-buy-check:checked');
  var all = document.querySelectorAll('.si-buy-check');
  var btn = document.getElementById('si-buy-delete-btn');
  var allCb = document.getElementById('si-buy-check-all');
  if(btn) btn.style.display = checked.length ? 'inline-block' : 'none';
  if(allCb){
    allCb.checked = all.length > 0 && checked.length === all.length;
    allCb.indeterminate = checked.length > 0 && checked.length < all.length;
  }
}
function toggleAllBuyItems(cb){
  document.querySelectorAll('.si-buy-check').forEach(function(el){ el.checked = cb.checked; });
  updateBuyDeleteBtn();
}
async function deleteSelectedBuyItems(){
  var checked = document.querySelectorAll('.si-buy-check:checked');
  if(!checked.length){ toast('선택된 아이템이 없습니다.', 'error'); return; }
  if(!window.confirm(checked.length+'개 구매 아이템을 삭제하시겠습니까?')) return;
  var ids = Array.from(checked).map(function(el){ return parseInt(el.getAttribute('data-id')); });
  try{
    var tok = localStorage.getItem('admin_token');
    var r = await fetch('/api/admin/delete-loopay-items', {method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body: JSON.stringify({item_ids: ids})});
    var d = await r.json();
    if(d.success){ toast('✅ '+ids.length+'개 구매 아이템 삭제 완료', 'success'); loadSystemItems(); }
    else{ toast('오류: '+(d.error||'삭제 실패'), 'error'); }
  }catch(e){ toast('오류: '+e.message, 'error'); }
}


async function deleteAllItems(){
  if(!confirm('loopay 계정의 모든 아이템을 삭제하시겠습니까? (되돌릴 수 없습니다)')) return;
  try{
    var tok = localStorage.getItem('admin_token');
    var r = await fetch('/api/admin/delete-loopay-items', {method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body: JSON.stringify({item_ids: 'all'})});
    var d = await r.json();
    if(d.success){ toast('✅ 전체 아이템 삭제 완료', 'success'); loadSystemItems(); }
    else{ toast('오류: '+(d.error||'삭제 실패'), 'error'); }
  }catch(e){ toast('오류: '+e.message, 'error'); }
}

var _systemItems = [];
var _serverHour = 0;
var _serverMin = 0;
var _unpaidClickedAt = {}; // matchId → 마지막 클릭 시각(ms)
async function saveRound2Auto(val){
  try{
    var tok=localStorage.getItem('admin_token');
    await fetch('/api/admin/settings',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({round2_auto:val})});
    toast(val==='true'?'2차 매칭 자동 설정됨 (매일 14:10)':'2차 매칭 수동 설정됨','success');
  }catch(e){toast('저장 실패','error');}
}

function loadRound2AutoSetting(){
  var tok=localStorage.getItem('admin_token');
  fetch('/api/admin/settings',{headers:{'Authorization':'Bearer '+tok}})
    .then(r=>r.json()).then(d=>{
      var val = d.settings?.round2_auto || 'false';
      var manualEl=document.getElementById('round2-manual');
      var autoEl=document.getElementById('round2-auto');
      if(manualEl) manualEl.checked = (val!=='true');
      if(autoEl) autoEl.checked = (val==='true');
    }).catch(()=>{});
}

async function loadAdminPenalties(){
  var tbody = document.getElementById('admin-penalty-tbody');
  if(!tbody) return;
  try{
    var d = await apiAdmin('/admin/penalties');
    var penalties = d.penalties || [];
    if(!penalties.length){
      tbody.innerHTML='<tr><td colspan="11" style="text-align:center;padding:20px;color:#888">패널티 없음</td></tr>';
      var allCb = document.getElementById('penalty-check-all');
      if(allCb){ allCb.checked=false; allCb.indeterminate=false; }
      updatePenaltyDelBtn();
      return;
    }
    var now = new Date();
    tbody.innerHTML = penalties.map(function(p,i){
      var bg = i%2===0?'#12121f':'#1a1a2e';
      var roundBadge = p.match_round===2
        ? '<span style="padding:1px 5px;border-radius:6px;font-size:10px;background:#7b1fa233;color:#ce93d8">2차</span>'
        : '<span style="padding:1px 5px;border-radius:6px;font-size:10px;background:#1565c033;color:#90caf9">1차</span>';
      var isActive = !p.is_released && p.suspended_until && new Date(p.suspended_until.replace(' ','T')) > now;
      var isPaid = !p.is_released && (p.release_paid === 1 || p.release_paid === true);
      var statusBadge = p.is_released
        ? '<span style="background:#1b5e2022;color:#66bb6a;font-size:11px;padding:2px 7px;border-radius:4px;font-weight:700">해제됨</span>'
        : (isPaid
            ? '<span style="background:#f9a82222;color:#f9a825;font-size:11px;padding:2px 7px;border-radius:4px;font-weight:700">패널티납부</span>'
            : '<span style="background:#c6282822;color:#ef5350;font-size:11px;padding:2px 7px;border-radius:4px;font-weight:700">정지중</span>');
      var releaseAtText = isPaid && p.release_at ? '<br><span style="font-size:10px;color:#888">자동해제: '+p.release_at.slice(0,10)+'</span>' : '';
      return '<tr style="border-bottom:1px solid #2a2a40;background:'+bg+'">'
        +'<td style="padding:6px;text-align:center"><input type="checkbox" class="penalty-check" data-id="'+p.id+'" onchange="updatePenaltyDelBtn()" style="cursor:pointer"></td>'
        +'<td style="padding:6px;text-align:center;color:#888">'+p.id+'</td>'
        +'<td style="padding:6px;color:#64b5f6">'+p.username+'<br><span style="color:#888;font-size:10px">'+p.nickname+'</span></td>'
        +'<td style="padding:6px;text-align:center;color:#f9a825">'+(p.total_count||p.unpaid_count)+'회'+(p.total_count && p.total_count > p.unpaid_count ? '<span style="font-size:10px;color:#888"> (누적 '+p.total_count+')</span>' : '')+'</td>'
        +'<td style="padding:6px;text-align:center">'+p.suspend_days+'일</td>'
        +'<td style="padding:6px;text-align:center;color:#ce93d8">'+p.release_points.toLocaleString()+'P</td>'
        +'<td style="padding:6px;text-align:center">'+roundBadge+'</td>'
        +'<td style="padding:6px;text-align:center;font-size:11px;color:#888">'+(p.created_at||'').slice(0,16)+'</td>'
        +'<td style="padding:6px;text-align:center;font-size:11px">'+(p.suspended_until||'-').slice(0,10)+'</td>'
        +'<td style="padding:6px;text-align:center">'+statusBadge+releaseAtText+'</td>'
        +'<td style="padding:6px;text-align:center">'+(p.is_released?'':('<button onclick="releaseUserPenalty('+p.id+')" style="padding:2px 10px;background:#1b5e20;color:#a5d6a7;border:none;border-radius:4px;font-size:11px;cursor:pointer">✅ 해제</button>'))+'</td>'
        +'</tr>';
    }).join('');
    var allCb = document.getElementById('penalty-check-all');
    if(allCb){ allCb.checked=false; allCb.indeterminate=false; }
    updatePenaltyDelBtn();
  }catch(e){ if(tbody) tbody.innerHTML='<tr><td colspan="11" style="text-align:center;padding:20px;color:#ef5350">오류: '+e.message+'</td></tr>'; }
}

function toggleAllPenalties(cb){
  document.querySelectorAll('.penalty-check').forEach(function(el){ el.checked=cb.checked; });
  updatePenaltyDelBtn();
}

function updatePenaltyDelBtn(){
  var checked = document.querySelectorAll('.penalty-check:checked');
  var all = document.querySelectorAll('.penalty-check');
  var btn = document.getElementById('penalty-del-btn');
  var allCb = document.getElementById('penalty-check-all');
  if(btn) btn.style.display = checked.length>0 ? '' : 'none';
  if(allCb){
    allCb.checked = all.length>0 && checked.length===all.length;
    allCb.indeterminate = checked.length>0 && checked.length<all.length;
  }
}

async function deleteSelectedPenalties(){
  var checked = document.querySelectorAll('.penalty-check:checked');
  if(!checked.length){ alert('선택된 항목이 없습니다.'); return; }
  var ids = Array.from(checked).map(function(el){ return parseInt(el.dataset.id); });
  if(!confirm(ids.length+'건의 패널티를 삭제하고 해당 사용자의 정지 상태를 초기화하시겠습니까?')) return;
  try{
    var d = await apiAdmin('/admin/penalties/delete',{method:'POST',body:JSON.stringify({ids:ids})});
    toast('✅ '+d.deleted+'건 삭제 완료 (사용자 정지 상태 초기화)', 'success');
    loadAdminPenalties();
  }catch(e){ toast(e.message||'삭제 실패','error'); }
}

async function addManualPenalty(){
  var username = (document.getElementById('penalty-add-username')?.value||'').trim();
  var days = parseInt(document.getElementById('penalty-add-days')?.value||3);
  var reason = (document.getElementById('penalty-add-reason')?.value||'관리자 수동 부여').trim();
  var resEl = document.getElementById('penalty-add-result');
  if(!username){ toast('사용자 아이디를 입력하세요','error'); return; }
  if(!confirm(username+'에게 '+days+'일 거래정지 패널티를 부여하시겠습니까?')) return;
  try{
    var d = await apiAdmin('/admin/penalties/add',{method:'POST',body:JSON.stringify({username,suspend_days:days,reason})});
    if(resEl) resEl.innerHTML='<span style="color:#66bb6a">✅ '+d.username+' 패널티 부여 완료 — '+d.suspend_days+'일 정지 (해제일: '+d.suspended_until.slice(0,10)+')</span>';
    toast('✅ 패널티 부여 완료', 'success');
    document.getElementById('penalty-add-username').value='';
    document.getElementById('penalty-add-reason').value='';
    loadAdminPenalties();
  }catch(e){
    if(resEl) resEl.innerHTML='<span style="color:#ef5350">❌ '+( e.message||'실패')+'</span>';
    toast(e.message||'패널티 부여 실패','error');
  }
}

async function releaseUserPenalty(penaltyId){
  if(!confirm('이 패널티를 즉시 해제하시겠습니까?')) return;
  try{
    await apiAdmin('/admin/penalties/release-user',{method:'POST',body:JSON.stringify({penalty_id:penaltyId})});
    toast('✅ 패널티 해제 완료', 'success');
    loadAdminPenalties();
  }catch(e){ toast(e.message||'해제 실패','error'); }
}

async function adminReleasePenalty(penaltyId){
  if(!confirm('패널티를 해제하시겠습니까?')) return;
  try{
    var d = await apiAdmin('/admin/penalty/release',{method:'POST',body:JSON.stringify({penalty_id:penaltyId})});
    toast('패널티 해제 완료','success');
    loadAdminPenalties();
  }catch(e){ toast(e.message||'오류','error'); }
}


// ── 루페이 구매아이템 송금 모달 (사용자 화면 openPaymentModal과 동일 구조) ──
var _adminRemitMatchId = null;
function adminLoopayRemit(matchId, sellerAccName, sellerAcc, sellerBank){
  _adminRemitMatchId = matchId;
  var modal = document.getElementById('admin-remit-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'admin-remit-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(modal);
  }
  modal.innerHTML = '<div style="background:#1a1d2e;border-radius:14px;padding:24px;width:90%;max-width:420px;border:1px solid #2a2d40;color:#e0e0e0">'
    +'<div style="font-size:16px;font-weight:700;margin-bottom:16px;color:#64b5f6">💸 루페이 송금완료 확인</div>'
    +'<div style="background:#12121f;border-radius:8px;padding:12px;margin-bottom:14px;font-size:13px">'
    +'<div style="color:#aaa;margin-bottom:4px">판매자 계좌 (송금 대상)</div>'
    +'<div style="color:#a5d6a7;font-weight:700">'+sellerAccName+' '+(sellerBank||'')+'</div>'
    +'<div style="color:#e0e0e0;font-size:14px;font-weight:700;letter-spacing:1px">'+sellerAcc+'</div>'
    +'</div>'
    +'<div style="margin-bottom:12px">'
    +'<label style="display:block;font-size:12px;color:#aaa;margin-bottom:6px">📎 영수증 이미지 <span style="color:#ef5350">(필수)</span></label>'
    +'<input type="file" id="admin-remit-file" accept="image/*" style="width:100%;font-size:13px;color:#e0e0e0">'
    +'</div>'
    +'<div id="admin-remit-preview" style="margin-bottom:12px"></div>'
    +'<div style="display:flex;gap:10px">'
    +'<button onclick="closeAdminRemit()" style="flex:1;padding:10px;background:#37474f;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">취소</button>'
    +'<button id="admin-remit-submit" onclick="submitAdminRemit()" disabled style="flex:1;padding:10px;background:#555;color:#aaa;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:not-allowed">송금완료</button>'
    +'</div>'
    +'</div>';
  modal.style.display = 'flex';
  window._adminRemitBase64 = null;
  document.getElementById('admin-remit-file').onchange = function(e){
    var file = e.target.files[0];
    var sbtn = document.getElementById('admin-remit-submit');
    if(sbtn){sbtn.disabled=!file;sbtn.style.background=file?'#1976d2':'#555';sbtn.style.color=file?'#fff':'#aaa';sbtn.style.cursor=file?'pointer':'not-allowed';}
    if(!file){window._adminRemitBase64=null;document.getElementById('admin-remit-preview').innerHTML='';return;}
    var reader=new FileReader();
    reader.onload=function(ev){
      window._adminRemitBase64=ev.target.result.split(',')[1];
      document.getElementById('admin-remit-preview').innerHTML='<img src="'+ev.target.result+'" style="width:100%;border-radius:8px;max-height:180px;object-fit:contain">';
    };
    reader.readAsDataURL(file);
  };
}
function closeAdminRemit(){
  var modal=document.getElementById('admin-remit-modal');
  if(modal) modal.style.display='none';
  window._adminRemitBase64=null; _adminRemitMatchId=null;
}
async function submitAdminRemit(){
  if(!_adminRemitMatchId){ closeAdminRemit(); return; }
  var btn=document.getElementById('admin-remit-submit');
  if(btn&&btn.disabled) return;
  if(btn){btn.textContent='처리 중...';btn.disabled=true;}
  try{
    var tok=localStorage.getItem('admin_token');
    var payload={match_id:_adminRemitMatchId};
    if(window._adminRemitBase64) payload.image='data:image/jpeg;base64,'+window._adminRemitBase64;
    var d=await fetch('/api/reservation/payment-complete',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body:JSON.stringify(payload)}).then(r=>r.json());
    if(d.success){
      closeAdminRemit();
      toast('✅ 송금 처리 완료','success');
      loadSystemItems();
    } else {
      toast(d.error||'처리 실패','error');
      if(btn){btn.textContent='송금완료';btn.disabled=false;btn.style.background='#1976d2';btn.style.color='#fff';}
    }
  }catch(e){
    toast(e.message||'오류','error');
    if(btn){btn.textContent='송금완료';btn.disabled=false;}
  }
}

async function loadSystemItems(){
  var tbody = document.getElementById('si-tbody');
  var summary = document.getElementById('si-summary');
  if(tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:20px;color:#888">로딩 중...</td></tr>';
  // 서버 시간 업데이트
  try{
    var tok=localStorage.getItem('admin_token');
    var ct=await fetch('/api/current-time',{headers:{'Authorization':'Bearer '+tok}}).then(r=>r.json());
    _serverHour=ct.hour||0; _serverMin=ct.minute||0;
  }catch(e){}
  try{
    var d = await apiAdmin('/admin/loopay-items');
    _systemItems = d.items || [];
    var types = {bronze:{name:'수정',color:'#cd7f32'}, silver:{name:'루비',color:'#a8a9ad'}, gold:{name:'다이아',color:'#ffd700'}};
    if(summary){
      summary.innerHTML = Object.keys(types).map(function(t){
        var all = _systemItems.filter(function(i){return i.bar_type===t;});
        var reservable = all.filter(function(i){return i.status==='reservable';}).length;
        var matched = all.filter(function(i){return i.status==='matched';}).length;
        var lbuy = all.filter(function(i){return i.is_buy_reservation;}).length;
        var lmatched = all.filter(function(i){return i.item_type==='구매매칭완료';}).length;
        return '<div style="background:#1a1d2e;border:1px solid #2a2d40;border-radius:8px;padding:12px">'
          +'<div style="font-size:13px;font-weight:700;color:'+types[t].color+';margin-bottom:8px">'+types[t].name+' ('+all.length+'개)</div>'
          +'<div style="font-size:11px;color:#aaa">판매가능: <span style="color:#66bb6a;font-weight:600">'+reservable+'</span></div>'
          +'<div style="font-size:11px;color:#aaa">판매매칭완료: <span style="color:#f9a825;font-weight:600">'+matched+'</span></div>'
          +(lbuy>0?'<div style="font-size:11px;color:#42a5f5">▶ 구매예약중: <span style="font-weight:700">'+lbuy+'</span></div>':'')
          +(lmatched>0?'<div style="font-size:11px;color:#ab47bc">▶ 구매매칭완료: <span style="font-weight:700">'+lmatched+'</span></div>':'')
          +'</div>';
      }).join('');
    }
    renderSystemItems();
    // 체크박스 상태 초기화
    var allCb = document.getElementById('si-check-all');
    if(allCb){ allCb.checked=false; allCb.indeterminate=false; }
    updateDeleteBtn();
    var buyCb = document.getElementById('si-buy-check-all');
    if(buyCb){ buyCb.checked=false; buyCb.indeterminate=false; }
    updateBuyDeleteBtn();
  }catch(e){
    if(tbody) tbody.innerHTML = '<tr><td colspan="6" style="color:#ef5350;text-align:center;padding:16px">오류: '+e.message+'</td></tr>';
    var buyTbodyErr = document.getElementById('si-buy-tbody');
    if(buyTbodyErr) buyTbodyErr.innerHTML = '<tr><td colspan="12" style="color:#ef5350;text-align:center;padding:16px">오류: '+e.message+'</td></tr>';
  }
}
function renderSystemItems(){
  var tbody = document.getElementById('si-tbody');
  var totalEl = document.getElementById('si-total');
  if(!tbody) return;
  var typeFilter = (document.getElementById('si-filter-type')||{}).value || '';
  var statusFilter = (document.getElementById('si-filter-status')||{}).value || '';
  var filtered = _systemItems.filter(function(i){
    if(typeFilter && i.bar_type !== typeFilter) return false;
    if(statusFilter && i.status !== statusFilter) return false;
    return true;
  });
  if(totalEl) totalEl.textContent = '총 '+filtered.length+'개 (전체 '+_systemItems.length+'개)';
  if(!filtered.length){
    tbody.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:20px;color:#888">아이템 없음</td></tr>';
    var buyTbodyEmpty = document.getElementById('si-buy-tbody');
    if(buyTbodyEmpty) buyTbodyEmpty.innerHTML = '<tr><td colspan="14" style="text-align:center;padding:20px;color:#888">구매 아이템 없음</td></tr>';
    return;
  }
  var tC={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
  var tN={bronze:'수정',silver:'루비',gold:'다이아'};
  var sL={reservable:'판매가능',waiting:'대기중',matched:'판매매칭완료',sold:'판매완료',active:'보유중',loopay_buy:'구매예약중',loopay_matched:'구매매칭완료',sell_reserved:'판매예약중'};
  var sC={reservable:'#66bb6a',waiting:'#f9a825',matched:'#1976d2',sold:'#888',active:'#aaa',loopay_buy:'#42a5f5',loopay_matched:'#ab47bc'};
  var matchStatusKr={pending:'대기',matched:'매칭완료',paid:'송금',completed:'거래완료',cancelled:'취소',failed:'미입금',confirmed:'거래완료',unpaid:'미입금'};
  var matchStatusColor={pending:'#888',matched:'#f9a825',paid:'#42a5f5',completed:'#66bb6a',cancelled:'#ef5350',failed:'#ef5350',confirmed:'#66bb6a',unpaid:'#ef5350'};
  // 판매아이템: reservable 또는 matched(pending/paid). waiting/is_buy_reservation/is_buy_matched/confirmed 제외
  // 단, loopay 자기매칭(is_self_match)은 판매테이블에도 표시
  var sellItems = filtered.filter(function(i){
    if(i.is_buy_reservation) return false;
    if(i.is_buy_matched && !i.is_self_match) return false; // 자기매칭이 아닌 구매매칭은 제외
    if(i.status === 'waiting') return false;
    if(i.status === 'matched' && !i.match_id && !i.sell_reservation_id) return false; // 매칭/판매예약 연결 없는 matched
    if(i.status === 'matched' && i.match_status === 'confirmed' && !i.is_self_match) return false; // 입금확인 완료(자기매칭 제외)
    return true;
  });
  // 구매아이템: 1차 매칭 완료(pending/paid만). confirmed(입금확인 완료)는 제외
  var buyItems = filtered.filter(function(i){
    return i.is_buy_matched === true && i.buy_match_confirmed !== true;
  });
  var buyTbody = document.getElementById('si-buy-tbody');
  tbody.innerHTML = sellItems.map(function(item,i){
    var bg = i%2===0?'#12121f':'#1a1a2e';
    // 판매예약 중 상태 판별 (matched 상태 + sell_reservation_id 있음)
    var isSellReserved = (item.status==='matched' && !item.match_status && item.sell_reservation_id);
    var ms = item.match_status;
    var matchBadge = ms
      ? '<span style="padding:2px 8px;border-radius:10px;font-size:11px;background:'+(matchStatusColor[ms]||'#888')+'33;color:'+(matchStatusColor[ms]||'#888')+'">'+(matchStatusKr[ms]||ms)+'</span>'
        + (item.match_round===2 ? '<span style="padding:2px 5px;border-radius:8px;font-size:10px;background:#7b1fa233;color:#ce93d8;font-weight:700;margin-left:4px">2차</span>'
                                : '<span style="padding:2px 5px;border-radius:8px;font-size:10px;background:#1565c033;color:#90caf9;font-weight:700;margin-left:4px">1차</span>')
      : '<span style="color:#555;font-size:11px">-</span>';
        // 서버 시간 기반 버튼 활성화 제어
    var _h = _serverHour||0; var _m = _serverMin||0;
    var _totalMin = _h*60+_m;
    // 1차: 12:30~13:00(750~780), 2차: 18:30~19:00(1110~1140)
    var _inWarnWindow = (_matchRound === 2)
      ? (_totalMin >= 1110 && _totalMin < 1140)
      : (_totalMin >= 750 && _totalMin < 780);
    // 1차: 13:00~14:00(780~840), 2차: 19:00~20:00(1140~1200)
    var _inConfirmWindow = (_matchRound === 2)
      ? (_totalMin >= 1140 && _totalMin < 1200)
      : (_totalMin >= 780 && _totalMin < 840);
    // 미입금 알림 버튼 쿨타임 체크 (10분=600000ms)
    // 쿨타임 체크: 서버 시간(분) 기준으로 9분 경과 여부
    var _lastClickMin = _unpaidClickedAt[item.match_id] || 0;
    var _curMin = _serverHour*60 + _serverMin;
    var _coolOk = (_lastClickMin === 0) || ((_curMin - _lastClickMin) >= 9);
    // 입금확인 완료 여부 / 송금완료 여부
    var _isConfirmed = (ms === 'confirmed');
    var _isPaid = (ms === 'paid');
    // 05:00~13:00 (300~780분)
    // 1차: 05:00~13:00 (300~780분), 2차: 15:00~19:00 (900~1140분)
    var _matchRound = item.match_round || 1;
    var _inPayWindow = (_matchRound === 2)
      ? (_totalMin >= 900 && _totalMin < 1140)
      : (_totalMin >= 300 && _totalMin < 780);

    // ── 3개 버튼: 시간 조건에 따라 활성/비활성 ──
    var actionBtns = '';
    if (item.match_id) {
      // ① 입금확인: 송금완료(paid) + 05:00~13:00 일 때 활성
      // 이미지 버튼 (receipt_url 있으면)
      if(item.receipt_url){
        actionBtns += '<a href="'+item.receipt_url+'" target="_blank" style="padding:3px 8px;background:#37474f;color:#80cbc4;border:1px solid #546e7a;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px;text-decoration:none">🖼️ 이미지</a>';
      }
      if (_isPaid) {  // 관리자는 시간 무관하게 입금확인 가능
        actionBtns += '<button onclick="adminConfirmPayment('+item.match_id+')" style="padding:3px 8px;background:#1976d2;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px">✅ 입금확인</button>';
      } else {
        actionBtns += '<button disabled style="padding:3px 8px;background:#2a2a3a;color:#555;border:1px solid #333;border-radius:4px;font-size:11px;cursor:not-allowed;margin-right:4px">✅ 입금확인</button>';
      }
      // ② 입금요청: 입금확인 안됨 + 송금완료 아님 + 12:30~13:00(750~780) + 쿨타임OK → 활성
      //   입금확인 버튼 활성화(paid) 시 비활성, 13:00이후 비활성, 클릭후 9분 쿨타임
      if (!_isConfirmed && !_isPaid && _inWarnWindow && _coolOk) {
        actionBtns += '<button onclick="adminWarnUnpaid('+item.match_id+')" style="padding:3px 8px;background:#f57c00;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px">📨 입금요청</button>';
      } else if (!_isConfirmed && !_isPaid && _inWarnWindow && !_coolOk) {
        actionBtns += '<button disabled title="9분 후 재활성화" style="padding:3px 8px;background:#2a2a3a;color:#555;border:1px solid #333;border-radius:4px;font-size:11px;cursor:not-allowed;margin-right:4px">📨 입금요청</button>';
      } else {
        actionBtns += '<button disabled style="padding:3px 8px;background:#2a2a3a;color:#555;border:1px solid #333;border-radius:4px;font-size:11px;cursor:not-allowed;margin-right:4px">📨 입금요청</button>';
      }
      // ③ 미입금확인: 입금확인 안됨 + 13:00~14:00(780~840) 활성
      if (!_isConfirmed && _inConfirmWindow) {
        actionBtns += '<button onclick="adminConfirmUnpaid('+item.match_id+')" style="padding:3px 8px;background:#c62828;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer">🚫 미입금확인</button>';
      } else {
        actionBtns += '<button disabled style="padding:3px 8px;background:#2a2a3a;color:#555;border:1px solid #333;border-radius:4px;font-size:11px;cursor:not-allowed">🚫 미입금확인</button>';
      }
    }
    return '<tr style="border-bottom:1px solid #2a2a40;background:'+bg+'">'
      +'<td style="padding:6px 8px;text-align:center"><input type=\"checkbox\" class=\"si-item-check\" data-id=\"'+item.id+'\" onchange=\"updateDeleteBtn()\" style=\"cursor:pointer\"></td>'
      +'<td style="padding:6px 8px;color:#555">'+item.id+'</td>'
      +'<td style="padding:6px 8px;text-align:center;color:'+(tC[item.bar_type]||'#fff')+'"><strong>'+(tN[item.bar_type]||item.bar_type)+'</strong></td>'
      +'<td style="padding:6px 8px;text-align:center">'+(item.stage||'-')+'단계</td>'
      +'<td style="padding:6px 8px;text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:11px;background:'+(isSellReserved?'#f9a82522':((sC[item.status]||'#555')+'33'))+';color:'+(isSellReserved?'#f9a825':(sC[item.status]||'#aaa'))+'">'+(isSellReserved?'판매예약중':(sL[item.status]||item.status))+'</span></td>'
      +'<td style="padding:6px 8px;text-align:center">'+(isSellReserved?'<span style="padding:2px 6px;border-radius:8px;font-size:11px;background:#f9a82522;color:#f9a825">'+(item.sell_reservation_round||1)+'차</span>':matchBadge)+'</td>'
      +'<td style="padding:6px 8px;color:#888;font-size:11px">'+(item.purchase_date||'-')+'</td>'
      +'<td style="padding:6px 8px;color:#888;font-size:11px">'+(isSellReserved?(item.sell_reservation_date||item.reserve_date||'-'):(item.reserve_date||'-'))+'</td>'
      +'<td style="padding:6px 8px;text-align:right;color:#90caf9;font-size:11px">'+(item.buy_price?item.buy_price.toLocaleString()+'원':'-')+'</td>'
      +'<td style="padding:6px 8px;text-align:right;color:#f9a825;font-size:11px;font-weight:600">'+(item.sell_price?item.sell_price.toLocaleString()+'원':'-')+'</td>'
      +'<td style="padding:6px 8px;color:#64b5f6;font-size:11px">'+(item.buyer_username||'-')+'</td>'
      +'<td style="padding:6px 8px;color:#64b5f6;font-size:11px">'+(item.buyer_account_name||'-')+'</td>'
      +'<td style="padding:6px 8px;color:#64b5f6;font-size:11px">'+(item.buyer_account||'-')+'</td>'
      +'<td style="padding:6px 8px">'
      // loopay 구매예약중: 삭제 버튼
      + (item.is_buy_reservation ? '<button onclick="deleteLoopayBuyItem('+item.id+')" style="padding:3px 8px;background:#c62828;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px">🗑️ 삭제</button>' : '')
      // loopay 구매매칭완료: 입금확인 + 취소 버튼
      + (false && item.match_id  /* loopay_matched → matched로 통합됨 */ ? '<button onclick="adminConfirmPayment('+item.match_id+')" style="padding:3px 8px;background:#1976d2;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px">✅ 입금확인</button>' : '')
      // loopay reservable(매칭 후 보유): 판매예약 버튼 / 판매예약중 배지
      + (isSellReserved ? '<span style="padding:3px 8px;border-radius:8px;font-size:11px;background:#f9a82522;color:#f9a825;font-weight:700">📋 판매예약중</span>' : '')
      + (!isSellReserved && item.status==='reservable' && !item.match_id && !item.sell_reservation_id ? '<button onclick="loopayItemSellReserve('+item.id+')" style="padding:3px 8px;background:#2e7d32;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;margin-right:4px">📋 판매예약</button>' : '')
      + actionBtns+'</td>'
      +'</tr>';
  }).join('');

  // 구매 아이템 테이블 렌더링
  if(buyTbody){
    if(!buyItems.length){
      buyTbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#888">구매 아이템 없음</td></tr>';
    } else {
      var tC2={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
      var tN2={bronze:'수정',silver:'루비',gold:'다이아'};
      buyTbody.innerHTML = buyItems.map(function(item,bi){
        var bg2 = bi%2===0?'#12121f':'#1a1a2e';
        var statusLabel = item.is_buy_matched ? '구매매칭완료' : (item.is_buy_reservation ? '구매예약중' : '대기중');
        var statusColor = item.is_buy_matched ? '#ab47bc' : (item.is_buy_reservation ? '#42a5f5' : '#f9a825');
        var ms2 = item.match_status;
        var mKr={pending:'대기',paid:'송금완료',confirmed:'거래완료',failed:'미입금'};
        var mCol={pending:'#888',paid:'#42a5f5',confirmed:'#66bb6a',failed:'#ef5350'};
        var mBadge = ms2 ? '<span style="padding:2px 8px;border-radius:10px;font-size:11px;background:'+(mCol[ms2]||'#888')+'33;color:'+(mCol[ms2]||'#888')+'">'+(mKr[ms2]||ms2)+'</span>' : '<span style="color:#555;font-size:11px">-</span>';
        var sellerAccName = item.seller_account_name || '-';
        var sellerAcc = item.seller_account || '-';
        var sellerBank = item.seller_bank ? '('+item.seller_bank+')' : '';
        var actionBtn = '';
        if(item.is_buy_matched && item.match_id && ms2 === 'pending'){
          actionBtn = '<button onclick="adminLoopayRemit('+item.match_id+',\''+sellerAccName+'\',\''+sellerAcc+'\',\''+sellerBank+'\')" style="padding:3px 10px;background:#1976d2;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer">💸 송금</button>';
        }
        return '<tr style="background:'+bg2+';border-bottom:1px solid #23243a">'
          +'<td style="padding:6px 8px;text-align:center"><input type="checkbox" class="si-buy-check" data-id="'+item.id+'" onchange="updateBuyDeleteBtn()" style="cursor:pointer"></td>'
          +'<td style="padding:6px 8px;color:#888">'+item.id+'</td>'
          +'<td style="padding:6px 8px;text-align:center;color:'+tC2[item.bar_type]+'"><strong>'+tN2[item.bar_type]+'</strong></td>'
          +'<td style="padding:6px 8px;text-align:center">'+(item.stage||1)+'단계</td>'
          +'<td style="padding:6px 8px;text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:11px;background:'+statusColor+'33;color:'+statusColor+'">'+statusLabel+'</span></td>'
          +'<td style="padding:6px 8px;text-align:center">'+mBadge+'</td>'
          +'<td style="padding:6px 8px;color:#888">'+(item.purchase_date||'-')+'</td>'
          +'<td style="padding:6px 8px;color:#888">'+(item.reserve_date||'-')+'</td>'
          +'<td style="padding:6px 8px;text-align:right;color:#90caf9;font-size:11px">'+(item.buy_price?item.buy_price.toLocaleString()+'원':'-')+'</td>'
          +'<td style="padding:6px 8px;text-align:right;color:#f9a825;font-size:11px;font-weight:600">'+(item.sell_price?item.sell_price.toLocaleString()+'원':'-')+'</td>'
          +'<td style="padding:6px 8px;color:#a5d6a7">'+(item.seller_username||'-')+'</td>'
          +'<td style="padding:6px 8px">'+(sellerAccName)+'</td>'
          +'<td style="padding:6px 8px;font-size:11px">'+(item.seller_account||'-')+(item.seller_bank?' ('+item.seller_bank+')':'')+'</td>'
          +'<td style="padding:6px 8px">'+actionBtn+'</td>'
          +'</tr>';
      }).join('');
    }
  }
}

// ── 매치 기록 ────────────────────────────────────────
var _matchRecords = [];

// ── 구매/판매 예약기록 ────────────────────────────────────────
var _rlPage = 1;
var _rlTotal = 0;
var _rlPerPage = 100;

function rlResetFilter(){
  document.getElementById('rl-date').value = '';
  document.getElementById('rl-date-from').value = '';
  document.getElementById('rl-date-to').value = '';
  document.getElementById('rl-username').value = '';
  document.getElementById('rl-type').value = '';
  _rlPage = 1;
  loadReservationsLog();
}

function rlToggleAll(cb){
  document.querySelectorAll('.rl-check').forEach(function(el){ el.checked = cb.checked; });
  rlUpdateDelBtn();
}

function rlUpdateDelBtn(){
  var checked = document.querySelectorAll('.rl-check:checked');
  var all = document.querySelectorAll('.rl-check');
  var btn = document.getElementById('rl-del-btn');
  var allCb = document.getElementById('rl-check-all');
  if(btn) btn.style.display = checked.length > 0 ? '' : 'none';
  if(allCb){
    allCb.checked = all.length > 0 && checked.length === all.length;
    allCb.indeterminate = checked.length > 0 && checked.length < all.length;
  }
}

async function deleteSelectedReservations(){
  var checked = document.querySelectorAll('.rl-check:checked');
  if(!checked.length){ toast('선택된 항목이 없습니다.','error'); return; }
  var ids = Array.from(checked).map(function(el){ return parseInt(el.dataset.id); });
  if(!confirm(ids.length+'건의 예약기록을 삭제하시겠습니까?')) return;
  try{
    var d = await apiAdmin('/admin/reservations/delete',{method:'POST',body:JSON.stringify({ids:ids})});
    toast('✅ '+d.deleted+'건 삭제 완료', 'success');
    loadReservationsLog();
  }catch(e){ toast(e.message||'삭제 실패','error'); }
}

async function loadReservationsLog(page){
  _rlPage = page || 1;
  var tbody = document.getElementById('rl-tbody');
  var summary = document.getElementById('rl-summary');
  if(tbody) tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:20px;color:#888">로딩 중...</td></tr>';

  var date     = document.getElementById('rl-date')?.value || '';
  var dateFrom = document.getElementById('rl-date-from')?.value || '';
  var dateTo   = document.getElementById('rl-date-to')?.value || '';
  var username = document.getElementById('rl-username')?.value || '';
  var type     = document.getElementById('rl-type')?.value || '';

  var params = new URLSearchParams({page: _rlPage, per_page: (_rlPerPage || 100)});
  if(date)     params.set('date', date);
  if(dateFrom) params.set('date_from', dateFrom);
  if(dateTo)   params.set('date_to', dateTo);
  if(username) params.set('username', username);
  if(type)     params.set('type', type);

  try{
    var tok2 = localStorage.getItem('admin_token');
    var d = await fetch('/api/admin/reservations-list?' + params.toString(),{headers:{'Authorization':'Bearer '+tok2}}).then(r=>r.json());
    _rlTotal = d.total || 0;
    var rows = d.reservations || [];

    if(summary){
      summary.textContent = '총 ' + _rlTotal + '건' + (date||dateFrom||dateTo||username||type ? ' (필터 적용)' : '');
    }

    if(!rows.length){
      if(tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:20px;color:#888">예약 내역 없음</td></tr>';
      rlRenderPagination();
      return;
    }

    var barNames = {bronze:'수정', silver:'루비', gold:'다이아'};
    var statusColors = {pending:'#42a5f5', matched:'#66bb6a', unmatched:'#ef9a9a', cancelled:'#888'};
    var typeColors = {buy:'#ab47bc', sell:'#42a5f5'};

    if(tbody) tbody.innerHTML = rows.map(function(r, i){
      var rowNo = ((_rlPage||1)-1)*(_rlPerPage||100) + i + 1;
      var bar = barNames[r.bar_type] || r.bar_type;
      var barColor = r.bar_type==='bronze'?'#cd7f32':r.bar_type==='silver'?'#c0c0c0':'#ffd700';
      var typeName = r.res_type==='sell'?'판매':'구매';
      var typeColor = r.res_type==='sell' ? typeColors['sell'] : typeColors['buy'];
      var statusColor = statusColors[r.status] || '#888';
      var confirmedBadge = r.confirmed ? '<span style="font-size:10px;background:#1b5e20;color:#a5d6a7;padding:1px 5px;border-radius:3px">확인</span>' : '';
      var createdAt = (r.created_at||'').slice(0,16);
      var statusKo = {reservable:'예약가능', active:'활성', waiting:'대기중', matched:'매칭완료',
        sold:'판매완료', reserved:'예약중', cancelled:'취소', confirmed:'확정',
        pending:'대기', sell_reserved:'판매예약중', unmatched:'미매칭',
        expired:'만료', rejected:'거절', complete:'완료'}[r.status] || r.status;
      // 2차 참가 배지: 구매예약만 표시
      var round2Badge = r.res_type==='buy'
        ? (r.join_round2
            ? '<span style="padding:2px 7px;border-radius:8px;font-size:11px;background:#2e7d3222;color:#66bb6a;font-weight:700">참가</span>'
            : '<span style="padding:2px 7px;border-radius:8px;font-size:11px;background:#c6282822;color:#ef5350;font-weight:700">미참가</span>')
        : '<span style="color:#555;font-size:11px">-</span>';
      return '<tr style="border-bottom:1px solid #2a2a40">'
        +'<td style="text-align:center"><input type="checkbox" class="rl-check" data-id="'+r.id+'" onchange="rlUpdateDelBtn()" style="cursor:pointer"></td>'
        +'<td style="text-align:center;color:#888">'+rowNo+'</td>'
        +'<td style="text-align:center">'+r.reserve_date+'</td>'
        +'<td style="text-align:center"><strong style="color:#4fc3f7">'+r.username+'</strong></td>'
        +'<td style="text-align:center;color:#aaa">'+(r.account_name||r.nickname||'-')+'</td>'
        +'<td style="text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:11px;background:'+typeColor+'22;color:'+typeColor+';font-weight:700">'+typeName+'</span></td>'
        +'<td style="text-align:center;font-weight:700;color:'+barColor+'">'+bar+'</td>'
        +'<td style="text-align:center;color:#aaa">'+(r.stage>0?r.stage+'단계':'-')+'</td>'
        +'<td style="text-align:center;color:#888">'+(r.match_round||'-')+'차</td>'
        +'<td style="text-align:center"><span style="padding:2px 8px;border-radius:10px;font-size:11px;background:'+statusColor+'22;color:'+statusColor+'">'+statusKo+'</span></td>'
        +'<td style="text-align:center">'+round2Badge+'</td>'
        +'</tr>';
    }).join('');

    rlRenderPagination();
  }catch(e){
    if(tbody) tbody.innerHTML = '<tr><td colspan="11" style="text-align:center;padding:16px;color:#ef5350">'+e.message+'</td></tr>';
  }
}

function rlRenderPagination(){
  var el = document.getElementById('rl-pagination');
  if(!el) return;
  var totalPages = Math.ceil(_rlTotal / _rlPerPage);
  if(totalPages <= 1){ el.innerHTML=''; return; }
  var html2 = '';
  var start = Math.max(1, _rlPage-3);
  var end   = Math.min(totalPages, _rlPage+3);
  if(_rlPage > 1) html2 += '<button onclick="loadReservationsLog(1)" style="'+rlPagBtn()+'">«</button><button onclick="loadReservationsLog('+(_rlPage-1)+')" style="'+rlPagBtn()+'">‹</button>';
  for(var p=start;p<=end;p++){
    var active = p===_rlPage ? 'background:#1976d2;color:#fff;' : '';
    html2 += '<button onclick="loadReservationsLog('+p+')" style="'+rlPagBtn()+active+'">'+p+'</button>';
  }
  if(_rlPage < totalPages) html2 += '<button onclick="loadReservationsLog('+(_rlPage+1)+')" style="'+rlPagBtn()+'">›</button><button onclick="loadReservationsLog('+totalPages+')" style="'+rlPagBtn()+'">»</button>';
  el.innerHTML = html2;
}
function rlPagBtn(){ return 'padding:5px 10px;background:#1a1d2e;border:1px solid #2d2d5e;color:#cdd6f4;border-radius:5px;cursor:pointer;font-size:12px;'; }

function getResStageMax(){
  var barType = document.getElementById('add-res-type')?.value || 'bronze';
  return {'bronze': 20, 'silver': 16, 'gold': 14}[barType] || 20;
}

function toggleResStage(kind){
  var stageEl = document.getElementById('add-res-stage');
  if(!stageEl) return;
  if(kind === 'buy'){
    stageEl.disabled = true;
    stageEl.style.background = '#111';
    stageEl.style.color = '#555';
    stageEl.style.cursor = 'not-allowed';
    stageEl.value = 1;
  } else {
    stageEl.disabled = false;
    stageEl.style.background = '';
    stageEl.style.color = '';
    stageEl.style.cursor = '';
    var maxStage = getResStageMax();
    stageEl.max = maxStage;
    if(parseInt(stageEl.value) > maxStage) stageEl.value = maxStage;
  }
}

function mrResetFilter(){
  document.getElementById('mr-date').value = '';
  document.getElementById('mr-date-from').value = '';
  document.getElementById('mr-date-to').value = '';
  document.getElementById('mr-username').value = '';
  loadMatchRecords(); // 초기화 후 당일 기록으로 복원
}

function searchMatchRecords(){
  loadMatchRecords(true); // 필터 적용 검색
}

async function loadMatchRecords(useFilter){
  var tbody = document.getElementById('matches-tbody');
  var summary = document.getElementById('mr-summary');
  if(tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:20px;color:#888">로딩 중...</td></tr>';

  try{
    var ct = await fetch('/api/current-time').then(r=>r.json());
    var today = ct.time.slice(0,10);

    var params = new URLSearchParams();

    if(useFilter){
      // 필터 값 읽기
      var date    = (document.getElementById('mr-date')?.value || '').trim();
      var dfrom   = (document.getElementById('mr-date-from')?.value || '').trim();
      var dto     = (document.getElementById('mr-date-to')?.value || '').trim();
      var uname   = (document.getElementById('mr-username')?.value || '').trim();
      if(date)  params.set('date', date);
      if(dfrom) params.set('date_from', dfrom);
      if(dto)   params.set('date_to', dto);
      if(uname) params.set('username', uname);
    } else {
      // 기본: 당일 날짜로 조회
      params.set('date', today);
    }

    var qs = params.toString();
    var d = await apiAdmin('/admin/matches' + (qs ? '?' + qs : ''));
    _matchRecords = d.matches || [];

    // 당일 데이터 없으면 가장 최근 날짜로 fallback (기본 조회 시만)
    if(!useFilter && _matchRecords.length === 0){
      var d2 = await apiAdmin('/admin/matches');
      var allMatches = d2.matches || [];
      if(allMatches.length > 0){
        var latestDate = allMatches.reduce(function(acc,m){ return m.match_date > acc ? m.match_date : acc; }, '');
        _matchRecords = allMatches.filter(function(m){ return m.match_date === latestDate; });
        today = latestDate;
      }
    }

    _todayForMatch = today;

    // summary 업데이트
    if(summary){
      var totalCount = d.total || _matchRecords.length;
      var filterDesc = useFilter && qs ? ' (필터 적용)' : ' (당일)';
      summary.textContent = '총 ' + totalCount + '건' + filterDesc;
    }

    renderMatchRecords();
  }catch(e){
    if(tbody) tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:16px;color:#ef5350">'+e.message+'</td></tr>';
  }
}
function renderMatchRecords(){
  var tbody = document.getElementById('matches-tbody');
  if(!tbody) return;
  var colors = {bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
  var statusKr = {pending:'대기',matched:'매칭',paid:'송금',confirmed:'입금',completed:'완료',cancelled:'취소',failed:'미입금'};
  var statusColor = {pending:'#ffffff',confirmed:'#66bb6a',paid:'#f9a825',failed:'#ef5350',matched:'#90caf9',completed:'#ce93d8',cancelled:'#888888'};
  if(!_matchRecords.length){
    tbody.innerHTML = '<tr><td colspan="12" style="text-align:center;padding:20px;color:#888">매치 기록 없음</td></tr>';
    return;
  }
  tbody.innerHTML = _matchRecords.map(function(m,i){
    var bg = i%2===0 ? '#12121f' : '#1a1a2e';
    var buyer = m.buyer||{};
    var seller = m.seller||{};
    return '<tr style="border-bottom:1px solid #2a2a40;background:'+bg+'">'
      +'<td style="padding:6px;text-align:center"><input type="checkbox" class="match-check" data-id="'+m.id+'" onchange="updateMatchSelectedCount()" style="cursor:pointer;width:15px;height:15px"></td>'
      +'<td style="padding:6px;font-size:11px;color:#888">'+(m.match_date||'-')+'</td>'
      +'<td style="padding:6px;text-align:center">'
        +(m.match_round===2
          ?'<span style="padding:2px 6px;border-radius:8px;font-size:10px;background:#7b1fa233;color:#ce93d8;font-weight:700">2차</span>'
          :'<span style="padding:2px 6px;border-radius:8px;font-size:10px;background:#1565c033;color:#90caf9;font-weight:700">1차</span>')
        +'</td>'
      +'<td style="padding:6px;text-align:center;color:'+colors[m.bar_type]+'"><strong>'+(m.bar_name||'-')+'</strong></td>'
      +'<td style="padding:6px;text-align:center">'+(m.stage||'-')+'단계</td>'
      +'<td style="padding:6px;color:#64b5f6">'+(buyer.username||'-')+'</td>'
      +'<td style="padding:6px;color:#64b5f6;font-size:11px">'+(buyer.account_name||'-')+'</td>'
      +'<td style="padding:6px;color:#64b5f6;font-size:11px">'+(buyer.account||'-')+'</td>'
      +'<td style="padding:6px;color:#a5d6a7">'+(seller.username||'-')+'</td>'
      +'<td style="padding:6px;color:#a5d6a7;font-size:11px">'+(seller.account_name||'-')+'</td>'
      +'<td style="padding:6px;color:#a5d6a7;font-size:11px">'+(seller.account||'-')+'</td>'
      +'<td style="padding:6px;text-align:right;color:#f9a825">'+(m.sell_price?m.sell_price.toLocaleString()+'원':'-')+'</td>'
      +'<td style="padding:6px;text-align:center;font-size:11px;font-weight:700;color:'+(statusColor[m.status]||'#aaa')+'">'+(statusKr[m.status]||m.status||'-')+'</td>'
      +'</tr>';
  }).join('');
  updateMatchSelectedCount();
}
function toggleAllMatches(checked){
  document.querySelectorAll('.match-check').forEach(function(cb){ cb.checked = checked; });
  updateMatchSelectedCount();
}
function updateMatchSelectedCount(){
  var n = document.querySelectorAll('.match-check:checked').length;
  var el = document.getElementById('match-selected-count');
  if(el) el.textContent = n > 0 ? n+'건 선택됨' : '';
  var allCb = document.getElementById('match-select-all');
  var total = document.querySelectorAll('.match-check').length;
  if(allCb) allCb.checked = (n > 0 && n === total);
}
async function deleteSelectedMatches(){
  var ids = Array.from(document.querySelectorAll('.match-check:checked')).map(function(cb){return parseInt(cb.dataset.id);});
  if(!ids.length){ toast('선택된 기록이 없습니다.','error'); return; }
  if(!confirm(ids.length+'건의 매칭 기록을 삭제하시겠습니까?')) return;
  try{
    await apiAdmin('/admin/delete-matches',{method:'POST',body:JSON.stringify({match_ids:ids})});
    toast('삭제 완료','success'); loadMatchRecords();
  }catch(e){ toast(e.message,'error'); }
}
async function deleteAllMatches(){
  if(!_matchRecords.length){ toast('삭제할 기록이 없습니다.'); return; }
  if(!confirm('전체 매칭 기록 '+_matchRecords.length+'건을 삭제하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
  try{
    await apiAdmin('/admin/delete-matches',{method:'POST',body:JSON.stringify({match_ids:[]})});
    toast('전체 삭제 완료','success'); loadMatchRecords();
  }catch(e){ toast(e.message,'error'); }
}

function switchRound(num,el){document.querySelectorAll('#page-matching .btn').forEach(function(b){if(b.id&&b.id.startsWith('round-tab-')){b.classList.remove('btn-primary');b.classList.add('btn-secondary');}});el.classList.remove('btn-secondary');el.classList.add('btn-primary');document.getElementById('round-panel-1').style.display=num===1?'block':'none';document.getElementById('round-panel-2').style.display=num===2?'block':'none';loadMatchingStatus();}
// ── 추가예약 (루페이 계정) ────────────────────────────────
async function addReservation(){
  var barType = document.getElementById('add-res-type').value;
  var kind = document.getElementById('add-res-kind').value;
  var stage = parseInt(document.getElementById('add-res-stage').value) || 1;
  var count = parseInt(document.getElementById('add-res-count').value) || 1;
  var resultEl = document.getElementById('add-res-result');
  if(resultEl) resultEl.textContent = '처리 중...';
  try{
    var tok = localStorage.getItem('admin_token');
    var r = await fetch('/api/admin/add-reservation',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body: JSON.stringify({bar_type:barType, type:kind, stage:stage, count:count, match_round: (window._currentMatchRound||1), join_round2: document.getElementById('admin-join-round2')?.checked ? 1 : 0})});
    var d = await r.json();
    if(d.success){
      if(resultEl) resultEl.innerHTML = '<span style="color:#66bb6a">✅ '+count+'건 추가예약 완료</span>';
      loadReservationStatus();
      loadExtraReservations();
    } else {
      if(resultEl) resultEl.innerHTML = '<span style="color:#ef5350">❌ '+(d.error||'실패')+'</span>';
    }
  }catch(e){
    if(resultEl) resultEl.innerHTML = '<span style="color:#ef5350">❌ '+e.message+'</span>';
  }
}

async function loadExtraReservations(){
  var tbody = document.getElementById('extra-res-tbody');
  var countEl = document.getElementById('extra-res-count');
  if(!tbody) return;
  tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:12px;color:#888">로딩 중...</td></tr>';
  try{
    var tok = localStorage.getItem('admin_token');
    var d = await fetch('/api/admin/loopay-extra-reservations',{headers:{'Authorization':'Bearer '+tok}}).then(r=>r.json());
    var list = d.reservations || [];
    if(!list.length){
      tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:12px;color:#888">추가예약 내역 없음</td></tr>';
      if(countEl) countEl.textContent = '총 0건';
      updateExtraDelBtn();
      return;
    }
    var names={bronze:'수정',silver:'루비',gold:'다이아'};
    var colors={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
    tbody.innerHTML = list.map(function(item,i){
      var bg = i%2===0?'#12121f':'#1a1a2e';
      var kindLabel = item.type==='buy'?'<span style="color:#4fc3f7">구매</span>':'<span style="color:#81c784">판매</span>';
      var isConfirmed = item.confirmed===1 || item.confirmed==='1';
      var statusLabel = isConfirmed
        ? '<span style="color:#66bb6a;font-weight:700">✅확정</span>'
        : (item.status==='pending'?'<span style="color:#ffd700">대기</span>':'<span style="color:#888">'+item.status+'</span>');
      // 체크박스: 확정된 항목은 비활성화
      var checkbox = isConfirmed
        ? '<input type="checkbox" disabled style="cursor:not-allowed;opacity:0.3">'
        : '<input type="checkbox" class="extra-res-check" data-id="'+item.id+'" onchange="updateExtraDelBtn()" style="cursor:pointer">';
      // 확정 버튼 (대기 상태만)
      var confirmBtn = isConfirmed
        ? '<span style="color:#66bb6a;font-size:11px">확정됨</span>'
        : '<button onclick="confirmSingleExtraRes('+item.id+')" style="padding:2px 8px;background:#2e7d32;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer">확정</button>';
      return '<tr style="border-bottom:1px solid #2a2a40;background:'+bg+'">'
        +'<td style="padding:6px 4px;text-align:center">'+checkbox+'</td>'
        +'<td style="padding:6px 8px;color:#888">'+(i+1)+'</td>'
        +'<td style="padding:6px 8px;color:'+colors[item.bar_type]+';font-weight:700">'+(names[item.bar_type]||item.bar_type)+'</td>'
        +'<td style="padding:6px 8px">'+kindLabel+'</td>'
        +'<td style="padding:6px 8px;text-align:center">'+(item.type==='buy' ? '<span style="color:#555">-</span>' : (item.stage||'-')+'단계')+'</td>'
        +'<td style="padding:6px 8px;color:#888">'+item.reserve_date+'</td>'
        +'<td style="padding:6px 8px;text-align:center">'+statusLabel+'</td>'
        +'<td style="padding:6px 8px;text-align:center">'+confirmBtn+'</td>'
        +'</tr>';
    }).join('');
    if(countEl) countEl.textContent = '총 '+list.length+'건 (대기: '+list.filter(function(r){return r.status==='pending';}).length+'건)';
    var allCb = document.getElementById('extra-check-all');
    if(allCb){ allCb.checked=false; allCb.indeterminate=false; }
    updateExtraDelBtn();
  }catch(e){
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:12px;color:#ef5350">오류: '+e.message+'</td></tr>';
  }
}


function toggleAllExtraRes(cb){
  document.querySelectorAll('.extra-res-check').forEach(function(el){ el.checked=cb.checked; });
  updateExtraDelBtn();
}

function updateExtraDelBtn(){
  var checked = document.querySelectorAll('.extra-res-check:checked');
  var delBtn = document.getElementById('del-extra-btn');
  var confBtn = document.getElementById('confirm-extra-btn');
  if(delBtn){ delBtn.style.display=checked.length>0?'inline-block':'none'; delBtn.textContent='🗑️ 선택삭제 ('+checked.length+'건)'; }
  if(confBtn){ confBtn.style.display=checked.length>0?'inline-block':'none'; confBtn.textContent='✅ 선택확정 ('+checked.length+'건)'; }
  var allCb = document.getElementById('extra-check-all');
  if(allCb){
    var all = document.querySelectorAll('.extra-res-check');
    allCb.checked = all.length>0 && checked.length===all.length;
    allCb.indeterminate = checked.length>0 && checked.length<all.length;
  }
}

async function confirmSingleExtraRes(id){
  if(!confirm('이 예약을 확정하시겠습니까? 확정 후 수정/삭제가 불가합니다.')) return;
  await _doConfirmExtraRes([id]);
}

async function confirmSelectedExtraRes(){
  var checked = document.querySelectorAll('.extra-res-check:checked');
  if(!checked.length){ alert('선택된 항목이 없습니다.'); return; }
  if(!confirm(checked.length+'건을 확정하시겠습니까? 확정 후 수정/삭제가 불가합니다.')) return;
  var ids = Array.from(checked).map(function(el){ return parseInt(el.getAttribute('data-id')); });
  await _doConfirmExtraRes(ids);
}

async function _doConfirmExtraRes(ids){
  try{
    var tok = localStorage.getItem('admin_token');
    var r = await fetch('/api/admin/confirm-extra-reservations',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body: JSON.stringify({ids: ids})});
    var d = await r.json();
    if(d.success){
      toast('✅ '+ids.length+'건 확정 완료 - 시스템아이템현황에 반영됨','success');
      loadExtraReservations();
      loadReservationStatus();
    } else {
      toast('오류: '+(d.error||'확정 실패'),'error');
    }
  }catch(e){ toast('오류: '+e.message,'error'); }
}

async function deleteSelectedExtraRes(){
  var checked = document.querySelectorAll('.extra-res-check:checked');
  if(!checked.length){ alert('선택된 항목이 없습니다.'); return; }
  if(!confirm(checked.length+'건을 삭제하시겠습니까?')) return;
  var ids = Array.from(checked).map(function(el){ return parseInt(el.getAttribute('data-id')); });
  try{
    var tok = localStorage.getItem('admin_token');
    var r = await fetch('/api/admin/delete-extra-reservations',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body: JSON.stringify({ids: ids})});
    var d = await r.json();
    if(d.success){ toast('✅ '+ids.length+'건 삭제 완료','success'); loadExtraReservations(); loadReservationStatus(); }
    else{ toast('오류: '+(d.error||'삭제 실패'),'error'); }
  }catch(e){ toast('오류: '+e.message,'error'); }
}

async function loadReservationStatus(){
  var colors={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
  var names={bronze:'수정',silver:'루비',gold:'다이아'};
  var SEP='border-left:3px solid #888;';
  var C='text-align:center;';
  var CB='text-align:center;font-weight:700;';
  function mrc(r){return r>=80?'#66bb6a':r>=50?'#f9a825':'#ef5350';}
  function renderSummaryRow(bt,s){
    var mr=s.match_rate||0;
    return '<tr>'
      +'<td style="color:'+colors[bt]+';font-weight:700;font-size:13px;white-space:nowrap;border-right:3px solid #888">'+names[bt]+'</td>'
      +'<td style="'+C+'">'+(s.user_buy||0)+'</td>'
      +'<td style="'+C+'">'+(s.extra_buy||0)+'</td>'
      +'<td style="'+CB+'">'+(s.buy_count||0)+'</td>'
      +'<td style="'+C+SEP+'">'+(s.sell_under32||0)+'</td>'
      +'<td style="'+C+'">'+(s.sell_33up||0)+'</td>'
      +'<td style="'+C+'">'+(s.sell_split||0)+'</td>'
      +'<td style="'+C+SEP+'">'+(s.extra_sell_under32||0)+'</td>'
      +'<td style="'+C+'">'+(s.extra_sell_33up||0)+'</td>'
      +'<td style="'+C+'">'+(s.extra_sell_split||0)+'</td>'
      +'<td style="'+C+'">'+(s.extra_sell_new||0)+'</td>'
      +'<td style="'+CB+SEP+'">'+(s.sell_count||0)+'</td>'
      +'<td style="'+C+'font-weight:700;color:'+mrc(mr)+'">'+mr+'%</td>'
      +'</tr>';
  }
  function renderPriceRow(bt,s){
    var pb=s.price_bands||{}; var mr=s.match_rate||0;
    return '<tr>'
      +'<td style="color:'+colors[bt]+';font-weight:700;white-space:nowrap">'+names[bt]+'</td>'
      +'<td style="'+C+'">'+(pb.band1||0)+'</td>'
      +'<td style="'+C+'">'+(pb.band2||0)+'</td>'
      +'<td style="'+C+'">'+(pb.band3||0)+'</td>'
      +'<td style="'+C+'">'+(pb.band4||0)+'</td>'
      +'<td style="'+C+'">'+(pb.prev_unsold||0)+'</td>'
      +'<td style="'+CB+'">'+(s.sell_count||0)+'</td>'
      +'<td style="'+C+'font-weight:700;color:'+mrc(mr)+'">'+mr+'%</td>'
      +'</tr>';
  }
  try{
    var tok=localStorage.getItem('admin_token');
    var d=await fetch('/api/admin/reservation-status',{headers:{'Authorization':'Bearer '+tok}}).then(function(r){return r.json();});
    ['bronze','silver','gold'].forEach(function(bt){
      var s=d[bt]||{};
      var tb=document.getElementById('res-summary-tbody-'+bt);
      if(tb) tb.innerHTML=renderSummaryRow(bt,s);
      var pb=document.getElementById('res-price-tbody-'+bt);
      if(pb) pb.innerHTML=renderPriceRow(bt,s);
    });
  }catch(e){console.error('loadReservationStatus:',e);}
}


async function loadMatchingStatus(){
  var names={bronze:'수정',silver:'루비',gold:'다이아'};
  var colors={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
  // 매칭 실행 버튼/문구 블록 복원 (runMatching 직후 호출 시엔 숨김 유지)
  if(!window._matchingJustRan){
    var _runBlock1 = document.getElementById('match-run-block-1');
    if(_runBlock1) _runBlock1.style.display='';
    var _runBlock2 = document.getElementById('match-run-block-2');
    if(_runBlock2) _runBlock2.style.display='';
  }
  window._matchingJustRan = false;
  // 버튼 활성/비활성은 updateMatchingBtn이 담당 (loadMatchingStatus 완료 후 호출)
  try{
    var tok=localStorage.getItem('admin_token');
    var d=await fetch('/api/admin/matching-status',{headers:{'Authorization':'Bearer '+tok}}).then(r=>r.json());
    var sub=document.getElementById('matching-date-sub');
    if(sub) sub.innerHTML=(d.date||'')+' 매칭 현황 및 실행';
    var set=function(id,v){ var el=document.getElementById(id); if(el) el.textContent=v!=null?v:'-'; };
    var mrc=function(r){ return r>=80?'#66bb6a':r>=50?'#f9a825':'#ef5350'; };

    function mkTypeTable(data){
      if(!data||!data.length) return '<div style="padding:16px;color:#888;text-align:center">데이터 없음</div>';
      return '<table style="width:100%;font-size:12px;border-collapse:collapse">'
        +'<thead><tr style="background:#1a1d2e"><th style="padding:7px 12px;text-align:left">아이템</th><th style="padding:7px 12px;text-align:center">예약수</th><th style="padding:7px 12px;text-align:center">비율</th></tr></thead>'
        +'<tbody>'+data.map(function(row){
          var total=data.reduce(function(s,r){return s+r.count;},0);
          var pct=total>0?Math.round(row.count/total*100):0;
          return '<tr style="border-bottom:1px solid #2a2a40">'
            +'<td style="padding:7px 12px;color:'+(colors[row.bar_type]||'#eee')+';font-weight:700">'+(names[row.bar_type]||row.bar_type)+'</td>'
            +'<td style="padding:7px 12px;text-align:center;font-weight:700">'+row.count+'</td>'
            +'<td style="padding:7px 12px;text-align:center;color:#888">'+pct+'%</td>'
            +'</tr>';
        }).join('')+'</tbody></table>';
    }
    function mkStageTable(data){
      if(!data||!data.length) return '<div style="padding:16px;color:#888;text-align:center">데이터 없음</div>';
      return '<table style="width:100%;font-size:12px;border-collapse:collapse">'
        +'<thead><tr style="background:#1a1d2e"><th style="padding:7px 12px;text-align:left">아이템</th><th style="padding:7px 12px;text-align:center">단계</th><th style="padding:7px 12px;text-align:center">예약수</th></tr></thead>'
        +'<tbody>'+data.map(function(row){
          return '<tr style="border-bottom:1px solid #2a2a40">'
            +'<td style="padding:7px 12px;color:'+(colors[row.bar_type]||'#eee')+';font-weight:700">'+(names[row.bar_type]||row.bar_type)+'</td>'
            +'<td style="padding:7px 12px;text-align:center">'+row.stage+'단계</td>'
            +'<td style="padding:7px 12px;text-align:center;font-weight:700">'+row.count+'</td>'
            +'</tr>';
        }).join('')+'</tbody></table>';
    }

    // ── 1차 매칭 ──
    var r1=d.round1||{};
    var mr1=r1.match_rate||0;
    // 1차 매칭이 실행됐으면 구매/판매예약수 0 유지 (새로고침 전까지)
    var _r1BuyDisplay = window._r1MatchingDone ? 0 : (r1.buy_count!=null?r1.buy_count:'-');
    var _r1SellDisplay = window._r1MatchingDone ? 0 : (r1.sell_count!=null?r1.sell_count:'-');
    set('r1-buy', _r1BuyDisplay);
    set('r1-sell', _r1SellDisplay);
    var rateEl1=document.getElementById('r1-rate');
    if(rateEl1){ rateEl1.textContent=mr1+'%'; rateEl1.style.color=mrc(mr1); }
    var bb1=document.getElementById('r1-buy-by-type'); if(bb1) bb1.innerHTML=mkTypeTable(r1.buy_by_type);
    var bt1=document.getElementById('r1-by-type'); if(bt1) bt1.innerHTML=mkTypeTable(r1.by_type);


    // ── 2차 매칭 ──
    var r2=d.round2||{};
    var mr2=r2.match_rate||0;
    // 2차 탭 구매예약 수 = 1차 미매칭(1차 buy - 1차 sell) 표시
    var _r1UnmatchedBuy = (d.r1_unmatched_buy!=null) ? d.r1_unmatched_buy : (r2.buy_count!=null?r2.buy_count:'-');
    set('r2-buy', _r1UnmatchedBuy);
    set('r2-sell', r2.sell_count!=null?r2.sell_count:'-');
    var rateEl2=document.getElementById('r2-rate');
    if(rateEl2){ rateEl2.textContent=mr2+'%'; rateEl2.style.color=mrc(mr2); }
    var bt2=document.getElementById('r2-by-type'); if(bt2) bt2.innerHTML=mkTypeTable(r2.by_type);
    var bbt2=document.getElementById('r2-buy-by-type'); if(bbt2) bbt2.innerHTML=mkTypeTable(r2.buy_by_type);

    // 미입금 현황 렌더링
    var barNames={bronze:'수정',silver:'루비',gold:'다이아'};
    var barColors={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
    var failedDetails = d.failed_details || [];
    var failedBadge = document.getElementById('r2-failed-count-badge');
    var failedList = document.getElementById('r2-failed-list');
    if(failedBadge) failedBadge.textContent = failedDetails.length > 0 ? '총 '+failedDetails.length+'건' : '없음';
    if(failedList){
      if(!failedDetails.length){
        failedList.innerHTML = '<div style="padding:12px 16px;color:#888;font-size:12px;text-align:center">미입금 없음</div>';
      } else {
        failedList.innerHTML = '<table style="width:100%;font-size:12px;border-collapse:collapse">'
          +'<thead><tr style="background:#1a1d2e">'
          +'<th style="padding:7px 12px;text-align:left">아이디</th>'
          +'<th style="padding:7px 12px;text-align:left">성명</th>'
          +'<th style="padding:7px 12px;text-align:center">아이템</th>'
          +'<th style="padding:7px 12px;text-align:center">단계</th>'
          +'</tr></thead><tbody>'
          +failedDetails.map(function(f){
            return '<tr style="border-bottom:1px solid #2a2a40">'
              +'<td style="padding:7px 12px;color:#ef5350;font-weight:700">'+f.username+'</td>'
              +'<td style="padding:7px 12px;color:#aaa">'+(f.nickname||'-')+'</td>'
              +'<td style="padding:7px 12px;text-align:center;font-weight:700;color:'+(barColors[f.bar_type]||'#eee')+'">'+(barNames[f.bar_type]||f.bar_type)+'</td>'
              +'<td style="padding:7px 12px;text-align:center;color:#888">'+(f.stage||'-')+'단계</td>'
              +'</tr>';
          }).join('')
          +'</tbody></table>';
      }
    }

  }catch(e){ console.error('loadMatchingStatus:',e); }
  try{ updateMatchingBtn(); }catch(_e){}
}


async function runMatching(roundNum){
  roundNum = roundNum||1;
  var btn = document.getElementById('btn-run-matching-'+roundNum);
  if(btn){ btn.disabled=true; btn.textContent='⏳ 실행 중...'; }
  var _success = false;
  try{
    var d = await apiAdmin('/admin/run-matching', {method:'POST', body:JSON.stringify({round:roundNum})});
    if(!d.success){ throw new Error(d.error||'매칭 실패'); }
    _success = true;
    toast(d.message||roundNum+'차 매칭 완료!', 'success');
    // 매칭 성공 후: 버튼 텍스트 복원 + 비활성화 유지 + 블록 숨김
    if(btn){ btn.disabled=true; btn.style.opacity='0.45'; btn.style.cursor='not-allowed'; btn.textContent='⚡ '+roundNum+'차 매칭 실행하기'; }
    var runBlockEl = document.getElementById('match-run-block-'+roundNum);
    if(runBlockEl) runBlockEl.style.display='none';
    // 매칭 완료 후 구매예약 수량 즉시 0으로 표시
    var buyEl = document.getElementById('r'+roundNum+'-buy');
    var sellEl = document.getElementById('r'+roundNum+'-sell');
    if(buyEl) buyEl.textContent = '0';
    if(roundNum===1){
      // 1차 매칭 후 구매/판매예약 카드 수량 0 표시
      var rateEl = document.querySelector('#matching-rate-1, [id*="rate"]');
    }
    window._matchingJustRan = true; // loadMatchingStatus에서 블록 복원 방지
    window._matchingRanRound = roundNum; // 어느 차수가 실행됐는지 기록
    // 1차 매칭 실행 직후: 구매/판매예약 수 즉시 0으로 표시
    if(roundNum===1){
      window._r1MatchingDone = true;
      var _rb = document.getElementById('r1-buy');
      var _rs = document.getElementById('r1-sell');
      if(_rb) _rb.textContent='0';
      if(_rs) _rs.textContent='0';
    }
    loadMatchingStatus();
    if(typeof loadMatchRecords==='function') loadMatchRecords();
  }catch(e){
    toast(e.message||'오류', 'error');
    // 실패 시에만 버튼 복원
    if(btn){ btn.disabled=false; btn.textContent='⚡ '+roundNum+'차 매칭 실행하기'; }
    updateMatchingBtn();
  }
}


function loadMembers(){
  var wrap=document.getElementById('members-table-wrap');
  if(!wrap) return;
  wrap.innerHTML='<div style="color:#888;padding:20px;text-align:center">로딩 중...</div>';
  fetch('/api/admin/pending-users',{headers:{'Authorization':'Bearer admin-loopay-2026'}})
  .then(function(r){return r.json();})
  .then(function(data){
    if(!data.users||!data.users.length){
      wrap.innerHTML='<div style="color:#888;padding:20px;text-align:center">회원이 없습니다.</div>';
      return;
    }
    var rows=data.users.map(function(u){
      var badge=u.approved?'<span style="background:#2e7d32;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">승인완료</span>':'<span style="background:#e65100;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">대기중</span>';
      var btns=u.approved?'<button onclick="approveUser('+u.id+',\'reject\')" style="padding:4px 10px;background:#c62828;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">회원탈퇴</button>':'<button onclick="approveUser('+u.id+',\'approve\')" style="padding:4px 10px;background:#1976d2;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px;margin-right:4px">승인</button><button onclick="approveUser('+u.id+',\'reject\')" style="padding:4px 10px;background:#c62828;color:#fff;border:none;border-radius:4px;cursor:pointer;font-size:12px">거절</button>';
      return '<tr>'+'<td>'+u.id+'</td>'+'<td style="font-weight:600">'+(u.username||'-')+'</td>'+'<td>'+(u.phone||'-')+'</td>'+'<td>'+(u.bank||'-')+'</td>'+'<td>'+(u.account_no||'-')+'</td>'+'<td>'+(u.account_name||'-')+'</td>'+'<td>'+badge+'</td>'+'<td>'+(u.created_at||'').slice(0,10)+'</td>'+'<td>'+btns+'</td>'+'</tr>';
    }).join('');
    wrap.innerHTML='<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr style="color:#888;border-bottom:1px solid #333"><th style="padding:8px 6px;text-align:left">ID</th><th style="padding:8px 6px;text-align:left">아이디</th><th style="padding:8px 6px;text-align:left">핸드폰</th><th style="padding:8px 6px;text-align:left">은행</th><th style="padding:8px 6px;text-align:left">계좌번호</th><th style="padding:8px 6px;text-align:left">예금주</th><th style="padding:8px 6px;text-align:left">상태</th><th style="padding:8px 6px;text-align:left">가입일</th><th style="padding:8px 6px;text-align:left">관리</th></tr></thead><tbody>'+rows+'</tbody></table>';
  })
  .catch(function(e){wrap.innerHTML='<div style="color:#c62828;padding:20px">오류: '+e.message+'</div>';});
}
async function approveAllPending(){
  if(!window.confirm('승인 대기 중인 회원 전체를 승인하시겠습니까?')) return;
  var tok=localStorage.getItem('admin_token');
  var r=await fetch('/api/admin/approve-user',{method:'POST',
    headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
    body:JSON.stringify({action:'approve_all'})});
  var d=await r.json();
  if(d.success){
    toast('✅ '+d.approved_count+'명 전체 승인 완료', 'success');
    loadPendingUsers();
  } else {
    toast('오류: '+(d.error||'실패'), 'error');
  }
}
function approveUser(userId,action){
  var msg=action==='approve'?'승인하시겠습니까?':'거절(삭제)하시겠습니까?';
  if(!confirm(msg)) return;
  var tok=localStorage.getItem('admin_token');
  fetch('/api/admin/approve-user',{method:'POST',
    headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
    body:JSON.stringify({user_id:userId,action:action})})
  .then(function(r){return r.json();})
  .then(function(d){
    if(d.success){
      if(action==='approve'){
        // 승인: 회원관리 페이지로 이동
        showPage('members', document.querySelector('[data-page="members"]'));
        toast('✅ 승인 완료되었습니다.', 'success');
      } else {
        // 거절: 현재 리스트 새로고침
        loadPendingUsers();
        toast('거절 처리되었습니다.', 'info');
      }
    } else {
      toast('오류: '+(d.error||'unknown'), 'error');
    }
  })
  .catch(function(e){ toast('오류: '+e.message, 'error'); });
}
// showPage 후 members 탭 클릭 시 자동 로드
var _origShowPage=typeof showPage==='function'?showPage:null;
if(_origShowPage){
  showPage=function(page,el){
    _origShowPage(page,el);
    if(page==='members') loadMembers();
  };
}

async function loadCurrentTime(){var el=document.getElementById('current-sys-time');function getKST(){var n=new Date();var k=new Date(n.getTime()+9*60*60*1000);return k.getUTCFullYear()+'-'+String(k.getUTCMonth()+1).padStart(2,'0')+'-'+String(k.getUTCDate()).padStart(2,'0')+' '+String(k.getUTCHours()).padStart(2,'0')+':'+String(k.getUTCMinutes()).padStart(2,'0')+':'+String(k.getUTCSeconds()).padStart(2,'0');}if(el)el.textContent=getKST();setInterval(function(){if(el)el.textContent=getKST();},1000);}
async function setMockTime(){
  var inp=document.getElementById('mock-datetime-input');
  var res=document.getElementById('time-result');
  if(!inp||!inp.value){if(res)res.textContent='날짜/시간을 입력해주세요.';return;}
  var dtVal=inp.value.replace('T',' ')+':00';
  var tok=localStorage.getItem('admin_token');
  var r=await fetch('/api/admin/set-time',{method:'POST',
    headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
    body:JSON.stringify({datetime:dtVal})});
  var d=await r.json();
  if(d.success){
    if(res) res.innerHTML='<span style="color:#4fc3f7">✅ 테스트 시간 설정: '+d.mock_time+'</span>';
    toast('✅ 시간 변경 완료: '+d.mock_time, 'success');
  } else {
    if(res) res.innerHTML='<span style="color:#c62828">❌ '+d.error+'</span>';
    toast('시간 설정 실패', 'error');
  }
  loadCurrentTime();
}
async function resetMockTime(){
  var res=document.getElementById('time-result');
  var tok=localStorage.getItem('admin_token');
  var r=await fetch('/api/admin/set-time',{method:'POST',
    headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
    body:JSON.stringify({datetime:null})});
  var d=await r.json();
  if(d.success){
    if(res) res.innerHTML='<span style="color:#66bb6a">✅ 실제 시간으로 복원 완료</span>';
    toast('✅ 실제 시간으로 복원되었습니다.', 'success');
  } else {
    if(res) res.innerHTML='<span style="color:#c62828">❌ '+d.error+'</span>';
    toast('복원 실패', 'error');
  }
  var inp=document.getElementById('mock-datetime-input');
  if(inp) inp.value='';
  loadCurrentTime();
  updateMatchingBtn();
}

// ── DB 초기화 ──────────────────────────────────────────────
async function resetIdSequences(){
  var res = document.getElementById('reset-result');
  if(!window.confirm('아이템ID/회원ID 시퀀스를 현재 최댓값으로 동기화합니까?\n(데이터는 삭제되지 않습니다)')) return;
  if(res) res.innerHTML = '<span style="color:#aaa">처리 중...</span>';
  try{
    var tok = localStorage.getItem('admin_token');
    var d = await fetch('/api/admin/reset-sequences',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body:JSON.stringify({targets:['items','users','matches','reservations']})
    }).then(r=>r.json());
    if(d.success){
      var html2 = d.results.map(function(r){ return '<div>'+r+'</div>'; }).join('');
      html2 += '<div style="color:#888;font-size:11px;margin-top:6px">현재 MAX: 아이템 '+d.current.items+' / 회원 '+d.current.users+'</div>';
      if(res) res.innerHTML = '<span style="color:#66bb6a">'+html2+'</span>';
      toast('✅ ID 시퀀스 동기화 완료', 'success');
    } else {
      if(res) res.innerHTML = '<span style="color:#ef5350">❌ '+d.error+'</span>';
      toast('실패: '+d.error, 'error');
    }
  }catch(e){ if(res) res.innerHTML='<span style="color:#ef5350">❌ '+e.message+'</span>'; }
}

async function resetAllData(){
  var res = document.getElementById('reset-result');
  if(!window.confirm('⚠️ 주의: 모든 아이템/매칭/예약/충전 데이터가 삭제되고\n아이템ID와 회원ID가 1부터 재시작됩니다.\n\n계속하시겠습니까?')) return;
  if(!window.confirm('정말로 전체 초기화 하시겠습니까?\n이 작업은 되돌릴 수 없습니다.')) return;
  if(res) res.innerHTML = '<span style="color:#f9a825">초기화 중...</span>';
  try{
    var tok = localStorage.getItem('admin_token');
    var d = await fetch('/api/admin/reset-sequences',{method:'POST',
      headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
      body:JSON.stringify({reset_all:true})
    }).then(r=>r.json());
    if(d.success){
      var html2 = d.results.map(function(r){ return '<div>'+r+'</div>'; }).join('');
      if(res) res.innerHTML = '<span style="color:#66bb6a">'+html2+'</span>';
      toast('✅ 전체 초기화 완료 — ID가 1부터 재시작됩니다', 'success');
      if(typeof loadDashboard==='function') setTimeout(loadDashboard, 500);
    } else {
      if(res) res.innerHTML = '<span style="color:#ef5350">❌ '+d.error+'</span>';
      toast('실패: '+d.error, 'error');
    }
  }catch(e){ if(res) res.innerHTML='<span style="color:#ef5350">❌ '+e.message+'</span>'; }
}

async function createTestUsers(){
  var res=document.getElementById('test-users-result');
  var count=parseInt(document.getElementById('test-user-count')?.value||'10')||10;
  var points=parseInt(document.getElementById('test-user-points')?.value||'0')||0;
  if(res) res.textContent='생성 중... ('+count+'명)';
  var tok=localStorage.getItem('admin_token');
  var r=await fetch('/api/admin/create-test-users',{method:'POST',
    headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},
    body:JSON.stringify({count,points})});
  var d=await r.json();
  if(res){
    if(d.success){
      var msg='✅ '+d.created.length+'명 생성 완료';
      if(points>0) msg+=' ('+points.toLocaleString()+'P 지급)';
      if(d.created.length) msg+='<br><span style="color:#888;font-size:12px">'+d.created.join(', ')+'</span>';
      if(d.skipped.length) msg+='<br><span style="color:#f9a825;font-size:12px">기존(건너뜀): '+d.skipped.join(', ')+'</span>';
      msg+='<br><span style="font-size:12px">비밀번호: <strong>'+d.password+'</strong></span>';
      res.innerHTML='<span style="color:#4fc3f7">'+msg+'</span>';
      toast('✅ 테스트 회원 '+d.created.length+'명 생성 완료', 'success');
    } else {
      res.innerHTML='<span style="color:#c62828">❌ '+d.error+'</span>';
      toast('생성 실패: '+d.error, 'error');
    }
  }
  if(typeof loadMembers==='function') loadMembers();
}
async function approveAllTest(){
  var res=document.getElementById('test-users-result');
  if(res) res.textContent='승인 중...';
  var r=await fetch('/api/admin/pending-users',{headers:{'Authorization':'Bearer admin-loopay-2026'}});
  var d=await r.json();
  var tests=(d.users||[]).filter(function(u){return u.username&&u.username.startsWith('testuser');});
  if(!tests.length){if(res)res.innerHTML='<span style="color:#aaa">승인할 테스트 회원이 없습니다.</span>';return;}
  var ok=0;
  for(var i=0;i<tests.length;i++){
    var pr=await fetch('/api/admin/approve-user',{method:'POST',
      headers:{'Authorization':'Bearer admin-loopay-2026','Content-Type':'application/json'},
      body:JSON.stringify({user_id:tests[i].id,action:'approve'})});
    var pd=await pr.json();
    if(pd.success) ok++;
  }
  if(res) res.innerHTML='<span style="color:#4fc3f7">✅ '+ok+'명 승인 완료</span>';
  if(typeof loadMembers==='function') loadMembers();
  if(typeof loadUsers==='function') loadUsers();
}
var _origShow2=typeof showPage==='function'?showPage:null;
if(_origShow2){ showPage=function(page,el){ _origShow2(page,el); if(page==='testtools') loadCurrentTime(); }; }

var _detailUserId = null;










































var _detailUserId = null;

async function showUserDetail(uid){
  _detailUserId = uid;
  var modal = document.getElementById('user-detail-modal');
  if(modal && modal.parentElement !== document.body) document.body.appendChild(modal);
  if(!modal) return;
  modal.style.display = 'block';
  document.getElementById('detail-title').textContent = '회원 상세';
  var infoEl = document.getElementById('detail-user-info');
  if(infoEl) infoEl.innerHTML = '<div style="padding:10px;color:#888">로딩 중...</div>';
  try {
    var d = await apiAdmin('/admin/user/'+uid);
    var u = d.user || {};
    if(infoEl) infoEl.innerHTML = '<div style="background:#2a2a3e;border-radius:8px;padding:12px;margin-bottom:12px"><table class="detail-table">' +
      '<tr><th>아이디</th><td>'+(u.username||'-')+'</td></tr>' +
      '<tr><th>성명</th><td>'+((u.nickname&&u.nickname!==u.username?u.nickname:u.account_name)||u.nickname||'-')+'</td></tr>' +
      '<tr><th>휴대폰</th><td>'+(u.phone||'-')+'</td></tr>' +
      '<tr><th>은행명</th><td>'+(u.bank||'-')+'</td></tr>' +
      '<tr><th>계좌번호</th><td>'+(u.account_no||'-')+'</td></tr>' +
      '<tr><th>가입일</th><td>'+(u.created_at||'-').slice(0,10)+'</td></tr>' +
      '<tr><th>레벨</th><td>'+(u.level||1)+'</td></tr>' +
      '<tr><th>충전P</th><td>'+(u.charge_points||0)+'P</td></tr>' +
      '<tr><th>전환P</th><td>'+(u.exchange_points||0)+'P</td></tr>' +
      '</table></div>';
  } catch(e) { if(infoEl) infoEl.textContent = e.message; }
  showDetailTab('charge');
}

function showDetailTab(tab){
  ['charge','exchange','buy','sell'].forEach(function(t){
    var btn = document.getElementById('dtab-'+t);
    if(btn) btn.style.background = t===tab ? '#7c3aed' : '#2d2d4e';
  });
  var con = document.getElementById('detail-content');
  if(con) con.innerHTML = '<div style="padding:20px;text-align:center;color:#888">로딩 중...</div>';
  var uid = _detailUserId;
  var mkTbl = function(ths, rows){
    return '<table style="width:100%;border-collapse:collapse;font-size:13px"><thead><tr>'+
      ths.map(function(h){return '<th style="padding:8px;text-align:left;background:#1e1e3a;color:#a0a0c0">'+h+'</th>';}).join('')+
      '</tr></thead><tbody>'+(rows.length ? rows.join('') : '<tr><td colspan='+ths.length+' style="padding:14px;text-align:center;color:#555">내역 없음</td></tr>')+
      '</tbody></table>';
  };
  var mkRow = function(cells){
    return '<tr style="border-bottom:1px solid #1a1a2e">'+cells.map(function(c){return '<td style="padding:7px 6px;color:#cdd6f4">'+c+'</td>';}).join('')+'</tr>';
  };
  if(tab==='charge'){
    apiAdmin('/admin/user/'+uid+'/charges').then(function(d){
      if(con) con.innerHTML = mkTbl(['번호','포인트','입금액','상태','신청일'],
        (d.charges||[]).map(function(c,i){
        var statusMap={'pending':'대기중','confirmed':'승인','rejected':'거절','cancelled':'취소'};
        var statusKr=statusMap[c.status]||c.status||'-';
        var statusColor={'pending':'#f9a825','confirmed':'#66bb6a','rejected':'#ef5350','cancelled':'#9e9e9e'}[c.status]||'#ccc';
        return mkRow([i+1, (c.points||0)+'P', (c.amount||0).toLocaleString()+'원',
          '<span style="color:'+statusColor+';font-weight:600">'+statusKr+'</span>',
          (c.created_at||'').slice(0,16)]);
      }));
    }).catch(function(e){if(con)con.textContent=e.message;});
  } else if(tab==='exchange'){
    apiAdmin('/admin/user/'+uid+'/exchanges').then(function(d){
      if(con) con.innerHTML = mkTbl(['번호','전환P','상태','신청일'],
        (d.exchanges||[]).map(function(c,i){return mkRow([i+1, (c.amount||0)+'P', c.status||'-', (c.created_at||'').slice(0,10)]);}));
    }).catch(function(e){if(con)con.textContent=e.message;});
  } else if(tab==='buy'){
    apiAdmin('/admin/user/'+uid+'/reservations').then(function(d){
      if(con) con.innerHTML = mkTbl(['번호','아이템','수량','상태','예약일'],
        (d.reservations||[]).map(function(c,i){return mkRow([i+1, c.bar_type||'-', c.quantity||0, c.status||'-', (c.created_at||'').slice(0,10)]);}));
    }).catch(function(e){if(con)con.textContent=e.message;});
  } else if(tab==='sell'){
    apiAdmin('/admin/user/'+uid+'/items').then(function(d){
      if(con) con.innerHTML = mkTbl(['번호','아이템','상태','단계','구매일'],
        (d.items||[]).map(function(c,i){return mkRow([i+1, c.bar_type||'-', c.status_label||'-', (c.stage||1).toLocaleString()+'원', (c.purchase_date||'-')]);}));
    }).catch(function(e){if(con)con.textContent=e.message;});
  }
}

async function withdrawUser(uid){
  if(!confirm('정말 탈퇴하시겠습니까?')) return;
  try {
    await apiAdmin('/admin/delete-user/'+uid, {method:'POST'});
    alert('탈퇴 완료');
    loadUsers();
  } catch(e) { alert(e.message); }
}


async function loadItemStats(barType){
  var names={bronze:'수정',silver:'루비',gold:'다이아'};
  var el=document.getElementById('item-stats-result');
  el.innerHTML='<div style="text-align:center;color:#888;padding:16px">로딩 중...</div>';
  try{
    var d=await apiAdmin('/admin/item-stats?bar_type='+barType);
    var rows=d.stages.map(function(s){
      return '<tr><td>'+names[barType]+' '+s.stage+'단계</td>'
        +'<td class="num">'+s.user_count+'</td>'
        +'<td class="num">'+s.platform_count+'</td>'
        +'<td class="num bold">'+s.total+'</td>'
        +'<td class="num">'+s.sell_price.toLocaleString()+'원</td>'
        +'</tr>';
    }).join('');
    el.innerHTML='<table class="data-table" style="font-size:13px">'
      +'<thead><tr><th>단계</th><th>유저</th><th>플랫폼</th><th>합계</th><th>판매가</th></tr></thead>'
      +'<tbody>'+rows+'</tbody></table>';
  }catch(e){el.innerHTML='<div style="color:#ef5350;padding:12px">오류: '+e.message+'</div>';}
}
async function loadReservations(){
  try{
    const d=await apiAdmin('/admin/reservations-list');
    const tbody=document.getElementById('res-list-body');
    if(!tbody)return;
    if(!d.reservations||!d.reservations.length){
      tbody.innerHTML='<tr><td colspan=7 style="text-align:center;padding:16px;color:#888">예약 없음</td></tr>';
      return;
    }
    const typeMap={bronze:'수정',silver:'루비',gold:'다이아'};
    const typeColor={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
    const roundMap={1:'구매예약',2:'판매예약'};
    const statusBadge={pending:'<span style="color:#f9a825">대기</span>',matched:'<span style="color:#66bb6a">매칭완료</span>',cancelled:'<span style="color:#ef5350">취소</span>'};
    tbody.innerHTML=d.reservations.map((v,i)=>`<tr>
      <td>${i+1}</td>
      <td>${v.username||'-'}</td>
      <td>${v.nickname||'-'}</td>
      <td><strong style="color:${typeColor[v.bar_type]||'#fff'}">${typeMap[v.bar_type]||v.bar_type||'-'}</strong></td>
      <td>${roundMap[v.match_round]||'구매예약'}</td>
      <td>${v.reserve_date||'-'}</td>
      <td>${statusBadge[v.status]||v.status||'-'}</td>
    </tr>`).join('');
  }catch(e){console.error(e);}
}

async function loadUnpaidReports(){
  var tbody=document.getElementById('unpaid-reports-body');
  if(!tbody)return;
  try{
    var d=await apiAdmin('/admin/unpaid-reports');
    if(!d.reports||!d.reports.length){
      tbody.innerHTML='<tr><td colspan="6" style="text-align:center;color:#888;padding:16px">신고 없음</td></tr>';
      return;
    }
    var typeMap={bronze:'수정',silver:'루비',gold:'다이아'};
    tbody.innerHTML=d.reports.map(function(r,i){
      return '<tr><td>'+(i+1)+'</td><td>'+r.username+'</td><td>'+r.reservation_id+'</td>'
        +'<td>'+typeMap[r.bar_type]+'</td><td>'+(r.created_at||'').slice(0,10)+'</td>'
        +'<td><button onclick="resolveUnpaid('+r.id+')" class="btn btn-success" style="font-size:11px;padding:3px 8px">처리완료</button></td></tr>';
    }).join('');
  }catch(e){console.error(e);}
}
async function resolveUnpaid(id){
  try{
    await apiAdmin('/admin/resolve-unpaid/'+id, {method:'POST'});
    toast('처리 완료');
    loadUnpaidReports();
  }catch(e){toast(e.message,'error');}
}
// ── 시스템 설정 ──
var _currentApproveMode = 'manual'; // 기본값

async function loadSettings(){
  try{
    const d = await apiAdmin('/admin/settings');
    const autoApprove = (d.settings?.auto_approve === '1');
    _currentApproveMode = autoApprove ? 'auto' : 'manual';
    updateSettingsUI(_currentApproveMode);
    // 루페이 계좌 목록 렌더링
    var s = d.settings || {};
    try {
      var accts = s.loopay_accounts ? JSON.parse(s.loopay_accounts) : [];
      // 기존 단일계좌 설정 마이그레이션
      if(!accts.length && s.loopay_account){
        accts = [{
          bank: s.loopay_bank||'', account: s.loopay_account||'',
          account_name: s.loopay_account_name||'', phone: s.loopay_phone||'',
          type: 'system'
        }];
      }
      _loopayAccounts = accts;
    } catch(e){ _loopayAccounts = []; }
    renderLoopayAccounts();
  }catch(e){
    console.error('설정 로딩 실패:', e);
    toast('설정 로딩 실패: ' + e.message, 'error');
  }
}

function selectApproveMode(mode){
  _currentApproveMode = mode;
  updateSettingsUI(mode);
}

function updateSettingsUI(mode){
  const isAuto = (mode === 'auto');
  const radioManual = document.getElementById('radio-manual');
  const radioAuto = document.getElementById('radio-auto');
  const badge = document.getElementById('settings-status-badge');
  if(radioManual) radioManual.checked = !isAuto;
  if(radioAuto) radioAuto.checked = isAuto;
  if(badge){
    badge.textContent = isAuto ? '⚡ 자동 승인 중' : '👤 수동 승인 중';
    badge.style.background = isAuto ? '#43a047' : '#546e7a';
  }
}


// ── 루페이 계좌 관리 ──────────────────────────────────────────────────
var _loopayAccounts = [];

function renderLoopayAccounts(){
  var list = document.getElementById('loopay-accounts-list');
  if(!list) return;
  if(!_loopayAccounts.length){
    list.innerHTML = '<div style="text-align:center;color:#888;padding:12px;font-size:12px">등록된 계좌 없음 — 위 [+ 계좌 추가] 버튼으로 추가하세요</div>';
    return;
  }
  list.innerHTML = _loopayAccounts.map(function(a,i){
    var typeColor = a.type==='point' ? '#ab47bc' : '#42a5f5';
    var typeName  = a.type==='point' ? '포인트계좌' : '시스템계좌';
    var typeIcon  = a.type==='point' ? '💜' : '🔵';
    return '<div style="display:flex;align-items:center;gap:8px;padding:8px 12px;background:#12121f;border-radius:8px;border:1px solid #2a2d40">'
      +'<span style="padding:2px 10px;border-radius:12px;font-size:11px;background:'+typeColor+'22;color:'+typeColor+';white-space:nowrap;font-weight:700">'+typeIcon+' '+typeName+'</span>'
      +'<span style="font-size:13px;color:#cdd6f4;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'
        +'<strong>'+(a.account_name||'-')+'</strong>'
        +' <span style="color:#888;font-size:11px">'+(a.bank||'')+'</span>'
        +' <span style="color:#a0a0c0">'+(a.account||'')+'</span>'
        +(a.phone?' <span style="color:#888;font-size:11px">'+a.phone+'</span>':'')
      +'</span>'
      +'<button onclick="editLoopayAccount('+i+')" style="padding:3px 8px;background:#37474f;color:#80cbc4;border:1px solid #546e7a;border-radius:4px;font-size:11px;cursor:pointer">수정</button>'
      +'<button onclick="deleteLoopayAccount('+i+')" style="padding:3px 8px;background:#c62828;color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer">삭제</button>'
      +'</div>';
  }).join('');
}

function addLoopayAccount(){
  showLoopayAccountModal(-1, {type:'system', bank:'', account:'', account_name:'', phone:''});
}

function editLoopayAccount(idx){
  showLoopayAccountModal(idx, Object.assign({}, _loopayAccounts[idx]));
}

function deleteLoopayAccount(idx){
  if(!window.confirm('이 계좌를 삭제하시겠습니까?')) return;
  _loopayAccounts.splice(idx, 1);
  renderLoopayAccounts();
  saveLoopayAccounts();
}

function showLoopayAccountModal(idx, data){
  var modal = document.getElementById('loopay-acct-modal');
  if(!modal){
    modal = document.createElement('div');
    modal.id = 'loopay-acct-modal';
    modal.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,0.6);z-index:9999;display:flex;align-items:center;justify-content:center';
    document.body.appendChild(modal);
  }
  // 현재 각 타입 사용 여부 확인
  var hasSystem = _loopayAccounts.some(function(a,i){ return a.type==='system' && i!==idx; });
  var hasPoint  = _loopayAccounts.some(function(a,i){ return a.type==='point'  && i!==idx; });
  modal.innerHTML = '<div style="background:#1a1d2e;border-radius:14px;padding:24px;width:90%;max-width:440px;border:1px solid #2a2d40;color:#e0e0e0">'
    +'<div style="font-size:15px;font-weight:700;margin-bottom:16px;color:#64b5f6">'+(idx<0?'계좌 추가':'계좌 수정')+'</div>'
    +'<div style="margin-bottom:10px">'
    +'<label style="font-size:11px;color:#aaa;display:block;margin-bottom:4px">계좌 용도 <span style="color:#ef5350">(필수, 각 1개만)</span></label>'
    +'<div style="display:flex;gap:10px">'
    +'<label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:7px 14px;border-radius:6px;border:1px solid '+(data.type==='system'?'#42a5f5':'#2d2d5e')+';background:'+(data.type==='system'?'#0d47a133':'transparent')+'" id="acct-type-system-lbl">'
    +'<input type="radio" name="acct-type-radio" value="system" '+(data.type==='system'?'checked':'')+(hasSystem?' disabled':'')+' onchange="onAcctTypeChange()" style="cursor:pointer">'
    +'<span style="color:#42a5f5;font-size:13px">🔵 시스템계좌</span>'+(hasSystem?' <span style="font-size:10px;color:#ef5350">(설정됨)</span>':'')
    +'</label>'
    +'<label style="display:flex;align-items:center;gap:5px;cursor:pointer;padding:7px 14px;border-radius:6px;border:1px solid '+(data.type==='point'?'#ab47bc':'#2d2d5e')+';background:'+(data.type==='point'?'#7b1fa233':'transparent')+'" id="acct-type-point-lbl">'
    +'<input type="radio" name="acct-type-radio" value="point" '+(data.type==='point'?'checked':'')+(hasPoint?' disabled':'')+' onchange="onAcctTypeChange()" style="cursor:pointer">'
    +'<span style="color:#ab47bc;font-size:13px">💜 포인트계좌</span>'+(hasPoint?' <span style="font-size:10px;color:#ef5350">(설정됨)</span>':'')
    +'</label>'
    +'</div></div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px">'
    +'<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:3px">예금주명</label><input id="acct-modal-name" value="'+(data.account_name||'')+'" placeholder="홍길동" style="width:100%;padding:7px 10px;background:#12121f;border:1px solid #2d2d5e;border-radius:6px;color:#e0e0e0;font-size:13px;box-sizing:border-box"></div>'
    +'<div><label style="font-size:11px;color:#aaa;display:block;margin-bottom:3px">은행명</label><input id="acct-modal-bank" value="'+(data.bank||'')+'" placeholder="국민은행" style="width:100%;padding:7px 10px;background:#12121f;border:1px solid #2d2d5e;border-radius:6px;color:#e0e0e0;font-size:13px;box-sizing:border-box"></div>'
    +'<div style="grid-column:1/-1"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:3px">계좌번호</label><input id="acct-modal-account" value="'+(data.account||'')+'" placeholder="123456789012" style="width:100%;padding:7px 10px;background:#12121f;border:1px solid #2d2d5e;border-radius:6px;color:#e0e0e0;font-size:13px;box-sizing:border-box"></div>'
    +'<div style="grid-column:1/-1"><label style="font-size:11px;color:#aaa;display:block;margin-bottom:3px">연락처</label><input id="acct-modal-phone" value="'+(data.phone||'')+'" placeholder="01012345678" style="width:100%;padding:7px 10px;background:#12121f;border:1px solid #2d2d5e;border-radius:6px;color:#e0e0e0;font-size:13px;box-sizing:border-box"></div>'
    +'</div>'
    +'<div id="acct-modal-err" style="color:#ef5350;font-size:12px;min-height:16px;margin-bottom:8px"></div>'
    +'<div style="display:flex;gap:10px">'
    +'<button onclick="closeLoopayAccountModal()" style="flex:1;padding:10px;background:#37474f;color:#fff;border:none;border-radius:8px;font-size:13px;cursor:pointer">취소</button>'
    +'<button onclick="saveLoopayAccountModal('+idx+')" style="flex:1;padding:10px;background:#1976d2;color:#fff;border:none;border-radius:8px;font-size:13px;font-weight:700;cursor:pointer">저장</button>'
    +'</div>'
    +'</div>';
  modal.style.display = 'flex';
}

function onAcctTypeChange(){
  var radios = document.querySelectorAll('[name="acct-type-radio"]');
  radios.forEach(function(r){
    var lbl = r.closest('label');
    if(!lbl) return;
    var color = r.value==='point' ? '#ab47bc' : '#42a5f5';
    lbl.style.borderColor = r.checked ? color : '#2d2d5e';
    lbl.style.background = r.checked ? (r.value==='point'?'#7b1fa233':'#0d47a133') : 'transparent';
  });
}

function closeLoopayAccountModal(){
  var m = document.getElementById('loopay-acct-modal');
  if(m) m.style.display='none';
}

function saveLoopayAccountModal(idx){
  var typeRadio = document.querySelector('[name="acct-type-radio"]:checked');
  var name = (document.getElementById('acct-modal-name')?.value||'').trim();
  var bank = (document.getElementById('acct-modal-bank')?.value||'').trim();
  var account = (document.getElementById('acct-modal-account')?.value||'').trim();
  var phone = (document.getElementById('acct-modal-phone')?.value||'').trim();
  var errEl = document.getElementById('acct-modal-err');
  if(!typeRadio){ errEl.textContent='계좌 용도를 선택해주세요.'; return; }
  if(!name||!bank||!account){ errEl.textContent='예금주명, 은행명, 계좌번호는 필수입니다.'; return; }
  errEl.textContent='';
  var acct = {type: typeRadio.value, bank, account, account_name: name, phone};
  if(idx < 0){ _loopayAccounts.push(acct); }
  else { _loopayAccounts[idx] = acct; }
  closeLoopayAccountModal();
  renderLoopayAccounts();
  saveLoopayAccounts();
}

async function saveLoopayAccounts(){
  try{
    await apiAdmin('/admin/settings', {
      method:'POST',
      body: JSON.stringify({
        loopay_accounts: JSON.stringify(_loopayAccounts),
        // 기존 단일 계좌 필드 동기화 (호환성)
        loopay_bank:         (_loopayAccounts.find(function(a){return a.type==='system';})||_loopayAccounts[0]||{}).bank||'',
        loopay_account:      (_loopayAccounts.find(function(a){return a.type==='system';})||_loopayAccounts[0]||{}).account||'',
        loopay_account_name: (_loopayAccounts.find(function(a){return a.type==='system';})||_loopayAccounts[0]||{}).account_name||'',
        loopay_phone:        (_loopayAccounts.find(function(a){return a.type==='system';})||_loopayAccounts[0]||{}).phone||''
      })
    });
    toast('✅ 계좌 정보 저장 완료', 'success');
  }catch(e){ toast('저장 실패: '+e.message, 'error'); }
}

async function saveSettings(){
  var btn = (typeof event!=='undefined' && event && event.target && event.target.tagName==='BUTTON') ? event.target : document.querySelector('[onclick="saveSettings()"]');
  var origText = btn ? btn.textContent : '';
  // 라디오 버튼에서 현재 선택값 직접 읽기
  var radioAuto = document.getElementById('radio-auto');
  var radioManual = document.getElementById('radio-manual');
  if(radioAuto && radioManual) {
    _currentApproveMode = radioAuto.checked ? 'auto' : 'manual';
  }
  try{
    if(btn){ btn.textContent = '저장 중...'; btn.disabled = true; }
    const isAuto = (_currentApproveMode === 'auto');
    var el = function(id){ var e=document.getElementById(id); return e?e.value.trim():''; };
    await apiAdmin('/admin/settings', {
      method:'POST',
      body: JSON.stringify({
        auto_approve: isAuto ? '1' : '0'
      })
    });
    // 자동승인 ON 시 기존 미승인 회원도 일괄 승인
    if(isAuto){
      var ar = await apiAdmin('/admin/approve-user',{method:'POST',body:JSON.stringify({action:'approve_all'})});
      if(ar.approved_count > 0) toast('✅ 기존 대기 회원 '+ar.approved_count+'명도 자동 승인됨', 'info');
    }
    const msg = isAuto ? '✅ 자동 승인으로 변경되었습니다' : '✅ 수동 승인으로 변경되었습니다';
    toast(msg, 'success');
    // 저장 버튼 성공 표시
    if(btn){ btn.textContent = '✅ 저장 완료!'; btn.style.background = '#43a047'; }
    setTimeout(function(){
      if(btn){ btn.textContent = '💾 설정 저장'; btn.style.background = ''; btn.disabled = false; }
    }, 2000);
    updateSettingsUI(_currentApproveMode);
  }catch(e){
    toast('저장 실패: ' + e.message, 'error');
    if(btn){ btn.textContent = origText; btn.disabled = false; }
  }
}

async function loadTesttools(){
  // 테스트도구 페이지는 별도 로드 불필요
}


async function sendAdminNotif(){
  const uid = document.getElementById('notif-user-id').value.trim();
  const title = document.getElementById('notif-title').value.trim();
  const msg = document.getElementById('notif-message').value.trim();
  if(!title||!msg){alert('제목과 내용을 입력해주세요.');return;}
  const body = {title,message:msg,type:'admin'};
  if(uid) body.user_id = parseInt(uid);
  try{
    await apiAdmin('/admin/notify',{method:'POST',body:JSON.stringify(body)});
    document.getElementById('notif-result').textContent = '✅ 발송 완료!';
    document.getElementById('notif-message').value='';
    setTimeout(()=>{document.getElementById('notif-result').textContent='';},3000);
  }catch(e){document.getElementById('notif-result').style.color='#e53935';document.getElementById('notif-result').textContent='오류: '+e.message;}
}
// ── 매칭 버튼 시간 활성화 (매분 갱신) ──
setInterval(updateMatchingBtn, 60000);

// 시스템아이템현황: 매분 버튼 상태 자동 갱신 (쿨타임 재활성화 반영)
setInterval(function(){
  var page = document.getElementById('page-system-items');
  if(page && page.classList.contains('active')){
    loadSystemItems();
  }
}, 60000);

// ── 행운구매 ──────────────────────────────────────────
var _luckyPairsData = {}; // 미리보기 결과 저장
var _luckyHistory = [];   // 행운구매 이력
var _luckyBandCounts = {bronze:0, silver:0, gold:0}; // 현재 행운단계 수량

function updateLuckyBuyBtn(priceBands){
  // priceBands: {bronze:{band1:N,...}, silver:..., gold:...}
  // 수정band1(1~10), 루비band1(1~8), 다이아band1(1~7)
  var bz = (priceBands.bronze && priceBands.bronze.band1)||0;
  var sv = (priceBands.silver && priceBands.silver.band1)||0;
  var gd = (priceBands.gold   && priceBands.gold.band1)  ||0;
  _luckyBandCounts = {bronze:bz, silver:sv, gold:gd};
  var maxBz = Math.floor(bz/2), maxSv = Math.floor(sv/2), maxGd = Math.floor(gd/2);
  document.getElementById('lucky-bz-max').textContent='(최대 '+maxBz+')';
  document.getElementById('lucky-sv-max').textContent='(최대 '+maxSv+')';
  document.getElementById('lucky-gd-max').textContent='(최대 '+maxGd+')';
  document.getElementById('lucky-bz-count').max = maxBz;
  document.getElementById('lucky-sv-count').max = maxSv;
  document.getElementById('lucky-gd-count').max = maxGd;
  var hasAny = (bz >= 2 || sv >= 2 || gd >= 2);
  var btn = document.getElementById('lucky-buy-btn');
  btn.disabled = !hasAny;
  btn.style.opacity = hasAny ? '1' : '0.4';
  btn.style.cursor = hasAny ? 'pointer' : 'not-allowed';
}

function openLuckyBuy(){
  document.getElementById('lucky-buy-panel').style.display='block';
  document.getElementById('lucky-preview').style.display='none';
  document.getElementById('lucky-result').textContent='';
  var maxBz=Math.floor(_luckyBandCounts.bronze/2);
  var maxSv=Math.floor(_luckyBandCounts.silver/2);
  var maxGd=Math.floor(_luckyBandCounts.gold/2);
  document.getElementById('lucky-bz-count').value=maxBz;
  document.getElementById('lucky-sv-count').value=maxSv;
  document.getElementById('lucky-gd-count').value=maxGd;
}

function closeLuckyBuy(){
  document.getElementById('lucky-buy-panel').style.display='none';
  document.getElementById('lucky-preview').style.display='none';
}

async function previewLuckyBuy(){
  var bz=parseInt(document.getElementById('lucky-bz-count').value)||0;
  var sv=parseInt(document.getElementById('lucky-sv-count').value)||0;
  var gd=parseInt(document.getElementById('lucky-gd-count').value)||0;
  if(bz+sv+gd===0){toast('행운셋수를 1 이상 입력하세요','error');return;}
  var result=document.getElementById('lucky-result');
  result.textContent='짝짓기 중...';
  try{
    var d=await apiAdmin('/admin/lucky-buy/setup',{method:'POST',body:JSON.stringify({counts:{bronze:bz,silver:sv,gold:gd}})});
    if(!d.success){result.textContent='오류: '+(d.error||'');return;}
    _luckyPairsData=d.pairs;
    result.textContent='';
    // 미리보기 렌더링
    var names={bronze:'수정',silver:'루비',gold:'다이아'};
    var colors={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
    var html2='';
    var totalSets=0;
    for(var bt of ['bronze','silver','gold']){
      var pairs=d.pairs[bt]||[];
      if(!pairs.length) continue;
      html2+='<div style="margin-bottom:12px"><strong style="color:'+colors[bt]+'">'+names[bt]+'</strong>';
      html2+='<table style="width:100%;font-size:12px;border-collapse:collapse;margin-top:6px">';
      html2+='<tr style="background:#1a1a2e;color:#aaa"><th style="padding:4px 8px;text-align:left">세트</th><th>아이템A</th><th>아이템B</th><th>합산판매가</th><th>→ 새 아이템</th></tr>';
      pairs.forEach(function(p,i){
        html2+='<tr style="border-top:1px solid #333">';
        html2+='<td style="padding:4px 8px">'+(i+1)+'세트</td>';
        html2+='<td style="text-align:center">'+p.item_a.stage+'단계 ('+p.item_a.sell.toLocaleString()+'원)</td>';
        html2+='<td style="text-align:center">'+p.item_b.stage+'단계 ('+p.item_b.sell.toLocaleString()+'원)</td>';
        html2+='<td style="text-align:center;color:#f9a825">'+p.total_sell.toLocaleString()+'원</td>';
        html2+='<td style="text-align:center;color:#66bb6a;font-weight:700">'+p.new_stage+'단계 ('+p.new_sell.toLocaleString()+'원)</td>';
        html2+='</tr>';
        totalSets++;
      });
      html2+='</table></div>';
    }
    if(totalSets===0){html2='<div style="color:#888">짝지을 수 있는 아이템이 없습니다.</div>';}
    document.getElementById('lucky-preview-content').innerHTML=html2;
    document.getElementById('lucky-preview').style.display='block';
  }catch(e){result.textContent='오류: '+e.message;}
}

async function confirmLuckyBuy(){
  if(!confirm('행운구매를 확정하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
  var result=document.getElementById('lucky-result');
  result.textContent='처리 중...';
  try{
    // pairs 데이터 정제
    var pairsToSend={};
    for(var bt of ['bronze','silver','gold']){
      if(_luckyPairsData[bt]&&_luckyPairsData[bt].length){
        pairsToSend[bt]=_luckyPairsData[bt];
      }
    }
    var d=await apiAdmin('/admin/lucky-buy/confirm',{method:'POST',body:JSON.stringify({pairs:pairsToSend})});
    if(!d.success){result.innerHTML='<span style="color:#ef5350">오류: '+(d.error||'')+'</span>';return;}
    var names={bronze:'수정',silver:'루비',gold:'다이아'};
    var summary=d.results.map(function(r){
      return names[r.bar_type]+' '+r.old_stages.join('+')+'단계 → '+r.new_stage+'단계('+r.new_sell.toLocaleString()+'원)';
    }).join(', ');
    result.innerHTML='<span style="color:#66bb6a">✅ 행운구매 완료! '+summary+'</span>';
    // 이력 저장
    _luckyHistory.unshift({time:new Date().toLocaleString(),results:d.results,detail:JSON.parse(JSON.stringify(_luckyPairsData))});
    document.getElementById('lucky-preview').style.display='none';
    _luckyPairsData={};
    // 예약현황 새로고침
    loadReservationStatus();
  }catch(e){result.innerHTML='<span style="color:#ef5350">오류: '+e.message+'</span>';}
}

async function toggleLuckyHistory(){
  var div=document.getElementById('lucky-history');
  if(div.style.display==='block'){div.style.display='none';return;}
  div.innerHTML='<div style="color:#888;font-size:12px;padding:8px">로딩 중...</div>';
  div.style.display='block';
  try{
    var d=await apiAdmin('/admin/lucky-buy/history');
    if(!d.success||!d.history.length){
      div.innerHTML='<div style="color:#888;font-size:12px;padding:8px">행운구매 이력이 없습니다.</div>';return;
    }
    var colors={bronze:'#cd7f32',silver:'#a8a9ad',gold:'#ffd700'};
    var html2='<div style="max-height:500px;overflow-y:auto">';
    d.history.forEach(function(h){
      html2+='<div style="border:1px solid #333;border-radius:8px;padding:12px;margin-bottom:10px;font-size:12px">';
      // 헤더
      html2+='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">';
      html2+='<strong style="color:'+colors[h.bar_type]+'">'+h.bar_name+' 행운구매 #'+h.id+'</strong>';
      html2+='<span style="color:#888;font-size:11px">'+h.created_at+'</span>';
      html2+='<button onclick="deleteLuckyHistory('+h.id+',this)" style="font-size:10px;padding:2px 8px;background:#c62828;color:#fff;border:none;border-radius:4px;cursor:pointer">삭제</button></div>';
      // 아이템 정보
      html2+='<table style="width:100%;border-collapse:collapse;margin-bottom:8px">';
      html2+='<tr style="background:#1a1a2e;color:#aaa;font-size:11px">';
      html2+='<th style="padding:4px 6px;text-align:left">구분</th>';
      html2+='<th style="padding:4px 6px">단계/판매가</th>';
      html2+='<th style="padding:4px 6px">판매자</th>';
      html2+='<th style="padding:4px 6px">연락처</th>';
      html2+='<th style="padding:4px 6px">정산계좌</th></tr>';
      // 아이템A 판매자
      var sa=h.seller_a||{};
      html2+='<tr style="border-top:1px solid #333">';
      html2+='<td style="padding:4px 6px;color:#888">판매자A</td>';
      html2+='<td style="text-align:center">'+(h.item_a.stage?h.item_a.stage+'단계':'-')+' ('+h.item_a.sell.toLocaleString()+'원)</td>';
      html2+='<td style="text-align:center">'+(sa?(sa.nickname||sa.username||'알수없음'):'회원 없음')+'</td>';
      html2+='<td style="text-align:center">'+(sa?sa.phone||'-':'-')+'</td>';
      html2+='<td style="text-align:center">'+(sa&&sa.bank?sa.bank+' '+sa.account_no:'-')+'</td></tr>';
      // 아이템B 판매자
      var sb=h.seller_b||{};
      html2+='<tr style="border-top:1px solid #222">';
      html2+='<td style="padding:4px 6px;color:#888">판매자B</td>';
      html2+='<td style="text-align:center">'+(h.item_b.stage?h.item_b.stage+'단계':'-')+' ('+h.item_b.sell.toLocaleString()+'원)</td>';
      html2+='<td style="text-align:center">'+(sb?(sb.nickname||sb.username||'알수없음'):'회원 없음')+'</td>';
      html2+='<td style="text-align:center">'+(sb?sb.phone||'-':'-')+'</td>';
      html2+='<td style="text-align:center">'+(sb&&sb.bank?sb.bank+' '+sb.account_no:'-')+'</td></tr>';
      // 합산 → 새 아이템
      html2+='<tr style="border-top:2px solid #444;background:#111">';
      html2+='<td style="padding:4px 6px;color:#f9a825" colspan="2">합산: '+h.total_sell.toLocaleString()+'원 → ';
      html2+='<span style="color:#66bb6a">'+h.new_stage+'단계 ('+h.new_sell.toLocaleString()+'원)</span></td>';
      html2+='<td colspan="3"></td></tr>';
      // 구매자
      var byr=h.buyer;
      html2+='<tr style="border-top:1px solid #333;background:#0d1a0d">';
      html2+='<td style="padding:4px 6px;color:#66bb6a">구매자</td>';
      html2+='<td style="text-align:center">'+(byr?h.new_stage+'단계':'대기 중')+'</td>';
      html2+='<td style="text-align:center">'+(byr?byr.nickname||byr.username:'구매 대기')+'</td>';
      html2+='<td style="text-align:center">'+(byr?byr.phone:'-')+'</td>';
      html2+='<td style="text-align:center">'+(byr?'':'매칭 후 표시')+'</td></tr>';
      html2+='</table></div>';
    });
    html2+='</div>';
    div.innerHTML=html2;
  }catch(e){div.innerHTML='<div style="color:#ef5350;font-size:12px;padding:8px">오류: '+e.message+'</div>';}
}


async function deleteLuckyHistory(id, btn){
  if(!confirm('이 행운구매 이력을 삭제하시겠습니까?')) return;
  try{
    var d=await apiAdmin('/admin/lucky-buy/history/'+id, {method:'DELETE'});
    if(d.success){
      var row=btn.closest('[style*="border:1px solid"]');
      if(row) row.remove();
      toast('삭제됐습니다');
    }
  }catch(e){toast('삭제 오류: '+e.message,'error');}
}

async function clearLuckyHistory(){
  if(!confirm('행운구매 이력을 전체 삭제하시겠습니까?')) return;
  try{
    var d=await apiAdmin('/admin/lucky-buy/history/0', {method:'DELETE'});
    if(d.success){
      document.getElementById('lucky-history').innerHTML='';
      document.getElementById('lucky-history').style.display='none';
      toast('이력이 전체 삭제됐습니다');
    }
  }catch(e){toast('삭제 오류: '+e.message,'error');}
}


// ── loopay 구매아이템 관리 ──
async function deleteLoopayBuyItem(itemId){
  if(!confirm('loopay 구매예약 아이템을 삭제하시겠습니까?')) return;
  var tok = localStorage.getItem('admin_token');
  var r = await fetch('/api/admin/delete-loopay-items',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({ids:[itemId]})}).then(r=>r.json());
  if(r.deleted){toast('삭제 완료'); loadSystemItems();}
  else toast(r.error||'삭제 실패','error');
}

async function loopayItemSellReserve(itemId){
  var round = window._currentMatchRound || 1;
  if(!confirm('loopay 아이템을 판매예약으로 등록하시겠습니까? ('+round+'차 매칭)')) return;
  var tok = localStorage.getItem('admin_token');
  var r = await fetch('/api/admin/loopay-sell-reserve',{method:'POST',headers:{'Authorization':'Bearer '+tok,'Content-Type':'application/json'},body:JSON.stringify({item_id:itemId,match_round:round})}).then(r=>r.json());
  if(r.success){
    toast('✅ 판매예약 등록 완료');
    // 전체 리로드 없이 _systemItems 배열에서 해당 아이템 상태만 업데이트 후 재렌더
    var target = (_systemItems||[]).find(function(x){ return x.id === itemId; });
    if(target){
      target.status = 'matched';
      target.sell_reservation_id = 1; // 판매예약 생성됨 표시
      renderSystemItems();
    } else {
      loadSystemItems();
    }
    loadMatchingStatus();
  }
  else toast(r.error||'실패','error');
}

