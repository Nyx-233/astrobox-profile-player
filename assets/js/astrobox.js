
'use strict';
// AstroBox personal-homepage iframe protocol v1.
const root=document.documentElement;
const envelope={namespace:'astrobox.profile-iframe',version:1};
const post=(message)=>window.parent.postMessage({...envelope,...message},'*');
let heightFrame=0,lastHeight=0,forceReport=false;
function reportHeight(force=false){
 forceReport ||= force;
 if(heightFrame)return;
 heightFrame=requestAnimationFrame(()=>{
  heightFrame=0;const forced=forceReport;forceReport=false;
  const b=document.body;const height=Math.ceil(Math.max(b.getBoundingClientRect().height,b.offsetHeight,b.scrollHeight));
  if(!Number.isFinite(height)||!height||(!forced&&height===lastHeight))return;
  lastHeight=height;post({type:'resize',height});
 });
}
window.addEventListener('message',event=>{
 if(event.source!==window.parent)return;
 const m=event.data;
 if(!m||m.namespace!==envelope.namespace||m.version!==1||m.type!=='config')return;
 if(m.theme==='light'||m.theme==='dark'){root.dataset.astroboxTheme=m.theme;root.style.colorScheme=m.theme;}
 root.classList.toggle('astrobox-transparent',m.transparent===true);
 // The requested design remains transparent even outside AstroBox.
 if(m.requestResize===true)reportHeight(true);
});
new ResizeObserver(()=>reportHeight()).observe(document.body);
window.addEventListener('load',()=>reportHeight());
post({type:'ready'});reportHeight(true);

export { reportHeight };
