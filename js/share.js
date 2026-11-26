// Sharing without a server: the puzzle "recipe" (and, for personal photos, a small copy of the
// photo) travels inside the link's #hash. The hash is never sent to any web server.

const b64url = s => btoa(s).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const unb64url = s => atob(s.replace(/-/g,'+').replace(/_/g,'/'));
const utf8 = s => String.fromCharCode(...new TextEncoder().encode(s));
const unutf8 = s => new TextDecoder().decode(Uint8Array.from(s, c => c.charCodeAt(0)));

export const QR_MAX = 900;          // longer links make QR codes too dense to scan from a screen

/** recipe: {src:{t:'scene',id,s}|{t:'pic',id}|{t:'album',u}|{t:'img'}, n, k, f?, m?}; img: dataURL for t:'img' */
export function makeLink(recipe, img){
  const base = location.href.split('#')[0];
  let h = 'p=' + b64url(utf8(JSON.stringify(recipe)));
  if(img){ const [head, data] = img.split(','); h += '&y=' + (head.includes('webp')?'w':'j') + '&i=' + data.replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
  return base + '#' + h;
}
export function readLink(hash = location.hash){
  if(!hash.startsWith('#p=')) return null;
  try{
    const q = new URLSearchParams(hash.slice(1));
    const recipe = JSON.parse(unutf8(unb64url(q.get('p'))));
    if(!recipe || !recipe.src || !recipe.n) return null;
    let img = null;
    if(q.get('i')){ const d = q.get('i').replace(/-/g,'+').replace(/_/g,'/');
      img = `data:image/${q.get('y')==='w'?'webp':'jpeg'};base64,` + d + '='.repeat((4-d.length%4)%4); }
    recipe.n = Math.min(48, Math.max(4, recipe.n|0)); recipe.k = recipe.k|0;
    return { recipe, img };
  }catch(_){ return null; }
}

/** Shrink a personal photo until it fits comfortably in a link (~40 KB). */
export function photoForLink(source){
  const webp = document.createElement('canvas').toDataURL('image/webp').startsWith('data:image/webp');
  for(const max of [900, 760, 640, 540, 440]) for(const q of [0.72, 0.6, 0.5]){
    const s = Math.min(1, max/Math.max(source.width, source.height)), c = document.createElement('canvas');
    c.width = Math.round(source.width*s); c.height = Math.round(source.height*s);
    c.getContext('2d').drawImage(source, 0, 0, c.width, c.height);
    const d = c.toDataURL(webp ? 'image/webp' : 'image/jpeg', q);
    if(d.length < 54000) return d;
  }
  return null;
}

/** Draw a QR code for text onto a canvas (needs the qrcode-generator CDN script). */
export function qrCanvas(text, px = 320){
  if(typeof qrcode !== 'function' || text.length > QR_MAX) return null;
  const q = qrcode(0, 'M'); q.addData(text); q.make();
  const n = q.getModuleCount(), quiet = 3, cell = Math.floor(px/(n+quiet*2)) || 1, size = cell*(n+quiet*2);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0,0,size,size); g.fillStyle = '#111';
  for(let r=0;r<n;r++) for(let k=0;k<n;k++) if(q.isDark(r,k)) g.fillRect((k+quiet)*cell, (r+quiet)*cell, cell, cell);
  return c;
}

export const canShareFiles = () => { try{ return !!navigator.canShare && navigator.canShare({ files:[new File([''], 'x.png', {type:'image/png'})] }); }catch(_){ return false; } };

/** Native share sheet (phones/tablets), falling back to copying the link. Returns 'shared'|'copied'|'cancelled'|'failed'. */
export async function shareLink({title, text, url}){
  if(navigator.share){
    try{ await navigator.share({ title, text, url }); return 'shared'; }
    catch(e){ if(e && e.name === 'AbortError') return 'cancelled'; }
  }
  return (await copy(url)) ? 'copied' : 'failed';
}
export async function shareImage(blob, name, text){
  const file = new File([blob], name, { type: blob.type });
  if(canShareFiles()){
    try{ await navigator.share({ files:[file], text }); return 'shared'; }
    catch(e){ if(e && e.name === 'AbortError') return 'cancelled'; }
  }
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
  return 'saved';
}
export async function copy(text){
  try{ await navigator.clipboard.writeText(text); return true; }
  catch(_){ const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select();
    let ok = false; try{ ok = document.execCommand('copy'); }catch(_){} t.remove(); return ok; }
}
export const smsHref = body => 'sms:?&body=' + encodeURIComponent(body);
export const mailHref = (subject, body) => `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** A keepsake "postcard" image of the finished puzzle, with a QR code to play it when possible. */
export async function postcard({image, name, pieces, seconds, title, link}){
  const W = 1080, H = 1350, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  g.fillStyle = '#fbf4e6'; g.fillRect(0,0,W,H);
  g.strokeStyle = '#d9c7a3'; g.lineWidth = 14; g.strokeRect(22,22,W-44,H-44);
  // framed picture
  const ar = image.width/image.height; let pw = W-160, ph = pw/ar; if(ph > 760){ ph = 760; pw = ph*ar; }
  const px = (W-pw)/2, py = 90;
  g.save(); g.shadowColor = 'rgba(0,0,0,.25)'; g.shadowBlur = 24; g.shadowOffsetY = 10;
  g.fillStyle = '#fff'; g.fillRect(px-18, py-18, pw+36, ph+36); g.restore();
  g.drawImage(image, px, py, pw, ph);
  const qr = link && qrCanvas(link, 240), tw = qr ? W-440 : W-160;      // keep text clear of the QR code
  g.fillStyle = '#2b2118'; g.textAlign = 'left';
  const ty = py + ph + 100;
  g.font = 'bold 56px Georgia, serif';
  g.fillText(name ? `${name} finished it!` : 'Puzzle finished!', 80, ty, tw);
  g.font = '34px Georgia, serif'; g.fillStyle = '#5a4a3a';
  const mins = Math.max(1, Math.round(seconds/60));
  g.fillText(`${pieces} pieces · ${mins} minute${mins===1?'':'s'}`, 80, ty+60, tw);
  if(title) g.fillText(title, 80, ty+108, tw);
  g.fillText(new Date().toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric'}), 80, ty+156, tw);
  if(qr){
    g.drawImage(qr, W-80-240, H-70-240, 240, 240);
    g.font = '24px Georgia, serif'; g.textAlign = 'center';
    g.fillText('Scan to play it too', W-80-120, H-70-252);
  }
  return new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.9));
}
