import type { DeviceSession } from "./deviceManager.js";
import { TouchKind, parseFrameStatsPacket, parseOpenURLPacket, parseTouchPacket } from "./protocol.js";
import { mapPointForRotation } from "./util.js";

export class InputRouter {
  private _lastMoveAt = 0;
  private readonly _moveThrottleMs: number;

  constructor(moveThrottleMs = 12) {
    this._moveThrottleMs = moveThrottleMs;
  }

  public async handleTouchPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const pkt = parseTouchPacket(buf);
    if (!pkt) return;

    if (pkt.kind === TouchKind.Move) {
      const now = Date.now();
      if (now - this._lastMoveAt < this._moveThrottleMs) return;
      this._lastMoveAt = now;
    }

    await this._dispatchTouchAsync(dev, pkt.kind, pkt.x, pkt.y);
  }

  public async handleFrameStatsPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const value = parseFrameStatsPacket(buf);
    dev.selfTestRunner?.setFrameRenderTimeAsync(value ?? 0, dev.cdp);
  }

  public async handleOpenURLPacketAsync(dev: DeviceSession, buf: Buffer): Promise<void> {
    const pkt = parseOpenURLPacket(buf);
      if (!pkt) return;

      if (pkt.url === "self-test") {
        await dev.selfTestRunner.startAsync(dev.deviceId, dev.cdp);
      } else {
        dev.selfTestRunner.stop();
        
        if (dev.url !== pkt.url)
          await dev.cdp.send('Page.navigate', { url: pkt.url });

          const kioskKeyboardScript = "(function(){if(document.getElementById('kiosk-vkb-container'))return;const style=document.createElement('style');style.textContent=`#kiosk-vkb-container{position:fixed;bottom:-500px;left:0;width:100%;background:#1e1e1e;border-top:2px solid #333;z-index:2147483647;display:flex;flex-direction:column;padding:4px;box-sizing:border-box;user-select:none;-webkit-user-select:none;font-family:'DejaVu Sans','Liberation Sans',Ubuntu,Roboto,sans-serif;transition:bottom 0.25s ease-out;touch-action:manipulation;}#kiosk-vkb-container.vkb-visible{bottom:0;}.vkb-row{display:flex;justify-content:center;margin-bottom:4px;width:100%;gap:4px;}.vkb-row:last-child{margin-bottom:0;}.vkb-key{flex:1;height:44px;background:#383838;color:#f8f8f2;border:1px solid #2a2a2a;border-radius:2px;font-size:1.4rem;font-weight:normal;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}.vkb-key:active{background:#555555;}.vkb-key-layout{background:#324a5f;color:#e2e8f0;font-size:1.1rem;}.vkb-key-layout:active{background:#233544;}.vkb-key-special{background:#485c4a;color:#e2e8f0;font-size:1.3rem;}.vkb-key-special:active{background:#364538;}.vkb-key-shift{font-size:1.8rem;}.vkb-key-enter{background:#E95420;color:#ffffff;border-color:#c94618;font-size:1.5rem;}.vkb-key-enter:active{background:#c94618;}.vkb-key-space{flex:3;}.vkb-key-arrow{flex:0.8;}`;document.head.appendChild(style);const layouts={default:[['q','w','e','r','t','y','u','i','o','p'],['a','s','d','f','g','h','j','k','l'],['⇧','z','x','c','v','b','n','m','⌫'],['?123',',','◀','Space','▶','.','⏎']],shift:[['Q','W','E','R','T','Y','U','I','O','P'],['A','S','D','F','G','H','J','K','L'],['⇧','Z','X','C','V','B','N','M','⌫'],['?123',',','◀','Space','▶','.','⏎']],symbols:[['1','2','3','4','5','6','7','8','9','0'],['@','#','$','%','&','*','-','+','(',')'],['ABC','!','\"',\"'\",':',';','/','?','⌫'],['=\\\\<',',','◀','Space','▶','.','⏎']],extended:[['~','|','^','_','=','{','}','[',']','✓'],['<','>','£','€','¢','°','±','÷','×','\\\\'],['?123','↹','©','®','™','¿','¡','§','⌫'],['ABC',',','◀','Space','▶','.','⏎']]};let currentLayout='default';let activeInput=null;let isShifted=false;const keyboardContainer=document.createElement('div');keyboardContainer.id='kiosk-vkb-container';document.body.appendChild(keyboardContainer);function renderKeyboard(){keyboardContainer.innerHTML='';const layout=layouts[currentLayout];layout.forEach(row=>{const rowDiv=document.createElement('div');rowDiv.className='vkb-row';row.forEach(key=>{const keyBtn=document.createElement('button');keyBtn.className='vkb-key';keyBtn.textContent=key==='Space'?'':key;keyBtn.dataset.key=key;if(['?123','ABC','=\\\\<'].includes(key)){keyBtn.classList.add('vkb-key-layout');}if(['⇧','⌫','◀','▶','↹'].includes(key)){keyBtn.classList.add('vkb-key-special');}if(key==='⇧'){keyBtn.classList.add('vkb-key-shift');}if(key==='Space'){keyBtn.classList.add('vkb-key-space');}if(key==='◀'||key==='▶'){keyBtn.classList.add('vkb-key-arrow');}if(key==='⏎'){keyBtn.classList.add('vkb-key-enter');}if(key==='⇧'&&isShifted){keyBtn.style.background='#e2e8f0';keyBtn.style.color='#121212';}keyBtn.addEventListener('mousedown',handleKeyPress);keyBtn.addEventListener('touchstart',handleKeyPress,{passive:false});rowDiv.appendChild(keyBtn);});keyboardContainer.appendChild(rowDiv);});}function handleKeyPress(e){e.preventDefault();if(!activeInput)return;const key=e.target.dataset.key;let val=activeInput.value;let start=activeInput.selectionStart;let end=activeInput.selectionEnd;const insertText=(text)=>{activeInput.value=val.substring(0,start)+text+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start+text.length;};switch(key){case'⇧':isShifted=!isShifted;currentLayout=isShifted?'shift':'default';renderKeyboard();break;case'?123':currentLayout='symbols';isShifted=false;renderKeyboard();break;case'ABC':currentLayout='default';isShifted=false;renderKeyboard();break;case'=\\\\<':currentLayout='extended';isShifted=false;renderKeyboard();break;case'↹':insertText('\\t');break;case'⌫':if(start===end&&start>0){activeInput.value=val.substring(0,start-1)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start-1;}else if(start!==end){activeInput.value=val.substring(0,start)+val.substring(end);activeInput.selectionStart=activeInput.selectionEnd=start;}break;case'Space':insertText(' ');break;case'◀':if(start>0){activeInput.selectionStart=activeInput.selectionEnd=start-1;}break;case'▶':if(end<val.length){activeInput.selectionStart=activeInput.selectionEnd=end+1;}break;case'⏎':if(activeInput.tagName==='TEXTAREA'){insertText('\\n');}else{if(activeInput.form){if(typeof activeInput.form.requestSubmit==='function'){activeInput.form.requestSubmit();}else{activeInput.form.submit();}}else{const enterEvent=new KeyboardEvent('keydown',{key:'Enter',code:'Enter',keyCode:13,bubbles:true});activeInput.dispatchEvent(enterEvent);}hideKeyboard();}break;default:if(key){insertText(key);if(isShifted){isShifted=false;currentLayout='default';renderKeyboard();}}break;}if(key!=='⏎'){activeInput.dispatchEvent(new Event('input',{bubbles:true}));activeInput.dispatchEvent(new Event('change',{bubbles:true}));}}function showKeyboard(inputElement){activeInput=inputElement;renderKeyboard();keyboardContainer.classList.add('vkb-visible');setTimeout(()=>{if(activeInput){activeInput.scrollIntoView({behavior:'smooth',block:'center'});}},250);}function hideKeyboard(){keyboardContainer.classList.remove('vkb-visible');if(activeInput){activeInput.blur();}activeInput=null;isShifted=false;currentLayout='default';}const validTypes=['text','email','number','password','search','tel','url'];document.addEventListener('focusin',function(e){const target=e.target;const isInput=target.tagName==='INPUT'&&validTypes.includes(target.type);const isTextArea=target.tagName==='TEXTAREA';if(isInput||isTextArea){if(activeInput!==target){showKeyboard(target);}}});document.addEventListener('pointerdown',function(e){if(keyboardContainer.classList.contains('vkb-visible')){const clickedInsideKeyboard=keyboardContainer.contains(e.target);const clickedOnInput=e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA';if(!clickedInsideKeyboard&&!clickedOnInput){hideKeyboard();}}});renderKeyboard();})();";
          await dev.cdp.send('Runtime.evaluate', { expression: kioskKeyboardScript });

      }
  }

  private async _dispatchTouchAsync(dev: DeviceSession, kind: TouchKind, x: number, y: number): Promise<void> {
    try {
      const id = 1; // single-finger id
      const rotated = mapPointForRotation(
        x, y,
        dev.cfg.width, dev.cfg.height,
        dev.cfg.rotation
      );
      const points = [{ x: rotated.x, y: rotated.y, radiusX: 1, radiusY: 1, force: 1, id }];

      switch (kind) {
        case TouchKind.Down:
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
          break;

        case TouchKind.Move:
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: points });
          break;

        case TouchKind.Up:
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          break;

        case TouchKind.Tap:
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: points });
          await dev.cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          break;
      }
    } catch (e) {
      console.warn(`Failed to dispatch touch event: ${(e as Error).message}`);
    }
  }
}
