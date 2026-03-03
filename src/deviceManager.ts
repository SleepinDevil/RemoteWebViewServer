import { CDPSession } from "playwright-core";
import sharp from "sharp";
import { DeviceConfig, deviceConfigsEqual } from "./config.js";
import { getRoot } from "./cdpRoot.js";
import { FrameProcessor } from "./frameProcessor.js";
import { DeviceBroadcaster } from "./broadcaster.js";
import { hash32 } from "./util.js";
import { SelfTestRunner } from "./selfTest.js";

export type DeviceSession = {
  id: string;
  deviceId: string;
  cdp: CDPSession;
  cfg: DeviceConfig;
  url: string;
  lastActive: number;
  frameId: number;
  prevFrameHash: number;
  processor: FrameProcessor;
  selfTestRunner: SelfTestRunner

  // trailing throttle state
  pendingB64?: string;
  throttleTimer?: NodeJS.Timeout;
  lastProcessedMs?: number;
};

const PREFERS_REDUCED_MOTION = /^(1|true|yes|on)$/i.test(process.env.PREFERS_REDUCED_MOTION ?? '');

const devices = new Map<string, DeviceSession>();
let _cleanupRunning = false;
export const broadcaster = new DeviceBroadcaster();

export async function ensureDeviceAsync(id: string, cfg: DeviceConfig): Promise<DeviceSession> {
  const root = getRoot();
  if (!root) throw new Error("CDP not ready");

  let device = devices.get(id);
  if (device) {
    if (deviceConfigsEqual(device.cfg, cfg)) {
      device.lastActive = Date.now();
      device.processor.requestFullFrame();
      return device;
    } else {
      console.log(`[device] Reconfiguring device ${id}`);
      await deleteDeviceAsync(device);
    }
  }

  const { targetId } = await root.send<{ targetId: string }>('Target.createTarget', {
    url: 'about:blank',
    width: cfg.width,
    height: cfg.height,
  });

  const { sessionId } = await root.send<{ sessionId: string }>('Target.attachToTarget', {
    targetId,
    flatten: true
  });
  const session = (root as any).session(sessionId);

  await session.send('Page.enable');
  await session.send('Emulation.setDeviceMetricsOverride', {
    width: cfg.width,
    height: cfg.height,
    deviceScaleFactor: 1,
    mobile: true
  });
  if (PREFERS_REDUCED_MOTION) {
    await session.send('Emulation.setEmulatedMedia', {
      media: 'screen',
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
  }

  // On-screen keyboard
  //const kioskKeyboardScript = "(function(){if(document.getElementById('kiosk-vkb-container'))return;const style=document.createElement('style');style.textContent=`#kiosk-vkb-container{position:fixed;bottom:-500px;left:0;width:100%;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;user-select:none;-webkit-user-select:none;font-family:'DejaVu Sans','Liberation Sans',Ubuntu,Roboto,sans-serif;transition:bottom 0.25s ease-out;touch-action:manipulation;}#kiosk-vkb-container.vkb-visible{bottom:0;}.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;}.vkb-row:last-child{margin-bottom:0;}.vkb-key{flex:1;height:44px;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;font-size:1.4rem;font-weight:normal;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}.vkb-key:active{background:#555555;}.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:1.1rem;}.vkb-key-layout:active{background:#233544;}.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:1.3rem;}.vkb-key-special:active{background:#364538;}.vkb-key-shift{font-size:1.8rem;}.vkb-key-enter{background:#E95420;color:#ffffff;border-color:#c94618;font-size:1.5rem;}.vkb-key-enter:active{background:#c94618;}.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}`;document.head.appendChild(style);const layouts={default:[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['⇧','z','x','c','v','b','n','m','⌫'],['?123',',','◀','Space','▶','.','⏎']],shift:[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['⇧','Z','X','C','V','B','N','M','⌫'],['?123',',','◀','Space','▶','.','⏎']],symbols:[['1','2','3','4','5','6','7','8','9','0'],['@','#','$','%','&','*','-','+','(',')'],['ABC','!','\"',\"'\",':',';','/','?','⌫'],['=\\\\<',',','◀','Space','▶','.','⏎']],extended:[['~','|','^','_','=','{','}','[',']','✓'],['<','>','£','€','¢','°','±','÷','×','\\\\'],['?123','↹','©','®','™','¿','¡','§','⌫'],['ABC',',','◀','Space','▶','.','⏎']]};let currentLayout='default';let activeInput=null;let isShifted=false;const keyboardContainer=document.createElement('div');keyboardContainer.id='kiosk-vkb-container';document.body.appendChild(keyboardContainer);function renderKeyboard(){keyboardContainer.innerHTML='';const layout=layouts[currentLayout];layout.forEach(row=>{const rowDiv=document.createElement('div');rowDiv.className='vkb-row';row.forEach(key=>{const keyBtn=document.createElement('button');keyBtn.className='vkb-key';keyBtn.textContent=key==='Space'?'':key;keyBtn.dataset.key=key;if(['?123','ABC','=\\\\<'].includes(key)){keyBtn.classList.add('vkb-key-layout');}if(['⇧','⌫','◀','▶','↹'].includes(key)){keyBtn.classList.add('vkb-key-special');}if(key==='⇧'){keyBtn.classList.add('vkb-key-shift');}if(key==='Space'){keyBtn.classList.add('vkb-key-space');}if(key==='◀'||key==='▶'){keyBtn.classList.add('vkb-key-arrow');}if(key==='⏎'){keyBtn.classList.add('vkb-key-enter');}if(key==='⇧'&&isShifted){keyBtn.style.background='#e2e8f0';keyBtn.style.color='#121212';}keyBtn.addEventListener('mousedown',handleKeyPress);keyBtn.addEventListener('touchstart',handleKeyPress,{passive:false});rowDiv.appendChild(keyBtn);});keyboardContainer.appendChild(rowDiv);});}function handleKeyPress(e){e.preventDefault();if(!activeInput)return;const key=e.target.dataset.key;let val=activeInput.value;let start=activeInput.selectionStart;let end=activeInput.selectionEnd;const insertText=(text)=>{activeInput.value=val.substring(0,start)+text+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start+text.length;};switch(key){case'⇧':isShifted=!isShifted;currentLayout=isShifted?'shift':'default';renderKeyboard();break;case'?123':currentLayout='symbols';isShifted=false;renderKeyboard();break;case'ABC':currentLayout='default';isShifted=false;renderKeyboard();break;case'=\\\\<':currentLayout='extended';isShifted=false;renderKeyboard();break;case'↹':insertText('\\t');break;case'⌫':if(start===end&&start>0){activeInput.value=val.substring(0,start-1)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start-1;}else if(start!==end){activeInput.value=val.substring(0,start)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start;}break;case'Space':insertText(' ');break;case'◀':if(start>0){activeInput.selectionStart=activeInput.selectionEnd=start-1;}break;case'▶':if(end<val.length){activeInput.selectionStart=activeInput.selectionEnd=end+1;}break;case'⏎':if(activeInput.tagName==='TEXTAREA'){insertText('\\n');}else{if(activeInput.form){if(typeof activeInput.form.requestSubmit==='function'){activeInput.form.requestSubmit();}else{activeInput.form.submit();}}else{const enterEvent=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true});activeInput.dispatchEvent(enterEvent);}hideKeyboard();}break;default:if(key){insertText(key);if(isShifted){isShifted=false;currentLayout='default';renderKeyboard();}}break;}if(key!=='⏎'){activeInput.dispatchEvent(new Event('input',{bubbles:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true}));}}function showKeyboard(inputElement){activeInput=inputElement;renderKeyboard();keyboardContainer.classList.add('vkb-visible');setTimeout(()=>{if(activeInput){activeInput.scrollIntoView({behavior:'smooth',block:'center'});}},250);}function hideKeyboard(){keyboardContainer.classList.remove('vkb-visible');if(activeInput){activeInput.blur();}activeInput=null;isShifted=false;currentLayout='default';}const validTypes=['text','email','number','password','search','tel','url'];document.addEventListener('focusin',function(e){const target=e.target;const isInput=target.tagName==='INPUT'&&validTypes.includes(target.type);const isTextArea=target.tagName==='TEXTAREA';if(isInput||isTextArea){if(activeInput!==target){showKeyboard(target);}}});document.addEventListener('pointerdown',function(e){if(keyboardContainer.classList.contains('vkb-visible')){const clickedInsideKeyboard=keyboardContainer.contains(e.target);const clickedOnInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA';if(!clickedInsideKeyboard&&!clickedOnInput){hideKeyboard();}}});renderKeyboard();})();";
  // -- first version did not wait for DOM, trying a second version now
  /*
  // -- This is the second attempt. This definitely makes things work, but I feel like the Javascript does not stay around persistently.
  const kioskKeyboardScript = "(function(){function initKeyboard(){if(document.getElementById('kiosk-vkb-container'))return;const style=document.createElement('style');style.textContent=`#kiosk-vkb-container{position:fixed;bottom:-500px;left:0;width:100%;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;user-select:none;-webkit-user-select:none;font-family:'DejaVu Sans','Liberation Sans',Ubuntu,Roboto,sans-serif;transition:bottom 0.25s ease-out;touch-action:manipulation;}#kiosk-vkb-container.vkb-visible{bottom:0;}.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;}.vkb-row:last-child{margin-bottom:0;}.vkb-key{flex:1;height:44px;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;font-size:1.4rem;font-weight:normal;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}.vkb-key:active{background:#555555;}.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:1.1rem;}.vkb-key-layout:active{background:#233544;}.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:1.3rem;}.vkb-key-special:active{background:#364538;}.vkb-key-shift{font-size:1.8rem;}.vkb-key-enter{background:#E95420;color:#ffffff;border-color:#c94618;font-size:1.5rem;}.vkb-key-enter:active{background:#c94618;}.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}`;document.head.appendChild(style);const layouts={default:[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['⇧','z','x','c','v','b','n','m','⌫'],['?123',',','◀','Space','▶','.','⏎']],shift:[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['⇧','Z','X','C','V','B','N','M','⌫'],['?123',',','◀','Space','▶','.','⏎']],symbols:[['1','2','3','4','5','6','7','8','9','0'],['@','#','$','%','&','*','-','+','(',')'],['ABC','!','\"',\"'\",':',';','/','?','⌫'],['=\\\\<',',','◀','Space','▶','.','⏎']],extended:[['~','|','^','_','=','{','}','[',']','✓'],['<','>','£','€','¢','°','±','÷','×','\\\\'],['?123','↹','©','®','™','¿','¡','§','⌫'],['ABC',',','◀','Space','▶','.','⏎']]};let currentLayout='default';let activeInput=null;let isShifted=false;const keyboardContainer=document.createElement('div');keyboardContainer.id='kiosk-vkb-container';document.body.appendChild(keyboardContainer);function renderKeyboard(){keyboardContainer.innerHTML='';const layout=layouts[currentLayout];layout.forEach(row=>{const rowDiv=document.createElement('div');rowDiv.className='vkb-row';row.forEach(key=>{const keyBtn=document.createElement('button');keyBtn.className='vkb-key';keyBtn.textContent=key==='Space'?'':key;keyBtn.dataset.key=key;if(['?123','ABC','=\\\\<'].includes(key)){keyBtn.classList.add('vkb-key-layout');}if(['⇧','⌫','◀','▶','↹'].includes(key)){keyBtn.classList.add('vkb-key-special');}if(key==='⇧'){keyBtn.classList.add('vkb-key-shift');}if(key==='Space'){keyBtn.classList.add('vkb-key-space');}if(key==='◀'||key==='▶'){keyBtn.classList.add('vkb-key-arrow');}if(key==='⏎'){keyBtn.classList.add('vkb-key-enter');}if(key==='⇧'&&isShifted){keyBtn.style.background='#e2e8f0';keyBtn.style.color='#121212';}keyBtn.addEventListener('mousedown',handleKeyPress);keyBtn.addEventListener('touchstart',handleKeyPress,{passive:false});rowDiv.appendChild(keyBtn);});keyboardContainer.appendChild(rowDiv);});}function handleKeyPress(e){e.preventDefault();if(!activeInput)return;const key=e.target.dataset.key;let val=activeInput.value;let start=activeInput.selectionStart;let end=activeInput.selectionEnd;const insertText=(text)=>{activeInput.value=val.substring(0,start)+text+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start+text.length;};switch(key){case'⇧':isShifted=!isShifted;currentLayout=isShifted?'shift':'default';renderKeyboard();break;case'?123':currentLayout='symbols';isShifted=false;renderKeyboard();break;case'ABC':currentLayout='default';isShifted=false;renderKeyboard();break;case'=\\\\<':currentLayout='extended';isShifted=false;renderKeyboard();break;case'↹':insertText('\\t');break;case'⌫':if(start===end&&start>0){activeInput.value=val.substring(0,start-1)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start-1;}else if(start!==end){activeInput.value=val.substring(0,start)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start;}break;case'Space':insertText(' ');break;case'◀':if(start>0){activeInput.selectionStart=activeInput.selectionEnd=start-1;}break;case'▶':if(end<val.length){activeInput.selectionStart=activeInput.selectionEnd=end+1;}break;case'⏎':if(activeInput.tagName==='TEXTAREA'){insertText('\\n');}else{if(activeInput.form){if(typeof activeInput.form.requestSubmit==='function'){activeInput.form.requestSubmit();}else{activeInput.form.submit();}}else{const enterEvent=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true});activeInput.dispatchEvent(enterEvent);}hideKeyboard();}break;default:if(key){insertText(key);if(isShifted){isShifted=false;currentLayout='default';renderKeyboard();}}break;}if(key!=='⏎'){activeInput.dispatchEvent(new Event('input',{bubbles:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true}));}}function showKeyboard(inputElement){activeInput=inputElement;renderKeyboard();keyboardContainer.classList.add('vkb-visible');setTimeout(()=>{if(activeInput){activeInput.scrollIntoView({behavior:'smooth',block:'center'});}},250);}function hideKeyboard(){keyboardContainer.classList.remove('vkb-visible');if(activeInput){activeInput.blur();}activeInput=null;isShifted=false;currentLayout='default';}const validTypes=['text','email','number','password','search','tel','url'];document.addEventListener('focusin',function(e){const target=e.target;const isInput=target.tagName==='INPUT'&&validTypes.includes(target.type);const isTextArea=target.tagName==='TEXTAREA';if(isInput||isTextArea){if(activeInput!==target){showKeyboard(target);}}});document.addEventListener('pointerdown',function(e){if(keyboardContainer.classList.contains('vkb-visible')){const clickedInsideKeyboard=keyboardContainer.contains(e.target);const clickedOnInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA';if(!clickedInsideKeyboard&&!clickedOnInput){hideKeyboard();}}});renderKeyboard();}if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',initKeyboard);}else{initKeyboard();}})();";
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: kioskKeyboardScript
  });
  await session.send('Page.addScriptToEvaluateOnNewDocument', {
    source: "console.log('Injected onscreen keyboard JS and CSS.');"
  }); */
  // -- So trying something new this time:
  /*
  const kioskKeyboardScript = "(function(){if(window.__kioskKeyboardInitialized)return;window.__kioskKeyboardInitialized=true;let keyboardContainer=null;let currentLayout='default';let activeInput=null;let isShifted=false;const layouts={default:[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['⇧','z','x','c','v','b','n','m','⌫'],['?123',',','◀','Space','▶','.','⏎']],shift:[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['⇧','Z','X','C','V','B','N','M','⌫'],['?123',',','◀','Space','▶','.','⏎']],symbols:[['1','2','3','4','5','6','7','8','9','0'],['@','#','$','%','&','*','-','+','(',')'],['ABC','!','\"',\"'\",':',';','/','?','⌫'],['=\\\\<',',','◀','Space','▶','.','⏎']],extended:[['~','|','^','_','=','{','}','[',']','✓'],['<','>','£','€','¢','°','±','÷','×','\\\\'],['?123','↹','©','®','™','¿','¡','§','⌫'],['ABC',',','◀','Space','▶','.','⏎']]};function ensureDOM(){if(!document.body||!document.head)return false;if(!document.getElementById('kiosk-vkb-style')){const style=document.createElement('style');style.id='kiosk-vkb-style';style.textContent=`#kiosk-vkb-container{position:fixed;bottom:-500px;left:0;width:100%;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;user-select:none;-webkit-user-select:none;font-family:'DejaVu Sans','Liberation Sans',Ubuntu,Roboto,sans-serif;transition:bottom 0.25s ease-out;touch-action:manipulation;}#kiosk-vkb-container.vkb-visible{bottom:0;}.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;}.vkb-row:last-child{margin-bottom:0;}.vkb-key{flex:1;height:44px;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;font-size:1.4rem;font-weight:normal;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}.vkb-key:active{background:#555555;}.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:1.1rem;}.vkb-key-layout:active{background:#233544;}.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:1.3rem;}.vkb-key-special:active{background:#364538;}.vkb-key-shift{font-size:1.8rem;}.vkb-key-enter{background:#E95420;color:#ffffff;border-color:#c94618;font-size:1.5rem;}.vkb-key-enter:active{background:#c94618;}.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}`;document.head.appendChild(style);}if(!keyboardContainer){keyboardContainer=document.createElement('div');keyboardContainer.id='kiosk-vkb-container';renderKeyboard();}if(!document.body.contains(keyboardContainer)){document.body.appendChild(keyboardContainer);}return true;}function renderKeyboard(){if(!keyboardContainer)return;keyboardContainer.innerHTML='';const layout=layouts[currentLayout];layout.forEach(row=>{const rowDiv=document.createElement('div');rowDiv.className='vkb-row';row.forEach(key=>{const keyBtn=document.createElement('button');keyBtn.className='vkb-key';keyBtn.textContent=key==='Space'?'':key;keyBtn.dataset.key=key;if(['?123','ABC','=\\\\<'].includes(key)){keyBtn.classList.add('vkb-key-layout');}if(['⇧','⌫','◀','▶','↹'].includes(key)){keyBtn.classList.add('vkb-key-special');}if(key==='⇧'){keyBtn.classList.add('vkb-key-shift');}if(key==='Space'){keyBtn.classList.add('vkb-key-space');}if(key==='◀'||key==='▶'){keyBtn.classList.add('vkb-key-arrow');}if(key==='⏎'){keyBtn.classList.add('vkb-key-enter');}if(key==='⇧'&&isShifted){keyBtn.style.background='#e2e8f0';keyBtn.style.color='#121212';}keyBtn.addEventListener('mousedown',handleKeyPress);keyBtn.addEventListener('touchstart',handleKeyPress,{passive:false});rowDiv.appendChild(keyBtn);});keyboardContainer.appendChild(rowDiv);});}function handleKeyPress(e){e.preventDefault();if(!activeInput)return;const key=e.target.dataset.key;let val=activeInput.value;let start=activeInput.selectionStart;let end=activeInput.selectionEnd;const insertText=(text)=>{activeInput.value=val.substring(0,start)+text+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start+text.length;};switch(key){case'⇧':isShifted=!isShifted;currentLayout=isShifted?'shift':'default';renderKeyboard();break;case'?123':currentLayout='symbols';isShifted=false;renderKeyboard();break;case'ABC':currentLayout='default';isShifted=false;renderKeyboard();break;case'=\\\\<':currentLayout='extended';isShifted=false;renderKeyboard();break;case'↹':insertText('\\t');break;case'⌫':if(start===end&&start>0){activeInput.value=val.substring(0,start-1)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start-1;}else if(start!==end){activeInput.value=val.substring(0,start)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start;}break;case'Space':insertText(' ');break;case'◀':if(start>0){activeInput.selectionStart=activeInput.selectionEnd=start-1;}break;case'▶':if(end<val.length){activeInput.selectionStart=activeInput.selectionEnd=end+1;}break;case'⏎':if(activeInput.tagName==='TEXTAREA'){insertText('\\n');}else{if(activeInput.form){if(typeof activeInput.form.requestSubmit==='function'){activeInput.form.requestSubmit();}else{activeInput.form.submit();}}else{const enterEvent=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true});activeInput.dispatchEvent(enterEvent);}hideKeyboard();}break;default:if(key){insertText(key);if(isShifted){isShifted=false;currentLayout='default';renderKeyboard();}}break;}if(key!=='⏎'){activeInput.dispatchEvent(new Event('input',{bubbles:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true}));}}function showKeyboard(inputElement){activeInput=inputElement;renderKeyboard();requestAnimationFrame(()=>{keyboardContainer.classList.add('vkb-visible');setTimeout(()=>{if(activeInput){activeInput.scrollIntoView({behavior:'smooth',block:'center'});}},250);});}function hideKeyboard(){if(keyboardContainer){keyboardContainer.classList.remove('vkb-visible');}if(activeInput){activeInput.blur();}activeInput=null;isShifted=false;currentLayout='default';}const validTypes=['text','email','number','password','search','tel','url'];document.addEventListener('focusin',function(e){const target=e.target;const isInput=target.tagName==='INPUT'&&validTypes.includes(target.type);const isTextArea=target.tagName==='TEXTAREA';if(isInput||isTextArea){if(ensureDOM()){if(activeInput!==target){showKeyboard(target);}}}});document.addEventListener('pointerdown',function(e){if(keyboardContainer&&keyboardContainer.classList.contains('vkb-visible')){const clickedInsideKeyboard=keyboardContainer.contains(e.target);const clickedOnInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA';if(!clickedInsideKeyboard&&!clickedOnInput){hideKeyboard();}}});console.log('Kiosk Virtual Keyboard Initialized (CDP Mode Active).');})();";
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: kioskKeyboardScript });
  */
  // -- found out something new, #shadow-root is a bigger problem than I ever knew. lets try something else now:
  //const kioskKeyboardScript = "(function(){if(window.__kioskKeyboardInitialized)return;window.__kioskKeyboardInitialized=true;let keyboardContainer=null;let currentLayout='default';let activeInput=null;let isShifted=false;const layouts={default:[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['⇧','z','x','c','v','b','n','m','⌫'],['?123',',','◀','Space','▶','.','⏎']],shift:[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['⇧','Z','X','C','V','B','N','M','⌫'],['?123',',','◀','Space','▶','.','⏎']],symbols:[['1','2','3','4','5','6','7','8','9','0'],['@','#','$','%','&','*','-','+','(',')'],['ABC','!','\"',\"'\",':',';','/','?','⌫'],['=\\\\<',',','◀','Space','▶','.','⏎']],extended:[['~','|','^','_','=','{','}','[',']','✓'],['<','>','£','€','¢','°','±','÷','×','\\\\'],['?123','↹','©','®','™','¿','¡','§','⌫'],['ABC',',','◀','Space','▶','.','⏎']]};function ensureDOM(){if(!document.body||!document.head)return false;if(!document.getElementById('kiosk-vkb-style')){const style=document.createElement('style');style.id='kiosk-vkb-style';style.textContent=`#kiosk-vkb-container{position:fixed;bottom:-500px;left:0;width:100%;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;user-select:none;-webkit-user-select:none;font-family:'DejaVu Sans','Liberation Sans',Ubuntu,Roboto,sans-serif;transition:bottom 0.25s ease-out;touch-action:manipulation;}#kiosk-vkb-container.vkb-visible{bottom:0;}.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;}.vkb-row:last-child{margin-bottom:0;}.vkb-key{flex:1;height:44px;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;font-size:1.4rem;font-weight:normal;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}.vkb-key:active{background:#555555;}.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:1.1rem;}.vkb-key-layout:active{background:#233544;}.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:1.3rem;}.vkb-key-special:active{background:#364538;}.vkb-key-shift{font-size:1.8rem;}.vkb-key-enter{background:#E95420;color:#ffffff;border-color:#c94618;font-size:1.5rem;}.vkb-key-enter:active{background:#c94618;}.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}`;document.head.appendChild(style);}if(!keyboardContainer){keyboardContainer=document.createElement('div');keyboardContainer.id='kiosk-vkb-container';renderKeyboard();}if(!document.body.contains(keyboardContainer)){document.body.appendChild(keyboardContainer);}return true;}function renderKeyboard(){if(!keyboardContainer)return;keyboardContainer.innerHTML='';const layout=layouts[currentLayout];layout.forEach(row=>{const rowDiv=document.createElement('div');rowDiv.className='vkb-row';row.forEach(key=>{const keyBtn=document.createElement('button');keyBtn.className='vkb-key';keyBtn.textContent=key==='Space'?'':key;keyBtn.dataset.key=key;if(['?123','ABC','=\\\\<'].includes(key)){keyBtn.classList.add('vkb-key-layout');}if(['⇧','⌫','◀','▶','↹'].includes(key)){keyBtn.classList.add('vkb-key-special');}if(key==='⇧'){keyBtn.classList.add('vkb-key-shift');}if(key==='Space'){keyBtn.classList.add('vkb-key-space');}if(key==='◀'||key==='▶'){keyBtn.classList.add('vkb-key-arrow');}if(key==='⏎'){keyBtn.classList.add('vkb-key-enter');}if(key==='⇧'&&isShifted){keyBtn.style.background='#e2e8f0';keyBtn.style.color='#121212';}keyBtn.addEventListener('mousedown',handleKeyPress);keyBtn.addEventListener('touchstart',handleKeyPress,{passive:false});rowDiv.appendChild(keyBtn);});keyboardContainer.appendChild(rowDiv);});}function handleKeyPress(e){e.preventDefault();if(!activeInput)return;const key=e.target.dataset.key;const insertText=(text)=>{if(activeInput.isContentEditable){document.execCommand('insertText',false,text);}else{let val=activeInput.value;let start=activeInput.selectionStart;let end=activeInput.selectionEnd;activeInput.value=val.substring(0,start)+text+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start+text.length;}};switch(key){case'⇧':isShifted=!isShifted;currentLayout=isShifted?'shift':'default';renderKeyboard();break;case'?123':currentLayout='symbols';isShifted=false;renderKeyboard();break;case'ABC':currentLayout='default';isShifted=false;renderKeyboard();break;case'=\\\\<':currentLayout='extended';isShifted=false;renderKeyboard();break;case'↹':insertText('\\t');break;case'⌫':if(activeInput.isContentEditable){document.execCommand('delete',false,null);}else{let val=activeInput.value;let start=activeInput.selectionStart;let end=activeInput.selectionEnd;if(start===end&&start>0){activeInput.value=val.substring(0,start-1)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start-1;}else if(start!==end){activeInput.value=val.substring(0,start)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start;}}break;case'Space':insertText(' ');break;case'◀':if(!activeInput.isContentEditable){let start=activeInput.selectionStart;if(start>0)activeInput.selectionStart=activeInput.selectionEnd=start-1;}break;case'▶':if(!activeInput.isContentEditable){let end=activeInput.selectionEnd;if(end<activeInput.value.length)activeInput.selectionStart=activeInput.selectionEnd=end+1;}break;case'⏎':if(activeInput.isContentEditable){document.execCommand('insertParagraph',false,null);}else if(activeInput.tagName==='TEXTAREA'){insertText('\\n');}else{if(activeInput.form){if(typeof activeInput.form.requestSubmit==='function'){activeInput.form.requestSubmit();}else{activeInput.form.submit();}}else{const enterEvent=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true});activeInput.dispatchEvent(enterEvent);}hideKeyboard();}break;default:if(key){insertText(key);if(isShifted){isShifted=false;currentLayout='default';renderKeyboard();}}break;}if(key!=='⏎'){activeInput.dispatchEvent(new Event('input',{bubbles:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true}));}}function showKeyboard(inputElement){activeInput=inputElement;renderKeyboard();requestAnimationFrame(()=>{keyboardContainer.classList.add('vkb-visible');setTimeout(()=>{if(activeInput&&activeInput.scrollIntoView){activeInput.scrollIntoView({behavior:'smooth',block:'center'});}},250);});}function hideKeyboard(){if(keyboardContainer){keyboardContainer.classList.remove('vkb-visible');}if(activeInput&&activeInput.blur){activeInput.blur();}activeInput=null;isShifted=false;currentLayout='default';}const validTypes=['text','email','number','password','search','tel','url'];document.addEventListener('focusin',function(e){const target=(e.composedPath&&e.composedPath()[0])||e.target;if(!target||!target.tagName)return;const isInput=target.tagName==='INPUT'&&validTypes.includes(target.type);const isTextArea=target.tagName==='TEXTAREA';const isEditable=target.isContentEditable;if(isInput||isTextArea||isEditable){if(ensureDOM()){if(activeInput!==target){showKeyboard(target);}}}},true);document.addEventListener('pointerdown',function(e){if(keyboardContainer&&keyboardContainer.classList.contains('vkb-visible')){const target=(e.composedPath&&e.composedPath()[0])||e.target;const path=e.composedPath?e.composedPath():[e.target];const clickedInsideKeyboard=path.includes(keyboardContainer);const isInput=target.tagName==='INPUT';const isTextArea=target.tagName==='TEXTAREA';const isEditable=target.isContentEditable;const clickedOnInput=isInput||isTextArea||isEditable;if(!clickedInsideKeyboard&&!clickedOnInput){hideKeyboard();}}},true);console.log('Kiosk Virtual Keyboard Initialized (Shadow DOM & Rich Text Support).');})();";
  // -- so the above worked really well for standard Input and Textarea objects, but HA Textfields are super cooked
  const kioskKeyboardScript = "(function(){if(window.__kioskKeyboardInitialized)return;window.__kioskKeyboardInitialized=true;let keyboardContainer=null;let currentLayout='default';let activeInput=null;let isShifted=false;const layouts={default:[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['⇧','z','x','c','v','b','n','m','⌫'],['?123',',','◀','Space','▶','.','⏎']],shift:[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['⇧','Z','X','C','V','B','N','M','⌫'],['?123',',','◀','Space','▶','.','⏎']],symbols:[['1','2','3','4','5','6','7','8','9','0'],['@','#','$','%','&','*','-','+','(',')'],['ABC','!','\"',\"'\",':',';','/','?','⌫'],['=\\\\<',',','◀','Space','▶','.','⏎']],extended:[['~','|','^','_','=','{','}','[',']','✓'],['<','>','£','€','¢','°','±','÷','×','\\\\'],['?123','↹','©','®','™','¿','¡','§','⌫'],['ABC',',','◀','Space','▶','.','⏎']]};function ensureDOM(){if(!document.body||!document.head)return false;if(!document.getElementById('kiosk-vkb-style')){const style=document.createElement('style');style.id='kiosk-vkb-style';style.textContent=`#kiosk-vkb-container{position:fixed;bottom:-500px;left:0;width:100%;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;user-select:none;-webkit-user-select:none;font-family:'DejaVu Sans','Liberation Sans',Ubuntu,Roboto,sans-serif;transition:bottom 0.25s ease-out;touch-action:manipulation;}#kiosk-vkb-container.vkb-visible{bottom:0;}.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;}.vkb-row:last-child{margin-bottom:0;}.vkb-key{flex:1;height:44px;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;font-size:1.4rem;font-weight:normal;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}.vkb-key:active{background:#555555;}.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:1.1rem;}.vkb-key-layout:active{background:#233544;}.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:1.3rem;}.vkb-key-special:active{background:#364538;}.vkb-key-shift{font-size:1.8rem;}.vkb-key-enter{background:#E95420;color:#ffffff;border-color:#c94618;font-size:1.5rem;}.vkb-key-enter:active{background:#c94618;}.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}`;document.head.appendChild(style);}if(!keyboardContainer){keyboardContainer=document.createElement('div');keyboardContainer.id='kiosk-vkb-container';renderKeyboard();}if(!document.body.contains(keyboardContainer)){document.body.appendChild(keyboardContainer);}return true;}function renderKeyboard(){if(!keyboardContainer)return;keyboardContainer.innerHTML='';const layout=layouts[currentLayout];layout.forEach(row=>{const rowDiv=document.createElement('div');rowDiv.className='vkb-row';row.forEach(key=>{const keyBtn=document.createElement('button');keyBtn.className='vkb-key';keyBtn.textContent=key==='Space'?'':key;keyBtn.dataset.key=key;if(['?123','ABC','=\\\\<'].includes(key)){keyBtn.classList.add('vkb-key-layout');}if(['⇧','⌫','◀','▶','↹'].includes(key)){keyBtn.classList.add('vkb-key-special');}if(key==='⇧'){keyBtn.classList.add('vkb-key-shift');}if(key==='Space'){keyBtn.classList.add('vkb-key-space');}if(key==='◀'||key==='▶'){keyBtn.classList.add('vkb-key-arrow');}if(key==='⏎'){keyBtn.classList.add('vkb-key-enter');}if(key==='⇧'&&isShifted){keyBtn.style.background='#e2e8f0';keyBtn.style.color='#121212';}keyBtn.addEventListener('mousedown',handleKeyPress);keyBtn.addEventListener('touchstart',handleKeyPress,{passive:false});rowDiv.appendChild(keyBtn);});keyboardContainer.appendChild(rowDiv);});}function handleKeyPress(e){e.preventDefault();if(!activeInput)return;const key=e.target.dataset.key;const insertText=(text)=>{if(activeInput.isContentEditable){document.execCommand('insertText',false,text);}else{let val=activeInput.value||'';let start=activeInput.selectionStart||0;let end=activeInput.selectionEnd||0;activeInput.value=val.substring(0,start)+text+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start+text.length;}};switch(key){case'⇧':isShifted=!isShifted;currentLayout=isShifted?'shift':'default';renderKeyboard();break;case'?123':currentLayout='symbols';isShifted=false;renderKeyboard();break;case'ABC':currentLayout='default';isShifted=false;renderKeyboard();break;case'=\\\\<':currentLayout='extended';isShifted=false;renderKeyboard();break;case'↹':insertText('\\t');break;case'⌫':if(activeInput.isContentEditable){document.execCommand('delete',false,null);}else{let val=activeInput.value||'';let start=activeInput.selectionStart||0;let end=activeInput.selectionEnd||0;if(start===end&&start>0){activeInput.value=val.substring(0,start-1)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start-1;}else if(start!==end){activeInput.value=val.substring(0,start)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start;}}break;case'Space':insertText(' ');break;case'◀':if(!activeInput.isContentEditable){let start=activeInput.selectionStart||0;if(start>0)activeInput.selectionStart=activeInput.selectionEnd=start-1;}break;case'▶':if(!activeInput.isContentEditable){let end=activeInput.selectionEnd||0;let valLen=(activeInput.value||'').length;if(end<valLen)activeInput.selectionStart=activeInput.selectionEnd=end+1;}break;case'⏎':if(activeInput.isContentEditable){document.execCommand('insertParagraph',false,null);}else if(activeInput.tagName==='TEXTAREA'){insertText('\\n');}else{if(activeInput.form){if(typeof activeInput.form.requestSubmit==='function')activeInput.form.requestSubmit();else activeInput.form.submit();}else{const enterEvent=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true,composed:true});activeInput.dispatchEvent(enterEvent);}hideKeyboard();}break;default:if(key){insertText(key);if(isShifted){isShifted=false;currentLayout='default';renderKeyboard();}}break;}if(key!=='⏎'){activeInput.dispatchEvent(new Event('input',{bubbles:true,composed:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true,composed:true}));}}function showKeyboard(inputElement){activeInput=inputElement;renderKeyboard();requestAnimationFrame(()=>{keyboardContainer.classList.add('vkb-visible');setTimeout(()=>{if(activeInput&&activeInput.scrollIntoView){activeInput.scrollIntoView({behavior:'smooth',block:'center'});}},250);});}function hideKeyboard(){if(keyboardContainer){keyboardContainer.classList.remove('vkb-visible');}if(activeInput&&activeInput.blur){activeInput.blur();}activeInput=null;isShifted=false;currentLayout='default';}const validTypes=['text','email','number','password','search','tel','url'];document.addEventListener('focusin',function(e){const path=e.composedPath?e.composedPath():[e.target];let targetInput=null;for(let i=0;i<path.length;i++){let el=path[i];if(!el||!el.tagName)continue;let t=el.tagName.toUpperCase();if(t==='INPUT'&&validTypes.includes(el.type)){targetInput=el;break;}if(t==='TEXTAREA'||el.isContentEditable){targetInput=el;break;}if(t.startsWith('HA-')&&(t.includes('TEXT')||t.includes('SEARCH')||t.includes('INPUT'))){targetInput=el.shadowRoot?(el.shadowRoot.querySelector('input, textarea')||el):el;break;}}if(targetInput){if(ensureDOM()){if(activeInput!==targetInput){showKeyboard(targetInput);}}}},true);document.addEventListener('pointerdown',function(e){if(keyboardContainer&&keyboardContainer.classList.contains('vkb-visible')){const path=e.composedPath?e.composedPath():[e.target];const clickedInsideKeyboard=path.includes(keyboardContainer);let clickedOnInput=false;for(let i=0;i<path.length;i++){let el=path[i];if(!el||!el.tagName)continue;let t=el.tagName.toUpperCase();if(t==='INPUT'&&validTypes.includes(el.type)){clickedOnInput=true;break;}if(t==='TEXTAREA'||el.isContentEditable){clickedOnInput=true;break;}if(t.startsWith('HA-')&&(t.includes('TEXT')||t.includes('SEARCH')||t.includes('INPUT'))){clickedOnInput=true;break;}}if(!clickedInsideKeyboard&&!clickedOnInput){hideKeyboard();}}},true);console.log('Kiosk Virtual Keyboard Initialized (HA Web Component Support).');})();";
  await session.send('Page.addScriptToEvaluateOnNewDocument', { source: kioskKeyboardScript });
  //--- Tried something else in inputRouter without much success, reverting back to this

  await session.send('Page.startScreencast', {
    format: 'png',
    maxWidth: cfg.width,
    maxHeight: cfg.height,
    everyNthFrame: cfg.everyNthFrame
  });

  const processor = new FrameProcessor({
    tileSize: cfg.tileSize,
    fullframeTileCount: cfg.fullFrameTileCount,
    fullframeAreaThreshold: cfg.fullFrameAreaThreshold,
    jpegQuality: cfg.jpegQuality,
    fullFrameEvery: cfg.fullFrameEvery,
    maxBytesPerMessage: cfg.maxBytesPerMessage,
  });

  const newDevice: DeviceSession = {
    id: targetId,
    deviceId: id,
    cdp: session,
    cfg: cfg,
    url: '',
    lastActive: Date.now(),
    frameId: 0,
    prevFrameHash: 0,
    processor,
    selfTestRunner: new SelfTestRunner(broadcaster),
    pendingB64: undefined,
    throttleTimer: undefined,
    lastProcessedMs: undefined,
  };
  devices.set(id, newDevice);
  newDevice.processor.requestFullFrame();

  const flushPending = async () => {
    const dev = newDevice;
    dev.throttleTimer = undefined;

    const b64 = dev.pendingB64;
    dev.pendingB64 = undefined;
    if (!b64) return;

    try {
      const pngFull = Buffer.from(b64, 'base64');

      const h32 = hash32(pngFull);
      if (dev.prevFrameHash === h32) {
        dev.lastProcessedMs = Date.now();
        return;
      }
      dev.prevFrameHash = h32;

      let img = sharp(pngFull);
      if (dev.cfg.rotation) img = img.rotate(dev.cfg.rotation);

      const { data, info } = await img
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const out = await processor.processFrameAsync({ data, width: info.width, height: info.height });
      if (out.rects.length > 0) {
        dev.frameId = (dev.frameId + 1) >>> 0;
        broadcaster.sendFrameChunked(id, out, dev.frameId, cfg.maxBytesPerMessage);
      }
    } catch (e) {
      console.warn(`[device] Failed to process frame for ${id}: ${(e as Error).message}`);
    } finally {
      dev.lastProcessedMs = Date.now();
    }
  };

  session.on('Page.screencastFrame', async (evt: any) => {
    // ACK immediately to keep producer running
    session.send('Page.screencastFrameAck', { sessionId: evt.sessionId }).catch(() => { });

    if (broadcaster.getClientCount(newDevice.deviceId) === 0)
      return;
    newDevice.lastActive = Date.now();
    newDevice.pendingB64 = evt.data;

    const now = Date.now();
    const since = newDevice.lastProcessedMs ? (now - newDevice.lastProcessedMs) : Infinity;
    if (!newDevice.throttleTimer) {
      const delay = Math.max(0, cfg.minFrameInterval - (Number.isFinite(since) ? since : 0));
      newDevice.throttleTimer = setTimeout(flushPending, delay);
    }
  });

  return newDevice;
}

export async function cleanupIdleAsync(ttlMs = 5 * 60_000) {
  if (_cleanupRunning) return;
  _cleanupRunning = true;

  try {
    const now = Date.now();
    const staleIds = Array.from(devices.values())
      .filter(d => now - d.lastActive > ttlMs)
      .map(d => d.deviceId);

    for (const id of staleIds) {
      const dev = devices.get(id);
      if (!dev) continue;

      console.log(`[device] Cleaning up idle device ${id}`);
      await deleteDeviceAsync(dev).catch(() => { /* swallow */ });
    }
  } finally {
    _cleanupRunning = false;
  }
}

async function deleteDeviceAsync(device: DeviceSession) {
  const root = getRoot();

  if (!devices.delete(device.deviceId))
    return;

  if (device.throttleTimer)
    clearTimeout(device.throttleTimer);

  try { await device.cdp.send("Page.stopScreencast").catch(() => { }); } catch { }
  try { await root?.send("Target.closeTarget", { targetId: device.id }); } catch { }
}
