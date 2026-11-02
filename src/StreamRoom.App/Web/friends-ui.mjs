import { showAvatar } from './profile-ui.mjs';

export function createFriendsUi(native, changed) {
  const $ = id => document.getElementById(id), dialog = $('friendsDialog');
  let friends = [], peers = [], self, busy = false;
  let results=[],searching=false;
  const element = (tag, className, text) => { const e = document.createElement(tag); e.className = className; if (text !== undefined) e.textContent = text; return e; };
  const has = id => Boolean(id) && friends.some(f => f.profileId === id);
  function draw() {
    $('friendsCount').textContent = String(friends.length);
    $('friendsEmpty').hidden = friends.length > 0;
    $('friendsList').replaceChildren(...friends.map(friend => {
      const current = peers.find(p => p.profileId === friend.profileId && p.id !== self), person = current ?? friend;
      const row = element('li','friend-item'), avatar = element('span','avatar'), copy = element('div','friend-copy');
      showAvatar(avatar, person.name, person.avatar);
      copy.append(element('strong','',person.name), element('small', current ? 'friend-present' : '', current ? 'Nesta sala' : 'Salvo neste PC'));
      const remove = element('button','quiet friend-remove','Remover'); remove.disabled = busy; remove.setAttribute('aria-label','Remover ' + person.name + ' dos amigos');
      remove.addEventListener('click', () => run(async () => { friends = await native('friendRemove', { profileId: friend.profileId }); }));
      row.append(avatar,copy,remove); return row;
    }));
    $('friendsRoomList').replaceChildren(...peers.filter(p => p.id !== self).map(peer => {
      const row = element('li','friend-item'), avatar = element('span','avatar'), copy = element('div','friend-copy');
      showAvatar(avatar, peer.name, peer.avatar); copy.append(element('strong','',peer.name), element('small','',has(peer.profileId) ? 'Já está na sua lista' : 'Participante desta sala'));
      row.append(avatar,copy,actionFor(peer, true)); return row;
    }));
    $('friendsRoomEmpty').hidden = peers.some(p => p.id !== self);
    $('peopleResults').replaceChildren(...results.map(person=>{
      const row=element('li','friend-item'),avatar=element('span','avatar'),copy=element('div','friend-copy');showAvatar(avatar,person.name,person.avatar);
      const identifier=element('small','', 'ID '+person.id.slice(0,8)+'…'+person.id.slice(-4));identifier.title=person.id;
      copy.append(element('strong','',person.name),identifier);
      const button=element('button','quiet friend-save',has(person.id)?'Salvo':'Adicionar');button.disabled=busy||has(person.id);
      button.addEventListener('click',()=>run(async()=>{friends=await native('peopleAdd',{id:person.id});}));row.append(avatar,copy,button);return row;
    }));
  }
  async function run(action) {
    if (busy) return; busy = true; $('friendsFeedback').textContent = ''; draw();
    try { await action(); }
    catch (error) { $('friendsFeedback').textContent = error.message; }
    finally { busy = false; draw(); changed(); }
  }
  function actionFor(peer, full = false) {
    const saved = has(peer.profileId), action = element('button','quiet friend-save',full ? saved ? 'Salvo' : 'Salvar amigo' : saved ? '✓' : '+');
    action.disabled = busy || saved || !peer.profileId;
    action.title = !peer.profileId ? 'Este participante precisa atualizar o StreamRoom.' : saved ? 'Amigo salvo neste PC' : 'Salvar ' + peer.name + ' como amigo';
    action.setAttribute('aria-label', action.title);
    action.addEventListener('click', () => run(async () => { friends = await native('friendSave', { participantId: peer.id }); })); return action;
  }
  $('showFriends').addEventListener('click', () => { draw(); dialog.showModal(); });
  $('friendsClose').addEventListener('click', () => dialog.close());
  async function search(){
    if(searching)return;const query=$('peopleQuery').value.trim();if(query.length<2){$('peopleSearchFeedback').textContent='Digite pelo menos 2 caracteres.';return;}
    searching=true;$('peopleSearch').disabled=true;$('peopleSearchFeedback').textContent='Buscando…';results=[];draw();
    try{results=await native('peopleSearch',{query});$('peopleSearchFeedback').textContent=results.length?results.length+' pessoa(s) encontrada(s).':'Nenhuma pessoa encontrada. Peça ao amigo para ativar a busca pública no perfil.';}
    catch(error){$('peopleSearchFeedback').textContent=error.message;}
    finally{searching=false;$('peopleSearch').disabled=false;draw();}
  }
  $('peopleSearch').addEventListener('click',search);$('peopleQuery').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();void search();}});
  return {
    async start() { try { friends = await native('friendsStatus'); } catch (error) { $('friendsFeedback').textContent = error.message; } draw(); },
    update(value, participantId) { peers = value; self = participantId; draw(); }, actionFor
  };
}
