/*
 * Chat X - front end (plain JavaScript, no build step).
 *
 *   Part 1 (top):    UI and local state - tabs, chat list, conversation view, settings pages, themes, icons.
 *   Part 2 (bottom): backend glue - api(), login/logout, realtime events (SSE), WebRTC calls, team room, admin portal.
 *
 * All network access goes through api() (same origin, cookie session).
 */
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const cols = ['#6c4cf5', '#e04cf5', '#0ea5a4', '#e5484d', '#f59e0b', '#3b82f6'];
let pic = n => S && n === S.me.name ? S.me.pic : null;
const av = (n, ring) => pic(n) ? `<div class="av ${ring ? 'ring' : ''}" style="background:url('${pic(n)}') center/cover"></div>` : av0(n, ring);
const av0 = (n, ring) => `<div class="av ${ring ? 'ring' : ''}" style="background:${cols[[...n].reduce((a, c) => a + c.charCodeAt(0), 0) % cols.length]}">${esc(n[0] || '?').toUpperCase()}</div>`;
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
const H = 3.6e6;
function seed() { return { chats: [], status: [], mine: [], calls: [], me: { name: 'You', about: 'Hey there! I am using Chat X.' } }; }
function seed0() {
    return { chats: [
            { id: 1, kind: 'dm', title: 'Aarav', msgs: [{ r: 'bot', t: 'Hey! Welcome to Chat X 👋' }] },
            { id: 2, kind: 'dm', title: 'Priya', msgs: [] }, { id: 3, kind: 'dm', title: 'Rohan', msgs: [] },
            { id: 4, kind: 'group', title: 'Family', members: ['Mummy', 'Papa', 'Didi'], msgs: [] },
            { id: 5, kind: 'group', title: 'Office Team', members: ['Aarav', 'Sneha', 'Rohan'], msgs: [] }
        ],
        status: [{ who: 'Aarav', t: 'Chai time ☕', at: Date.now() - H }, { who: 'Priya', t: 'Weekend plan: trek 🏔️', at: Date.now() - 3 * H }, { who: 'Sneha', t: 'Busy day…', at: Date.now() - 5 * H }],
        mine: [], calls: [{ who: 'Rohan', type: 'in', at: Date.now() - 2 * H }, { who: 'Priya', type: 'out', at: Date.now() - 6 * H }, { who: 'Aarav', type: 'missed', at: Date.now() - 20 * H }],
        me: { name: 'You', about: 'Hey there! I am using Chat X.' } };
}
let S = null, KEY = 'chatx2';
S = S || seed();
let save = () => { try {
    localStorage.setItem(KEY, JSON.stringify(S));
}
catch (e) { } };
let tab = 'chat', openId = null;
const TABS = [['chat', '💬', 'Chat'], ['group', '👥', 'Group'], ['status', '◎', 'Status'], ['calling', '📞', 'Calling'], ['team', '🧑‍💻', 'Team'], ['you', '👤', 'You']];
function render() {
    $('#nav').innerHTML = '<div class="logo">X</div>' + TABS.map(t => `<button class="tab ${t[0] === tab ? 'on' : ''}" data-t="${t[0]}"><i>${ico(t[0], 22)}</i>${t[2]}</button>`).join('');
    paintLogo();
    document.querySelectorAll('.tab').forEach(b => b.onclick = () => { tab = b.dataset.t; openId = null; yp = null; sel.clear(); showArch = false; render(); });
    ({ chat: () => split('dm'), group: () => split('group'), status, calling, team: teamPage, you })[tab]();
}
const sel = new Set(), unl = new Set();
let showArch = false;
const toast = m => { let t = $('#toast'); if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    document.body.appendChild(t);
} t.textContent = m; t.className = 'on'; clearTimeout(t._t); t._t = setTimeout(() => { t.className = ''; }, 2200); };
function dlg(h, wire) { let d = $('#dlg'); if (!d) {
    d = document.createElement('div');
    d.id = 'dlg';
    document.body.appendChild(d);
} d.innerHTML = '<div class="box">' + h + '</div>'; d.className = 'on'; const close = () => { d.className = ''; }; d.onclick = e => { if (e.target === d)
    close(); }; if (wire)
    wire(d, close); }
function split(kind) {
    const g = kind === 'group', all = S.chats.filter(c => c.kind === kind);
    const items = all.filter(c => !!c.arch === showArch).sort((a, b) => (b.pin ? 1 : 0) - (a.pin ? 1 : 0));
    const na = all.filter(c => c.arch).length, selMode = sel.size > 0;
    const top = selMode ? `<div class="top selbar"><button class="ic" id="sx">${ico('x', 18)}</button><b>${sel.size}</b><span style="flex:1"></span><button class="ic" id="a-pin" title="Pin">${ico('pin', 18)}</button><button class="ic" id="a-del" title="Delete">${ico('del', 18)}</button><button class="ic" id="a-mute" title="Mute">${ico('mute', 18)}</button><button class="ic" id="a-arc" title="Archive">${ico('arc', 18)}</button><button class="ic" id="a-more" title="More">${ico('more', 18)}</button></div>` : `<div class="top"><h2>${showArch ? 'Archived' : g ? 'Groups' : 'Chats'}</h2><input id="nn" placeholder="Search ${g ? 'groups' : 'chats'}…" autocomplete="off">${na || showArch ? `<button class="row" id="ar" style="margin-top:6px">📦 <div class="t"><b>${showArch ? 'Back to chats' : 'Archived (' + na + ')'}</b></div></button>` : ''}</div>`;
    $('#view').innerHTML = `<div class="split ${openId ? 'open' : ''}"><div class="lp">${top}<div id="list"></div>${selMode ? '' : `<button class="fab" id="fab" aria-label="New">${ico('plus', 24)}</button>`}</div><div class="pane" id="pane"></div></div>`;
    $('#list').innerHTML = items.map(c => { const l = c.msgs[c.msgs.length - 1]; return `<button class="row ${c.id === openId ? 'on' : ''} ${sel.has(c.id) ? 'sel' : ''}" data-id="${c.id}">${sel.has(c.id) ? '<div class="av" style="background:#22c55e">✓</div>' : av(c.title)}<div class="t"><b>${esc(c.title)}${c.fav ? ' ⭐' : ''}</b><small>${c.lock ? '🔒 Locked chat' : l ? (l.a ? '🎤 Voice message' : esc(l.t)) : g ? c.members.join(', ') : 'No messages yet'}${(c.lists || []).map(x => ` · #${esc(x)}`).join('')}</small></div><span class="meta">${c.unread ? '<i class="dot"></i>' : ''}${c.mute ? '🔕' : ''}${c.pin ? '📌' : ''}${c.sc ? '🔗' : ''}${c.blocked ? '🚫' : ''}</span></button>`; }).join('') || '<div class="empty">Nothing here yet.</div>';
    document.querySelectorAll('#list .row').forEach(r => {
        const id = +r.dataset.id;
        let tm;
        r.onpointerdown = () => { tm = setTimeout(() => { sel.add(id); render(); if (navigator.vibrate)
            navigator.vibrate(30); }, 500); };
        const cancel = () => clearTimeout(tm);
        r.onpointerup = cancel;
        r.onpointerleave = cancel;
        r.onpointercancel = cancel;
        r.oncontextmenu = e => { e.preventDefault(); clearTimeout(tm); sel.add(id); render(); };
        r.onclick = () => { if (sel.size) {
            sel.has(id) ? sel.delete(id) : sel.add(id);
            render();
            return;
        } const c = S.chats.find(x => x.id === id); c.unread = false; openId = id; save(); render(); };
    });
    if (selMode) {
        $('#sx').onclick = () => { sel.clear(); render(); };
        $('#a-pin').onclick = () => act('pin', 'Pinned', 'Unpinned');
        $('#a-mute').onclick = () => act('mute', 'Muted', 'Unmuted');
        $('#a-arc').onclick = () => act('arch', 'Archived', 'Unarchived');
        $('#a-del').onclick = delChats;
        $('#a-more').onclick = () => moreMenu(items);
    }
    else {
        const sr = $('#nn');
        sr.oninput = () => { const q = sr.value.trim().toLowerCase(); document.querySelectorAll('#list .row').forEach(r => { r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none'; }); };
        const fb = $('#fab');
        if (fb)
            fb.onclick = () => newDlg(kind);
        const ar = $('#ar');
        if (ar)
            ar.onclick = () => { showArch = !showArch; render(); };
    }
    convo();
}
function act(p, a, b) { const cs = S.chats.filter(c => sel.has(c.id)), on = !cs.every(c => c[p]); cs.forEach(c => c[p] = on); if (p === 'arch' && on && sel.has(openId))
    openId = null; sel.clear(); save(); render(); toast(on ? a : b); }
function delChats() { const n = sel.size; dlg(`<h3>Delete ${n} chat${n > 1 ? 's' : ''}?</h3><p class="muted">This can’t be undone.</p><div class="bt"><button class="btn g" id="no">Cancel</button><button class="btn red" id="ye">Delete</button></div>`, (d, close) => { $('#no').onclick = close; $('#ye').onclick = () => { S.chats = S.chats.filter(c => !sel.has(c.id)); if (sel.has(openId))
    openId = null; sel.clear(); save(); close(); render(); toast('Deleted'); }; }); }
function moreMenu(items) {
    const cs = S.chats.filter(c => sel.has(c.id)), all = p => cs.every(c => c[p]);
    const L = [['sc', '🔗', all('sc') ? 'Remove Chat Shortcut' : 'Add Chat Shortcut'], ['vc', '👤', 'View contact'], ['un', '🔵', all('unread') ? 'Mark as read' : 'Mark as unread'], ['sa', '☑️', 'Select all'], ['lk', '🔒', all('lock') ? 'Unlock chat' : 'Lock chat'], ['fv', '⭐', all('fav') ? 'Remove from favourite' : 'Add to favourite'], ['al', '🏷️', 'Add to list'], ['cc', '🧹', 'Clear chat'], ['bl', '🚫', all('blocked') ? 'Unblock' : 'Block']];
    dlg(L.map(x => `<button class="mi" data-k="${x[0]}">${x[1]} ${x[2]}</button>`).join(''), (d, close) => d.querySelectorAll('.mi').forEach(b => b.onclick = () => { close(); menuAct(b.dataset.k, items); }));
}
function menuAct(k, items) {
    const cs = S.chats.filter(c => sel.has(c.id)), all = p => cs.every(c => c[p]);
    const tg = (p, a, b) => { const on = !all(p); cs.forEach(c => c[p] = on); sel.clear(); save(); render(); toast(on ? a : b); };
    if (k === 'sc')
        return tg('sc', 'Shortcut added (marked with 🔗)', 'Shortcut removed');
    if (k === 'un')
        return tg('unread', 'Marked as unread', 'Marked as read');
    if (k === 'fv')
        return tg('fav', 'Added to favourites', 'Removed from favourites');
    if (k === 'bl')
        return tg('blocked', 'Blocked', 'Unblocked');
    if (k === 'sa') {
        items.forEach(c => sel.add(c.id));
        return render();
    }
    if (k === 'vc') {
        if (cs.length !== 1)
            return toast('Select one chat to view contact');
        return viewContact(cs[0]);
    }
    if (k === 'lk')
        return lockAct(cs);
    if (k === 'al')
        return listDlg(cs);
    if (k === 'cc')
        return dlg(`<h3>Clear chat?</h3><p class="muted">All messages in ${cs.length} chat(s) will be deleted.</p><div class="bt"><button class="btn g" id="no">Cancel</button><button class="btn red" id="ye">Clear</button></div>`, (d, close) => { $('#no').onclick = close; $('#ye').onclick = () => { cs.forEach(c => { c.msgs = []; }); sel.clear(); save(); close(); render(); toast('Chat cleared'); }; });
}
function viewContact(c) { dlg(`<div style="text-align:center">${av(c.title)}<h3 style="margin:10px 0 2px">${esc(c.title)}</h3><small>${c.members ? 'Group · ' + c.members.length + ' members + You' : 'Hey there! I am using Chat X.'}</small></div>${c.members ? '<p>' + c.members.map(esc).join(', ') + '</p>' : ''}<p class="muted">${c.msgs.length} messages${c.fav ? ' · ⭐ Favourite' : ''}${c.mute ? ' · 🔕 Muted' : ''}</p><div class="bt"><button class="btn" id="no">Close</button></div>`, (d, close) => { $('#no').onclick = () => { close(); sel.clear(); render(); }; }); }
function listDlg(cs) { S.lists = S.lists || ['Work', 'Family', 'Friends']; dlg(`<h3>Add to list</h3>${S.lists.map(x => `<button class="mi" data-l="${esc(x)}">🏷️ ${esc(x)}</button>`).join('')}<div class="add" style="margin-top:8px"><input id="nl" placeholder="New list" style="flex:1"><button class="btn" id="al">Create</button></div>`, (d, close) => { const put = n => { cs.forEach(c => { c.lists = c.lists || []; if (!c.lists.includes(n))
    c.lists.push(n); }); sel.clear(); save(); close(); render(); toast('Added to ' + n); }; d.querySelectorAll('[data-l]').forEach(b => b.onclick = () => put(b.dataset.l)); $('#al').onclick = () => { const v = $('#nl').value.trim(); if (!v)
    return; if (!S.lists.includes(v))
    S.lists.push(v); put(v); }; }); }
function lockAct(cs) {
    const ask = (t, cb) => dlg(`<h3>${t}</h3><input id="pn" type="password" inputmode="numeric" maxlength="4" placeholder="4-digit PIN" style="width:100%"><div class="bt"><button class="btn g" id="no">Cancel</button><button class="btn" id="ok">OK</button></div>`, (d, close) => { $('#pn').focus(); $('#no').onclick = close; $('#ok').onclick = () => { const v = $('#pn').value; if (v.length !== 4 || !/^[0-9]+$/.test(v)) {
        $('#pn').style.borderColor = '#e5484d';
        return;
    } close(); cb(v); }; });
    const done = on => { cs.forEach(c => { c.lock = on; unl.delete(c.id); }); sel.clear(); save(); render(); toast(on ? 'Chat locked' : 'Chat unlocked'); };
    if (cs.every(c => c.lock))
        ask('Enter PIN to unlock', v => v === S.pin ? done(false) : toast('Wrong PIN'));
    else if (!S.pin)
        ask('Set a 4-digit PIN', v => { S.pin = v; done(true); });
    else
        done(true);
}
function lockScreen(c, p) { p.innerHTML = `<div class="head"><button class="ic back" id="bk">←</button><b>🔒 Locked chat</b></div><div class="empty"><b style="font-size:20px;color:var(--text)">${esc(c.title)} is locked</b><br><br><input id="pn" type="password" inputmode="numeric" maxlength="4" placeholder="Enter PIN" style="text-align:center"> <button class="btn" id="ok">Unlock</button></div>`; $('#bk').onclick = () => { openId = null; render(); }; $('#ok').onclick = () => { if ($('#pn').value === S.pin) {
    unl.add(c.id);
    convo();
}
else {
    $('#pn').value = '';
    $('#pn').style.borderColor = '#e5484d';
} }; }
function split0(kind) {
    const items = S.chats.filter(c => c.kind === kind), g = kind === 'group';
    $('#view').innerHTML = `<div class="split ${openId ? 'open' : ''}"><div class="lp"><div class="top"><h2>${g ? 'Groups' : 'Chats'}</h2><div class="add"><input id="nn" placeholder="${g ? 'New group name' : 'New chat name'}"><button class="btn" id="ad">Add</button></div></div><div id="list"></div></div><div class="pane" id="pane"></div></div>`;
    $('#list').innerHTML = items.map(c => { const l = c.msgs[c.msgs.length - 1]; return `<button class="row ${c.id === openId ? 'on' : ''}" data-id="${c.id}">${av(c.title)}<div class="t"><b>${esc(c.title)}</b><small>${l ? (l.a ? '🎤 Voice message' : esc(l.t)) : g ? c.members.join(', ') : 'No messages yet'}</small></div></button>`; }).join('') || '<div class="empty">Nothing here yet.</div>';
    document.querySelectorAll('.row').forEach(r => r.onclick = () => { openId = +r.dataset.id; render(); });
    $('#ad').onclick = () => { const v = $('#nn').value.trim(); if (!v)
        return; const c = { id: Date.now(), kind, title: v, msgs: [] }; if (g)
        c.members = ['Aarav', 'Priya', 'Rohan']; S.chats.unshift(c); openId = c.id; save(); render(); };
    convo();
}
function convo() {
    const c = S.chats.find(x => x.id === openId), p = $('#pane');
    if (c && c.lock && !unl.has(c.id)) {
        lockScreen(c, p);
        return;
    }
    if (c)
        c.msgs = c.msgs.filter(m => !m.x || m.x > Date.now());
    if (!c) {
        p.innerHTML = '<div class="empty"><b style="font-size:22px;color:var(--text)">Welcome to Chat X</b><br>Select a conversation to start.</div>';
        return;
    }
    p.innerHTML = `<div class="head"><button class="ic back" id="bk">${ico('back', 18)}</button>${av(c.title).replace('44px', '')}<b>${esc(c.title)}${c.members ? `<br><small>${c.members.join(', ')}, You</small>` : (c.peer ? peerLine(c) : '')}</b><button class="ic" id="cl" title="Voice call">${ico('phone', 18)}</button><button class="ic" id="cv" title="Video call">${ico('video', 18)}</button></div><div class="msgs" id="ms"></div><form class="comp" id="f"><textarea id="in" rows="1" placeholder="Message…"></textarea><button type="button" class="ic" id="mic" title="Voice message">${ico('mic', 18)}</button><button class="btn" type="submit" aria-label="Send">${ico('send', 18)}</button></form>`;
    const ms = $('#ms');
    ms.innerHTML = c.msgs.map((m, i) => `<div class="m ${m.r}">${m.n ? `<small>${esc(m.n)}</small>` : ''}${m.a ? `<audio controls src="${m.a}" style="max-width:220px"></audio>` : esc(m.t)}${m.r === 'me' ? tick(c, i) : ''}</div>`).join('') || '<div class="empty">Say hi 👋</div>';
    ms.scrollTop = ms.scrollHeight;
    $('#bk').onclick = () => { openId = null; render(); };
    $('#cl').onclick = () => startCall(c.title);
    $('#cv').onclick = () => startCall(c.title, true);
    $('#mic').onclick = () => toggleRec(c);
    $('#f').onsubmit = e => { e.preventDefault(); const v = $('#in').value.trim(); if (v) {
        $('#in').value = '';
        send(c, v);
    } };
    $('#in').onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        $('#f').requestSubmit();
    } };
    $('#in').oninput = e => { e.target.style.height = 'auto'; e.target.style.height = e.target.scrollHeight + 'px'; };
    if (c.blocked) {
        $('#f').outerHTML = '<div class="comp"><small style="flex:1">You blocked this contact.</small><button class="btn g" id="ub">Unblock</button></div>';
        $('#ub').onclick = () => { c.blocked = false; save(); render(); };
    }
}
// Backend hook: replace with a real API call later.
async function getReply(c, text) { await new Promise(r => setTimeout(r, 900)); return 'Demo reply to “' + text + '”. Connect your backend in getReply().'; }
async function send(c, t, a) {
    c.msgs.push(mk(a ? { r: 'me', a } : { r: 'me', t }));
    save();
    convo();
    const ms = $('#ms'), d = document.createElement('div');
    d.className = 'm bot';
    d.innerHTML = '<span class="dots"><span></span><span></span><span></span></span>';
    ms.appendChild(d);
    ms.scrollTop = ms.scrollHeight;
    const r = await getReply(c, t || 'a voice message'), m = { r: 'bot', t: r };
    if (c.members)
        m.n = c.members[Math.floor(Math.random() * c.members.length)];
    c.msgs.push(mk(m));
    save();
    if (c.id === openId && document.querySelector('#ms'))
        convo();
}
function readPic(f, cb) { if (!f)
    return; const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { const z = 256, s = Math.min(im.width, im.height), cv = document.createElement('canvas'); cv.width = cv.height = z; cv.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, z, z); cb(cv.toDataURL('image/jpeg', .85)); }; im.src = r.result; }; r.readAsDataURL(f); }
let rec = null;
async function toggleRec(c) {
    const b = $('#mic');
    if (rec) {
        rec.stop();
        return;
    }
    try {
        const st = await navigator.mediaDevices.getUserMedia({ audio: true });
        const mr = new MediaRecorder(st), ch = [];
        let s = 0;
        mr.ondataavailable = e => ch.push(e.data);
        const tk = setInterval(() => { s++; b.textContent = '⏹ ' + s + 's'; if (s >= 30)
            mr.stop(); }, 1000);
        mr.onstop = () => { clearInterval(tk); st.getTracks().forEach(t => t.stop()); rec = null; const fr = new FileReader(); fr.onload = () => { if (s > 0)
            send(c, '', fr.result);
        else
            render(); }; fr.readAsDataURL(new Blob(ch, { type: mr.mimeType })); };
        rec = mr;
        mr.start();
        b.textContent = '⏹ 0s';
        b.style.color = '#e5484d';
    }
    catch (e) {
        b.textContent = '🚫 No mic';
        setTimeout(() => { b.innerHTML = ico('mic', 18); }, 2000);
    }
}
function status() {
    $('#view').innerHTML = `<div class="pg"><h2>Status</h2>
  ${S.mine.length ? '<small>My updates</small><div class="rows">' + S.mine.map((s, i) => `<div class="row">${av(S.me.name, 1)}<div class="t"><b>${esc(s.t)}</b><small>${ago(s.at)}</small></div><button class="ic" data-d="${i}">✕</button></div>`).join('') + '</div>' : ''}
  <small>Recent updates</small><div class="rows">${S.status.map(s => `<div class="row">${av(s.who, 1)}<div class="t"><b>${esc(s.who)}</b><small>${esc(s.t)} · ${ago(s.at)}</small></div></div>`).join('')}</div></div>`;
    addFab(() => dlg(`<h3>New status</h3>${inp('st1', 'What’s on your mind?')}${bt('Post')}`, (d, close) => { $('#st1').focus(); $('#no').onclick = close; $('#ok').onclick = () => { const v = $('#st1').value.trim(); if (!v)
        return; S.mine.unshift({ t: v, at: Date.now() }); save(); close(); status(); }; }));
    document.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { S.mine.splice(+b.dataset.d, 1); save(); status(); });
}
function calling() {
    const ic = { in: '↙ Incoming', out: '↗ Outgoing', missed: '✕ Missed' };
    const names = [...new Set(S.chats.filter(c => c.kind === 'dm').map(c => c.title))];
    $('#view').innerHTML = `<div class="pg"><h2>Calling</h2><small>Quick call</small><div class="rows" style="flex:none">${names.map(n => `<div class="row">${av(n)}<div class="t"><b>${esc(n)}</b></div><button class="ic" data-c="${esc(n)}">${ico('phone', 16)}</button><button class="ic" data-v="${esc(n)}">${ico('video', 16)}</button></div>`).join('')}</div><br><small>Recent calls</small><div class="rows">${S.calls.map(c => `<div class="row">${av(c.who)}<div class="t"><b style="${c.type === 'missed' ? 'color:#e5484d' : ''}">${esc(c.who)}</b><small>${ic[c.type]}${c.video ? ' 📹' : ''} · ${ago(c.at)}${c.dur ? ' · ' + c.dur + 's' : ''}</small></div><button class="ic" data-c="${esc(c.who)}">${ico('phone', 16)}</button><button class="ic" data-v="${esc(c.who)}">${ico('video', 16)}</button></div>`).join('')}</div></div>`;
    document.querySelectorAll('[data-c]').forEach(b => b.onclick = () => startCall(b.dataset.c));
    document.querySelectorAll('[data-v]').forEach(b => b.onclick = () => startCall(b.dataset.v, true));
    addFab(() => dlg(`<h3>New call</h3>${inp('nc1', 'Name or number')}<div class='bt'><button class='btn g' id='no'>Cancel</button><button class='btn' id='cv1'>${ico('video', 16)} Video</button><button class='btn' id='cp1'>${ico('phone', 16)} Voice</button></div>`, (d, close) => { $('#nc1').focus(); $('#no').onclick = close; const go = v => { const n = $('#nc1').value.trim(); if (!n)
        return; close(); startCall(n, v); }; $('#cv1').onclick = () => go(true); $('#cp1').onclick = () => go(false); }));
}
let timer;
let camStream = null;
function startCall(who, video) {
    let s = 0;
    const el = $('#call');
    el.className = 'on';
    el.innerHTML = `${av(who)}<h2 style="margin:0">${esc(who)}</h2><div id="ct">${video ? 'Video calling…' : 'Calling…'}</div>${video ? '<video id="sv" autoplay muted playsinline style="width:160px;border-radius:14px;background:#000;margin-top:8px"></video>' + ((S.set || {}).camfx === false ? '' : '<div id="fx" style="margin-top:8px">' + ['none', 'grayscale(1)', 'sepia(.8)', 'hue-rotate(180deg)', 'saturate(2.2)', 'blur(4px)'].map((f, i) => '<button class="ic" data-f="' + f + '" style="color:#fff;margin:2px">' + ['None', 'Mono', 'Warm', 'Cool', 'Vivid', 'Blur'][i] + '</button>').join('') + '</div>') : ''}<br><button class="btn red" id="en">End call</button>`;
    if (video && navigator.mediaDevices)
        navigator.mediaDevices.getUserMedia({ video: true }).then(st => { camStream = st; const v = $('#sv'); if (v)
            v.srcObject = st; }).catch(() => { const v = $('#sv'); if (v)
            v.outerHTML = '<small style="color:#ccc">Camera unavailable</small>'; });
    document.querySelectorAll('#fx button').forEach(b => b.onclick = () => { const v = $('#sv'); if (v)
        v.style.filter = b.dataset.f; });
    clearInterval(timer);
    setTimeout(() => { timer = setInterval(() => { s++; const t = $('#ct'); if (t)
        t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0'); }, 1000); const t = $('#ct'); if (t)
        t.textContent = '00:00'; }, 1500);
    $('#en').onclick = () => { clearInterval(timer); el.className = ''; if (camStream) {
        camStream.getTracks().forEach(t => t.stop());
        camStream = null;
    } S.calls.unshift({ who, type: 'out', video: !!video, at: Date.now(), dur: s }); save(); if (tab === 'calling')
        calling(); };
}
function you() {
    if (yp === 'admin')
        return adminPage();
    if (yp)
        return sub(yp);
    const sent = S.chats.reduce((a, c) => a + c.msgs.filter(m => m.r === 'me').length, 0);
    $('#view').innerHTML = `<div class="pg"><h2>You</h2><div class="card" style="text-align:center;position:relative"><button class="ic" id="pe" aria-label="Edit profile" style="position:absolute;right:10px;top:10px">${ico('pen', 16)}</button><div id="pav" style="display:flex;justify-content:center;cursor:pointer">${av(S.me.name)}</div><b style="display:block;margin-top:8px">${esc(S.me.name)}</b><small>${esc(S.me.about)}</small></div>
  <div class="card" style="padding:4px">${[['acct', '🔑', 'Account', 'Passkey, password, security'], ['priv', '🔒', 'Privacy', 'Last seen, receipts, locks'], ['app', '🎨', 'Appearance', 'Themes and app icon']].concat(isAdmin ? [['admin', '🛠', 'Admin portal', 'Reports, announcements, moderation']] : []).map(x => `<button class='sr' data-yp='${x[0]}'><span class='ib'>${ico(x[0], 20)}</span><div class='t'><b>${x[2]}</b><small>${x[3]}</small></div>›</button>`).join('')}</div>
  <div class="stats"><div><b>${S.chats.filter(c => c.kind === 'dm').length}</b><small>Chats</small></div><div><b>${S.chats.filter(c => c.kind === 'group').length}</b><small>Groups</small></div><div><b>${sent}</b><small>Sent</small></div></div>
  <input type="file" id="pf" accept="image/*" hidden>
  <button class="btn red" id="rs">Reset all data</button></div>`;
    $('#rs').onclick = () => { S = seed(); S.me.name = (users()[curUser] || {}).name || 'You'; save(); you(); };
    $('#pe').onclick = editProfile;
    $('#pav').onclick = () => $('#pf').click();
    document.querySelectorAll('[data-yp]').forEach(b => b.onclick = () => { yp = b.dataset.yp; you(); });
    $('#pf').onchange = e => { const f = e.target.files[0]; if (!f)
        return; const r = new FileReader(); r.onload = () => { const im = new Image(); im.onload = () => { const z = 256, s = Math.min(im.width, im.height), cv = document.createElement('canvas'); cv.width = cv.height = z; cv.getContext('2d').drawImage(im, (im.width - s) / 2, (im.height - s) / 2, s, s, 0, 0, z, z); S.me.pic = cv.toDataURL('image/jpeg', .85); save(); you(); }; im.src = r.result; }; r.readAsDataURL(f); };
}
let curUser = null;
const LS = (k, v) => { try {
    if (v === undefined)
        return localStorage.getItem(k);
    localStorage.setItem(k, v);
}
catch (e) {
    return null;
} };
async function hash(s) { const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('chatx:' + s)); return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join(''); }
const users = () => { try {
    return JSON.parse(LS('chatx_users') || '{}');
}
catch (e) {
    return {};
} };
function enter(id) { KEY = 'chatx2_' + id; let d = null; try {
    d = JSON.parse(LS(KEY) || 'null');
}
catch (e) { } S = d || seed(); if (d) {
    S.chats = S.chats.filter(c => c.id > 5);
    S.status = (S.status || []).filter(s => !['Aarav', 'Priya', 'Sneha'].includes(s.who));
    S.calls = (S.calls || []).filter(c => !['Rohan', 'Priya', 'Aarav'].includes(c.who));
} const u = users()[id]; if (!d && u)
    S.me.name = u.name; LS('chatx_session', id); curUser = id; $('#auth').className = ''; applyAll(); render(); initDb(); if (S.set && S.set.secnote)
    setTimeout(() => toast('Security alert: new login on this device'), 700); }
function logout() { try {
    localStorage.removeItem('chatx_session');
}
catch (e) { } curUser = null; tab = 'chat'; yp = null; openId = null; tUn.forEach(f => f()); tUn = []; isAdmin = false; DB = null; sel.clear(); unl.clear(); showArch = false; showAuth('login'); }
function showAuth(mode) {
    const su = mode === 'signup', a = $('#auth');
    a.className = 'on';
    a.innerHTML = `<div class="acard"><div class="logo" style="margin:0 auto 12px;width:56px;height:56px;font-size:26px;border-radius:16px">X</div><h2 style="margin:0">${su ? 'Create account' : 'Welcome back'}</h2><p class="muted" style="margin:4px 0 14px">${su ? 'Sign up to start chatting on Chat X' : 'Log in to continue to Chat X'}</p>${su ? '<input id="an" placeholder="Your name" autocomplete="name">' : ''}<input id="ae" placeholder="Email or phone" autocomplete="username"><input id="ap" type="password" placeholder="Password (min 6 characters)" autocomplete="${su ? 'new-password' : 'current-password'}"><div id="aerr" class="aerr"></div><button class="btn" id="ago" style="width:100%">${su ? 'Sign up' : 'Log in'}</button><p class="muted" style="margin:14px 0 4px">${su ? 'Already have an account?' : 'New to Chat X?'} <button class="lnk" id="asw">${su ? 'Log in' : 'Sign up'}</button></p><small>Accounts are saved on this device only.</small></div>`;
    paintLogo();
    const err = m => { $('#aerr').textContent = m; };
    $('#asw').onclick = () => showAuth(su ? 'login' : 'signup');
    const go = async () => {
        const id = $('#ae').value.trim().toLowerCase(), pw = $('#ap').value, nm = su ? $('#an').value.trim() : '';
        if (su && !nm)
            return err('Please enter your name');
        if (id.length < 5)
            return err('Enter a valid email or phone');
        if (pw.length < 6)
            return err('Password must be at least 6 characters');
        const us = users(), h = await hash(pw);
        if (su) {
            if (us[id])
                return err('Account already exists. Please log in.');
            us[id] = { name: nm, hash: h };
            LS('chatx_users', JSON.stringify(us));
            enter(id);
        }
        else {
            if (!us[id] || us[id].hash !== h)
                return err('Wrong email/phone or password');
            if (us[id].tsv)
                return tsvStep(id, us[id].tsv);
            enter(id);
        }
    };
    $('#ago').onclick = go;
    $('#ap').onkeydown = e => { if (e.key === 'Enter')
        go(); };
}
let yp = null;
const bt = l => `<div class='bt'><button class='btn g' id='no'>Cancel</button><button class='btn' id='ok'>${l}</button></div>`;
const askPin = (t, cb, n) => dlg(`<h3>${t}</h3><input id='pn' type='password' inputmode='numeric' maxlength='${n}' placeholder='${n}-digit PIN' style='width:100%'>${bt('OK')}`, (d, close) => { $('#pn').focus(); $('#no').onclick = close; $('#ok').onclick = () => { const v = $('#pn').value; if (v.length !== n || !/^[0-9]+$/.test(v)) {
    $('#pn').style.borderColor = '#e5484d';
    return;
} close(); cb(v); }; });
const inp = (id, ph, t) => `<input id='${id}' type='${t || 'text'}' placeholder='${ph}' style='width:100%;margin-bottom:8px'>`;
const TM = { 'Off': 0, '1 minute (demo)': 6e4, '24 hours': 864e5, '7 days': 6048e5, '90 days': 7776e6 };
const mk = o => { const d = TM[(S.set || {}).timer || 'Off']; if (d)
    o.x = Date.now() + d; return o; };
let tick = (c, i) => `<span class='tk ${(S.set || {}).read !== false && c.msgs.slice(i + 1).some(x => x.r === 'bot') ? 'rd' : ''}'>✓✓</span>`;
function ic() { return (S && S.set && S.set.icon) || { g: 'X', a: 255, b: 300, r: '11px' }; }
function paintLogo() { document.querySelectorAll('.logo').forEach(e => { e.textContent = ic().g; }); }
function applyIcon() {
    const i = ic(), r = document.documentElement.style;
    r.setProperty('--lg', `linear-gradient(135deg,hsl(${i.a},80%,58%),hsl(${i.b},80%,58%))`);
    r.setProperty('--lr', i.r);
    paintLogo();
    let l = $('#fav');
    if (!l) {
        l = document.createElement('link');
        l.id = 'fav';
        l.rel = 'icon';
        document.head.appendChild(l);
    }
    l.href = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'><defs><linearGradient id='g' x1='0' y1='0' x2='1' y2='1'><stop offset='0' stop-color='hsl(${i.a},80%,58%)'/><stop offset='1' stop-color='hsl(${i.b},80%,58%)'/></linearGradient></defs><rect width='64' height='64' rx='${i.r === '50%' ? 32 : i.r === '3px' ? 3 : 14}' fill='url(#g)'/><text x='32' y='44' font-size='34' text-anchor='middle' fill='#fff'>${esc(i.g)}</text></svg>`);
}
function applyTheme() {
    const t = (S.set || {}).theme, r = document.documentElement.style, K = ['--bg', '--panel', '--them', '--line', '--text', '--muted', '--accent', 'color-scheme'];
    if (!t) {
        K.forEach(k => r.removeProperty(k));
        return;
    }
    const H = x => `hsl(${t.h},${x})`, v = t.d ? { '--bg': H('25%,8%'), '--panel': H('25%,12%'), '--them': H('22%,18%'), '--line': H('20%,22%'), '--text': H('30%,94%'), '--muted': H('12%,62%') } : { '--bg': H('40%,96%'), '--panel': '#fff', '--them': H('35%,92%'), '--line': H('25%,88%'), '--text': H('30%,10%'), '--muted': H('10%,42%') };
    v['--accent'] = H(t.s + '%,' + (t.d ? '62%' : '52%'));
    v['color-scheme'] = t.d ? 'dark' : 'light';
    Object.keys(v).forEach(k => r.setProperty(k, v[k]));
}
function applyAll() { applyTheme(); applyIcon(); }
let hiddenAt = 0;
function showLock() { const a = $('#alock'); a.className = 'on'; a.innerHTML = `<div class='acard'><h2 style='margin:0 0 6px'>🔒 Chat X is locked</h2><p class='muted'>Enter your app PIN</p><input id='lp' type='password' inputmode='numeric' maxlength='4' style='text-align:center'><div class='aerr' id='le'></div><button class='btn' id='lu' style='width:100%'>Unlock</button></div>`; const go = async () => { if (await hash($('#lp').value) === S.set.appPin)
    a.className = '';
else {
    $('#le').textContent = 'Wrong PIN';
    $('#lp').value = '';
} }; $('#lu').onclick = go; $('#lp').onkeydown = e => { if (e.key === 'Enter')
    go(); }; }
document.addEventListener('visibilitychange', () => { if (!curUser)
    return; if (document.hidden)
    hiddenAt = Date.now();
else if (S.set && S.set.appPin && Date.now() - hiddenAt >= (S.set.alt || 0) * 6e4)
    showLock(); });
function tsvStep(id, th) { const a = $('#auth'); a.innerHTML = `<div class='acard'><h2 style='margin:0 0 6px'>Two-step verification</h2><p class='muted'>Enter your 6-digit PIN</p><input id='tp' type='password' inputmode='numeric' maxlength='6' style='text-align:center'><div class='aerr' id='te'></div><button class='btn' id='tg' style='width:100%'>Verify</button><br><button class='lnk' id='tb'>Back</button></div>`; const go = async () => { if (await hash($('#tp').value) === th)
    enter(id);
else {
    $('#te').textContent = 'Wrong PIN';
    $('#tp').value = '';
} }; $('#tg').onclick = go; $('#tp').onkeydown = e => { if (e.key === 'Enter')
    go(); }; $('#tb').onclick = () => showAuth('login'); }
function sub(p) {
    const set = S.set = S.set || {}, g = (k, d) => set[k] === undefined ? d : set[k], rr = () => { save(); you(); };
    const sl = ['Everyone', 'My contacts', 'Nobody'], slug = (curUser || 'me').replace(/[^a-z0-9]/g, '');
    const ACT = {
        addacc() { const us = users(); dlg(`<h3>Accounts on this device</h3>${Object.keys(us).map(id => `<button class='mi' data-s='${esc(id)}'>${id === curUser ? '✅' : '👤'} ${esc(us[id].name)} · ${esc(id)}</button>`).join('')}<button class='mi' id='na'>➕ Add another account</button>`, (d, close) => { d.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { close(); if (b.dataset.s !== curUser) {
            yp = null;
            sel.clear();
            openId = null;
            enter(b.dataset.s);
        } }); $('#na').onclick = () => { close(); showAuth('login'); $('.acard').insertAdjacentHTML('beforeend', `<br><button class='lnk' id='acx'>Cancel</button>`); $('#acx').onclick = () => { $('#auth').className = ''; }; }; }); },
        async passkey() {
            if (set.passkey) {
                set.passkey = false;
                rr();
                return toast('Passkey removed');
            }
            try {
                const c = await navigator.credentials.create({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'Chat X' }, user: { id: new TextEncoder().encode(curUser), name: curUser, displayName: S.me.name }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }], authenticatorSelection: { userVerification: 'preferred' }, timeout: 60000 } });
                if (c) {
                    set.passkey = true;
                    rr();
                    toast('Passkey created');
                }
            }
            catch (_) {
                toast('Passkeys aren’t available in this window');
            }
        },
        pw() { dlg(`<h3>Change password</h3>${inp('p0', 'Current password', 'password')}${inp('p1', 'New password (min 6)', 'password')}${inp('p2', 'Confirm new password', 'password')}<div class='aerr' id='pe'></div>${bt('Update')}`, (d, close) => { $('#no').onclick = close; $('#ok').onclick = async () => { const us = users(), e = m => { $('#pe').textContent = m; }; if (await hash($('#p0').value) !== us[curUser].hash)
            return e('Current password is wrong'); if ($('#p1').value.length < 6)
            return e('Minimum 6 characters'); if ($('#p1').value !== $('#p2').value)
            return e('Passwords don’t match'); us[curUser].hash = await hash($('#p1').value); LS('chatx_users', JSON.stringify(us)); close(); toast('Password changed'); }; }); },
        em() { dlg(`<h3>Email address</h3>${inp('eml', 'name@example.com', 'email')}<div class='aerr' id='ee'></div>${bt('Save')}`, (d, close) => { $('#eml').value = set.email || ''; $('#no').onclick = close; $('#ok').onclick = () => { const v = $('#eml').value.trim(); if (!v.includes('@') || !v.includes('.'))
            return $('#ee').textContent = 'Enter a valid email'; set.email = v; close(); rr(); toast('Email saved'); }; }); },
        tsv() { const us = users(), u = us[curUser]; if (u.tsv)
            return askPin('Enter your 6-digit PIN to turn off', async (v) => { if (await hash(v) === u.tsv) {
                delete u.tsv;
                LS('chatx_users', JSON.stringify(us));
                rr();
                toast('Two-step verification off');
            }
            else
                toast('Wrong PIN'); }, 6); askPin('Create a 6-digit PIN', async (v) => { u.tsv = await hash(v); LS('chatx_users', JSON.stringify(us)); rr(); toast('Two-step verification on'); }, 6); },
        chg() { dlg(`<h3>Change phone number or email</h3>${inp('c1', 'New phone number or email')}${inp('c2', 'Current password', 'password')}<div class='aerr' id='ce'></div>${bt('Change')}`, (d, close) => { $('#no').onclick = close; $('#ok').onclick = async () => { const us = users(), n = $('#c1').value.trim().toLowerCase(), e = m => { $('#ce').textContent = m; }; if (n.length < 5)
            return e('Enter a valid phone number or email'); if (us[n])
            return e('Already used by another account'); if (await hash($('#c2').value) !== us[curUser].hash)
            return e('Wrong password'); us[n] = us[curUser]; delete us[curUser]; LS('chatx_users', JSON.stringify(us)); const old = KEY; KEY = 'chatx2_' + n; LS(KEY, LS(old)); try {
            localStorage.removeItem(old);
        }
        catch (_) { } LS('chatx_session', n); curUser = n; close(); rr(); toast('Updated'); }; }); },
        out: logout,
        about() { dlg(`<h3>About</h3>${inp('ab', 'About')}${bt('Save')}`, (d, close) => { $('#ab').value = S.me.about; $('#no').onclick = close; $('#ok').onclick = () => { S.me.about = $('#ab').value.trim(); close(); rr(); }; }); },
        link() { const u = 'https://chatx.me/' + slug; try {
            navigator.clipboard.writeText(u).then(() => toast('Link copied: chatx.me/' + slug), () => toast('Your link: chatx.me/' + slug));
        }
        catch (_) {
            toast('Your link: chatx.me/' + slug);
        } },
        live() { const on = set.live > Date.now(); dlg(`<h3>Live location</h3><p class='muted'>${on ? 'Sharing until ' + new Date(set.live).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not sharing right now'}</p>${[['15 minutes', 15], ['1 hour', 60], ['8 hours', 480]].map(x => `<button class='mi' data-m='${x[1]}'>📍 Share for ${x[0]}</button>`).join('')}${on ? `<button class='mi' id='st'>⏹ Stop sharing</button>` : ''}`, (d, close) => { d.querySelectorAll('[data-m]').forEach(b => b.onclick = () => { set.live = Date.now() + b.dataset.m * 6e4; close(); rr(); toast('Sharing live location'); }); const s = $('#st'); if (s)
            s.onclick = () => { set.live = 0; close(); rr(); toast('Stopped sharing'); }; }); },
        blocked() { const b = S.chats.filter(c => c.blocked), o = S.chats.filter(c => !c.blocked && c.kind === 'dm'); dlg(`<h3>Blocked contacts</h3>${b.map(c => `<div class='row' style='cursor:default'>${av(c.title)}<div class='t'><b>${esc(c.title)}</b></div><button class='ic' data-u='${c.id}'>Unblock</button></div>`).join('') || `<p class='muted'>No blocked contacts</p>`}<h3 style='margin-top:14px'>Block a contact</h3>${o.map(c => `<button class='mi' data-b='${c.id}'>🚫 ${esc(c.title)}</button>`).join('')}`, (d, close) => { d.querySelectorAll('[data-u]').forEach(x => x.onclick = () => { S.chats.find(c => c.id == x.dataset.u).blocked = false; save(); close(); rr(); ACT.blocked(); }); d.querySelectorAll('[data-b]').forEach(x => x.onclick = () => { S.chats.find(c => c.id == x.dataset.b).blocked = true; save(); close(); rr(); ACT.blocked(); }); }); },
        applock() {
            if (!set.appPin)
                return askPin('Set a 4-digit app PIN', async (v) => { set.appPin = await hash(v); rr(); toast('App lock on'); }, 4);
            dlg(`<h3>App lock</h3><button class='mi' id='a1'>🔓 Turn off app lock</button><button class='mi' id='a2'>🔑 Change PIN</button><p class='muted' style='margin:10px 0 4px'>Lock after</p><select id='alt' style='width:100%'>${[['Immediately', 0], ['1 minute', 1], ['15 minutes', 15], ['1 hour', 60]].map(x => `<option value='${x[1]}' ${(set.alt || 0) === x[1] ? 'selected' : ''}>${x[0]}</option>`).join('')}</select>`, (d, close) => {
                $('#alt').onchange = e => { set.alt = +e.target.value; save(); };
                $('#a1').onclick = () => { close(); askPin('Enter PIN to turn off', async (v) => { if (await hash(v) === set.appPin) {
                    set.appPin = '';
                    rr();
                    toast('App lock off');
                }
                else
                    toast('Wrong PIN'); }, 4); };
                $('#a2').onclick = () => { close(); askPin('Current PIN', async (v) => { if (await hash(v) !== set.appPin)
                    return toast('Wrong PIN'); askPin('New 4-digit PIN', async (n) => { set.appPin = await hash(n); save(); toast('PIN changed'); }, 4); }, 4); };
            });
        },
        chatlock() { dlg(`<h3>Chat lock</h3>${S.chats.map(c => `<div class='row' style='cursor:default'>${av(c.title)}<div class='t'><b>${esc(c.title)}</b></div><button class='ic' data-l='${c.id}'>${c.lock ? '🔒 Unlock' : 'Lock'}</button></div>`).join('')}<button class='mi' id='cpn'>🔑 Change chat PIN</button>`, (d, close) => { d.querySelectorAll('[data-l]').forEach(b => b.onclick = () => { close(); lockAct([S.chats.find(c => c.id == b.dataset.l)]); }); $('#cpn').onclick = () => { close(); if (!S.pin)
            return toast('Lock a chat first to set a PIN'); askPin('Current chat PIN', v => { if (v !== S.pin)
            return toast('Wrong PIN'); askPin('New chat PIN', n => { S.pin = n; save(); toast('Chat PIN changed'); }, 4); }, 4); }; }); },
        theme() {
            const sv = set.themes = set.themes || [], t0 = set.theme || { h: 255, s: 80, d: false }, hs = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map(i => i * 30), PRE = hs.map(h => ({ h, s: 75, d: false })).concat(hs.map(h => ({ h, s: 75, d: true })));
            const sw = t => `background:linear-gradient(135deg,hsl(${t.h},${t.s}%,55%) 50%,hsl(${t.h},${t.d ? '25%,10%' : '40%,94%'}) 50%)`;
            dlg(`<h3>App theme</h3><div class='gr'>${PRE.map((t, i) => `<button class='sq' data-p='${i}' style='${sw(t)}'></button>`).join('')}</div><h3 style='margin-top:14px'>Create your own</h3><label class='muted'>Colour</label><input id='thh' type='range' min='0' max='360' value='${t0.h}' style='width:100%'><label class='muted'>Intensity</label><input id='tss' type='range' min='30' max='100' value='${t0.s}' style='width:100%'><label class='muted'><input type='checkbox' id='tdd' ${t0.d ? 'checked' : ''}> Dark</label><div class='add' style='margin-top:8px'><input id='tn' placeholder='Theme name' style='flex:1'><button class='btn' id='tsv'>Save</button></div><div class='bt' style='justify-content:flex-start'><button class='btn g' id='trn'>🎲 Random</button><button class='btn g' id='tdf'>Default</button></div>${sv.length ? `<h3 style='margin-top:14px'>My themes</h3>` : ''}${sv.map((t, i) => `<div class='row' style='cursor:default'><button class='sq' data-a='${i}' style='${sw(t)};width:34px'></button><div class='t'><b>${esc(t.n)}</b></div><button class='ic' data-x='${i}'>✕</button></div>`).join('')}`, (d, close) => {
                const ap = t => { set.theme = { h: t.h, s: t.s, d: t.d }; save(); applyTheme(); }, cu = () => ({ h: +$('#thh').value, s: +$('#tss').value, d: $('#tdd').checked });
                ['#thh', '#tss', '#tdd'].forEach(s => $(s).oninput = () => ap(cu()));
                d.querySelectorAll('[data-p]').forEach(b => b.onclick = () => { ap(PRE[b.dataset.p]); ACT.theme(); });
                d.querySelectorAll('[data-a]').forEach(b => b.onclick = () => { ap(sv[b.dataset.a]); ACT.theme(); });
                d.querySelectorAll('[data-x]').forEach(b => b.onclick = () => { sv.splice(b.dataset.x, 1); save(); ACT.theme(); });
                $('#tsv').onclick = () => { sv.push({ n: $('#tn').value.trim() || 'Theme ' + (sv.length + 1), ...cu() }); save(); ACT.theme(); };
                $('#trn').onclick = () => { ap({ h: Math.floor(Math.random() * 360), s: 50 + Math.floor(Math.random() * 50), d: Math.random() < .5 }); ACT.theme(); };
                $('#tdf').onclick = () => { delete set.theme; save(); applyTheme(); ACT.theme(); };
            });
        },
        icon() {
            const sv = set.icons = set.icons || [], i0 = ic(), G = ['X', '💬', '⚡', '🔥', '🌈', '🚀', '🦋', '🐼', '🎧', '🌙', '⭐', '💎', '🍀', '🎯', '🦄', '🌸', '☕', '🎮', '🐯', '🦊', '🌊', '🍕', '🎨', '👑'];
            const bg = t => `background:linear-gradient(135deg,hsl(${t.a},80%,58%),hsl(${t.b},80%,58%));border-radius:${t.r}`;
            dlg(`<h3>App icon</h3><div class='gr'>${G.map(x => `<button class='eb' data-g='${x}'>${x}</button>`).join('')}</div><h3 style='margin-top:14px'>Create your own</h3><div class='add'><input id='ig' maxlength='4' value='${esc(i0.g)}' placeholder='Emoji or letters' style='flex:1'><select id='ir'><option value='11px'>Rounded</option><option value='50%'>Circle</option><option value='3px'>Square</option></select></div><label class='muted'>Colour 1</label><input id='ia' type='range' min='0' max='360' value='${i0.a}' style='width:100%'><label class='muted'>Colour 2</label><input id='ib' type='range' min='0' max='360' value='${i0.b}' style='width:100%'><div class='add' style='margin-top:8px'><input id='in2' placeholder='Icon name' style='flex:1'><button class='btn' id='isv'>Save</button></div><div class='bt' style='justify-content:flex-start'><button class='btn g' id='irn'>🎲 Random</button><button class='btn g' id='idf'>Default</button></div>${sv.length ? `<h3 style='margin-top:14px'>My icons</h3><div class='gr'>${sv.map((t, k) => `<div style='position:relative'><button class='eb' data-s='${k}' style='${bg(t)};color:#fff;width:100%'>${esc(t.g)}</button><button data-d='${k}' style='position:absolute;top:-4px;right:-4px;font-size:11px;background:var(--panel);border-radius:50%;width:18px;height:18px'>✕</button></div>`).join('')}</div>` : ''}`, (d, close) => {
                $('#ir').value = i0.r;
                const cu = () => ({ g: $('#ig').value || 'X', a: +$('#ia').value, b: +$('#ib').value, r: $('#ir').value }), ap = t => { set.icon = t; save(); applyIcon(); };
                ['#ig', '#ia', '#ib', '#ir'].forEach(s => $(s).oninput = () => ap(cu()));
                $('#ir').onchange = () => ap(cu());
                d.querySelectorAll('[data-g]').forEach(b => b.onclick = () => { ap({ ...cu(), g: b.dataset.g }); ACT.icon(); });
                d.querySelectorAll('[data-s]').forEach(b => b.onclick = () => { ap(sv[b.dataset.s]); ACT.icon(); });
                d.querySelectorAll('[data-d]').forEach(b => b.onclick = () => { sv.splice(b.dataset.d, 1); save(); ACT.icon(); });
                $('#isv').onclick = () => { sv.push({ n: $('#in2').value.trim() || 'Icon ' + (sv.length + 1), ...cu() }); save(); ACT.icon(); };
                $('#irn').onclick = () => { ap({ ...cu(), a: Math.floor(Math.random() * 360), b: Math.floor(Math.random() * 360) }); ACT.icon(); };
                $('#idf').onclick = () => { delete set.icon; save(); applyIcon(); ACT.icon(); };
            });
        }
    };
    if (typeof ACTX === 'function')
        Object.assign(ACT, ACTX(set, rr));
    const P = {
        acct: ['Account', [['a', 'pw', 'Password', 'Change your password'], ['a', 'em', 'Email address', set.email || 'Add a recovery email'], ['sw', 'secnote', 'Security notifications', 'Alert me about logins on this device', false], ['a', 'chg', 'Change phone number or email', (ME && ME.login) || ''], ['a', 'out', 'Log out', ''], ['a', 'del', 'Delete account', 'Permanently remove your account']]],
        priv: ['Privacy', [['sel', 'seen', 'Last seen and online', sl], ['sel', 'online', 'Who can see when I’m online', ['Everyone', 'Same as last seen']], ['sel', 'picv', 'Profile picture', sl], ['a', 'about', 'About', S.me.about], ['sel', 'aboutv', 'Who can see my about', sl], ['a', 'link', 'Link', location.host], ['sel', 'linkv', 'Who can open my link', sl], ['sw', 'read', 'Read receipts', 'Blue ticks when messages are read', true], ['sel', 'timer', 'Default message timer', Object.keys(TM)], ['sel', 'groupsv', 'Groups: who can add me', sl], ['a', 'live', 'Live location', set.live > Date.now() ? 'Sharing now' : 'Not sharing'], ['sel', 'callv', 'Calls: who can call me', sl], ['sw', 'silence', 'Silence unknown callers', '', false], ['a', 'blocked', 'Contacts: blocked', S.chats.filter(c => c.blocked).length + ' blocked'], ['a', 'applock', 'App lock', set.appPin ? 'On' : 'Off'], ['a', 'chatlock', 'Chat lock', S.chats.filter(c => c.lock).length + ' locked chats'], ['sw', 'camfx', 'Allow camera effects', 'Filters during video calls', true]]],
        app: ['Appearance', [['a', 'theme', 'App theme', 'Unlimited themes: presets, custom colours, saved'], ['a', 'icon', 'App icon', 'Unlimited icons: emoji, colours, shapes']]]
    }[p];
    const row = r => r[0] === 'sw' ? `<div class='sr'><div class='t'><b>${r[2]}</b><small>${r[3]}</small></div><label class='sw'><input type='checkbox' data-k='${r[1]}' ${g(r[1], r[4]) ? 'checked' : ''}><i></i></label></div>` : r[0] === 'sel' ? `<div class='sr'><div class='t'><b>${r[2]}</b></div><select data-k='${r[1]}'>${r[3].map(o => `<option ${g(r[1], r[3][0]) === o ? 'selected' : ''}>${o}</option>`).join('')}</select></div>` : `<button class='sr' data-a='${r[1]}'><div class='t'><b>${r[2]}</b><small>${esc(r[3])}</small></div>›</button>`;
    $('#view').innerHTML = `<div class='pg'><div style='display:flex;align-items:center;gap:10px;margin-bottom:12px'><button class='ic' id='yb'>←</button><h2 style='margin:0'>${P[0]}</h2></div><div class='card' style='padding:4px'>${P[1].map(row).join('')}</div></div>`;
    $('#yb').onclick = () => { yp = null; you(); };
    document.querySelectorAll('[data-k]').forEach(el => el.onchange = () => { set[el.dataset.k] = el.type === 'checkbox' ? el.checked : el.value; save(); });
    document.querySelectorAll('[data-a]').forEach(b => b.onclick = () => ACT[b.dataset.a]());
}
let DB = null, isAdmin = false, UID = null, CANW = true, CFGL = false, TEAM = [], CFG = {}, MY = [], RESP = {}, ALLT = {}, ALLR = {}, tUn = [], tsub = 'room', admFilter = 'all';
const LOCALK = 'chatx_team_local';
const uidNow = () => UID || curUser;
const STL = { open: '🔴 Open', progress: '🟡 In progress', resolved: '🟢 Resolved' };
let nameOf = u => { const m = TEAM.find(x => x.uid === u); return (m && m.name) || (ALLT[u] && ALLT[u].name) || ('User ' + String(u).slice(0, 6)); };
async function initDb() {
    tUn.forEach(f => f());
    tUn = [];
    DB = null;
    isAdmin = false;
    UID = null;
    CFGL = false;
    TEAM = [];
    CFG = {};
    MY = [];
    RESP = {};
    ALLT = {};
    ALLR = {};
    try {
        if (window.claude && claude.use) {
            const u = await claude.use('user'), db = await claude.use('db'), er = () => { };
            if (u) {
                isAdmin = !!(await u.canEdit());
                UID = await u.id();
                CANW = (await u.can('data.write')) !== false;
            }
            if (db) {
                DB = db;
                tUn.push(db.collection('team').orderBy('at').limit(500).onSnapshot(s => { TEAM = s.docs.map(d => Object.assign({ id: d.id }, d.data())); refreshTeam(); }, er));
                tUn.push(db.doc('config/app').onSnapshot(s => { CFG = s.exists ? s.data() : {}; CFGL = true; if (isAdmin && UID && !(CFG.admins || []).includes(UID))
                    db.doc('config/app').set(Object.assign({}, CFG, { admins: [...(CFG.admins || []), UID] })).catch(er); refreshTeam(); }, er));
                if (UID) {
                    tUn.push(db.doc('tickets/' + UID).onSnapshot(s => { MY = s.exists ? (s.data().items || []) : []; refreshTeam(); }, er));
                    tUn.push(db.doc('resp/' + UID).onSnapshot(s => { RESP = s.exists ? (s.data().map || {}) : {}; refreshTeam(); }, er));
                }
                if (isAdmin) {
                    tUn.push(db.collection('tickets').onSnapshot(s => { ALLT = {}; s.docs.forEach(d => { ALLT[d.id] = d.data(); }); refreshTeam(); }, er));
                    tUn.push(db.collection('resp').onSnapshot(s => { ALLR = {}; s.docs.forEach(d => { ALLR[d.id] = d.data().map || {}; }); refreshTeam(); }, er));
                }
            }
        }
    }
    catch (e) { }
    if (!DB) {
        try {
            TEAM = JSON.parse(LS(LOCALK) || '[]');
        }
        catch (_) {
            TEAM = [];
        }
        try {
            MY = JSON.parse(LS('chatx_my_local_' + curUser) || '[]');
        }
        catch (_) {
            MY = [];
        }
    }
    if (tab === 'you' && !yp)
        you();
    refreshTeam();
}
function refreshTeam() { if (tab === 'team') {
    if ($('#tban'))
        paintTeam();
    else
        teamPage();
}
else if (tab === 'you' && yp === 'admin') {
    if ($('#adm'))
        paintAdmin();
    else
        adminPage();
} }
function tkHtml(t, r, who, extra) { const st = r.status || 'open'; return `<div class='tk2'><span class='bd ${st}'>${STL[st]}</span> <small>${esc(t.cat)} · ${ago(t.at)}${who ? ' · ' + esc(who) : ''}</small><p style='margin:6px 0'>${esc(t.text)}</p>${(r.replies || []).map(x => `<div class='rp'><small>Admin · ${ago(x.at)}</small><br>${esc(x.text)}</div>`).join('')}${extra || ''}</div>`; }
function teamPage() {
    $('#view').innerHTML = `<div class='tp'><div class='head'><div class='logo'>X</div><b>Chat X Team<br><small id='tsub2'></small></b></div><div class='seg'><button data-s='room' class='${tsub === 'room' ? 'on' : ''}'>${ico('chat', 16)} Team room</button><button data-s='prob' class='${tsub === 'prob' ? 'on' : ''}'>${ico('wrench', 16)} My problems</button></div><div id='tban'></div><div id='tbody' style='flex:1;display:flex;flex-direction:column;min-height:0'></div></div>`;
    paintLogo();
    document.querySelectorAll('.seg button').forEach(b => b.onclick = () => { tsub = b.dataset.s; teamPage(); });
    addFab(() => { tsub = 'prob'; teamPage(); setTimeout(() => { const t = $('#pt'); if (t)
        t.focus(); }, 50); });
    paintTeam();
}
function paintTeam() {
    const ban = $('#tban');
    if (!ban)
        return;
    ban.innerHTML = (CFG.banner ? `<div class='ban'>📢 ${esc(CFG.banner)}</div>` : '') + (!DB ? `<div class='ban'>Offline mode: the shared team chat works when this app is opened while signed in to claude.ai. Right now messages stay on this device.</div>` : '') + (DB && !CANW ? `<div class='ban'>You can read but can’t post yet. Ask the admin for Contributor access.</div>` : '');
    $('#tsub2').textContent = DB ? 'Shared with everyone on the team' : 'This device only';
    const body = $('#tbody');
    if (tsub === 'room') {
        if (!$('#tfeed')) {
            body.innerHTML = `<div class='msgs' id='tfeed'></div><form class='comp' id='tf'><input id='ti' placeholder='Message the team…' style='flex:1' autocomplete='off'><button class='btn' type='submit' aria-label='Send'>${ico('send', 18)}</button></form>`;
            $('#tf').onsubmit = e => { e.preventDefault(); sendRoom(); };
        }
        $('#ti').placeholder = CFG.closed && !isAdmin ? 'Room is closed by the admin' : 'Message the team…';
        paintFeed();
    }
    else {
        if (!$('#tlist')) {
            body.innerHTML = `<div class='pg' style='max-width:none'><div class='card'><b>Report a problem</b><label>Category</label><select id='pc' style='width:100%;padding:9px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--text)'>${['Login / account', 'Messages', 'Calls', 'Status', 'Profile / photo', 'Other'].map(x => `<option>${x}</option>`).join('')}</select><label>Describe your problem</label><textarea id='pt' rows='4' style='width:100%'></textarea><br><br><button class='btn' id='ps'>Send to admin</button><div class='muted' style='margin-top:6px'>Only you and the admin can see this.</div></div><h3 style='margin:0 0 8px'>My reports</h3><div id='tlist'></div></div>`;
            $('#ps').onclick = sendProblem;
        }
        $('#tlist').innerHTML = MY.slice().reverse().map(t => tkHtml(t, RESP[t.id] || {})).join('') || `<div class='muted'>No reports yet.</div>`;
    }
}
function paintFeed() {
    const f = $('#tfeed');
    if (!f)
        return;
    const near = f.scrollHeight - f.scrollTop - f.clientHeight < 80, adm = CFG.admins || [], me = uidNow();
    const pins = (CFG.pins || []).map(p => `<div class='tk2' style='text-align:center'>📢 <b>Admin announcement</b><br>${esc(p.text)}<br><small>${ago(p.at)}</small></div>`).join('');
    const ms = TEAM.filter(m => m.text).map(m => { const mine = m.uid === me; return `<div class='m ${mine ? 'me' : 'bot'}'>${mine ? '' : `<small>${esc(m.name || 'User')}${adm.includes(m.uid) ? `<span class='adm'>Admin</span>` : ''}</small>`}${esc(m.text)}</div>`; }).join('');
    f.innerHTML = pins + (ms || `<div class='empty'>${esc(CFG.welcome || 'Welcome to Chat X Team! Say hi, or report a problem from the My problems tab.')}</div>`);
    if (near || !f.dataset.i) {
        f.scrollTop = f.scrollHeight;
        f.dataset.i = 1;
    }
}
async function sendRoom() {
    const i = $('#ti'), t = i.value.trim();
    if (!t)
        return;
    if ((CFG.bans || []).includes(uidNow()))
        return toast('You are blocked from the team room');
    if (CFG.closed && !isAdmin)
        return toast('The team room is closed by the admin');
    if (DB && !CANW)
        return toast('You need Contributor access to post');
    const o = { uid: uidNow(), name: S.me.name, text: t.slice(0, 500), at: Date.now() };
    i.value = '';
    if (DB) {
        try {
            await DB.collection('team').add(o);
        }
        catch (e) {
            toast('Couldn’t send. Try again.');
        }
    }
    else {
        o.id = 'l' + o.at;
        TEAM.push(o);
        LS(LOCALK, JSON.stringify(TEAM.slice(-200)));
        paintFeed();
    }
}
async function sendProblem() {
    const t = $('#pt').value.trim();
    if (!t)
        return toast('Please describe your problem');
    const it = { id: 't' + Date.now(), cat: $('#pc').value, text: t.slice(0, 1000), at: Date.now() }, items = [...MY, it];
    if (DB) {
        if (!UID || !CANW)
            return toast('Sign in to claude.ai with Contributor access to report');
        try {
            await DB.doc('tickets/' + UID).set({ name: S.me.name, items });
            $('#pt').value = '';
            toast('Sent to admin');
        }
        catch (e) {
            toast('Couldn’t send. Try again.');
        }
    }
    else {
        MY = items;
        LS('chatx_my_local_' + curUser, JSON.stringify(MY));
        $('#pt').value = '';
        paintTeam();
        toast('Saved on this device');
    }
}
function allTickets() { const a = []; Object.keys(ALLT).forEach(u => { const d = ALLT[u]; (d.items || []).forEach(t => a.push(Object.assign({}, t, { uid: u, name: d.name, r: (ALLR[u] || {})[t.id] || {} }))); }); return a.sort((x, y) => y.at - x.at); }
async function cfgSet(p) { if (!DB)
    return toast('Admin tools need the shared view'); if (!CFGL)
    return toast('Still loading, try again'); try {
    await DB.doc('config/app').set(Object.assign({}, CFG, p));
}
catch (e) {
    toast('Couldn’t save');
} }
async function respSet(u, t, fn) { const map = Object.assign({}, ALLR[u] || {}), c = Object.assign({ status: 'open' }, map[t]); c.replies = (c.replies || []).slice(); fn(c); map[t] = c; try {
    await DB.doc('resp/' + u).set({ map });
}
catch (e) {
    toast('Couldn’t save');
} }
async function delTicket(u, t) { try {
    const d = ALLT[u];
    await DB.doc('tickets/' + u).set({ name: d.name, items: (d.items || []).filter(i => i.id !== t) });
    const m = Object.assign({}, ALLR[u] || {});
    delete m[t];
    await DB.doc('resp/' + u).set({ map: m });
}
catch (e) {
    toast('Couldn’t delete');
} }
async function clearResolved() { if (!DB)
    return; for (const u of Object.keys(ALLT)) {
    const all = ALLT[u].items || [], keep = all.filter(i => ((ALLR[u] || {})[i.id] || {}).status !== 'resolved');
    if (keep.length !== all.length) {
        try {
            await DB.doc('tickets/' + u).set({ name: ALLT[u].name, items: keep });
            const m = {};
            keep.forEach(i => { if ((ALLR[u] || {})[i.id])
                m[i.id] = ALLR[u][i.id]; });
            await DB.doc('resp/' + u).set({ map: m });
        }
        catch (e) { }
    }
} toast('Cleared resolved reports'); }
async function exportCsv() { const d = await claude.use('downloads'); if (!d)
    return toast('Download isn’t available here'); const q = String.fromCharCode(34), nl = String.fromCharCode(10); const rows = [['Reporter', 'Category', 'Status', 'Created', 'Problem']].concat(allTickets().map(t => [t.name || '', t.cat, t.r.status || 'open', new Date(t.at).toISOString(), t.text])); const csv = rows.map(r => r.map(c => q + String(c).split(q).join(q + q) + q).join(',')).join(nl); try {
    await d.save({ filename: 'chatx-problems.csv', data: new Blob([csv], { type: 'text/csv' }) });
}
catch (e) { } }
function adminPage() {
    if (!isAdmin) {
        yp = null;
        return you();
    }
    $('#view').innerHTML = `<div class='pg' style='max-width:760px'><div style='display:flex;align-items:center;gap:10px;margin-bottom:12px'><button class='ic' id='yb'>←</button><h2 style='margin:0'>🛠 Admin portal</h2></div><div id='adm'></div></div>`;
    $('#yb').onclick = () => { yp = null; you(); };
    paintAdmin();
}
function paintAdmin() {
    const a = $('#adm');
    if (!a)
        return;
    if (!$('#aq')) {
        a.innerHTML = `<div id='ast' class='stats' style='grid-template-columns:repeat(4,1fr)'></div><div class='card'><b>📢 Banner (shown to everyone)</b><div class='add' style='margin-top:6px'><input id='ab1' placeholder='e.g. Maintenance tonight 10 PM' style='flex:1'><button class='btn' id='ab2'>Save</button></div></div><div class='card'><b>📣 Post announcement in Team room</b><div class='add' style='margin-top:6px'><input id='an1' placeholder='Write announcement' style='flex:1'><button class='btn' id='an2'>Post</button></div><div id='apins'></div></div><div class='card'><div class='sr' style='padding:0'><div class='t'><b>Close Team room</b><small>When closed, only admins can post</small></div><label class='sw'><input type='checkbox' id='acl'><i></i></label></div><br><button class='btn g' id='aex'>⬇ Export problems (CSV)</button> <button class='btn red' id='acr'>Clear resolved</button></div><h3>User problems</h3><div class='seg' id='afl' style='padding:0 0 10px;border:0'>${['all', 'open', 'progress', 'resolved'].map(x => `<button data-f='${x}'>${x === 'all' ? 'All' : STL[x]}</button>`).join('')}</div><div id='aq'></div><h3>Blocked users</h3><div id='abn'></div><h3>Recent team messages</h3><div id='amg'></div>`;
        $('#ab2').onclick = () => cfgSet({ banner: $('#ab1').value.trim() });
        $('#an2').onclick = () => { const v = $('#an1').value.trim(); if (!v)
            return; $('#an1').value = ''; cfgSet({ pins: [...(CFG.pins || []), { text: v, at: Date.now() }] }); };
        $('#acl').onchange = e => cfgSet({ closed: e.target.checked });
        $('#aex').onclick = exportCsv;
        $('#acr').onclick = clearResolved;
        $('#afl').onclick = e => { const f = e.target.dataset.f; if (f) {
            admFilter = f;
            paintAdmin();
        } };
        a.onclick = e => {
            const b = e.target.closest('[data-x]');
            if (!b)
                return;
            const x = b.dataset.x, u = b.dataset.u, t = b.dataset.t;
            if (!DB)
                return toast('Admin tools need the shared view');
            if (x === 'st')
                respSet(u, t, c => { c.status = b.dataset.s; });
            else if (x === 'rp') {
                const i = $('#r_' + t), v = i.value.trim();
                if (!v)
                    return;
                respSet(u, t, c => { c.replies.push({ text: v, at: Date.now() }); if (c.status === 'open')
                    c.status = 'progress'; });
                i.value = '';
            }
            else if (x === 'dl')
                delTicket(u, t);
            else if (x === 'bn')
                cfgSet({ bans: [...(CFG.bans || []), u] });
            else if (x === 'ub')
                cfgSet({ bans: (CFG.bans || []).filter(y => y !== u) });
            else if (x === 'dm')
                DB.doc('team/' + t).delete();
            else if (x === 'dp')
                cfgSet({ pins: (CFG.pins || []).filter((p, i) => i !== +b.dataset.i) });
        };
    }
    const T = allTickets(), c = s => T.filter(t => (t.r.status || 'open') === s).length;
    $('#ast').innerHTML = [['Total', T.length], ['Open', c('open')], ['In progress', c('progress')], ['Resolved', c('resolved')]].map(x => `<div><b>${x[1]}</b><small>${x[0]}</small></div>`).join('');
    document.querySelectorAll('#afl button').forEach(b => b.classList.toggle('on', b.dataset.f === admFilter));
    $('#acl').checked = !!CFG.closed;
    if (document.activeElement !== $('#ab1'))
        $('#ab1').value = CFG.banner || '';
    $('#apins').innerHTML = (CFG.pins || []).map((p, i) => `<div class='rp'>${esc(p.text)} <button class='ic' data-x='dp' data-i='${i}'>✕</button></div>`).join('');
    if (!document.activeElement || !$('#aq').contains(document.activeElement)) {
        const L = T.filter(t => admFilter === 'all' || (t.r.status || 'open') === admFilter);
        $('#aq').innerHTML = L.map(t => tkHtml(t, t.r, t.name, `<div class='add' style='margin-top:6px'><input id='r_${t.id}' placeholder='Reply to user' style='flex:1'><button class='ic' data-x='rp' data-u='${esc(t.uid)}' data-t='${t.id}'>Reply</button></div><div style='margin-top:6px'>${['progress', 'resolved', 'open'].map(s => `<button class='ic' data-x='st' data-s='${s}' data-u='${esc(t.uid)}' data-t='${t.id}'>${STL[s]}</button>`).join(' ')} <button class='ic' data-x='dl' data-u='${esc(t.uid)}' data-t='${t.id}'>🗑</button></div>`)).join('') || `<div class='muted'>No reports yet.</div>`;
    }
    $('#abn').innerHTML = (CFG.bans || []).map(u => `<div class='row' style='cursor:default'><div class='t'><b>${esc(nameOf(u))}</b></div><button class='ic' data-x='ub' data-u='${esc(u)}'>Unban</button></div>`).join('') || `<div class='muted'>Nobody is blocked.</div>`;
    $('#amg').innerHTML = TEAM.slice(-20).reverse().map(m => `<div class='row' style='cursor:default'><div class='t'><b>${esc(m.name || 'User')}</b><small>${esc(m.text || '')}</small></div>${(CFG.admins || []).includes(m.uid) ? '' : `<button class='ic' data-x='bn' data-u='${esc(m.uid)}'>🚫</button>`}<button class='ic' data-x='dm' data-t='${m.id}'>🗑</button></div>`).join('') || `<div class='muted'>No messages yet.</div>`;
}
const ICO = {
    chat: `<path d='M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z'/>`,
    group: `<path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'/><circle cx='9' cy='7' r='4'/><path d='M23 21v-2a4 4 0 0 0-3-3.9'/><path d='M16 3.1a4 4 0 0 1 0 7.8'/>`,
    status: `<circle cx='12' cy='12' r='9' stroke-dasharray='3 3'/><circle cx='12' cy='12' r='4'/>`,
    calling: `<path d='M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z'/>`,
    team: `<path d='M3 14v-2a9 9 0 0 1 18 0v2'/><path d='M21 15a2 2 0 0 1-2 2h-1v-5h1a2 2 0 0 1 2 2z'/><path d='M3 15a2 2 0 0 0 2 2h1v-5H5a2 2 0 0 0-2 2z'/><path d='M21 17v1a3 3 0 0 1-3 3h-4'/>`,
    you: `<path d='M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2'/><circle cx='12' cy='7' r='4'/>`,
    phone: `<path d='M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6 19.8 19.8 0 0 1-3.1-8.7A2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z'/>`,
    video: `<path d='m22 8-6 4 6 4V8z'/><rect x='2' y='6' width='14' height='12' rx='2'/>`,
    mic: `<path d='M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z'/><path d='M19 10v2a7 7 0 0 1-14 0v-2'/><line x1='12' y1='19' x2='12' y2='22'/>`,
    send: `<path d='m22 2-7 20-4-9-9-4 20-7z'/><path d='M22 2 11 13'/>`,
    back: `<path d='m15 18-6-6 6-6'/>`,
    x: `<path d='M18 6 6 18'/><path d='m6 6 12 12'/>`,
    pin: `<path d='M12 17v5'/><path d='M9 10.8a2 2 0 0 1-1.1 1.8l-1.8.9A2 2 0 0 0 5 15.2V17h14v-1.8a2 2 0 0 0-1.1-1.8l-1.8-.9A2 2 0 0 1 15 10.8V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z'/>`,
    del: `<path d='M3 6h18'/><path d='M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6'/><path d='M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2'/>`,
    mute: `<path d='M8.7 3A6 6 0 0 1 18 8c0 2.3.5 4.1 1.1 5.4'/><path d='M17 17H3s3-2 3-9a5 5 0 0 1 .3-1.7'/><path d='M10.3 21a2 2 0 0 0 3.4 0'/><path d='m2 2 20 20'/>`,
    arc: `<rect x='2' y='3' width='20' height='5' rx='1'/><path d='M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8'/><path d='M10 12h4'/>`,
    more: `<circle cx='12' cy='5' r='1'/><circle cx='12' cy='12' r='1'/><circle cx='12' cy='19' r='1'/>`,
    acct: `<circle cx='7.5' cy='15.5' r='4.5'/><path d='m10.7 12.3 9.8-9.8'/><path d='m17 6 3 3'/>`,
    priv: `<rect x='3' y='11' width='18' height='11' rx='2'/><path d='M7 11V7a5 5 0 0 1 10 0v4'/>`,
    app: `<circle cx='13.5' cy='6.5' r='1'/><circle cx='17.5' cy='10.5' r='1'/><circle cx='8.5' cy='7.5' r='1'/><circle cx='6.5' cy='12.5' r='1'/><path d='M12 2a10 10 0 0 0 0 20 2 2 0 0 0 2-2c0-.5-.2-1-.5-1.3a1.5 1.5 0 0 1 1.1-2.5H17a5 5 0 0 0 5-5c0-5-4.5-9.2-10-9.2z'/>`,
    admin: `<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'/><path d='m9 12 2 2 4-4'/>`,
    wrench: `<path d='M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.8-3.8a6 6 0 0 1-7.9 7.9l-6.9 6.9a2.1 2.1 0 0 1-3-3l6.9-6.9a6 6 0 0 1 7.9-7.9z'/>`
};
ICO.pen = `<path d='M12 20h9'/><path d='M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z'/>`;
ICO.cam = `<path d='M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z'/><circle cx='12' cy='13' r='4'/>`;
function editProfile() { dlg(`<h3>Edit profile</h3><div style='text-align:center;margin-bottom:10px'>${av(S.me.name)}<br><button class='btn g' id='ep1' style='margin-top:8px'>${ico('cam', 14)} Change photo</button> ${S.me.pic ? `<button class='btn g' id='ep2'>Remove</button>` : ''}</div><label class='muted'>Name</label>${inp('en', 'Name')}<label class='muted'>About</label>${inp('ea', 'About')}${bt('Save')}`, (d, close) => { $('#en').value = S.me.name; $('#ea').value = S.me.about; $('#ep1').onclick = () => { close(); $('#pf').click(); }; const r = $('#ep2'); if (r)
    r.onclick = () => { delete S.me.pic; save(); close(); you(); }; $('#no').onclick = close; $('#ok').onclick = () => { S.me.name = $('#en').value.trim() || 'You'; S.me.about = $('#ea').value.trim(); save(); close(); you(); }; }); }
ICO.plus = `<path d='M12 5v14'/><path d='M5 12h14'/>`;
function addFab(fn) { const v = $('#view'); v.insertAdjacentHTML('beforeend', `<button class='fab' id='fab2' aria-label='New'>${ico('plus', 24)}</button>`); $('#fab2').onclick = fn; }
function newDlg(kind) { const g = kind === 'group'; dlg(`<h3>${g ? 'New group' : 'New chat'}</h3>${inp('nc1', g ? 'Group name' : 'Contact name')}${g ? inp('nc2', 'Members (comma separated)') : ''}${bt('Create')}`, (d, close) => { $('#nc1').focus(); $('#no').onclick = close; $('#ok').onclick = () => { const v = $('#nc1').value.trim(); if (!v)
    return; const c = { id: Date.now(), kind, title: v, msgs: [] }; if (g) {
    c.members = $('#nc2').value.split(',').map(x => x.trim()).filter(Boolean);
    if (!c.members.length)
        c.members = ['Member'];
} S.chats.unshift(c); showArch = false; openId = c.id; save(); close(); render(); }; }); }
const ico = (n, s) => `<svg width='${s || 20}' height='${s || 20}' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'>${ICO[n] || ''}</svg>`;
/* ===== Backend glue: replaces the local demo data layer with the real API ===== */
let ME = null, es = null, syncT = null, lastSet = '', lastMe = '', KNOWN = [], KNOWNST = [], USERNAMES = {};
const PEERPIC = {};
const api = async (m, u, b) => {
    const r = await fetch('/api' + u, { method: m, headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'chatx' }, body: b ? JSON.stringify(b) : undefined });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
        const e = new Error(j.error || 'Something went wrong');
        e.status = r.status;
        throw e;
    }
    return j;
};
pic = n => (S && (n === S.me.name ? S.me.pic : PEERPIC[n])) || null;
nameOf = u => USERNAMES[u] || (TEAM.find(x => x.uid === u) || {}).name || ('User ' + u);
const peerLine = c => { const p = c.peer; if (!p)
    return ''; if (p.online)
    return '<br><small>online</small>'; if (p.seen)
    return `<br><small>last seen ${ago(p.seen)}</small>`; return ''; };
tick = (c, i) => { const m = c.msgs[i]; if (c.kind === 'group' || !m || !m.id)
    return `<span class='tk'>\u2713</span>`; const rd = (S.set || {}).read !== false && c.peerRead >= m.id; return `<span class='tk ${rd ? 'rd' : ''}'>\u2713\u2713</span>`; };
const flags = c => JSON.stringify([!!c.pin, !!c.mute, !!c.arch, !!c.fav, !!c.lock, !!c.unread, c.lists || []]);
const mapMsg = (m, c) => ({ id: m.id, r: m.sender === ME.id ? 'me' : 'bot', t: m.text || (m.audio ? undefined : '(message removed)'), a: m.audio || undefined, n: c.kind === 'group' && m.sender !== ME.id ? m.name : undefined, at: m.at, x: m.exp || undefined });
function applyChat(c, v) {
    c.title = v.title;
    c.pin = v.pin;
    c.mute = v.mute;
    c.arch = v.arch;
    c.fav = v.fav;
    c.lock = v.lock;
    c._ur = v.unread;
    c.unread = v.unread > 0;
    c.lists = v.lists;
    if (v.members) {
        c.members = v.members.map(x => x.name);
        c.memberIds = v.members.map(x => x.id);
    }
    if (v.peer) {
        c.peer = v.peer;
        if (v.peer.avatar)
            PEERPIC[v.title] = v.peer.avatar;
        else
            delete PEERPIC[v.title];
        c.blocked = v.blocked;
    }
    c.peerRead = v.peerRead || 0;
    if (!c._loaded)
        c.msgs = v.last ? [mapMsg(v.last, c)] : [];
    c._n = c.msgs.length;
    c._b = !!c.blocked;
    c._f = flags(c);
}
function mkChat(v) { const c = { id: v.id, kind: v.type === 'group' ? 'group' : 'dm', title: v.title, msgs: [], _loaded: false }; applyChat(c, v); return c; }
async function loadChats() {
    const list = await api('GET', '/chats'), old = new Map(S.chats.map(c => [c.id, c]));
    S.chats = list.map(v => { const c = old.get(v.id); if (c) {
        applyChat(c, v);
        return c;
    } return mkChat(v); });
    KNOWN = S.chats.map(c => c.id);
    updTitle();
}
const updTitle = () => { const n = S.chats.reduce((a, c) => a + (c.mute ? 0 : (c._ur || 0)), 0); document.title = (n ? `(${n}) ` : '') + 'Chat X'; };
async function loadMsgs(c) { const r = await api('GET', '/chats/' + c.id + '/messages?limit=100'); c.msgs = r.messages.map(m => mapMsg(m, c)); c.peerRead = r.peerRead || 0; c._loaded = true; c._n = c.msgs.length; }
function markRead(c) { if (!c._ur)
    return; c._ur = 0; c.unread = false; c._f = flags(c); updTitle(); api('POST', '/chats/' + c.id + '/read', {}).catch(() => { }); }
const inChats = () => tab === 'chat' || tab === 'group';
/* ---- keep the draft and the search text when the UI redraws from live events ---- */
const _convo = convo;
convo = function () {
    const c = S.chats.find(x => x.id === openId), i0 = $('#in'), draft = i0 ? i0.value : '', foc = !!i0 && document.activeElement === i0;
    if (c && !c._loaded && !c._loading && (!c.lock || unl.has(c.id))) {
        c._loading = true;
        loadMsgs(c).then(() => { c._loading = false; if (openId === c.id)
            convo(); }).catch(e => { c._loading = false; toast(e.message); });
    }
    _convo();
    if (draft) {
        const i = $('#in');
        if (i) {
            i.value = draft;
            i.style.height = 'auto';
            i.style.height = i.scrollHeight + 'px';
            if (foc)
                i.focus();
        }
    }
    if (c && c._ur && c._loaded && (!c.lock || unl.has(c.id)) && !document.hidden)
        markRead(c);
};
const _split = split;
split = function (kind) {
    const n0 = $('#nn'), v = n0 ? n0.value : '', had = !!n0 && document.activeElement === n0;
    _split(kind);
    if (v) {
        const n = $('#nn');
        n.value = v;
        n.oninput();
        if (had)
            n.focus();
    }
};
document.addEventListener('visibilitychange', () => { if (!document.hidden && inChats() && openId)
    convo(); });
/* ---- sending ---- */
async function send(c, t, a) {
    try {
        const m = await api('POST', '/chats/' + c.id + '/messages', a ? { audio: a } : { text: t });
        if (!c.msgs.some(x => x.id === m.id)) {
            c.msgs.push(mapMsg(m, c));
            c._n = c.msgs.length;
        }
        S.chats = [c, ...S.chats.filter(x => x !== c)];
        if (openId === c.id)
            convo();
        else
            render();
    }
    catch (e) {
        toast(e.message);
        const i = $('#in');
        if (i && !i.value && t)
            i.value = t;
    }
}
function onMsg(d) {
    const c = S.chats.find(x => x.id === d.chat);
    if (!c) {
        loadChats().then(() => { if (inChats())
            render(); });
        return;
    }
    const m = mapMsg(d.msg, c);
    if (c.msgs.some(x => x.id === m.id))
        return;
    c.msgs.push(m);
    c._n = c.msgs.length;
    S.chats = [c, ...S.chats.filter(x => x !== c)];
    if (m.r === 'bot') {
        c._ur = (c._ur || 0) + 1;
        c.unread = true;
        c._f = flags(c);
    }
    updTitle();
    if (inChats())
        render();
}
/* ---- saving: the chat PIN stays on this device, everything else is synced to the server ---- */
save = function () {
    try {
        localStorage.setItem('cx_pin_' + (ME && ME.id), JSON.stringify({ pin: S.pin || null }));
    }
    catch (e) { }
    clearTimeout(syncT);
    syncT = setTimeout(syncNow, 250);
};
async function syncNow() {
    if (!ME)
        return;
    try {
        const sj = JSON.stringify(S.set || {});
        if (sj !== lastSet) {
            lastSet = sj;
            await api('PATCH', '/me', { settings: S.set || {} });
        }
        const mj = JSON.stringify([S.me.name, S.me.about, S.me.pic || null]);
        if (mj !== lastMe) {
            lastMe = mj;
            ME = await api('PATCH', '/me', { name: S.me.name, about: S.me.about, avatar: S.me.pic || null });
        }
        for (const c of S.chats) {
            const f = flags(c);
            if (c._f !== f) {
                c._f = f;
                api('PATCH', '/chats/' + c.id, { pin: !!c.pin, mute: !!c.mute, arch: !!c.arch, fav: !!c.fav, lock: !!c.lock, unread: !!c.unread, lists: c.lists || [] }).catch(() => { });
            }
            if (c.peer && !!c.blocked !== c._b) {
                c._b = !!c.blocked;
                (c.blocked ? api('POST', '/blocks', { user: c.peer.id }) : api('DELETE', '/blocks/' + c.peer.id)).catch(() => { });
            }
            if (c.msgs.length === 0 && c._n > 0) {
                c._n = 0;
                api('DELETE', '/chats/' + c.id + '/messages').catch(() => { });
            }
        }
        const ids = S.chats.map(c => c.id);
        for (const id of KNOWN)
            if (!ids.includes(id))
                api('DELETE', '/chats/' + id).catch(() => { });
        KNOWN = ids;
        for (const s of S.mine)
            if (!s.id && !s._p) {
                s._p = 1;
                api('POST', '/status', { text: s.t }).then(r => { s.id = r.id; KNOWNST.push(r.id); }).catch(e => toast(e.message));
            }
        const mids = S.mine.filter(s => s.id).map(s => s.id);
        for (const id of KNOWNST)
            if (!mids.includes(id))
                api('DELETE', '/status/' + id).catch(() => { });
        KNOWNST = mids;
    }
    catch (e) {
        toast(e.message);
    }
}
window.addEventListener('pagehide', () => { if (ME)
    syncNow(); });
/* ---- status & call history ---- */
async function loadStatus() {
    const r = await api('GET', '/status');
    S.mine = [...S.mine.filter(s => !s.id), ...r.filter(x => x.mine).map(x => ({ id: x.id, t: x.text, at: x.at }))];
    S.status = r.filter(x => !x.mine).map(x => ({ who: x.name, t: x.text, at: x.at }));
    KNOWNST = S.mine.filter(s => s.id).map(s => s.id);
}
const _status = status;
status = function () { _status(); loadStatus().then(() => { if (tab === 'status')
    _status(); }).catch(() => { }); };
async function loadCalls() { S.calls = (await api('GET', '/calls')).map(c => ({ who: c.who, type: c.type, video: c.video, dur: c.dur, at: c.at })); }
const _calling = calling;
calling = function () { _calling(); loadCalls().then(() => { if (tab === 'calling')
    _calling(); }).catch(() => { }); };
/* ---- new chat / group: search real people ---- */
function newDlg(kind) {
    const g = kind === 'group', picked = new Map();
    dlg(`<h3>${g ? 'New group' : 'New chat'}</h3>${g ? inp('gn', 'Group name') : ''}${inp('us', g ? 'Search people to add' : 'Search by name, email or phone')}<div id='ur' style='max-height:240px;overflow:auto'></div>${g ? `<div id='gp' class='muted' style='margin-top:6px'></div>${bt('Create')}` : `<div class='bt'><button class='btn g' id='no'>Close</button></div>`}`, (d, close) => {
        $('#no').onclick = close;
        let t;
        const paintPicked = () => { const e = $('#gp'); if (e)
            e.textContent = picked.size ? 'Added: ' + [...picked.values()].join(', ') : 'Pick at least one person'; };
        if (g)
            paintPicked();
        $('#us').oninput = () => {
            clearTimeout(t);
            t = setTimeout(async () => {
                const v = $('#us').value.trim();
                if (v.length < 2) {
                    $('#ur').innerHTML = '';
                    return;
                }
                try {
                    const r = await api('GET', '/users?q=' + encodeURIComponent(v));
                    r.forEach(u => { if (u.avatar)
                        PEERPIC[u.name] = u.avatar; });
                    $('#ur').innerHTML = r.map(u => `<button class='row' data-u='${u.id}' data-n='${esc(u.name)}'>${av(u.name)}<div class='t'><b>${esc(u.name)}</b><small>${esc(u.about || '')}</small></div></button>`).join('') || `<div class='muted' style='padding:8px'>No one found. They need to sign up first.</div>`;
                    d.querySelectorAll('#ur [data-u]').forEach(b => b.onclick = async () => {
                        const id = +b.dataset.u;
                        if (g) {
                            picked.has(id) ? picked.delete(id) : picked.set(id, b.dataset.n);
                            paintPicked();
                            return;
                        }
                        try {
                            const c = await api('POST', '/chats', { type: 'dm', user: id });
                            await loadChats();
                            close();
                            openId = c.id;
                            showArch = false;
                            render();
                        }
                        catch (e) {
                            toast(e.message);
                        }
                    });
                }
                catch (e) {
                    toast(e.message);
                }
            }, 250);
        };
        if (g)
            $('#ok').onclick = async () => {
                const n = $('#gn').value.trim();
                if (!n)
                    return toast('Enter a group name');
                if (!picked.size)
                    return toast('Pick at least one person');
                try {
                    const c = await api('POST', '/chats', { type: 'group', title: n, members: [...picked.keys()] });
                    await loadChats();
                    close();
                    openId = c.id;
                    showArch = false;
                    render();
                    if (c.skipped && c.skipped.length)
                        toast('Not added (privacy settings): ' + c.skipped.join(', '));
                }
                catch (e) {
                    toast(e.message);
                }
            };
    });
}
/* ---- real voice/video calls (WebRTC, signalled through the server) ---- */
const ICE = { iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] };
let pc = null, lstream = null, peerId = null, peerName = '', callVideo = false, pendingIce = [], callStart = 0, callRole = '', ringTimer = null, ctTimer = null, incoming = null;
function callUI(name, video, status, inc) {
    const el = $('#call');
    el.className = 'on';
    const fx = video && (S.set || {}).camfx !== false ? `<div id='fx' style='margin-top:8px'>${[['none', 'None'], ['grayscale(1)', 'Mono'], ['sepia(.8)', 'Warm'], ['hue-rotate(180deg)', 'Cool'], ['saturate(2.2)', 'Vivid'], ['blur(4px)', 'Blur']].map(f => `<button class='ic' data-f='${f[0]}' style='color:#fff;margin:2px'>${f[1]}</button>`).join('')}</div>` : '';
    el.innerHTML = `${av(name)}<h2 style='margin:0'>${esc(name)}</h2><div id='ct'>${status}</div><div style='position:relative;width:min(92vw,420px);display:${video ? 'block' : 'none'}'><video id='rv' autoplay playsinline style='width:100%;border-radius:14px;background:#000'></video><video id='sv' autoplay muted playsinline style='position:absolute;right:8px;bottom:8px;width:28%;border-radius:10px;background:#000'></video></div><audio id='ra' autoplay></audio>${fx}<div style='display:flex;gap:10px;margin-top:10px'>${inc ? `<button class='btn' id='acc' style='background:#22c55e'>${ico('phone', 16)} Accept</button>` : ''}<button class='btn red' id='en'>${inc ? 'Decline' : 'End call'}</button></div>`;
    document.querySelectorAll('#fx button').forEach(b => b.onclick = () => { const v = $('#sv'); if (v)
        v.style.filter = b.dataset.f; });
}
const sig = (kind, data, video) => api('POST', '/signal', { to: peerId, kind, data, video });
function mkPc() {
    pc = new RTCPeerConnection(ICE);
    pendingIce = [];
    pc.onicecandidate = e => { if (e.candidate && peerId)
        sig('ice', e.candidate).catch(() => { }); };
    pc.ontrack = e => { const s = e.streams[0], v = $('#rv'), a = $('#ra'); if (v)
        v.srcObject = s; if (a)
        a.srcObject = s; };
    pc.onconnectionstatechange = () => {
        if (!pc)
            return;
        if (pc.connectionState === 'connected' && !callStart) {
            callStart = Date.now();
            clearTimeout(ringTimer);
            ctTimer = setInterval(() => { const t = $('#ct'); if (t) {
                const s = Math.floor((Date.now() - callStart) / 1000);
                t.textContent = String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');
            } }, 1000);
        }
        if (pc.connectionState === 'failed')
            endCall(true);
    };
}
function flushIce() { pendingIce.forEach(c => pc.addIceCandidate(c).catch(() => { })); pendingIce = []; }
async function getMedia(video) { return navigator.mediaDevices.getUserMedia({ audio: true, video: video }); }
function cleanup() {
    clearTimeout(ringTimer);
    clearInterval(ctTimer);
    if (pc) {
        try {
            pc.close();
        }
        catch (e) { }
        pc = null;
    }
    if (lstream) {
        lstream.getTracks().forEach(t => t.stop());
        lstream = null;
    }
    incoming = null;
    callStart = 0;
    pendingIce = [];
    peerId = null;
    callRole = '';
    $('#call').className = '';
    if (tab === 'calling')
        calling();
}
function endCall(notify, status) {
    const dur = callStart ? Math.round((Date.now() - callStart) / 1000) : 0;
    if (notify && peerId)
        sig('end').catch(() => { });
    if (callRole === 'out' && peerId)
        api('POST', '/calls', { peer: peerId, video: callVideo, status: callStart ? 'answered' : (status || 'missed'), dur }).catch(() => { });
    cleanup();
}
async function rtcCall(id, name, video) {
    if (pc || incoming)
        return toast('You are already in a call');
    peerId = id;
    peerName = name;
    callVideo = video;
    callRole = 'out';
    callUI(name, video, video ? 'Video calling\u2026' : 'Calling\u2026');
    $('#en').onclick = () => endCall(true, 'missed');
    try {
        lstream = await getMedia(video);
    }
    catch (e) {
        cleanup();
        return toast('Please allow the microphone' + (video ? ' and camera' : '') + ' to make calls');
    }
    const sv = $('#sv');
    if (sv)
        sv.srcObject = lstream;
    try {
        mkPc();
        lstream.getTracks().forEach(t => pc.addTrack(t, lstream));
        await pc.setLocalDescription(await pc.createOffer());
        await sig('offer', pc.localDescription, video);
        ringTimer = setTimeout(() => { if (callRole === 'out' && !callStart) {
            toast('No answer');
            endCall(true, 'missed');
        } }, 45000);
    }
    catch (e) {
        const off = e.message === 'offline';
        cleanup();
        toast(off ? name + ' is offline right now' : e.message);
    }
}
function startCall(who, video) {
    const c = S.chats.find(x => x.kind === 'dm' && x.title === who && x.peer);
    if (c)
        return rtcCall(c.peer.id, who, !!video);
    api('GET', '/users?q=' + encodeURIComponent(who)).then(async (r) => {
        const u = r.find(x => x.name.toLowerCase() === String(who).toLowerCase()) || r[0];
        if (!u)
            return toast('No one found. Ask them to sign up first.');
        await api('POST', '/chats', { type: 'dm', user: u.id });
        await loadChats();
        rtcCall(u.id, u.name, !!video);
    }).catch(e => toast(e.message));
}
async function acceptCall() {
    const d = incoming;
    incoming = null;
    callUI(peerName, callVideo, 'Connecting\u2026');
    $('#en').onclick = () => endCall(true);
    try {
        lstream = await getMedia(callVideo);
    }
    catch (e) {
        sig('decline').catch(() => { });
        cleanup();
        return toast('Please allow the microphone' + (callVideo ? ' and camera' : '') + ' to answer calls');
    }
    const sv = $('#sv');
    if (sv)
        sv.srcObject = lstream;
    try {
        mkPc();
        lstream.getTracks().forEach(t => pc.addTrack(t, lstream));
        await pc.setRemoteDescription(d.data);
        flushIce();
        await pc.setLocalDescription(await pc.createAnswer());
        await sig('answer', pc.localDescription);
    }
    catch (e) {
        toast(e.message);
        endCall(true);
    }
}
function onSignal(d) {
    const k = d.kind, from = d.from.id;
    if (k === 'offer') {
        if (pc || incoming) {
            api('POST', '/signal', { to: from, kind: 'busy' }).catch(() => { });
            return;
        }
        incoming = d;
        peerId = from;
        peerName = d.from.name;
        callVideo = d.video;
        callRole = 'in';
        pendingIce = [];
        callUI(peerName, callVideo, callVideo ? 'Incoming video call\u2026' : 'Incoming call\u2026', true);
        $('#acc').onclick = acceptCall;
        $('#en').onclick = () => { sig('decline').catch(() => { }); cleanup(); };
        ringTimer = setTimeout(() => { if (incoming) {
            sig('decline').catch(() => { });
            cleanup();
        } }, 45000);
        return;
    }
    if (from !== peerId)
        return;
    if (k === 'answer' && pc && callRole === 'out') {
        clearTimeout(ringTimer);
        pc.setRemoteDescription(d.data).then(flushIce).catch(() => { });
    }
    else if (k === 'ice') {
        pc && pc.remoteDescription ? pc.addIceCandidate(d.data).catch(() => { }) : pendingIce.push(d.data);
    }
    else if (k === 'end' || k === 'decline' || k === 'busy') {
        const out = callRole === 'out', dur = callStart ? Math.round((Date.now() - callStart) / 1000) : 0, answered = !!callStart;
        toast(k === 'busy' ? 'User is busy' : k === 'decline' ? 'Call declined' : 'Call ended');
        if (out)
            api('POST', '/calls', { peer: peerId, video: callVideo, status: answered ? 'answered' : (k === 'decline' ? 'declined' : 'missed'), dur }).catch(() => { });
        cleanup();
    }
}
/* ---- team room, problem reports and admin portal (served by the API) ---- */
async function loadTeam() {
    try {
        const r = await api('GET', '/team');
        TEAM = r.messages;
        CFG = r.config;
        if (ME.admin) {
            const us = await api('GET', '/admin/users');
            USERNAMES = {};
            us.forEach(u => { USERNAMES[String(u.id)] = u.name; });
            CFG.bans = us.filter(u => u.banned).map(u => String(u.id));
        }
        refreshTeam();
    }
    catch (e) { }
}
async function loadTickets() {
    try {
        const mine = await api('GET', '/tickets');
        MY = mine.map(t => ({ id: t.id, cat: t.cat, text: t.text, at: t.at }));
        RESP = {};
        mine.forEach(t => { RESP[t.id] = { status: t.status, replies: t.replies }; });
        if (ME.admin) {
            const all = await api('GET', '/tickets?all=1');
            ALLT = {};
            ALLR = {};
            all.forEach(t => { (ALLT[t.uid] = ALLT[t.uid] || { name: t.name, items: [] }).items.push({ id: t.id, cat: t.cat, text: t.text, at: t.at }); (ALLR[t.uid] = ALLR[t.uid] || {})[t.id] = { status: t.status, replies: t.replies }; });
        }
        refreshTeam();
    }
    catch (e) { }
}
async function initDb() {
    DB = { doc: p => ({ delete: () => api('DELETE', '/admin/messages/' + p.split('/')[1]).catch(e => toast(e.message)) }) };
    isAdmin = !!ME.admin;
    UID = String(ME.id);
    CANW = true;
    CFGL = true;
    await Promise.all([loadTeam(), loadTickets()]);
    if (tab === 'you' && !yp)
        you();
}
async function sendRoom() { const i = $('#ti'), t = i.value.trim(); if (!t)
    return; i.value = ''; try {
    await api('POST', '/team/messages', { text: t });
}
catch (e) {
    i.value = t;
    toast(e.message);
} }
async function sendProblem() { const t = $('#pt').value.trim(); if (!t)
    return toast('Please describe your problem'); try {
    await api('POST', '/tickets', { cat: $('#pc').value, text: t });
    $('#pt').value = '';
    toast('Sent to admin');
    loadTickets();
}
catch (e) {
    toast(e.message);
} }
async function cfgSet(p) {
    try {
        if (p.bans) {
            const cur = CFG.bans || [];
            for (const id of p.bans.filter(x => !cur.includes(x)))
                await api('POST', '/admin/users/' + id + '/ban', { banned: true });
            for (const id of cur.filter(x => !p.bans.includes(x)))
                await api('POST', '/admin/users/' + id + '/ban', { banned: false });
        }
        const c = {};
        ['banner', 'welcome', 'closed', 'pins'].forEach(k => { if (p[k] !== undefined)
            c[k] = p[k]; });
        if (Object.keys(c).length)
            await api('POST', '/admin/config', c);
        await loadTeam();
    }
    catch (e) {
        toast(e.message);
    }
}
async function respSet(u, t, fn) {
    const cur = (ALLR[u] || {})[t] || { status: 'open', replies: [] }, c = { status: cur.status, replies: (cur.replies || []).slice() };
    fn(c);
    const body = {};
    if (c.status !== cur.status)
        body.status = c.status;
    if (c.replies.length > (cur.replies || []).length)
        body.reply = c.replies[c.replies.length - 1].text;
    if (!Object.keys(body).length)
        return;
    try {
        await api('PATCH', '/tickets/' + t, body);
    }
    catch (e) {
        toast(e.message);
    }
}
async function delTicket(u, t) { try {
    await api('DELETE', '/tickets/' + t);
}
catch (e) {
    toast(e.message);
} }
async function clearResolved() { try {
    const r = await api('POST', '/admin/tickets/clear-resolved', {});
    toast('Cleared ' + r.removed + ' resolved reports');
}
catch (e) {
    toast(e.message);
} }
function exportCsv() { const a = document.createElement('a'); a.href = '/api/admin/tickets.csv'; a.download = 'chatx-problems.csv'; document.body.appendChild(a); a.click(); a.remove(); }
/* ---- account settings that need the server ---- */
function ACTX(set, rr) {
    return {
        pw() { dlg(`<h3>Change password</h3>${inp('p0', 'Current password', 'password')}${inp('p1', 'New password (min 6)', 'password')}${inp('p2', 'Confirm new password', 'password')}<div class='aerr' id='pe'></div>${bt('Update')}`, (d, close) => { $('#no').onclick = close; $('#ok').onclick = async () => { const e = m => { $('#pe').textContent = m; }; if ($('#p1').value.length < 6)
            return e('Minimum 6 characters'); if ($('#p1').value !== $('#p2').value)
            return e('Passwords don\u2019t match'); try {
            await api('POST', '/me/password', { old: $('#p0').value, new: $('#p1').value });
            close();
            toast('Password changed');
        }
        catch (x) {
            e(x.message);
        } }; }); },
        chg() { dlg(`<h3>Change phone number or email</h3>${inp('c1', 'New phone number or email')}${inp('c2', 'Current password', 'password')}<div class='aerr' id='ce'></div>${bt('Change')}`, (d, close) => { $('#no').onclick = close; $('#ok').onclick = async () => { try {
            ME = await api('POST', '/me/login', { login: $('#c1').value.trim(), password: $('#c2').value });
            close();
            rr();
            toast('Updated');
        }
        catch (x) {
            $('#ce').textContent = x.message;
        } }; }); },
        link() { try {
            navigator.clipboard.writeText(location.origin).then(() => toast('Invite link copied'), () => toast(location.origin));
        }
        catch (_) {
            toast(location.origin);
        } },
        del() { dlg(`<h3>Delete account</h3><p class='muted'>This permanently removes your account, chats and reports. Enter your password to confirm.</p>${inp('dp', 'Password', 'password')}<div class='aerr' id='de'></div><div class='bt'><button class='btn g' id='no'>Cancel</button><button class='btn red' id='ok'>Delete</button></div>`, (d, close) => { $('#no').onclick = close; $('#ok').onclick = async () => { try {
            await api('DELETE', '/me', { password: $('#dp').value });
            close();
            await logout();
        }
        catch (x) {
            $('#de').textContent = x.message;
        } }; }); }
    };
}
/* ---- sign in / sign up screen, session handling ---- */
function showAuth(mode) {
    const su = mode === 'signup', a = $('#auth');
    a.className = 'on';
    a.innerHTML = `<div class="acard"><div class="logo" style="margin:0 auto 12px;width:56px;height:56px;font-size:26px;border-radius:16px">X</div><h2 style="margin:0">${su ? 'Create account' : 'Welcome back'}</h2><p class="muted" style="margin:4px 0 14px">${su ? 'Sign up to start chatting on Chat X' : 'Log in to continue to Chat X'}</p>${su ? '<input id="an" placeholder="Your name" autocomplete="name" maxlength="40">' : ''}<input id="ae" placeholder="Email or phone" autocomplete="username"><input id="ap" type="password" placeholder="Password (min 6 characters)" autocomplete="${su ? 'new-password' : 'current-password'}"><div id="aerr" class="aerr"></div><button class="btn" id="ago" style="width:100%">${su ? 'Sign up' : 'Log in'}</button><p class="muted" style="margin:14px 0 4px">${su ? 'Already have an account?' : 'New to Chat X?'} <button class="lnk" id="asw">${su ? 'Log in' : 'Sign up'}</button></p></div>`;
    paintLogo();
    const err = m => { $('#aerr').textContent = m; };
    $('#asw').onclick = () => showAuth(su ? 'login' : 'signup');
    const go = async () => {
        const login = $('#ae').value.trim(), pw = $('#ap').value, nm = su ? $('#an').value.trim() : '';
        if (su && !nm)
            return err('Please enter your name');
        if (login.length < 5)
            return err('Enter a valid email or phone');
        if (pw.length < 6)
            return err('Password must be at least 6 characters');
        $('#ago').disabled = true;
        try {
            const me = await api('POST', su ? '/register' : '/login', su ? { login, name: nm, password: pw } : { login, password: pw });
            await enter(me);
        }
        catch (e) {
            err(e.message);
            $('#ago').disabled = false;
        }
    };
    $('#ago').onclick = go;
    $('#ap').onkeydown = e => { if (e.key === 'Enter')
        go(); };
}
async function enter(me, restore) {
    ME = me;
    curUser = String(me.id);
    S = { chats: [], status: [], mine: [], calls: [], me: { name: me.name, about: me.about, pic: me.avatar || undefined }, set: me.settings || {} };
    try {
        S.pin = JSON.parse(localStorage.getItem('cx_pin_' + me.id) || '{}').pin || undefined;
    }
    catch (e) { }
    lastSet = JSON.stringify(S.set);
    lastMe = JSON.stringify([S.me.name, S.me.about, S.me.pic || null]);
    $('#auth').className = '';
    applyAll();
    try {
        await loadChats();
    }
    catch (e) {
        toast(e.message);
    }
    tab = 'chat';
    openId = null;
    render();
    startSSE();
    initDb();
    if (restore && S.set.appPin)
        showLock();
    if (!restore && S.set.secnote)
        setTimeout(() => toast('Security alert: new login on this device'), 700);
}
async function logout() {
    try {
        await api('POST', '/logout', {});
    }
    catch (e) { }
    if (es) {
        es.close();
        es = null;
    }
    if (pc || incoming)
        cleanup();
    ME = null;
    curUser = null;
    S = seed();
    tab = 'chat';
    yp = null;
    openId = null;
    sel.clear();
    unl.clear();
    showArch = false;
    DB = null;
    isAdmin = false;
    UID = null;
    TEAM = [];
    CFG = {};
    MY = [];
    RESP = {};
    ALLT = {};
    ALLR = {};
    USERNAMES = {};
    $('#alock').className = '';
    document.title = 'Chat X';
    applyAll();
    showAuth('login');
}
function startSSE() {
    if (es)
        es.close();
    es = new EventSource('/api/events');
    const on = (n, f) => es.addEventListener(n, e => { try {
        f(JSON.parse(e.data));
    }
    catch (x) { } });
    on('message', onMsg);
    on('chat', () => loadChats().then(() => { if (inChats())
        render(); }));
    on('read', d => { const c = S.chats.find(x => x.id === d.chat); if (c) {
        c.peerRead = Math.max(c.peerRead || 0, d.upto);
        if (openId === c.id && inChats())
            convo();
    } });
    on('presence', d => { S.chats.forEach(c => { if (c.peer && c.peer.id === d.user) {
        c.peer.online = d.online;
        if (d.seen)
            c.peer.seen = d.seen;
        if (openId === c.id && inChats())
            convo();
    } }); });
    on('status', () => { if (tab === 'status')
        status(); });
    on('calls', () => { if (tab === 'calling')
        calling(); });
    on('signal', onSignal);
    on('team', d => { if (d.deleted)
        TEAM = TEAM.filter(m => m.id !== String(d.deleted));
    else if (!TEAM.some(m => m.id === d.msg.id))
        TEAM.push(d.msg); refreshTeam(); });
    on('config', loadTeam);
    on('ticket', loadTickets);
    es.onerror = () => { if (ME)
        api('GET', '/me').catch(e => { if (e.status === 401) {
            es.close();
            toast('Session expired. Please log in again.');
            logout();
        } }); };
}
(async () => {
    try {
        const me = await api('GET', '/me');
        await enter(me, true);
    }
    catch (e) {
        showAuth('login');
    }
})();
