let sequence=0;const pending=new Map();
const native=(type,payload={})=>new Promise((resolve,reject)=>{const id=String(++sequence);pending.set(id,{resolve,reject});window.chrome.webview.postMessage({id,type,payload});});
window.chrome.webview.addEventListener('message',({data})=>{const r=pending.get(data.id);if(r){pending.delete(data.id);data.ok?r.resolve(data.result):r.reject(Error(data.error));}});
let result;
try{
 await native('ready');
 const closed=await native('trayTestClose');
 await new Promise(r=>setTimeout(r,500));
 const reopened=await native('trayTestOpen');
 result={success:closed.hidden&&closed.tray&&closed.ready&&!closed.closing&&closed.noticePassive&&reopened.visible,closed,reopened};
}catch(e){result={success:false,error:String(e)};}
await native('trayTestFinish',result);
