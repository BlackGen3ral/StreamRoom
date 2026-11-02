export function createWelcomeUi(native,onCompleted) {
  const $=id=>document.getElementById(id);let busy=false,available=false;
  function controls() {
    $('welcomeGoogle').disabled=busy||!available;$('welcomeGuest').disabled=busy;$('welcomeCancel').hidden=!busy;
    $('welcomeGoogle').textContent=busy?'Aguardando no navegador…':'Continuar com Google';
  }
  function finish(profile,account) {
    $('welcomePage').hidden=true;document.body.classList.remove('is-onboarding');onCompleted(profile,account);
    requestAnimationFrame(()=>$('name').focus({preventScroll:true}));
  }
  async function run(google) {
    if(busy)return;busy=true;$('welcomeFeedback').textContent='';controls();
    try {
      let profile=null,account;
      if(google){
        const login=await native('googleSignIn');
        const saved=await native('profileSave',{name:login.name,avatar:login.avatar,sounds:true});profile=saved.profile;account=login.account;
      }
      await native('welcomeComplete');finish(profile,account);
    } catch(error){$('welcomeFeedback').textContent=error.message;}
    finally{busy=false;controls();}
  }
  $('welcomeGoogle').addEventListener('click',()=>run(true));$('welcomeGuest').addEventListener('click',()=>run(false));
  $('welcomeCancel').addEventListener('click',()=>native('googleCancel').catch(()=>{}));
  return {
    start(ready){available=Boolean(ready.clientConfiguration?.googleClientId);controls();if(!available)$('welcomeFeedback').textContent='Google indisponível no momento. Você pode continuar sem login.';if(ready.firstRun&&!ready.uiPreview){this.show();}},
    show(){document.body.classList.add('is-onboarding');$('welcomePage').hidden=false;$('welcomeGuest').focus({preventScroll:true});}
  };
}
